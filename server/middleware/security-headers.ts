/**
 * Production (Nitro) security headers. Do not set X-Frame-Options — the live
 * preview is iframed on grok.com and SAMEORIGIN would blank it.
 *
 * Always set X-Robots-Tag to allow indexing. Google Search Console treats a
 * `noindex` value (from a stale header or an upstream preview policy) as
 * authoritative; never leave it unset if an earlier layer injected noindex.
 */
const HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(self), microphone=(self), geolocation=()",
  "x-dns-prefetch-control": "off",
  "cross-origin-opener-policy": "same-origin-allow-popups",
};

const ROBOTS_TAG = "index, follow";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://grok.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "frame-src 'self' https://embed.audius.co https://embed.music.apple.com https://audius.co",
  "connect-src 'self' https://grok.com https: wss: ws:",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

interface HeaderEvent {
  url: URL;
  req: { method: string; headers: Headers };
}

export default async function securityHeadersMiddleware(
  event: HeaderEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  if (!(result instanceof Response)) return result;
  const headers = new Headers(result.headers);
  for (const [k, v] of Object.entries(HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  headers.delete("x-robots-tag");
  headers.set("x-robots-tag", ROBOTS_TAG);
  if (!headers.has("content-security-policy")) headers.set("content-security-policy", CSP);
  const proto =
    event.req.headers.get("x-forwarded-proto") ?? event.url.protocol.replace(":", "");
  if (proto === "https" && !headers.has("strict-transport-security")) {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}
