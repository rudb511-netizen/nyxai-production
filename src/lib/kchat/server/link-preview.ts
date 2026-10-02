import {
  hashUrl,
  parseHtmlMeta,
  parseSafeHttpUrl,
  type SafeHttpUrl,
} from "../link-preview";
import { sqlClient } from "./helpers";

const FETCH_MS = 4000;
const MAX_BYTES = 512_000;
const CACHE_MS = 6 * 60 * 60 * 1000;

export type StoredPreview = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  domain: string;
  ok: boolean;
};

function resolveImage(page: SafeHttpUrl, image: string | null): string | null {
  if (!image) return null;
  try {
    const abs = new URL(image, page.href);
    const safe = parseSafeHttpUrl(abs.href);
    if (!safe) return null;
    if (safe.href.length > 500) return null;
    return safe.href;
  } catch {
    return null;
  }
}

export async function lookupLinkPreview(url: string): Promise<StoredPreview | null> {
  const parsed = parseSafeHttpUrl(url);
  if (!parsed) return null;
  const sql = await sqlClient();
  const key = hashUrl(parsed.href);
  const cached = await sql<{
    url: string;
    title: string | null;
    description: string | null;
    image_url: string | null;
    domain: string;
    ok: boolean;
    fetched_at: string;
  }>`
    select url, title, description, image_url, domain, ok, fetched_at
    from link_previews where url_hash = ${key} limit 1
  `.catch(() => []);
  const hit = cached[0];
  if (hit && Date.now() - new Date(hit.fetched_at).getTime() < CACHE_MS) {
    return {
      url: hit.url,
      title: hit.title,
      description: hit.description,
      imageUrl: hit.image_url,
      domain: hit.domain,
      ok: hit.ok,
    };
  }

  let preview: StoredPreview = {
    url: parsed.href,
    title: null,
    description: null,
    imageUrl: null,
    domain: parsed.domain,
    ok: false,
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const res = await fetch(parsed.href, {
      method: "GET",
      redirect: "manual",
      signal: ac.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "NYXLinkPreview/1.0",
      },
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = parseSafeHttpUrl(new URL(loc, parsed.href).href);
      if (!next) throw new Error("redirect blocked");
      const hop = await fetch(next.href, {
        method: "GET",
        redirect: "error",
        signal: ac.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "NYXLinkPreview/1.0",
        },
      });
      preview = await readPreview(hop, next);
    } else {
      preview = await readPreview(res, parsed);
    }
  } catch {
    preview.ok = false;
  } finally {
    clearTimeout(timer);
  }

  await sql`
    insert into link_previews (url_hash, url, title, description, image_url, domain, ok, fetched_at)
    values (
      ${key}, ${preview.url}, ${preview.title}, ${preview.description}, ${preview.imageUrl},
      ${preview.domain}, ${preview.ok}, now()
    )
    on conflict (url_hash) do update set
      title = excluded.title,
      description = excluded.description,
      image_url = excluded.image_url,
      domain = excluded.domain,
      ok = excluded.ok,
      fetched_at = excluded.fetched_at
  `.catch(() => undefined);
  return preview.ok ? preview : { ...preview, title: preview.domain, ok: false };
}

async function readPreview(res: Response, page: SafeHttpUrl): Promise<StoredPreview> {
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("html") && !type.includes("xml")) {
    return { url: page.href, title: page.domain, description: null, imageUrl: null, domain: page.domain, ok: true };
  }
  const buf = await res.arrayBuffer();
  const slice = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
  const html = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  const meta = parseHtmlMeta(html);
  return {
    url: page.href,
    title: meta.title || page.domain,
    description: meta.description,
    imageUrl: resolveImage(page, meta.image),
    domain: page.domain,
    ok: true,
  };
}

export { hashUrl };
