import { createFileRoute } from "@tanstack/react-router";
import { sqlClient } from "@/lib/kchat/server/helpers";
import { jsonError, requireMediaUser } from "@/lib/kchat/server/media-http";
import { getUpload } from "@/lib/kchat/server/media-upload";

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= size || start > end) return null;
  return { start, end };
}

async function canRead(opts: { userId: string; upload: NonNullable<Awaited<ReturnType<typeof getUpload>>> }): Promise<boolean> {
  if (opts.upload.user_id === opts.userId) return true;
  const sql = await sqlClient();
  if (opts.upload.purpose === "chat" && opts.upload.conversation_id) {
    const m = await sql<{ n: number }>`
      select count(*)::int as n from conversation_members
      where conversation_id = ${opts.upload.conversation_id} and user_id = ${opts.userId}
    `;
    return (m[0]?.n ?? 0) > 0;
  }
  if (opts.upload.purpose === "video" && opts.upload.published_id) {
    const v = await sql<{ n: number }>`
      select count(*)::int as n from videos
      where id = ${opts.upload.published_id} and is_removed = false
        and not exists (
          select 1 from blocks b
          where (b.blocker_id = ${opts.userId} and b.blocked_id = videos.author_id)
             or (b.blocker_id = videos.author_id and b.blocked_id = ${opts.userId})
        )
    `;
    return (v[0]?.n ?? 0) > 0;
  }
  if (opts.upload.purpose === "status" && opts.upload.published_id) {
    const s = await sql<{ author_id: string }>`
      select author_id from statuses where id = ${opts.upload.published_id} and expires_at > now()
    `;
    return Boolean(s[0]);
  }
  if (opts.upload.purpose === "post" && opts.upload.published_id) {
    const p = await sql<{ n: number }>`select count(*)::int as n from posts where id = ${opts.upload.published_id} and is_removed = false`;
    return (p[0]?.n ?? 0) > 0;
  }
  return false;
}

async function get({ request, params }: { request: Request; params: { id: string } }) {
  let userId: string;
  try {
    userId = await requireMediaUser(request);
  } catch {
    return jsonError("Sign in to view this media.", 401);
  }
  const id = params.id;
  if (!id) return jsonError("Missing id.", 404);
  try {
    const sql = await sqlClient();
    const upload = await getUpload(sql, id);
    if (!upload || !upload.blob_b64) return jsonError("Media not found.", 404);
    if (upload.status === "cancelled" || upload.status === "failed") return jsonError("Media not found.", 404);
    if (!(await canRead({ userId, upload }))) return jsonError("You cannot view this media.", 403);
    const buf = Buffer.from(upload.blob_b64, "base64");
    const mime = upload.mime || "application/octet-stream";
    const range = parseRange(request.headers.get("range"), buf.length);
    if (range) {
      const slice = buf.subarray(range.start, range.end + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(slice.length),
          "Content-Range": `bytes ${range.start}-${range.end}/${buf.length}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=60",
        },
      });
    }
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(buf.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not read media.", 400);
  }
}

export const Route = createFileRoute("/api/media/$id")({
  server: { handlers: { GET: get } },
});
