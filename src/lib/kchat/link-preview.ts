/** SSRF-safe URL checks for chat link previews. No network I/O. */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
]);

export type SafeHttpUrl = {
  href: string;
  hostname: string;
  domain: string;
};

export function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const oct = m.slice(1).map((n) => Number(n));
  if (oct.some((n) => n > 255)) return false;
  const [a, b] = oct;
  if (a === 10 || a === 127 || a === 0 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

export function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  if (h.startsWith("::ffff:")) return isPrivateIPv4(h.slice("::ffff:".length));
  return false;
}

export function hostnameLooksPrivate(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "0.0.0.0") return true;
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) return true;
  return false;
}

export function parseSafeHttpUrl(raw: string): SafeHttpUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && !["", "80", "443"].includes(u.port)) {
    const p = Number(u.port);
    if (p === 80 || p === 443) {
      /* ok */
    } else if (p < 1024) {
      return null;
    }
  }
  const hostname = u.hostname.replace(/^\[|\]$/g, "");
  if (hostnameLooksPrivate(hostname)) return null;
  if (hostname.length > 253) return null;
  return {
    href: u.href,
    hostname,
    domain: hostname.replace(/^www\./, ""),
  };
}

export function extractSafeLinks(body: string): SafeHttpUrl[] {
  const out: SafeHttpUrl[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s<>"'`]+/gi;
  for (const raw of body.match(re) ?? []) {
    const cleaned = raw.replace(/[),.;!?]+$/g, "");
    const parsed = parseSafeHttpUrl(cleaned);
    if (!parsed || seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    out.push(parsed);
    if (out.length >= 3) break;
  }
  return out;
}

export function hashUrl(href: string): string {
  let h = 2166136261;
  for (let i = 0; i < href.length; i++) {
    h ^= href.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `lp_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function parseHtmlMeta(html: string): {
  title: string | null;
  description: string | null;
  image: string | null;
} {
  const pick = (names: string[]): string | null => {
    for (const name of names) {
      const re = new RegExp(
        `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        "i",
      );
      const re2 = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`,
        "i",
      );
      const m = html.match(re) ?? html.match(re2);
      if (m?.[1]) return decodeHtmlEntities(m[1]).trim();
    }
    return null;
  };
  const titleTag = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] ?? null;
  const title = pick(["og:title", "twitter:title"]) || (titleTag ? decodeHtmlEntities(titleTag).trim() : null);
  const description = pick(["og:description", "twitter:description", "description"]);
  const image = pick(["og:image", "twitter:image"]);
  return {
    title: title ? title.slice(0, 180) : null,
    description: description ? description.slice(0, 280) : null,
    image: image ? image.slice(0, 500) : null,
  };
}
