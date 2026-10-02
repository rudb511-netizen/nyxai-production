/** Client sticker processing: crop, background remove, filters, video clip, GIF. */

export const STICKER_MAX_EDGE = 512;
export const STICKER_MAX_BYTES = 480_000;
export const STICKER_VIDEO_MAX_MS = 3_000;
export const STICKER_VIDEO_MAX_BYTES = 1_800_000;
export const STICKER_GIF_MAX_BYTES = 1_800_000;

export type StickerMediaKind = "image" | "video" | "gif";
export type SniffedMedia = { kind: StickerMediaKind; mime: string };
export type RgbaFrame = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

const RECORDER_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
];

export function sniffBytes(buf: Uint8Array, name = "", type = ""): SniffedMedia | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { kind: "image", mime: "image/jpeg" };
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { kind: "image", mime: "image/png" };
  }
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { kind: "gif", mime: "image/gif" };
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { kind: "image", mime: "image/webp" };
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { kind: "video", mime: "video/webm" };
  }
  if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!).toLowerCase();
    if (/hei[cf]|mif1|msf1/.test(brand)) return { kind: "image", mime: "image/heic" };
    if (brand.startsWith("qt")) return { kind: "video", mime: "video/quicktime" };
    return { kind: "video", mime: "video/mp4" };
  }
  return sniffNameType(name, type);
}

export function sniffNameType(name = "", type = ""): SniffedMedia | null {
  const t = type.toLowerCase().split(";")[0]!.trim();
  const n = name.toLowerCase();
  if (t === "image/gif" || n.endsWith(".gif")) return { kind: "gif", mime: "image/gif" };
  if (t === "image/heic" || t === "image/heif" || /\.(heic|heif)$/.test(n)) return { kind: "image", mime: t || "image/heic" };
  if (t.startsWith("image/")) return { kind: "image", mime: t };
  if (t === "video/quicktime" || n.endsWith(".mov")) return { kind: "video", mime: t || "video/quicktime" };
  if (t.startsWith("video/") || /\.(mp4|m4v|webm|mov|3gp)$/.test(n)) {
    return { kind: "video", mime: t || (n.endsWith(".webm") ? "video/webm" : n.endsWith(".mov") ? "video/quicktime" : "video/mp4") };
  }
  if (/\.(jpe?g|png|webp|bmp)$/.test(n)) {
    const mime = n.endsWith(".png") ? "image/png" : n.endsWith(".webp") ? "image/webp" : n.endsWith(".bmp") ? "image/bmp" : "image/jpeg";
    return { kind: "image", mime };
  }
  return null;
}

export async function sniffFile(file: File): Promise<SniffedMedia | null> {
  const named = sniffNameType(file.name, file.type);
  try {
    const head = new Uint8Array(await file.slice(0, 24).arrayBuffer());
    return sniffBytes(head, file.name, file.type) ?? named;
  } catch {
    return named;
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const header = comma >= 0 ? dataUrl.slice(0, comma) : "data:application/octet-stream;base64";
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const mime = /data:([^;,]+)/i.exec(header)?.[1] || "application/octet-stream";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function dataUrlToFile(dataUrl: string, name = "media"): File {
  const blob = dataUrlToBlob(dataUrl);
  const mime = blob.type || "application/octet-stream";
  const ext =
    mime.includes("gif") ? "gif"
    : mime.includes("png") ? "png"
    : mime.includes("webp") ? "webp"
    : mime.includes("mp4") ? "mp4"
    : mime.includes("webm") ? "webm"
    : mime.includes("quicktime") ? "mov"
    : mime.includes("heic") || mime.includes("heif") ? "heic"
    : "jpg";
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  return new File([blob], `${base}.${ext}`, { type: mime });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(src)) img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Could not load that image. Try JPEG, PNG, WEBP, or GIF."));
    img.src = src;
  });
}

export function canvasFromImage(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not process image.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function exportPng(canvas: HTMLCanvasElement, maxBytes = STICKER_MAX_BYTES): string {
  const scale = Math.min(1, STICKER_MAX_EDGE / Math.max(canvas.width, canvas.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not export sticker.");
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  let url = out.toDataURL("image/png");
  if (url.length > maxBytes * 1.37) {
    url = out.toDataURL("image/webp", 0.86);
  }
  if (url.length > maxBytes * 1.37) {
    throw new Error("Sticker is still too large after compression.");
  }
  return url;
}

function colorDist(a: Uint8ClampedArray, i: number, r: number, g: number, b: number) {
  return Math.abs(a[i]! - r) + Math.abs(a[i + 1]! - g) + Math.abs(a[i + 2]! - b);
}

/** Flood-fill from corners: pixels similar to the corner color become transparent. */
export function removeBackground(imageData: ImageData, tolerance = 42): ImageData {
  const { width, height, data } = imageData;
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  for (const i of corners) {
    queue.push(i);
    visited[i] = 1;
  }
  while (queue.length) {
    const idx = queue.pop()!;
    const p = idx * 4;
    const r = data[p]!;
    const g = data[p + 1]!;
    const b = data[p + 2]!;
    const samples = corners.map((c) => c * 4);
    const similar = samples.some((s) => colorDist(data, p, data[s]!, data[s + 1]!, data[s + 2]!) <= tolerance * 3);
    if (!similar && idx !== corners[0] && idx !== corners[1] && idx !== corners[2] && idx !== corners[3]) continue;
    if (colorDist(data, p, data[0]!, data[1]!, data[2]!) > tolerance * 3) {
      const last = (width * height - 1) * 4;
      if (colorDist(data, p, data[last]!, data[last + 1]!, data[last + 2]!) > tolerance * 3) continue;
    }
    data[p + 3] = 0;
    const x = idx % width;
    const y = (idx / width) | 0;
    const nbs = [
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
    ];
    for (const n of nbs) {
      if (n < 0 || visited[n]) continue;
      const np = n * 4;
      if (colorDist(data, np, r, g, b) <= tolerance * 3) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }
  return imageData;
}

export function applyCanvasFilter(
  canvas: HTMLCanvasElement,
  filter: string,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not apply effect.");
  ctx.filter = filter;
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = "none";
  return out;
}

export function rotateCanvas(canvas: HTMLCanvasElement, deg: 90 | 180 | 270): HTMLCanvasElement {
  const out = document.createElement("canvas");
  const rad = (deg * Math.PI) / 180;
  const swap = deg === 90 || deg === 270;
  out.width = swap ? canvas.height : canvas.width;
  out.height = swap ? canvas.width : canvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not rotate.");
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

function waitEvent(el: EventTarget, name: string, timeout = 12_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("Timed out processing video.")), timeout);
    const on = () => {
      window.clearTimeout(t);
      el.removeEventListener(name, on);
      resolve();
    };
    el.addEventListener(name, on);
  });
}

function attachVideoEl(src: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  if (/^https?:/i.test(src)) video.crossOrigin = "anonymous";
  video.src = src;
  try {
    video.load();
  } catch {
    /* some WebViews throw on load() */
  }
  return video;
}

export async function probeVideo(file: File): Promise<{ durationMs: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const video = attachVideoEl(url);
    await waitEvent(video, "loadedmetadata");
    let duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      await Promise.race([
        waitEvent(video, "durationchange", 3500).catch(() => undefined),
        waitEvent(video, "loadeddata", 3500).catch(() => undefined),
      ]);
      duration = video.duration;
    }
    if (!Number.isFinite(duration) || duration === Infinity || duration <= 0) {
      try {
        await video.play();
        video.pause();
        duration = video.duration;
      } catch {
        /* iOS may still withhold duration until a user gesture; treat as a short clip */
      }
    }
    if (!Number.isFinite(duration) || duration === Infinity || duration <= 0) {
      duration = 2;
    }
    return {
      durationMs: Math.round(duration * 1000),
      width: video.videoWidth || 0,
      height: video.videoHeight || 0,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const mime of RECORDER_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      /* ignore */
    }
  }
  return "";
}

function canKeepOriginal(file: File, startMs: number, endMs: number, fileDurationMs: number): boolean {
  if (file.size <= 0 || file.size > STICKER_VIDEO_MAX_BYTES) return false;
  const span = Math.max(0, endMs - startMs);
  if (span < 250 || span > STICKER_VIDEO_MAX_MS + 400) return false;
  if (startMs > 180) return false;
  if (fileDurationMs > STICKER_VIDEO_MAX_MS + 400 && endMs < fileDurationMs - 250) return false;
  if (fileDurationMs > STICKER_VIDEO_MAX_MS + 400) return false;
  const mime = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return (
    /mp4|webm|quicktime|x-m4v/.test(mime) ||
    /\.(mp4|m4v|webm|mov)$/.test(name) ||
    mime === ""
  );
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (!Number.isFinite(time)) return;
  video.currentTime = Math.max(0, time);
  await waitEvent(video, "seeked", 8_000).catch(() => undefined);
}

async function extractClipAsGif(
  video: HTMLVideoElement,
  start: number,
  end: number,
  onProgress?: (pct: number) => void,
): Promise<{ blob: Blob; durationMs: number; width: number; height: number }> {
  const duration = Math.min(STICKER_VIDEO_MAX_MS / 1000, Math.max(0.4, end - start));
  const width = video.videoWidth || 320;
  const height = video.videoHeight || 320;
  const edge = Math.min(240, STICKER_MAX_EDGE);
  const scale = Math.min(1, edge / Math.max(width, height));
  const cw = Math.max(16, Math.round(width * scale / 2) * 2);
  const ch = Math.max(16, Math.round(height * scale / 2) * 2);
  const fps = duration <= 1.2 ? 10 : 8;
  const frames: RgbaFrame[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not process video.");
  const steps = Math.max(4, Math.round(duration * fps));
  for (let i = 0; i < steps; i++) {
    const t = start + (i / Math.max(1, steps - 1)) * duration;
    await seekVideo(video, t);
    ctx.drawImage(video, 0, 0, cw, ch);
    const img = ctx.getImageData(0, 0, cw, ch);
    frames.push({ data: img.data, width: cw, height: ch });
    onProgress?.(Math.min(92, 8 + ((i + 1) / steps) * 80));
  }
  const bytes = encodeAnimatedGif(frames, { delayCs: Math.max(4, Math.round(100 / fps)) });
  if (bytes.byteLength < 32) throw new Error("Could not process that clip. Try a shorter section.");
  if (bytes.byteLength > STICKER_GIF_MAX_BYTES) throw new Error("Clip is still too large. Shorten it.");
  onProgress?.(100);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return {
    blob: new Blob([copy], { type: "image/gif" }),
    durationMs: Math.round(duration * 1000),
    width: cw,
    height: ch,
  };
}

/** Trim a video clip (max 3s). Prefers MediaRecorder, then original bytes, then animated GIF. */
export async function trimVideoClip(
  file: File,
  startMs: number,
  endMs: number,
  onProgress?: (pct: number) => void,
): Promise<{ blob: Blob; durationMs: number; width: number; height: number; mediaKind: "video" | "gif" }> {
  const duration = Math.min(STICKER_VIDEO_MAX_MS, Math.max(400, endMs - startMs));
  const url = URL.createObjectURL(file);
  const video = attachVideoEl(url);
  try {
    await waitEvent(video, "loadedmetadata");
    const fileDurationMs = Number.isFinite(video.duration) && video.duration > 0 && video.duration !== Infinity
      ? Math.round(video.duration * 1000)
      : duration;
    const start = Math.max(0, startMs / 1000);
    await seekVideo(video, start);
    onProgress?.(8);
    const width = video.videoWidth || 480;
    const height = video.videoHeight || 480;
    const mime = pickRecorderMime();
    if (!mime) {
      if (canKeepOriginal(file, startMs, endMs, fileDurationMs)) {
        onProgress?.(100);
        return {
          blob: file,
          durationMs: Math.min(duration, fileDurationMs || duration),
          width,
          height,
          mediaKind: "video",
        };
      }
      const gif = await extractClipAsGif(video, start, start + duration / 1000, onProgress);
      return { ...gif, mediaKind: "gif" };
    }
    const scale = Math.min(1, STICKER_MAX_EDGE / Math.max(width, height));
    const cw = Math.max(16, Math.round(width * scale));
    const ch = Math.max(16, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process video.");
    const stream = canvas.captureStream(16);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 600_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });
    rec.start(80);
    try {
      await video.play();
    } catch {
      rec.stop();
      await stopped;
      if (canKeepOriginal(file, startMs, endMs, fileDurationMs)) {
        return { blob: file, durationMs: duration, width: cw, height: ch, mediaKind: "video" };
      }
      const gif = await extractClipAsGif(video, start, start + duration / 1000, onProgress);
      return { ...gif, mediaKind: "gif" };
    }
    const t0 = performance.now();
    const endAt = start + duration / 1000;
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (video.ended || video.currentTime >= endAt || performance.now() - t0 > duration + 800) {
          resolve();
          return;
        }
        ctx.drawImage(video, 0, 0, cw, ch);
        onProgress?.(Math.min(92, 8 + ((video.currentTime - start) / (duration / 1000)) * 80));
        requestAnimationFrame(tick);
      };
      video.addEventListener("error", () => reject(new Error("Could not read that video.")), { once: true });
      tick();
    });
    video.pause();
    rec.stop();
    await stopped;
    const outType = mime.split(";")[0] || "video/webm";
    const blob = new Blob(chunks, { type: outType });
    if (blob.size < 64) {
      if (canKeepOriginal(file, startMs, endMs, fileDurationMs)) {
        return { blob: file, durationMs: duration, width: cw, height: ch, mediaKind: "video" };
      }
      const gif = await extractClipAsGif(video, start, start + duration / 1000, onProgress);
      return { ...gif, mediaKind: "gif" };
    }
    if (blob.size > STICKER_VIDEO_MAX_BYTES) throw new Error("Clip is still too large. Shorten it.");
    onProgress?.(100);
    return { blob, durationMs: duration, width: cw, height: ch, mediaKind: "video" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read processed sticker."));
    r.readAsDataURL(blob);
  });
}

/** Compact GIF89a encoder (looping) for sticker-sized RGBA frames. */
export function encodeAnimatedGif(frames: RgbaFrame[], opts?: { delayCs?: number; maxColors?: number }): Uint8Array {
  if (!frames.length) throw new Error("Could not process that clip. Try a shorter section.");
  const width = frames[0]!.width;
  const height = frames[0]!.height;
  const delayCs = Math.max(2, Math.min(100, opts?.delayCs ?? 12));
  const maxColors = Math.max(32, Math.min(256, opts?.maxColors ?? 128));
  const { palette, indexed } = quantizeFrames(frames, maxColors);
  const colorCount = palette.length / 3;
  const palSize = Math.max(2, 1 << Math.ceil(Math.log2(Math.max(2, colorCount))));
  const gctPow = Math.max(0, Math.log2(palSize) - 1);
  const minCodeSize = Math.max(2, Math.ceil(Math.log2(palSize)));
  const out: number[] = [];
  const w = (b: number) => out.push(b & 255);
  const w16 = (n: number) => {
    w(n);
    w(n >> 8);
  };
  w(0x47); w(0x49); w(0x46); w(0x38); w(0x39); w(0x61);
  w16(width);
  w16(height);
  w(0x80 | (gctPow & 7));
  w(0);
  w(0);
  for (let i = 0; i < palSize; i++) {
    w(palette[i * 3] ?? 0);
    w(palette[i * 3 + 1] ?? 0);
    w(palette[i * 3 + 2] ?? 0);
  }
  w(0x21); w(0xff); w(0x0b);
  for (const c of "NETSCAPE2.0") w(c.charCodeAt(0));
  w(0x03); w(0x01); w16(0); w(0);
  for (const px of indexed) {
    w(0x21); w(0xf9); w(0x04); w(0x00); w16(delayCs); w(0); w(0);
    w(0x2c); w16(0); w16(0); w16(width); w16(height); w(0);
    w(minCodeSize);
    const packed = lzwEncode(minCodeSize, px);
    for (let i = 0; i < packed.length; ) {
      const n = Math.min(255, packed.length - i);
      w(n);
      for (let j = 0; j < n; j++) w(packed[i + j]!);
      i += n;
    }
    w(0);
  }
  w(0x3b);
  return Uint8Array.from(out);
}

function quantizeFrames(frames: RgbaFrame[], maxColors: number): { palette: number[]; indexed: Uint8Array[] } {
  const counts = new Map<number, number>();
  for (const frame of frames) {
    const d = frame.data;
    const step = Math.max(4, ((d.length / 4) > 80_000 ? 16 : 4));
    for (let i = 0; i < d.length; i += step) {
      const r = d[i]! & 0xf8;
      const g = d[i + 1]! & 0xfc;
      const b = d[i + 2]! & 0xf8;
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxColors);
  const palette: number[] = [];
  const keys: number[] = [];
  for (const [key] of ranked) {
    keys.push(key);
    palette.push((key >> 16) & 255, (key >> 8) & 255, key & 255);
  }
  if (!keys.length) {
    keys.push(0);
    palette.push(0, 0, 0);
  }
  const cache = new Map<number, number>();
  const mapColor = (r: number, g: number, b: number) => {
    const q = ((r & 0xf8) << 16) | ((g & 0xfc) << 8) | (b & 0xf8);
    const hit = cache.get(q);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestD = 1e9;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      const dr = r - ((k >> 16) & 255);
      const dg = g - ((k >> 8) & 255);
      const db = b - (k & 255);
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestD) {
        bestD = dist;
        best = i;
        if (dist === 0) break;
      }
    }
    cache.set(q, best);
    return best;
  };
  const indexed = frames.map((frame) => {
    const d = frame.data;
    const out = new Uint8Array((d.length / 4) | 0);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      out[p] = mapColor(d[i]!, d[i + 1]!, d[i + 2]!);
    }
    return out;
  });
  return { palette, indexed };
}

function lzwEncode(minCodeSize: number, pixels: Uint8Array): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoi + 1;
  const dict = new Map<number, number>();
  const out: number[] = [];
  let bitBuf = 0;
  let bitN = 0;
  const writeCode = (code: number) => {
    bitBuf |= code << bitN;
    bitN += codeSize;
    while (bitN >= 8) {
      out.push(bitBuf & 255);
      bitBuf >>= 8;
      bitN -= 8;
    }
  };
  writeCode(clear);
  let prefix = pixels[0] ?? 0;
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i]!;
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    writeCode(prefix);
    if (nextCode < 4096) {
      dict.set(key, nextCode);
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
      nextCode += 1;
    }
    if (nextCode >= 4096) {
      writeCode(clear);
      dict.clear();
      codeSize = minCodeSize + 1;
      nextCode = eoi + 1;
    }
    prefix = k;
  }
  writeCode(prefix);
  writeCode(eoi);
  if (bitN > 0) out.push(bitBuf & 255);
  return out;
}
