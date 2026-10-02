import { createHash } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { newId } from "../ids";
import {
  DEFAULT_CHUNK_SIZE,
  PLATFORM_MAX_BYTES,
  allowedUploadMime,
  chunkCount as planChunks,
  missingChunks,
} from "../media-pipeline";

export type MediaUploadRow = {
  id: string;
  user_id: string;
  purpose: string;
  mime: string;
  filename: string | null;
  total_bytes: number;
  chunk_size: number;
  chunk_count: number;
  received_count: number;
  checksum: string | null;
  status: string;
  fail_reason: string | null;
  blob_b64: string | null;
  media_url: string | null;
  thumb_url: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  file_size: number | null;
  idempotency_key: string | null;
  published_id: string | null;
  conversation_id: string | null;
};

function sha256(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function platformMax(): number {
  const n = Number(process.env.NYX_MEDIA_MAX_BYTES ?? PLATFORM_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : PLATFORM_MAX_BYTES;
}

export async function startMediaUpload(
  sql: Sql,
  opts: {
    userId: string;
    purpose: string;
    mime: string;
    filename?: string | null;
    totalBytes: number;
    chunkSize?: number;
    checksum?: string | null;
    idempotencyKey?: string | null;
    conversationId?: string | null;
  },
): Promise<{ id: string; chunkSize: number; chunkCount: number; maxBytes: number; received: number[]; status: string }> {
  const maxBytes = platformMax();
  if (!allowedUploadMime(opts.mime)) throw new Error("That file type isn’t allowed.");
  if (opts.totalBytes <= 0) throw new Error("That file is empty.");
  if (opts.totalBytes > maxBytes) {
    throw new Error(`This platform accepts files up to ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
  const chunkSize = Math.min(Math.max(opts.chunkSize ?? DEFAULT_CHUNK_SIZE, 32 * 1024), 512 * 1024);
  const chunkCount = planChunks(opts.totalBytes, chunkSize);
  if (opts.idempotencyKey) {
    const existing = await sql<MediaUploadRow>`
      select * from media_uploads where user_id = ${opts.userId} and idempotency_key = ${opts.idempotencyKey} limit 1
    `.catch(() => []);
    if (existing[0]) {
      const received = await receivedIndexes(sql, existing[0].id);
      return {
        id: existing[0].id,
        chunkSize: existing[0].chunk_size,
        chunkCount: existing[0].chunk_count,
        maxBytes,
        received,
        status: existing[0].status,
      };
    }
  }
  const id = newId("up");
  await sql`
    insert into media_uploads (
      id, user_id, purpose, mime, filename, total_bytes, chunk_size, chunk_count,
      checksum, status, idempotency_key, conversation_id, file_size
    ) values (
      ${id}, ${opts.userId}, ${opts.purpose}, ${opts.mime.slice(0, 80)},
      ${(opts.filename ?? "upload").slice(0, 180)}, ${opts.totalBytes}, ${chunkSize}, ${chunkCount},
      ${opts.checksum ?? null}, 'uploading', ${opts.idempotencyKey ?? null},
      ${opts.conversationId ?? null}, ${opts.totalBytes}
    )
  `;
  return { id, chunkSize, chunkCount, maxBytes, received: [], status: "uploading" };
}

export async function receivedIndexes(sql: Sql, uploadId: string): Promise<number[]> {
  const rows = await sql<{ idx: number }>`select idx from media_upload_chunks where upload_id = ${uploadId} order by idx`;
  return rows.map((r) => r.idx);
}

export async function putMediaChunk(
  sql: Sql,
  opts: { userId: string; uploadId: string; index: number; bytes: Buffer; checksum: string },
): Promise<{ receivedCount: number; chunkCount: number; duplicate: boolean }> {
  const row = await sql<MediaUploadRow>`
    select * from media_uploads where id = ${opts.uploadId} and user_id = ${opts.userId} limit 1
  `;
  if (!row[0]) throw new Error("Upload session not found.");
  if (row[0].status === "cancelled") throw new Error("This upload was cancelled.");
  if (row[0].status === "failed") throw new Error(row[0].fail_reason || "This upload failed. Start it again.");
  if (["ready", "publishing", "published", "upload_complete", "processing"].includes(row[0].status)) {
    return { receivedCount: row[0].chunk_count, chunkCount: row[0].chunk_count, duplicate: true };
  }
  if (opts.index < 0 || opts.index >= row[0].chunk_count) throw new Error("Invalid chunk.");
  const expect = sha256(opts.bytes);
  if (expect !== opts.checksum.toLowerCase()) {
    throw new Error("Chunk did not match its checksum. It will be retried.");
  }
  const b64 = opts.bytes.toString("base64");
  await sql`
    insert into media_upload_chunks (upload_id, idx, data, bytes, checksum)
    values (${opts.uploadId}, ${opts.index}, ${b64}, ${opts.bytes.length}, ${expect})
    on conflict (upload_id, idx) do nothing
  `;
  const received = await receivedIndexes(sql, opts.uploadId);
  await sql`
    update media_uploads set received_count = ${received.length}, updated_at = now()
    where id = ${opts.uploadId}
  `;
  return { receivedCount: received.length, chunkCount: row[0].chunk_count, duplicate: received.length !== row[0].received_count + 1 && received.includes(opts.index) };
}

export async function completeMediaUpload(
  sql: Sql,
  opts: {
    userId: string;
    uploadId: string;
    thumbUrl?: string | null;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
  },
): Promise<MediaUploadRow> {
  const row = await sql<MediaUploadRow>`
    select * from media_uploads where id = ${opts.uploadId} and user_id = ${opts.userId} limit 1
  `;
  if (!row[0]) throw new Error("Upload session not found.");
  if (row[0].status === "ready" || row[0].status === "published" || row[0].status === "publishing") {
    return row[0];
  }
  await sql`update media_uploads set status = 'processing', updated_at = now() where id = ${opts.uploadId}`;
  const received = await receivedIndexes(sql, opts.uploadId);
  const missing = missingChunks(row[0].chunk_count, received);
  if (missing.length) {
    await sql`
      update media_uploads set status = 'uploading', fail_reason = ${`Missing ${missing.length} chunk(s).`}, updated_at = now()
      where id = ${opts.uploadId}
    `;
    throw new Error("Upload is incomplete. Missing chunks will be retried.");
  }
  const parts = await sql.query<{ idx: number; data: string; bytes: number }>(
    `select idx, data, bytes from media_upload_chunks where upload_id = $1 order by idx`,
    [opts.uploadId],
  );
  const buffers = parts.map((p) => Buffer.from(p.data, "base64"));
  const full = Buffer.concat(buffers);
  if (full.length !== Number(row[0].total_bytes)) {
    await sql`
      update media_uploads set status = 'failed', fail_reason = ${"Assembled file size did not match the original."}, updated_at = now()
      where id = ${opts.uploadId}
    `;
    throw new Error("Video processing failed. Retry processing.");
  }
  if (row[0].checksum) {
    const got = sha256(full);
    if (got !== row[0].checksum.toLowerCase()) {
      await sql`
        update media_uploads set status = 'failed', fail_reason = ${"File checksum did not match."}, updated_at = now()
        where id = ${opts.uploadId}
      `;
      throw new Error("Video processing failed. Retry processing.");
    }
  }
  const mime = row[0].mime.toLowerCase();
  if (!allowedUploadMime(mime)) {
    await sql`update media_uploads set status = 'failed', fail_reason = ${"File type not allowed."}, updated_at = now() where id = ${opts.uploadId}`;
    throw new Error("That file type isn’t allowed.");
  }
  const mediaUrl = `/api/media/${opts.uploadId}`;
  await sql`
    update media_uploads set
      status = 'ready',
      blob_b64 = ${full.toString("base64")},
      media_url = ${mediaUrl},
      thumb_url = ${opts.thumbUrl ?? row[0].thumb_url},
      width = ${opts.width ?? row[0].width},
      height = ${opts.height ?? row[0].height},
      duration_ms = ${opts.durationMs ?? row[0].duration_ms},
      file_size = ${full.length},
      fail_reason = null,
      updated_at = now()
    where id = ${opts.uploadId}
  `;
  await sql`delete from media_upload_chunks where upload_id = ${opts.uploadId}`;
  const done = await sql<MediaUploadRow>`select * from media_uploads where id = ${opts.uploadId} limit 1`;
  return done[0]!;
}

export async function getOwnedUpload(sql: Sql, userId: string, uploadId: string): Promise<MediaUploadRow | null> {
  const rows = await sql<MediaUploadRow>`
    select * from media_uploads where id = ${uploadId} and user_id = ${userId} limit 1
  `;
  return rows[0] ?? null;
}

export async function getUpload(sql: Sql, uploadId: string): Promise<MediaUploadRow | null> {
  const rows = await sql<MediaUploadRow>`select * from media_uploads where id = ${uploadId} limit 1`;
  return rows[0] ?? null;
}

export async function markUploadPublished(sql: Sql, uploadId: string, publishedId: string): Promise<void> {
  await sql`
    update media_uploads set status = 'published', published_id = ${publishedId}, updated_at = now()
    where id = ${uploadId}
  `;
}

export async function cancelUpload(sql: Sql, userId: string, uploadId: string): Promise<void> {
  await sql`
    update media_uploads set status = 'cancelled', updated_at = now()
    where id = ${uploadId} and user_id = ${userId} and status in ('uploading', 'failed')
  `;
  await sql`delete from media_upload_chunks where upload_id = ${uploadId}`;
}

export { platformMax, sha256 };

export async function sqlClient(): Promise<Sql> {
  return getSql();
}
