import { createFileRoute } from "@tanstack/react-router";
import { takeToken, rateError } from "@/lib/kchat/rate-limit";
import { sqlClient } from "@/lib/kchat/server/helpers";
import { jsonError, requireMediaUser } from "@/lib/kchat/server/media-http";
import { cancelUpload, putMediaChunk, receivedIndexes, startMediaUpload } from "@/lib/kchat/server/media-upload";

async function post({ request }: { request: Request }) {
  let userId: string;
  try {
    userId = await requireMediaUser(request);
  } catch {
    return jsonError("Sign in to upload.", 401);
  }
  const wait = takeToken(`media-start:${userId}`, 20, 60_000);
  if (wait) return jsonError(rateError(wait), 429);
  let body: {
    purpose?: string;
    mime?: string;
    filename?: string;
    totalBytes?: number;
    chunkSize?: number;
    checksum?: string;
    idempotencyKey?: string;
    conversationId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid upload request.");
  }
  const purpose = body.purpose ?? "video";
  if (!["video", "status", "post", "chat", "story"].includes(purpose)) {
    return jsonError("Unknown upload purpose.");
  }
  try {
    const sql = await sqlClient();
    const started = await startMediaUpload(sql, {
      userId,
      purpose,
      mime: body.mime ?? "application/octet-stream",
      filename: body.filename ?? null,
      totalBytes: Number(body.totalBytes) || 0,
      chunkSize: body.chunkSize,
      checksum: body.checksum ?? null,
      idempotencyKey: body.idempotencyKey ?? null,
      conversationId: body.conversationId ?? null,
    });
    return Response.json(started);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not start upload.", 400);
  }
}

async function put({ request }: { request: Request }) {
  let userId: string;
  try {
    userId = await requireMediaUser(request);
  } catch {
    return jsonError("Sign in to upload.", 401);
  }
  const wait = takeToken(`media-chunk:${userId}`, 240, 60_000);
  if (wait) return jsonError(rateError(wait), 429);
  const url = new URL(request.url);
  const uploadId = url.searchParams.get("id") ?? "";
  const index = Number(url.searchParams.get("i"));
  const checksum = (request.headers.get("x-nyx-checksum") ?? url.searchParams.get("checksum") ?? "").toLowerCase();
  if (!uploadId || !Number.isInteger(index)) return jsonError("Missing chunk coordinates.");
  const buf = Buffer.from(await request.arrayBuffer());
  if (!buf.length) return jsonError("Empty chunk.");
  try {
    const sql = await sqlClient();
    const r = await putMediaChunk(sql, { userId, uploadId, index, bytes: buf, checksum });
    return Response.json(r);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not store chunk.", 400);
  }
}

async function get({ request }: { request: Request }) {
  let userId: string;
  try {
    userId = await requireMediaUser(request);
  } catch {
    return jsonError("Sign in to upload.", 401);
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return jsonError("Missing upload id.");
  try {
    const sql = await sqlClient();
    const row = await sql<{
      status: string;
      received_count: number;
      chunk_count: number;
      fail_reason: string | null;
      media_url: string | null;
    }>`select status, received_count, chunk_count, fail_reason, media_url from media_uploads where id = ${id} and user_id = ${userId} limit 1`;
    if (!row[0]) return jsonError("Upload session not found.", 404);
    const received = await receivedIndexes(sql, id);
    return Response.json({ ...row[0], received });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not read upload.", 400);
  }
}

async function del({ request }: { request: Request }) {
  let userId: string;
  try {
    userId = await requireMediaUser(request);
  } catch {
    return jsonError("Sign in to upload.", 401);
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return jsonError("Missing upload id.");
  try {
    const sql = await sqlClient();
    await cancelUpload(sql, userId, id);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not cancel.", 400);
  }
}

export const Route = createFileRoute("/api/media/upload")({
  server: { handlers: { GET: get, POST: post, PUT: put, DELETE: del } },
});
