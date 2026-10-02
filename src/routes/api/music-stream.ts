import { createFileRoute } from "@tanstack/react-router";
import { requireMediaUser } from "@/lib/kchat/server/media-http";
import {
  contentSpan,
  entireTrackRange,
  isStreamableAudioType,
  parseAudioSource,
  redirectTargetAllowed,
  safeRangeHeader,
  spanReachesEnd,
  streamContentType,
  typeFromAudioMagic,
} from "@/lib/kchat/music-stream";
import { takeToken, rateError } from "@/lib/kchat/rate-limit";

const MAX_HOPS = 3;

function denied(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

type UpstreamHit = { response: Response; url: URL };

function isHit(value: UpstreamHit | Response): value is UpstreamHit {
  return "response" in value && "url" in value;
}

async function fetchUpstream(target: URL, range: string | null, signal: AbortSignal, root: URL = target): Promise<UpstreamHit | Response> {
  let current = target;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const headers = new Headers({
      Accept: "audio/*,application/octet-stream;q=0.8,*/*;q=0.1",
      "User-Agent": "NYX-Music/1.0",
    });
    if (range) headers.set("Range", range);
    const upstream = await fetch(current, {
      method: "GET",
      headers,
      redirect: "manual",
      signal,
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel().catch(() => undefined);
      const loc = upstream.headers.get("location");
      if (!loc || hop === MAX_HOPS) return denied(hop === MAX_HOPS ? "The audio host redirected too many times." : "The audio file could not be fetched.", 502);
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return denied("The audio file could not be fetched.", 502);
      }
      if (current.protocol === "https:" && next.protocol !== "https:") {
        return denied("That audio host isn’t allowed.", 502);
      }
      const allowed = redirectTargetAllowed(current, next, root);
      if (!allowed) return denied("That audio host isn’t allowed.", 502);
      current = allowed;
      continue;
    }
    return { response: upstream, url: current };
  }
  return denied("The audio host redirected too many times.", 502);
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

/** If an upstream window stops early, keep reading until the last byte. One response to the client. */
function throughEnd(
  first: ReadableStream<Uint8Array>,
  url: URL,
  span: { start: number; end: number; total: number },
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let current: ReadableStream<Uint8Array> | null = first;
  let cursor = span.end + 1;
  let parts = 0;
  return new ReadableStream({
    async pull(controller) {
      if (!reader && current) reader = current.getReader();
      if (reader) {
        const next = await reader.read();
        if (!next.done) {
          controller.enqueue(next.value);
          return;
        }
        reader.releaseLock();
        reader = null;
        current = null;
      }
      if (cursor >= span.total) {
        controller.close();
        return;
      }
      if (++parts > 8192) {
        controller.error(new Error("short audio"));
        return;
      }
      const part = await fetchUpstream(url, `bytes=${cursor}-`, signal, url);
      if (!isHit(part) || !part.response.body || !(part.response.ok || part.response.status === 206)) {
        if (isHit(part)) await part.response.body?.cancel().catch(() => undefined);
        controller.error(new Error("short audio"));
        return;
      }
      const partSpan = contentSpan(part.response.headers.get("content-range"));
      if (partSpan) {
        if (partSpan.end + 1 <= cursor) {
          await part.response.body.cancel().catch(() => undefined);
          controller.error(new Error("short audio"));
          return;
        }
        cursor = partSpan.end + 1;
      } else {
        cursor = span.total;
      }
      url = part.url;
      current = part.response.body;
      reader = current.getReader();
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader?.cancel(reason);
    },
  });
}

async function openUpstream(target: URL, range: string | null, signal: AbortSignal): Promise<Response> {
  const hit = await fetchUpstream(target, range, signal);
  if (!isHit(hit)) return hit;
  const upstream = hit.response;
  if (upstream.status === 416) {
    await upstream.body?.cancel().catch(() => undefined);
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (!(upstream.ok || upstream.status === 206) || !upstream.body) {
    await upstream.body?.cancel().catch(() => undefined);
    return denied("The audio file could not be fetched.", 502);
  }
  const rawType = upstream.headers.get("content-type") || "";
  let body: ReadableStream<Uint8Array> = upstream.body;
  let type = streamContentType(rawType);
  if (!isStreamableAudioType(rawType)) {
    const peeked = await readHead(upstream.body);
    const magic = typeFromAudioMagic(peeked.head);
    if (!magic) {
      await peeked.rest.cancel().catch(() => undefined);
      return denied("The audio file could not be fetched.", 502);
    }
    type = magic;
    body = prepend(peeked.head, peeked.rest);
  }
  const span = contentSpan(upstream.headers.get("content-range"));
  const complete = upstream.status !== 206 || spanReachesEnd(span);
  if (!complete && span) body = throughEnd(body, hit.url, span, signal);
  const out = new Headers({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  const length = upstream.headers.get("content-length");
  if (span && span.start > 0) {
    out.set("Content-Range", `bytes ${span.start}-${span.total - 1}/${span.total}`);
    out.set("Content-Length", String(span.total - span.start));
    return new Response(body, { status: 206, headers: out });
  }
  if (span) out.set("Content-Length", String(span.total));
  else if (length && /^\d+$/.test(length) && upstream.status === 200) out.set("Content-Length", length);
  return new Response(body, { status: 200, headers: out });
}

async function handle({ request }: { request: Request }) {
  let userId = "";
  try {
    userId = await requireMediaUser(request);
  } catch {
    return denied("Sign in to play this track.", 401);
  }
  const wait = takeToken(`music-stream:${userId}`, 180, 60_000);
  if (wait) return denied(rateError(wait), 429);

  const src = new URL(request.url).searchParams.get("u") ?? "";
  const target = parseAudioSource(src);
  if (!target) return denied("That audio host isn’t allowed.", 400);

  const requested = request.headers.get("range");
  if (requested && !safeRangeHeader(requested)) return denied("That audio range isn’t valid.", 416);

  try {
    return await openUpstream(target, entireTrackRange(requested), request.signal);
  } catch {
    return denied("The audio file could not be fetched.", 502);
  }
}

export const Route = createFileRoute("/api/music-stream")({
  server: { handlers: { GET: handle } },
});
