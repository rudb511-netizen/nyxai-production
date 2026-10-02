import {
  contentDisposition,
  filenameForTrack,
  isPreviewAudioUrl,
  type MusicTrack,
  DOWNLOAD_FAILED,
  FULL_DOWNLOAD_UNAVAILABLE,
} from "../music";
import {
  isStreamableAudioType,
  parseAudioSource,
  redirectTargetAllowed,
  streamContentType,
  typeFromAudioMagic,
} from "../music-stream";
import { DownloadError } from "./music";

const MAX_HOPS = 4;

function logDownload(fields: Record<string, string | number | null>): void {
  console.info("[nyx-download]", fields);
}

async function readHead(body: ReadableStream<Uint8Array>, bytes = 16): Promise<{ head: Uint8Array; rest: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < bytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const head = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    head.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const rest = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { head, rest };
}

function prepend(head: Uint8Array, rest: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let pending = head.byteLength > 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream({
    async pull(controller) {
      if (pending) {
        pending = false;
        controller.enqueue(head);
        return;
      }
      reader ??= rest.getReader();
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader ? reader.cancel(reason) : rest.cancel(reason);
    },
  });
}

type Hit = { response: Response; url: URL };

/** Follow provider redirects. The whole file is one response — no byte window and no timer cutoff. */
async function fetchWholeFile(target: URL, signal: AbortSignal): Promise<Hit> {
  let current = target;
  const root = target;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const upstream = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        Accept: "audio/*,application/octet-stream;q=0.8,*/*;q=0.1",
        "User-Agent": "NYX-Music/1.0",
      },
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel().catch(() => undefined);
      const loc = upstream.headers.get("location");
      if (!loc || hop === MAX_HOPS) throw new DownloadError(DOWNLOAD_FAILED, 502);
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        throw new DownloadError(DOWNLOAD_FAILED, 502);
      }
      if (current.protocol === "https:" && next.protocol !== "https:") throw new DownloadError(FULL_DOWNLOAD_UNAVAILABLE, 502);
      const allowed = redirectTargetAllowed(current, next, root);
      if (!allowed || isPreviewAudioUrl(allowed.toString())) throw new DownloadError(FULL_DOWNLOAD_UNAVAILABLE, 403);
      current = allowed;
      continue;
    }
    return { response: upstream, url: current };
  }
  throw new DownloadError(DOWNLOAD_FAILED, 502);
}

export async function streamTrackDownload(track: MusicTrack, signal: AbortSignal): Promise<Response> {
  const remote = track.downloadUrl;
  if (!remote || isPreviewAudioUrl(remote) || /\/stream(\?|$)/.test(remote)) {
    throw new DownloadError(FULL_DOWNLOAD_UNAVAILABLE, 403);
  }
  const target = parseAudioSource(remote);
  if (!target) throw new DownloadError(FULL_DOWNLOAD_UNAVAILABLE, 403);
  const hit = await fetchWholeFile(target, signal);
  const upstream = hit.response;
  if (!(upstream.ok || upstream.status === 206) || !upstream.body) {
    await upstream.body?.cancel().catch(() => undefined);
    logDownload({
      trackId: track.id,
      provider: track.provider,
      status: upstream.status,
      contentType: upstream.headers.get("content-type"),
      bytes: null,
    });
    throw new DownloadError(upstream.status === 404 ? "Full track unavailable for download." : DOWNLOAD_FAILED, 502);
  }
  const rawType = upstream.headers.get("content-type") || "";
  let body: ReadableStream<Uint8Array> = upstream.body;
  let type = streamContentType(rawType);
  if (!isStreamableAudioType(rawType) || type === "application/octet-stream") {
    const peeked = await readHead(upstream.body);
    const magic = typeFromAudioMagic(peeked.head);
    if (!magic) {
      await peeked.rest.cancel().catch(() => undefined);
      logDownload({ trackId: track.id, provider: track.provider, status: 502, contentType: rawType || null, bytes: null });
      throw new DownloadError("Full track unavailable for download.", 502);
    }
    type = magic;
    body = prepend(peeked.head, peeked.rest);
  }
  const filename = filenameForTrack(track.title, remote, type);
  const length = upstream.headers.get("content-length");
  const headers = new Headers({
    "Content-Type": type,
    "Content-Disposition": contentDisposition(filename),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Nyx-Track": track.id,
    "X-Nyx-Provider": track.provider,
    "X-Nyx-Download": "full",
  });
  if (length && /^\d+$/.test(length) && upstream.status === 200) headers.set("Content-Length", length);
  logDownload({
    trackId: track.id,
    provider: track.provider,
    status: 200,
    contentType: type,
    bytes: length && /^\d+$/.test(length) ? Number(length) : null,
  });
  return new Response(body, { status: 200, headers });
}
