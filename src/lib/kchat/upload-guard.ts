const IMAGE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO = new Set(["video/webm", "video/mp4", "video/quicktime"]);
const AUDIO = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"]);
const DOC = new Set(["application/pdf", "text/plain"]);

export type UploadKind = "image" | "video" | "audio" | "file";

const LIMITS: Record<UploadKind, number> = {
  image: 2_000_000,
  video: 12_000_000,
  audio: 4_000_000,
  file: 2_000_000,
};

export function classifyUpload(mime: string): UploadKind | null {
  const t = mime.toLowerCase().split(";")[0]!.trim();
  if (IMAGE.has(t)) return "image";
  if (VIDEO.has(t)) return "video";
  if (AUDIO.has(t)) return "audio";
  if (DOC.has(t)) return "file";
  return null;
}

export function assertUpload(opts: { mime: string; bytes: number; name?: string }): UploadKind {
  const kind = classifyUpload(opts.mime);
  if (!kind) throw new Error("That file type isn’t allowed.");
  const name = (opts.name ?? "").toLowerCase();
  if (/\.(svg|html?|xhtml|js|mjs|exe|sh|php|wasm)$/i.test(name)) {
    throw new Error("That file type isn’t allowed.");
  }
  if (opts.bytes <= 0 || opts.bytes > LIMITS[kind]) {
    throw new Error("That file is too large.");
  }
  return kind;
}

export function assertDataUrl(url: string, maxChars = 16_000_000): void {
  if (!url.startsWith("data:")) throw new Error("Invalid attachment.");
  if (url.length > maxChars) throw new Error("That file is too large.");
  if (/data:\s*(text\/html|image\/svg|application\/javascript)/i.test(url.slice(0, 80))) {
    throw new Error("That file type isn’t allowed.");
  }
}

/** Data URLs (legacy in-chat photos) or authenticated `/api/media/:id` refs from the chunked pipeline. */
export function assertMediaRef(url: string, maxChars = 16_000_000): void {
  const path = url.split("?")[0] ?? url;
  if (/^\/api\/media\/[A-Za-z0-9_-]+$/.test(path)) return;
  assertDataUrl(url, maxChars);
}
