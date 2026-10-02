import { getBearerToken } from "@/lib/auth/client";
import {
  canDownload,
  DOWNLOAD_DENIED,
  DOWNLOAD_FAILED,
  DOWNLOAD_INTERRUPTED,
  downloadBlockReason,
  filenameForTrack,
  FULL_TRACK_DOWNLOAD_MISSING,
  type MusicTrack,
} from "./music";
import { typeFromAudioMagic } from "./music-stream";

export type DownloadPhase = "idle" | "downloading" | "done" | "error";

export type DownloadEntry = {
  phase: DownloadPhase;
  pct: number | null;
  error: string | null;
  filename: string | null;
};

type Listener = () => void;

const entries = new Map<string, DownloadEntry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setEntry(id: string, entry: DownloadEntry): void {
  entries.set(id, entry);
  emit();
}

export function getDownloadEntry(id: string): DownloadEntry | null {
  return entries.get(id) ?? null;
}

export function subscribeDownloads(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function downloadLog(fields: Record<string, string | number | boolean | null>): void {
  console.info("[nyx-download]", fields);
}

async function readBody(res: Response, onProgress?: (pct: number | null) => void): Promise<Blob> {
  const total = Number(res.headers.get("content-length") || 0);
  const type = (res.headers.get("content-type") || "audio/mpeg").split(";")[0]?.trim() || "audio/mpeg";
  if (!res.body) {
    const blob = await res.blob();
    if (!blob.size) throw new Error(DOWNLOAD_FAILED);
    onProgress?.(100);
    return blob.type ? blob : new Blob([blob], { type });
  }
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value.slice());
      received += value.byteLength;
      onProgress?.(total > 0 ? Math.min(99, Math.round((received / total) * 100)) : null);
    }
  }
  if (!received) throw new Error(DOWNLOAD_FAILED);
  onProgress?.(100);
  return new Blob(chunks, { type });
}

function triggerSave(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* use plain filename */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const size = 0x2000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

async function assertFullAudio(blob: Blob, expectedMs: number | null): Promise<void> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!typeFromAudioMagic(head)) throw new Error(FULL_TRACK_DOWNLOAD_MISSING);
  if (!expectedMs || expectedMs < 45_000 || typeof Audio === "undefined") return;
  const url = URL.createObjectURL(blob);
  try {
    const duration = await new Promise<number | null>((resolve) => {
      const audio = new Audio();
      const timer = window.setTimeout(() => resolve(null), 8_000);
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        window.clearTimeout(timer);
        resolve(Number.isFinite(audio.duration) ? audio.duration : null);
      };
      audio.onerror = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
      audio.src = url;
    });
    if (duration != null && duration < 40 && expectedMs > 60_000) {
      throw new Error(FULL_TRACK_DOWNLOAD_MISSING);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function endpoints(trackId: string): { path: string; query: string } {
  const token = getBearerToken();
  const access = token ? `access=${encodeURIComponent(token)}` : "";
  const id = encodeURIComponent(trackId);
  const path = `/api/music/${id}/download${access ? `?${access}` : ""}`;
  const query = `/api/music-download?id=${id}${access ? `&${access}` : ""}`;
  return { path, query };
}

async function fetchAuthorized(track: MusicTrack, onProgress?: (pct: number | null) => void): Promise<{ blob: Blob; filename: string; contentType: string }> {
  const { path, query } = endpoints(track.id);
  let res = await fetch(path, { credentials: "include" });
  let contentType = res.headers.get("content-type") || "";
  if (res.status === 404 || contentType.includes("text/html")) {
    res = await fetch(query, { credentials: "include" });
    contentType = res.headers.get("content-type") || "";
  }
  downloadLog({
    trackId: track.id,
    provider: track.provider,
    status: res.status,
    contentType: contentType.split(";")[0] || null,
    bytes: Number(res.headers.get("content-length") || 0) || null,
    env: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "server",
    native: false,
  });
  if (!res.ok) {
    let message = res.status === 403 || res.status === 404 ? FULL_TRACK_DOWNLOAD_MISSING : DOWNLOAD_FAILED;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep mapped message */
    }
    throw new Error(message);
  }
  if (contentType.includes("text/html") || contentType.includes("application/json")) {
    throw new Error(FULL_TRACK_DOWNLOAD_MISSING);
  }
  const blob = await readBody(res, onProgress);
  await assertFullAudio(blob, track.durationMs);
  const filename = filenameFromDisposition(
    res.headers.get("content-disposition"),
    filenameForTrack(track.title, track.downloadUrl || "", blob.type),
  );
  return { blob, filename, contentType: blob.type || contentType };
}

async function saveOnDevice(blob: Blob, filename: string, mime: string): Promise<string> {
  const native = await import("@/utils/nativeCapabilities");
  if (!native.isNativePlatform()) {
    triggerSave(blob, filename);
    return "browser-downloads";
  }
  const platform = native.nativePlatform();
  const data = await blobToBase64(blob);
  if (platform === "android") {
    try {
      const saved = await native.savePublicAudio({ filename, mime, data });
      return saved.uri || "downloads/NYX";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/permission/i.test(message)) throw new Error(DOWNLOAD_DENIED);
      throw new Error(message || DOWNLOAD_FAILED);
    }
  }
  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  try {
    await Filesystem.writeFile({
      path: `NYX/${filename}`,
      data,
      directory: Directory.Documents,
      recursive: true,
    });
    return `Documents/NYX/${filename}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/permission/i.test(message)) throw new Error(DOWNLOAD_DENIED);
    throw new Error(DOWNLOAD_FAILED);
  }
}

async function runDownload(track: MusicTrack, onProgress?: (pct: number | null) => void): Promise<void> {
  if (!canDownload(track)) throw new Error(downloadBlockReason(track) || FULL_TRACK_DOWNLOAD_MISSING);
  setEntry(track.id, { phase: "downloading", pct: 0, error: null, filename: null });
  try {
    const file = await fetchAuthorized(track, (pct) => {
      setEntry(track.id, { phase: "downloading", pct, error: null, filename: null });
      onProgress?.(pct);
    });
    const location = await saveOnDevice(file.blob, file.filename, file.contentType);
    try {
      const { saveOfflineTrack } = await import("./music-offline");
      await saveOfflineTrack(track, file.blob, {
        filename: file.filename,
        contentType: file.contentType,
        location,
      });
    } catch {
      downloadLog({ trackId: track.id, provider: track.provider, status: 200, contentType: file.contentType, bytes: file.blob.size, error: "offline-index-failed" });
    }
    setEntry(track.id, { phase: "done", pct: 100, error: null, filename: file.filename });
    downloadLog({
      trackId: track.id,
      provider: track.provider,
      status: 200,
      contentType: file.contentType,
      bytes: file.blob.size,
      progress: 100,
      env: location,
    });
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "AbortError" || /network|failed to fetch|interrupted/i.test(error.message));
    const message = aborted && !(error instanceof Error && error.message === DOWNLOAD_FAILED)
      ? error instanceof Error && error.message && !/failed to fetch/i.test(error.message)
        ? error.message
        : DOWNLOAD_INTERRUPTED
      : error instanceof Error && error.message
        ? error.message
        : DOWNLOAD_FAILED;
    const friendly = /failed to fetch|networkerror/i.test(message) ? DOWNLOAD_INTERRUPTED : message;
    setEntry(track.id, { phase: "error", pct: null, error: friendly, filename: null });
    downloadLog({
      trackId: track.id,
      provider: track.provider,
      status: 0,
      contentType: null,
      bytes: null,
      error: friendly,
    });
    throw new Error(friendly);
  }
}

/** Download the authorized full track once. A second tap while it is running joins the same download. */
export function startTrackDownload(track: MusicTrack, onProgress?: (pct: number | null) => void, opts?: { force?: boolean }): Promise<void> {
  const current = inflight.get(track.id);
  if (current) return current;
  if (!opts?.force && getDownloadEntry(track.id)?.phase === "downloading") {
    return Promise.resolve();
  }
  const job = runDownload(track, onProgress).finally(() => {
    inflight.delete(track.id);
  });
  inflight.set(track.id, job);
  return job;
}

export async function downloadTrack(url: string, title: string, onProgress?: (pct: number | null) => void): Promise<Blob> {
  void url;
  void title;
  void onProgress;
  throw new Error(FULL_TRACK_DOWNLOAD_MISSING);
}
