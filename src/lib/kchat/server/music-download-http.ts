import { takeToken, rateError } from "../rate-limit";
import { requireMediaUser } from "./media-http";
import { sqlClient } from "./helpers";
import { DownloadError, loadTrackForDownload } from "./music";
import { streamTrackDownload } from "./audio-download";
import { DOWNLOAD_FAILED, DOWNLOAD_INTERRUPTED, FULL_DOWNLOAD_UNAVAILABLE } from "../music";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Track id only. Rejects ?u= / ?url= so this cannot be an open download proxy. */
export function trackIdFromDownloadRequest(url: URL, routeId?: string | null): string | null {
  if (url.searchParams.has("u") || url.searchParams.has("url")) return null;
  const raw = (routeId || url.searchParams.get("id") || "").trim();
  if (!raw || raw.includes("://")) return null;
  return raw;
}

export async function handleMusicDownload(request: Request, routeId?: string | null): Promise<Response> {
  let userId = "";
  try {
    userId = await requireMediaUser(request);
  } catch {
    return jsonError("Sign in to download this track.", 401);
  }
  const wait = takeToken(`music-dl:${userId}`, 20, 60_000);
  if (wait) return jsonError(rateError(wait), 429);
  const id = trackIdFromDownloadRequest(new URL(request.url), routeId);
  if (!id) return jsonError(FULL_DOWNLOAD_UNAVAILABLE, 400);
  try {
    const sql = await sqlClient();
    const track = await loadTrackForDownload(sql, id);
    return await streamTrackDownload(track, request.signal);
  } catch (error) {
    if (error instanceof DownloadError) return jsonError(error.message, error.status);
    if (error instanceof Error && error.name === "AbortError") return jsonError(DOWNLOAD_INTERRUPTED, 502);
    return jsonError(DOWNLOAD_FAILED, 502);
  }
}
