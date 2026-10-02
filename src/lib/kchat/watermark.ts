import { isNativePlatform, saveDataUrlToDevice } from "@/utils/nativeCapabilities";

/** Embed an NYX watermark into downloaded photos and videos. */

function drawMark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  username: string,
) {
  const pad = Math.max(10, Math.round(Math.min(w, h) * 0.03));
  const size = Math.max(12, Math.round(Math.min(w, h) * 0.035));
  ctx.save();
  ctx.font = `600 ${size}px Outfit, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  const line1 = "NYX";
  const line2 = username ? `@${username}` : "Downloaded from NYX";
  const x = w - pad;
  const y = h - pad;
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = "rgba(255,247,243,0.92)";
  ctx.fillText(line1, x, y - size - 2);
  ctx.font = `500 ${Math.round(size * 0.82)}px Outfit, ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(line2, x, y);
  ctx.restore();
}

export async function watermarkImage(src: string, username: string): Promise<Blob> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not watermark this photo.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  drawMark(ctx, canvas.width, canvas.height, username);
  return await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode photo."))), "image/jpeg", 0.9);
  });
}

export async function watermarkVideo(
  src: string,
  username: string,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  const url = src.startsWith("blob:") || src.startsWith("data:") ? src : src;
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("Could not open this video.")), 20_000);
    video.onloadeddata = () => {
      window.clearTimeout(t);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(t);
      reject(new Error("Could not open this video."));
    };
  });
  const w = video.videoWidth || 720;
  const h = video.videoHeight || 1280;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not watermark this video.");
  if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
    throw new Error("This browser cannot embed a download watermark. Try Chrome or Safari.");
  }
  const stream = canvas.captureStream(24);
  const audioTracks = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.()
    ?.getAudioTracks() ?? [];
  for (const t of audioTracks) stream.addTrack(t);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
    ? "video/webm;codecs=vp8"
    : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "";
  const rec = mime
    ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_200_000 })
    : new MediaRecorder(stream, { videoBitsPerSecond: 1_200_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.start(400);
  await video.play();
  const duration = Number.isFinite(video.duration) ? video.duration : 20;
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (video.ended || video.paused) {
        try {
          rec.stop();
        } catch {
          /* already */
        }
        return;
      }
      ctx.drawImage(video, 0, 0, w, h);
      drawMark(ctx, w, h, username);
      onProgress?.(Math.min(95, (video.currentTime / Math.max(duration, 0.1)) * 100));
      requestAnimationFrame(tick);
    };
    rec.onerror = () => reject(new Error("Watermark encoding failed."));
    rec.onstop = () => resolve();
    tick();
  });
  onProgress?.(100);
  return new Blob(chunks, { type: rec.mimeType || "video/webm" });
}

export async function downloadWatermarked(opts: {
  src: string;
  kind: "image" | "video";
  username: string;
  filename?: string;
  onProgress?: (p: number) => void;
}): Promise<void> {
  const blob =
    opts.kind === "image"
      ? await watermarkImage(opts.src, opts.username)
      : await watermarkVideo(opts.src, opts.username, opts.onProgress);
  const name =
    opts.filename ??
    `nyx-${opts.username || "video"}-${Date.now()}.${opts.kind === "image" ? "jpg" : "webm"}`;
  if (isNativePlatform()) {
    const dataUrl = await blobToDataUrl(blob);
    const saved = await saveDataUrlToDevice(dataUrl, name);
    if (saved) return;
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 8_000);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not open this photo."));
    img.src = src;
  });
}
