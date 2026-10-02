/** Client-side image compression before upload. */

import { isPlayableReady, playbackErrorMessage } from "./video-playback";
import {
  aspectRatio,
  encodeTargets,
  qualityFromHeight,
  type QualityId,
} from "./video-quality";
export async function compressImage(
  file: File,
  opts: { maxEdge?: number; quality?: number; maxBytes?: number } = {},
): Promise<{ dataUrl: string; width: number; height: number; kind: "image" | "gif" }> {
  const maxEdge = opts.maxEdge ?? 1280;
  const quality = opts.quality ?? 0.82;
  const maxBytes = opts.maxBytes ?? 380_000;

  if (file.type === "image/gif") {
    if (file.size > 1_500_000) throw new Error("GIF is too large (max 1.5MB).");
    const dataUrl = await readFile(file);
    return { dataUrl, width: 0, height: 0, kind: "gif" };
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let q = quality;
  let dataUrl = canvas.toDataURL("image/jpeg", q);
  while (dataUrl.length > maxBytes * 1.37 && q > 0.45) {
    q -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", q);
  }
  if (dataUrl.length > maxBytes * 1.37) {
    throw new Error("Image is still too large after compression.");
  }
  return { dataUrl, width, height, kind: "image" };
}

export async function fileToDataUrl(file: File, maxBytes: number): Promise<string> {
  if (file.size > maxBytes) {
    throw new Error(`File is too large (max ${Math.round(maxBytes / 1024)}KB).`);
  }
  return readFile(file);
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function captureVideoThumb(video: HTMLVideoElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    const w = video.videoWidth || 720;
    const h = video.videoHeight || 1280;
    const scale = Math.min(1, 480 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

/** Probe width/height/duration and a poster from a File via blob URL — never FileReader of the whole clip. */
export function probeVideoFile(file: File): Promise<{
  width: number;
  height: number;
  durationMs: number;
  thumbUrl: string | null;
}> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    let settled = false;
    const done = (info: { width: number; height: number; durationMs: number; thumbUrl: string | null }) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.src = "";
      resolve(info);
    };
    const fallback = () => done({ width: 0, height: 0, durationMs: 0, thumbUrl: null });
    video.onerror = () => fallback();
    video.onloadedmetadata = () => {
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;
      const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
      const seekTo = Math.min(0.4, Math.max(0.05, (video.duration || 1) * 0.08));
      const grab = () => done({ width, height, durationMs, thumbUrl: captureVideoThumb(video) });
      video.onseeked = () => grab();
      try {
        video.currentTime = seekTo;
      } catch {
        grab();
      }
      window.setTimeout(() => grab(), 1200);
    };
    video.src = url;
  });
}

/** Browser clips only. Source files over 200 MB are rejected. Posted clip is compressed. */
export const VIDEO_SOURCE_MAX = 200 * 1024 * 1024;
export const VIDEO_POST_MAX = 12 * 1024 * 1024;
export const VIDEO_SECONDS_MAX = 600;
export const STATUS_VIDEO_SECONDS_MAX = 120;

export type VideoProbe = {
  width: number;
  height: number;
  durationMs: number;
  fps: number | null;
  aspect: string;
  codec: string | null;
  hdr: boolean;
  sourceLabel: string;
  bytes: number;
};

export type EncodedRung = {
  quality: QualityId;
  height: number;
  width: number;
  dataUrl: string;
  bytes: number;
};

export async function probeVideo(file: File): Promise<VideoProbe> {
  if (file.size > VIDEO_SOURCE_MAX) {
    throw new Error("The maximum allowed size is 200 MB.");
  }
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("Could not read that video.")), 20_000);
      video.onloadedmetadata = () => {
        window.clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(t);
        reject(new Error("The browser couldn’t open this file."));
      };
    });
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    const durationMs = Math.round((video.duration || 0) * 1000);
    return {
      width,
      height,
      durationMs,
      fps: null,
      aspect: aspectRatio(width, height),
      codec: file.type || null,
      hdr: false,
      sourceLabel: qualityFromHeight(height),
      bytes: file.size,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function verifyPlayableVideo(
  src: string,
  timeoutMs = 14_000,
): Promise<{ ok: true; width: number; height: number; durationMs: number } | { ok: false; reason: string }> {
  if (!src) return { ok: false, reason: "No video to review." };
  if (typeof document === "undefined") return { ok: false, reason: "Video review needs a browser." };
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  try {
    const result = await new Promise<{ ok: true; width: number; height: number; durationMs: number } | { ok: false; reason: string }>(
      (resolve) => {
        const t = window.setTimeout(() => {
          resolve({ ok: false, reason: "The processed video did not become playable in time." });
        }, timeoutMs);
        const finish = (value: { ok: true; width: number; height: number; durationMs: number } | { ok: false; reason: string }) => {
          window.clearTimeout(t);
          resolve(value);
        };
        video.onloadedmetadata = () => {
          if (isPlayableReady(video) || video.readyState >= 1) {
            /* wait for canplay for decode confirmation */
          }
        };
        video.oncanplay = () => {
          if (!isPlayableReady(video)) {
            finish({ ok: false, reason: "The video loaded but could not be decoded." });
            return;
          }
          finish({
            ok: true,
            width: video.videoWidth,
            height: video.videoHeight,
            durationMs: Math.round(video.duration * 1000),
          });
        };
        video.onerror = () => {
          finish({ ok: false, reason: playbackErrorMessage(video.error?.code ?? null) });
        };
      },
    );
    return result;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

export async function compressVideo(
  file: File,
  onProgress?: (p: number) => void,
  opts: { maxSeconds?: number; targetHeight?: number } = {},
): Promise<{ dataUrl: string; durationMs: number; thumbUrl: string | null; width: number; height: number; quality: QualityId }> {
  const ladder = await encodeVideoLadder(file, onProgress, opts);
  const best = ladder.renditions[ladder.renditions.length - 1];
  if (!best) throw new Error("Could not encode this video.");
  return {
    dataUrl: best.dataUrl,
    durationMs: ladder.durationMs,
    thumbUrl: ladder.thumbUrl,
    width: best.width,
    height: best.height,
    quality: best.quality,
  };
}

export async function encodeVideoLadder(
  file: File,
  onProgress?: (p: number) => void,
  opts: { maxSeconds?: number; targetHeight?: number } = {},
): Promise<{
  probe: VideoProbe;
  renditions: EncodedRung[];
  thumbUrl: string | null;
  durationMs: number;
}> {
  if (file.size > VIDEO_SOURCE_MAX) {
    throw new Error("The maximum allowed size is 200 MB.");
  }
  onProgress?.(4);
  const probe = await probeVideo(file);
  const cap = opts.maxSeconds ?? VIDEO_SECONDS_MAX;
  const durationSec = Math.min((probe.durationMs || cap * 1000) / 1000, cap);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Could not read video duration.");
  }
  const ids = opts.targetHeight
    ? encodeTargets(Math.min(probe.height, opts.targetHeight), durationSec)
    : encodeTargets(probe.height, durationSec);
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("Could not decode this video."));
  });
  const thumbUrl = captureVideoThumb(video);
  const renditions: EncodedRung[] = [];
  let i = 0;
  for (const quality of ids) {
    const targetH = Math.min(
      quality === "1080p" ? 1080 : quality === "720p" ? 720 : quality === "480p" ? 480 : 360,
      probe.height,
    );
    if (targetH > probe.height) continue;
    onProgress?.(8 + Math.round((i / Math.max(ids.length, 1)) * 80));
    try {
      const rung = await encodeRung(video, {
        targetHeight: targetH,
        durationSec,
        quality,
        sourceWidth: probe.width,
        sourceHeight: probe.height,
      });
      if (rung.bytes <= VIDEO_POST_MAX) renditions.push(rung);
    } catch {
      /* skip failed rung */
    }
    i += 1;
  }
  video.pause();
  URL.revokeObjectURL(url);
  if (renditions.length === 0) {
    if (file.size > VIDEO_POST_MAX) {
      throw new Error("This browser could not compress the clip enough. Use a shorter take.");
    }
    const dataUrl = await readFile(file);
    renditions.push({
      quality: qualityFromHeight(probe.height),
      height: probe.height,
      width: probe.width,
      dataUrl,
      bytes: file.size,
    });
  }
  const best = renditions[renditions.length - 1];
  if (best) {
    const playable = await verifyPlayableVideo(best.dataUrl);
    if (!playable.ok) {
      if (file.size <= VIDEO_POST_MAX) {
        const dataUrl = await readFile(file);
        const orig = await verifyPlayableVideo(dataUrl);
        if (orig.ok) {
          renditions.length = 0;
          renditions.push({
            quality: qualityFromHeight(probe.height),
            height: probe.height,
            width: probe.width,
            dataUrl,
            bytes: file.size,
          });
        } else {
          throw new Error(playable.reason);
        }
      } else {
        throw new Error(playable.reason);
      }
    }
  }
  onProgress?.(100);
  return { probe, renditions, thumbUrl, durationMs: Math.round(durationSec * 1000) };
}

async function encodeRung(
  video: HTMLVideoElement,
  opts: {
    targetHeight: number;
    durationSec: number;
    quality: QualityId;
    sourceWidth: number;
    sourceHeight: number;
  },
): Promise<EncodedRung> {
  const scale = opts.targetHeight / Math.max(opts.sourceHeight, 1);
  const width = Math.max(2, Math.round((opts.sourceWidth * scale) / 2) * 2);
  const height = Math.max(2, Math.round(opts.targetHeight / 2) * 2);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not encode video.");
  if (typeof canvas.captureStream !== "function" || typeof MediaRecorder === "undefined") {
    throw new Error("This browser cannot transcode video.");
  }
  video.currentTime = 0;
  await video.play();
  const canvasStream = canvas.captureStream(24);
  const srcStream =
    typeof (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream === "function"
      ? (video as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream()
      : null;
  srcStream?.getAudioTracks().forEach((t) => canvasStream.addTrack(t));
  const draw = () => {
    ctx.drawImage(video, 0, 0, width, height);
    if (!video.paused && !video.ended) requestAnimationFrame(draw);
  };
  draw();
  const mime = pickRecorderMime();
  const bitrate = height >= 1000 ? 1_600_000 : height >= 700 ? 1_100_000 : 700_000;
  const rec = mime
    ? new MediaRecorder(canvasStream, { mimeType: mime, videoBitsPerSecond: bitrate })
    : new MediaRecorder(canvasStream, { videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.start(400);
  await new Promise<void>((resolve, reject) => {
    rec.onerror = () => reject(new Error("Could not compress this video."));
    rec.onstop = () => resolve();
    window.setTimeout(() => {
      try {
        rec.stop();
      } catch {
        /* */
      }
      video.pause();
    }, Math.round(opts.durationSec * 1000) + 350);
  });
  srcStream?.getTracks().forEach((t) => t.stop());
  canvasStream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: rec.mimeType || mime || "video/webm" });
  if (blob.size < 800) throw new Error("Empty rung.");
  const dataUrl = await blobToDataUrl(blob);
  return {
    quality: qualityFromHeight(height),
    height,
    width,
    dataUrl,
    bytes: blob.size,
  };
}

function pickRecorderMime(): string {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read compressed clip."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(fileOrBlob(blob));
  });
}

function fileOrBlob(blob: Blob): Blob {
  return blob;
}
