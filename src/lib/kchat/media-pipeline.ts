/** Pure helpers for chunked uploads, recovery copy, and chat media indexing. */

export const DEFAULT_CHUNK_SIZE = 256 * 1024;
/** Default platform ceiling. The live limit is returned by startUpload — never hardcode it in UI. */
export const PLATFORM_MAX_BYTES = 64 * 1024 * 1024;

export type UploadPhase =
  | "preparing"
  | "uploading"
  | "processing"
  | "finalizing"
  | "ready"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export type UploadPurpose = "video" | "status" | "post" | "chat" | "story";

export function chunkCount(totalBytes: number, chunkSize = DEFAULT_CHUNK_SIZE): number {
  const size = Math.max(1, chunkSize | 0);
  const total = Math.max(0, totalBytes);
  if (total === 0) return 1;
  return Math.ceil(total / size);
}

export function chunkRange(index: number, totalBytes: number, chunkSize = DEFAULT_CHUNK_SIZE): { start: number; end: number } {
  const start = index * chunkSize;
  const end = Math.min(totalBytes, start + chunkSize);
  return { start, end };
}

export function missingChunks(chunkCountN: number, received: Iterable<number>): number[] {
  const have = new Set(received);
  const missing: number[] = [];
  for (let i = 0; i < chunkCountN; i++) if (!have.has(i)) missing.push(i);
  return missing;
}

export function uploadPct(receivedCount: number, chunkCountN: number): number {
  if (chunkCountN <= 0) return 0;
  return Math.min(99, Math.floor((receivedCount / chunkCountN) * 100));
}

export function etaSeconds(remainingBytes: number, bytesPerSec: number): number | null {
  if (!(bytesPerSec > 400)) return null;
  return Math.max(1, Math.round(remainingBytes / bytesPerSec));
}

export function formatSpeed(bytesPerSec: number): string {
  if (!(bytesPerSec > 0)) return "";
  if (bytesPerSec >= 1_000_000) return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_000) return `${Math.round(bytesPerSec / 1_000)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

export function formatEta(sec: number | null): string {
  if (sec == null) return "";
  if (sec < 60) return `${sec}s left`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s left` : `${m}m left`;
}

export function phaseLabel(phase: UploadPhase): string {
  switch (phase) {
    case "preparing":
      return "Preparing";
    case "uploading":
      return "Uploading";
    case "processing":
      return "Processing";
    case "finalizing":
      return "Finalizing";
    case "ready":
      return "Ready to post";
    case "publishing":
      return "Publishing";
    case "published":
      return "Published";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function phaseFromStatus(status: string): UploadPhase {
  switch (status) {
    case "uploading":
      return "uploading";
    case "upload_complete":
    case "processing":
      return "processing";
    case "ready":
      return "ready";
    case "publishing":
      return "publishing";
    case "published":
      return "published";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "preparing";
  }
}

export function uploadRecoveryMessage(opts: {
  phase: UploadPhase;
  online?: boolean;
  reason?: string | null;
}): string {
  if (opts.online === false) {
    return "Network connection lost. Upload will resume automatically.";
  }
  switch (opts.phase) {
    case "uploading":
      return "Video is still uploading. You can keep this screen open.";
    case "processing":
      return "Video uploaded. Processing is still in progress.";
    case "finalizing":
      return "Finalizing your video. Publishing has not started yet.";
    case "ready":
      return "Video is ready. Publishing did not start yet.";
    case "publishing":
      return "Publishing failed. Your video is safe. Tap Retry.";
    case "failed":
      return opts.reason?.trim() || "Video processing failed. Retry processing.";
    default:
      return opts.reason?.trim() || "Could not finish this video. Tap Retry.";
  }
}

export function allowedUploadMime(mime: string): boolean {
  const t = mime.toLowerCase().split(";")[0]!.trim();
  return (
    t.startsWith("video/") ||
    t.startsWith("image/") ||
    t === "application/pdf" ||
    t === "text/plain" ||
    t === "application/zip"
  );
}

const LINK_RE = /https?:\/\/[^\s<>"'`]+/gi;

export function extractMessageLinks(body: string): { url: string; domain: string }[] {
  const out: { url: string; domain: string }[] = [];
  const seen = new Set<string>();
  for (const raw of body.match(LINK_RE) ?? []) {
    const cleaned = raw.replace(/[),.;!?]+$/g, "");
    try {
      const u = new URL(cleaned);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (seen.has(u.href)) continue;
      seen.add(u.href);
      out.push({ url: u.href, domain: u.hostname.replace(/^www\./, "") });
    } catch {
      /* skip */
    }
  }
  return out.slice(0, 20);
}

export function mediaKindFromMessage(kind: string, mime?: string | null): "image" | "video" | "file" | null {
  if (kind === "image" || kind === "gif" || kind === "sticker") return "image";
  if (kind === "video") return "video";
  if (kind === "file" || kind === "audio") return "file";
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "file";
  return null;
}

export function historyBucket(
  kind: string,
  body: string,
  extra?: { linkPreview?: { url?: string | null } | null } | null,
): "image" | "video" | "file" | "link" | null {
  const media = mediaKindFromMessage(kind);
  if (media) return media;
  if (kind === "text" && (extractMessageLinks(body).length > 0 || extra?.linkPreview?.url)) return "link";
  return null;
}

export function isMediaApiUrl(url: string): boolean {
  return /^\/api\/media\/[A-Za-z0-9_-]+$/.test(url.split("?")[0] ?? "");
}

export const PENDING_VIDEO_KEY = "nyx-pending-video";

export type PendingVideoDraft = {
  uploadId: string | null;
  purpose: UploadPurpose;
  caption: string;
  phase: UploadPhase;
  mediaUrl: string | null;
  thumbUrl: string | null;
  filename: string;
  bytes: number;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fileKey?: string | null;
};

export function readPendingVideo(): PendingVideoDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PENDING_VIDEO_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingVideoDraft;
  } catch {
    return null;
  }
}

export function writePendingVideo(draft: PendingVideoDraft | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!draft || draft.phase === "published" || draft.phase === "cancelled") {
      localStorage.removeItem(PENDING_VIDEO_KEY);
      return;
    }
    localStorage.setItem(PENDING_VIDEO_KEY, JSON.stringify(draft));
  } catch {
    /* quota */
  }
}
