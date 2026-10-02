/** Same-origin audio streaming. One response is the whole licensed file — no byte window and no time cutoff. */

import type { AudioSource } from "./music";

const ALLOWED_HOST =
  /(^|\.)jamendo\.com$|(^|\.)jamendo\.net$|(^|\.)itunes\.apple\.com$|(^|\.)mzstatic\.com$|(^|\.)audius\.co$|(^|\.)archive\.org$|(^|\.)supabase\.co$|\.amazonaws\.com$|\.cloudfront\.net$|\.r2\.dev$|\.r2\.cloudflarestorage\.com$|\.blob\.core\.windows\.net$|\.googleusercontent\.com$|\.storage\.googleapis\.com$/i;

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

export function audioHostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (isIpLiteral(host)) return false;
  return ALLOWED_HOST.test(host);
}

/** https audio URL on an allowlisted public host. Rejects credentials, http, and IP literals. */
export function parseAudioSource(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (!audioHostAllowed(parsed.hostname)) return null;
  return parsed;
}

export function isAudiusHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "audius.co" || host.endsWith(".audius.co");
}

function publicHttpsHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (isIpLiteral(host)) return false;
  return true;
}

/**
 * Redirect target for a stream or download.
 * Allowlisted hosts always pass.
 * If the original URL is Audius, later hops may land on Audius content nodes.
 */
export function redirectTargetAllowed(from: URL, next: URL, root?: URL): URL | null {
  if (next.username || next.password) return null;
  const direct = parseAudioSource(next.toString());
  if (direct) return direct;
  if (next.protocol !== "https:" || !publicHttpsHost(next.hostname)) return null;
  const startedOnAudius = isAudiusHost((root ?? from).hostname) || isAudiusHost(from.hostname);
  if (!startedOnAudius) return null;
  return next;
}

export function musicStreamPath(remote: string): string | null {
  if (!parseAudioSource(remote)) return null;
  return `/api/music-stream?u=${encodeURIComponent(remote.trim())}`;
}

/** Proxy first so playback is same-origin and seekable. Direct URL stays as the fallback. */
export function streamPlaybackSources(sources: AudioSource[]): AudioSource[] {
  const out: AudioSource[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const proxied = musicStreamPath(source.src);
    if (proxied && !seen.has(proxied)) {
      seen.add(proxied);
      out.push({ src: proxied, type: source.type });
    }
    if (source.src && !seen.has(source.src)) {
      seen.add(source.src);
      out.push(source);
    }
  }
  return out;
}

export function safeRangeHeader(header: string | null): string | null {
  if (!header) return null;
  const value = header.trim();
  if (!/^bytes=\d*-\d*$/.test(value)) return null;
  return value;
}

/**
 * Range to forward. A request that starts at byte 0 is the entire track, so no
 * Range is sent. A seek keeps its start and drops any end so the response runs
 * through the last byte instead of stopping on a window.
 */
export function entireTrackRange(header: string | null): string | null {
  const safe = safeRangeHeader(header);
  if (!safe) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(safe);
  if (!match) return null;
  const startRaw = match[1] ?? "";
  if (!startRaw) return null;
  const start = Number(startRaw);
  if (!Number.isSafeInteger(start) || start <= 0) return null;
  return `bytes=${start}-`;
}

export function contentSpan(header: string | null): { start: number; end: number; total: number } | null {
  if (!header) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)) return null;
  if (start < 0 || end < start || total <= 0 || end >= total) return null;
  return { start, end, total };
}

/** True when this part already includes the last byte, or the length is unknown. */
export function spanReachesEnd(span: { end: number; total: number } | null): boolean {
  if (!span) return true;
  return span.end >= span.total - 1;
}

function ascii(buf: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(buf[offset + i] ?? 0);
  return out;
}

/** File signature for a full audio file. Null when the bytes are a document. */
export function typeFromAudioMagic(buf: Uint8Array): string | null {
  if (buf.length < 3) return null;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "audio/mpeg";
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (buf.length >= 8 && ascii(buf, 4, 4) === "ftyp") return "audio/mp4";
  if (buf.length >= 4 && ascii(buf, 0, 4) === "OggS") return "audio/ogg";
  if (buf.length >= 12 && ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WAVE") return "audio/wav";
  if (buf.length >= 4 && ascii(buf, 0, 4) === "fLaC") return "audio/flac";
  return null;
}

export function isStreamableAudioType(type: string): boolean {
  const t = (type.split(";")[0] || "").trim().toLowerCase();
  if (!t) return true;
  if (t.startsWith("text/") || t.includes("html") || t.includes("json") || t.includes("xml")) return false;
  if (t.startsWith("audio/")) return true;
  return t === "application/octet-stream" || t === "binary/octet-stream" || t === "application/ogg" || t === "video/mp4";
}

/** Normalize odd licensed types. iTunes previews are audio/x-m4p; media elements want audio/mp4. */
export function streamContentType(type: string): string {
  const t = (type.split(";")[0] || "").trim().toLowerCase();
  if (!t || t === "application/octet-stream" || t === "binary/octet-stream") return "application/octet-stream";
  if (t === "audio/x-m4a" || t === "audio/x-m4p" || t === "audio/m4a" || t === "audio/mp4a-latm" || t === "video/mp4") return "audio/mp4";
  if (t === "audio/mp3" || t === "audio/x-mpeg" || t === "audio/mpeg3") return "audio/mpeg";
  if (t === "audio/x-wav" || t === "audio/wave") return "audio/wav";
  return t.startsWith("audio/") || t === "application/ogg" ? t : "application/octet-stream";
}

/** Catalog URL hidden inside a same-origin stream URL, otherwise the src itself. */
export function remoteAudioUrl(src: string): string {
  try {
    const url = new URL(src, "https://nyx.invalid");
    if (url.pathname !== "/api/music-stream") return src;
    const remote = url.searchParams.get("u") ?? "";
    return parseAudioSource(remote) ? remote : src;
  } catch {
    return src;
  }
}
