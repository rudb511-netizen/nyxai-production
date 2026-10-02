/** Playback readiness helpers for review/publish. Browser MediaError codes. */

export const MEDIA_ERR_ABORTED = 1;
export const MEDIA_ERR_NETWORK = 2;
export const MEDIA_ERR_DECODE = 3;
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export function isPlayableReady(video: {
  readyState: number;
  videoWidth: number;
  videoHeight: number;
  duration: number;
}): boolean {
  if (video.readyState < 2) return false;
  if (!(video.videoWidth > 0) || !(video.videoHeight > 0)) return false;
  if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
  return true;
}

export function playbackErrorMessage(code: number | null | undefined): string {
  switch (code) {
    case MEDIA_ERR_ABORTED:
      return "Playback was interrupted. Retry to load the clip.";
    case MEDIA_ERR_NETWORK:
      return "The video could not be loaded. Check your connection and retry.";
    case MEDIA_ERR_DECODE:
      return "This video cannot be decoded on this device. Replace the file or retry processing.";
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This video format isn’t supported on this device. Replace the file and try again.";
    default:
      return "Preview currently unavailable for this video.";
  }
}

export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function videoAspectClass(width: number, height: number): "portrait" | "landscape" | "square" {
  if (!(width > 0) || !(height > 0)) return "portrait";
  const r = width / height;
  if (r > 1.1) return "landscape";
  if (r < 0.9) return "portrait";
  return "square";
}
