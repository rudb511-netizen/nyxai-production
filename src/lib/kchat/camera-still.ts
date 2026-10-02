/** True still-photo capture. Preview frames are never the primary output. */

export const STILL_MEMORY_CAP_PX = 48_000_000;
export const STILL_JPEG_QUALITY = 1;
export const PREVIEW_MAX_EDGE = 1600;
export const ENHANCE_INPUT_MAX_EDGE = 2048;
export const ENHANCE_INPUT_MAX_BYTES = 2_800_000;

export type StillSource = "image-capture" | "native-still" | "capacitor-camera" | "library";
export type StillFacing = "user" | "environment";
export type StillFlash = "off" | "on" | "auto";

export type PhotoSizeRange = { min: number; max: number };

export type StillDiagnostics = {
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  mime: string;
  source: StillSource;
  lens: string | null;
  facing: StillFacing;
  selectedWidth: number | null;
  selectedHeight: number | null;
  captureMs: number;
  enhanced: boolean;
  enhanceScale: 0 | 2 | 4;
  enhanceProvider: string | null;
  finalWidth: number;
  finalHeight: number;
  finalBytes: number;
  enhanceMs: number | null;
  error: string | null;
};

export type StillPhoto = {
  blob: Blob;
  objectUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  bytes: number;
  mime: string;
  source: StillSource;
  lens: string | null;
  facing: StillFacing;
  captureMs: number;
  selectedWidth: number | null;
  selectedHeight: number | null;
};

type ImageCaptureLike = {
  getPhotoCapabilities: () => Promise<{
    imageWidth?: PhotoSizeRange;
    imageHeight?: PhotoSizeRange;
    fillLightMode?: string[];
  }>;
  takePhoto: (settings?: {
    imageWidth?: number;
    imageHeight?: number;
    fillLightMode?: string;
  }) => Promise<Blob>;
};

declare global {
  interface Window {
    ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike;
  }
}

export function selectMaxPhotoSize(
  imageWidth?: PhotoSizeRange | null,
  imageHeight?: PhotoSizeRange | null,
  memoryCapPx = STILL_MEMORY_CAP_PX,
): { width: number; height: number } | null {
  if (!imageWidth || !imageHeight) return null;
  if (!(imageWidth.max > 0) || !(imageHeight.max > 0)) return null;
  let width = Math.round(imageWidth.max);
  let height = Math.round(imageHeight.max);
  const px = width * height;
  if (px > memoryCapPx) {
    const scale = Math.sqrt(memoryCapPx / px);
    width = Math.max(imageWidth.min || 1, Math.round(width * scale));
    height = Math.max(imageHeight.min || 1, Math.round(height * scale));
  }
  return { width, height };
}

export function megapixels(width: number, height: number): number {
  return Math.round(((width * height) / 1_000_000) * 10) / 10;
}

/** Reads pixel size from JPEG/PNG bytes without decoding the full bitmap. */
export function readStillPixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = dv.getUint32(16);
    const height = dv.getUint32(20);
    if (width > 0 && height > 0) return { width, height };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1]!;
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
        const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
        if (width > 0 && height > 0) return { width, height };
        return null;
      }
      if (marker === 0xd8 || marker === 0xd9) {
        i += 2;
        continue;
      }
      const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      if (len < 2) break;
      i += 2 + len;
    }
  }
  return null;
}

export function recommendedEnhanceScale(opts: {
  width: number;
  height: number;
  bytes: number;
  deviceMemoryGb?: number;
  cores?: number;
}): 0 | 2 | 4 {
  const px = opts.width * opts.height;
  if (!(px > 0)) return 0;
  const mem = opts.deviceMemoryGb ?? 4;
  const cores = opts.cores ?? 4;
  if (opts.bytes > 14_000_000 || px > 32_000_000) return 0;
  if (px >= 12_000_000) return mem >= 6 && cores >= 6 ? 2 : 0;
  if (px >= 4_000_000) return 2;
  if (mem >= 6 && cores >= 6) return 4;
  return 2;
}

export function deviceMemoryGb(): number | undefined {
  const n = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof n === "number" && n > 0 ? n : undefined;
}

function imageCaptureCtor(): (new (track: MediaStreamTrack) => ImageCaptureLike) | null {
  if (typeof window === "undefined") return null;
  return window.ImageCapture ?? null;
}

export function stillCaptureSupported(track?: MediaStreamTrack | null): boolean {
  if (track && imageCaptureCtor()) return true;
  return false;
}

export async function captureStillFromTrack(
  track: MediaStreamTrack,
  opts: { flash?: StillFlash; facing?: StillFacing } = {},
): Promise<StillPhoto> {
  const Ctor = imageCaptureCtor();
  if (!Ctor) throw new Error("This browser cannot take a full-resolution still.");
  const started = performance.now();
  const ic = new Ctor(track);
  let selected: { width: number; height: number } | null = null;
  let fillModes: string[] = [];
  try {
    const caps = await ic.getPhotoCapabilities();
    selected = selectMaxPhotoSize(caps.imageWidth, caps.imageHeight);
    fillModes = Array.isArray(caps.fillLightMode) ? caps.fillLightMode : [];
  } catch {
    /* capabilities optional */
  }
  const settings: { imageWidth?: number; imageHeight?: number; fillLightMode?: string } = {};
  if (selected) {
    settings.imageWidth = selected.width;
    settings.imageHeight = selected.height;
  }
  const want = opts.flash === "on" ? "flash" : opts.flash === "auto" ? "auto" : "off";
  if (fillModes.includes(want)) settings.fillLightMode = want;
  let blob: Blob;
  try {
    blob = await ic.takePhoto(Object.keys(settings).length ? settings : undefined);
  } catch {
    blob = await ic.takePhoto();
  }
  if (!blob || blob.size < 800) throw new Error("High-resolution capture failed.");
  const info = track.getSettings?.() ?? {};
  return stillFromBlob(blob, {
    source: "image-capture",
    facing: opts.facing ?? (info.facingMode === "user" ? "user" : "environment"),
    lens: typeof info.deviceId === "string" ? info.deviceId.slice(0, 12) : null,
    captureMs: Math.round(performance.now() - started),
    selectedWidth: selected?.width ?? null,
    selectedHeight: selected?.height ?? null,
  });
}

export async function stillFromBlob(
  blob: Blob,
  meta: {
    source: StillSource;
    facing?: StillFacing;
    lens?: string | null;
    captureMs?: number;
    selectedWidth?: number | null;
    selectedHeight?: number | null;
  },
): Promise<StillPhoto> {
  const mime = blob.type || "image/jpeg";
  if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(mime) && meta.source !== "library") {
    throw new Error("Invalid image.");
  }
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) throw new Error("Could not read that photo.");
  const width = bmp.width;
  const height = bmp.height;
  const objectUrl = URL.createObjectURL(blob);
  let previewUrl = objectUrl;
  if (Math.max(width, height) > PREVIEW_MAX_EDGE) {
    const scale = PREVIEW_MAX_EDGE / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const preview = await canvasToBlob(canvas, "image/jpeg", 0.85);
      if (preview) previewUrl = URL.createObjectURL(preview);
    }
  }
  bmp.close();
  return {
    blob,
    objectUrl,
    previewUrl,
    width,
    height,
    bytes: blob.size,
    mime,
    source: meta.source,
    lens: meta.lens ?? null,
    facing: meta.facing ?? "environment",
    captureMs: meta.captureMs ?? 0,
    selectedWidth: meta.selectedWidth ?? width,
    selectedHeight: meta.selectedHeight ?? height,
  };
}

export function diagnosticsFromStill(
  still: StillPhoto,
  extra: Partial<StillDiagnostics> = {},
): StillDiagnostics {
  return {
    originalWidth: still.width,
    originalHeight: still.height,
    originalBytes: still.bytes,
    mime: still.mime,
    source: still.source,
    lens: still.lens,
    facing: still.facing,
    selectedWidth: still.selectedWidth,
    selectedHeight: still.selectedHeight,
    captureMs: still.captureMs,
    enhanced: false,
    enhanceScale: 0,
    enhanceProvider: null,
    finalWidth: still.width,
    finalHeight: still.height,
    finalBytes: still.bytes,
    enhanceMs: null,
    error: null,
    ...extra,
  };
}

export async function jpegForModel(
  blob: Blob,
  maxEdge = ENHANCE_INPUT_MAX_EDGE,
  maxBytes = ENHANCE_INPUT_MAX_BYTES,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close();
    throw new Error("Could not prepare that photo.");
  }
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  let q = 0.92;
  let blobOut = await canvasToBlob(canvas, "image/jpeg", q);
  while (blobOut && blobOut.size > maxBytes && q > 0.7) {
    q -= 0.06;
    blobOut = await canvasToBlob(canvas, "image/jpeg", q);
  }
  if (!blobOut) throw new Error("Could not prepare that photo.");
  if (blobOut.size > maxBytes) throw new Error("Image too large.");
  return { dataUrl: await blobToDataUrl(blobOut), width, height };
}

export async function stillToPostableDataUrl(blob: Blob, maxChars = 12_000_000): Promise<string> {
  const direct = await blobToDataUrl(blob);
  if (direct.length <= maxChars) return direct;
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  let q = 0.92;
  let out = await canvasToBlob(canvas, "image/jpeg", q);
  while (out && out.size * 1.37 > maxChars && q > 0.72) {
    q -= 0.06;
    out = await canvasToBlob(canvas, "image/jpeg", q);
  }
  if (!out) throw new Error("Image too large.");
  return blobToDataUrl(out);
}

export function releaseStill(still: StillPhoto | null | undefined) {
  if (!still) return;
  if (still.objectUrl.startsWith("blob:")) URL.revokeObjectURL(still.objectUrl);
  if (still.previewUrl !== still.objectUrl && still.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(still.previewUrl);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("Could not read photo."));
    r.readAsDataURL(blob);
  });
}

export function lastStillLog(diag: StillDiagnostics): void {
  try {
    sessionStorage.setItem(
      "nyx-last-still",
      JSON.stringify({
        w: diag.originalWidth,
        h: diag.originalHeight,
        bytes: diag.originalBytes,
        mime: diag.mime,
        source: diag.source,
        mp: megapixels(diag.originalWidth, diag.originalHeight),
        enhanced: diag.enhanced,
        scale: diag.enhanceScale,
        provider: diag.enhanceProvider,
        captureMs: diag.captureMs,
        enhanceMs: diag.enhanceMs,
        error: diag.error,
      }),
    );
  } catch {
    /* private mode */
  }
}
