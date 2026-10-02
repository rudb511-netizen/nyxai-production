import { createFileRoute } from "@tanstack/react-router";
import { takeToken, rateError } from "@/lib/kchat/rate-limit";
import { sqlClient } from "@/lib/kchat/server/helpers";
import { jsonError, requireMediaUser } from "@/lib/kchat/server/media-http";
import { completeMediaUpload } from "@/lib/kchat/server/media-upload";

async function post({ request }: { request: Request }) {
  let userId: string;
  try {
    userId = await requireMediaUser(request);
  } catch {
    return jsonError("Sign in to upload.", 401);
  }
  const wait = takeToken(`media-complete:${userId}`, 20, 60_000);
  if (wait) return jsonError(rateError(wait), 429);
  let body: { id?: string; thumbUrl?: string | null; width?: number | null; height?: number | null; durationMs?: number | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid request.");
  }
  if (!body.id) return jsonError("Missing upload id.");
  try {
    const sql = await sqlClient();
    const row = await completeMediaUpload(sql, {
      userId,
      uploadId: body.id,
      thumbUrl: body.thumbUrl ?? null,
      width: body.width ?? null,
      height: body.height ?? null,
      durationMs: body.durationMs ?? null,
    });
    return Response.json({
      id: row.id,
      status: row.status,
      mediaUrl: row.media_url,
      thumbUrl: row.thumb_url,
      width: row.width,
      height: row.height,
      durationMs: row.duration_ms,
      bytes: row.file_size,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not finalize upload.", 400);
  }
}

export const Route = createFileRoute("/api/media/complete")({
  server: { handlers: { POST: post } },
});
