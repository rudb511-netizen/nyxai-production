/** Browser resumable uploader. Keeps the File in IndexedDB and never posts a whole video as JSON. */

import { getBearerToken } from "@/lib/auth/client";
import {
  DEFAULT_CHUNK_SIZE,
  chunkRange,
  etaSeconds,
  formatSpeed,
  phaseFromStatus,
  type UploadPhase,
  type UploadPurpose,
  uploadPct,
  uploadRecoveryMessage,
  writePendingVideo,
} from "./media-pipeline";

export type UploadSnapshot = {
  phase: UploadPhase;
  pct: number;
  speedBps: number;
  etaSec: number | null;
  speedLabel: string;
  error: string | null;
  uploadId: string | null;
  mediaUrl: string | null;
  thumbUrl: string | null;
  previewUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  bytes: number;
  filename: string;
  mime: string;
  online: boolean;
  fileKey: string | null;
};

const DB = "nyx-media";
const FILES = "files";
const SESS = "sessions";

function authHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  const token = getBearerToken();
  if (token) h.set("Authorization", `Bearer ${token}`);
  return h;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
      if (!db.objectStoreNames.contains(SESS)) db.createObjectStore(SESS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

async function idbSet(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export class MediaUploader {
  private file: File | null = null;
  private previewUrl: string | null = null;
  private aborted = false;
  private received = new Set<number>();
  private listeners = new Set<(s: UploadSnapshot) => void>();
  private netBound = false;
  private purpose: UploadPurpose = "video";
  snapshot: UploadSnapshot = {
    phase: "preparing",
    pct: 0,
    speedBps: 0,
    etaSec: null,
    speedLabel: "",
    error: null,
    uploadId: null,
    mediaUrl: null,
    thumbUrl: null,
    previewUrl: null,
    width: null,
    height: null,
    durationMs: null,
    bytes: 0,
    filename: "",
    mime: "",
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    fileKey: null,
  };

  onChange(fn: (s: UploadSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  private persist() {
    writePendingVideo({
      uploadId: this.snapshot.uploadId,
      purpose: this.purpose,
      caption: "",
      phase: this.snapshot.phase,
      mediaUrl: this.snapshot.mediaUrl,
      thumbUrl: this.snapshot.thumbUrl,
      filename: this.snapshot.filename,
      bytes: this.snapshot.bytes,
      mime: this.snapshot.mime,
      width: this.snapshot.width,
      height: this.snapshot.height,
      durationMs: this.snapshot.durationMs,
      fileKey: this.snapshot.fileKey,
    });
  }

  private emit(patch: Partial<UploadSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.persist();
    for (const fn of this.listeners) fn(this.snapshot);
  }

  private bindNet() {
    if (this.netBound || typeof window === "undefined") return;
    this.netBound = true;
    const on = () => {
      const online = navigator.onLine;
      this.emit({
        online,
        error: online ? null : uploadRecoveryMessage({ phase: this.snapshot.phase, online: false }),
      });
      if (online && this.snapshot.phase === "uploading" && this.file && this.snapshot.uploadId) {
        void this.retry();
      }
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
  }

  async pick(
    file: File,
    opts: {
      purpose: UploadPurpose;
      conversationId?: string;
      thumbUrl?: string | null;
      width?: number;
      height?: number;
      durationMs?: number;
    },
  ) {
    this.aborted = false;
    this.file = file;
    this.purpose = opts.purpose;
    this.bindNet();
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = URL.createObjectURL(file);
    this.received = new Set();
    this.emit({
      phase: "preparing",
      pct: 1,
      error: null,
      previewUrl: this.previewUrl,
      bytes: file.size,
      filename: file.name,
      mime: file.type || "application/octet-stream",
      thumbUrl: opts.thumbUrl ?? null,
      width: opts.width ?? null,
      height: opts.height ?? null,
      durationMs: opts.durationMs ?? null,
      mediaUrl: null,
      uploadId: null,
      online: navigator.onLine,
    });
    const key =
      (await sha256Hex(await file.slice(0, Math.min(file.size, 2_000_000)).arrayBuffer())) +
      ":" +
      file.size +
      ":" +
      file.lastModified;
    this.emit({ fileKey: key });
    await idbSet(FILES, key, file);
    try {
      const started = await this.start(file, { ...opts, idempotencyKey: key });
      this.emit({ uploadId: started.id, phase: phaseFromStatus(started.status) });
      if (started.status === "ready" || started.status === "published") {
        this.emit({
          phase: started.status === "published" ? "published" : "ready",
          pct: 100,
          mediaUrl: `/api/media/${started.id}`,
        });
        return this.snapshot;
      }
      for (const i of started.received ?? []) this.received.add(i);
      await idbSet(SESS, started.id, { key, purpose: opts.purpose });
      await this.uploadChunks(file, started);
    } catch (e) {
      this.emit({
        phase: "failed",
        error: uploadRecoveryMessage({
          phase: "failed",
          online: navigator.onLine,
          reason: e instanceof Error ? e.message : "Could not start upload.",
        }),
      });
    }
    return this.snapshot;
  }

  async restore(uploadId: string): Promise<boolean> {
    this.bindNet();
    try {
      const sess = await idbGet<{ key: string; purpose: UploadPurpose }>(SESS, uploadId);
      const file = sess ? await idbGet<File>(FILES, sess.key) : undefined;
      const st = await fetch(`/api/media/upload?id=${encodeURIComponent(uploadId)}`, {
        headers: authHeaders(),
        credentials: "include",
      });
      const body = (await st.json()) as {
        received?: number[];
        error?: string;
        status?: string;
        media_url?: string;
        fail_reason?: string | null;
      };
      if (!st.ok) return false;
      this.purpose = sess?.purpose ?? this.purpose;
      if (file) {
        this.file = file;
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = URL.createObjectURL(file);
      }
      this.emit({
        uploadId,
        phase: phaseFromStatus(body.status ?? "uploading"),
        mediaUrl: body.media_url ?? (body.status === "ready" ? `/api/media/${uploadId}` : null),
        previewUrl: this.previewUrl,
        fileKey: sess?.key ?? null,
        bytes: file?.size ?? this.snapshot.bytes,
        filename: file?.name ?? this.snapshot.filename,
        mime: file?.type ?? this.snapshot.mime,
        error: body.fail_reason ?? null,
      });
      this.received = new Set(body.received ?? []);
      if ((body.status === "uploading" || body.status === "failed") && file) {
        await this.retry();
      }
      return true;
    } catch {
      return false;
    }
  }

  async retry() {
    if (!this.snapshot.uploadId) return;
    this.aborted = false;
    this.emit({ phase: "uploading", error: null, pct: Math.max(1, this.snapshot.pct) });
    try {
      const st = await fetch(`/api/media/upload?id=${encodeURIComponent(this.snapshot.uploadId)}`, {
        headers: authHeaders(),
        credentials: "include",
      });
      const body = (await st.json()) as {
        received?: number[];
        error?: string;
        status?: string;
        media_url?: string;
      };
      if (!st.ok) throw new Error(body.error || "Could not resume.");
      if (body.status === "ready" || body.status === "published") {
        this.emit({
          phase: body.status === "published" ? "published" : "ready",
          pct: 100,
          mediaUrl: body.media_url ?? `/api/media/${this.snapshot.uploadId}`,
          error: null,
        });
        return;
      }
      this.received = new Set(body.received ?? []);
      if (!this.file) throw new Error("The original file is no longer on this device. Select it again.");
      await this.uploadChunks(this.file, {
        id: this.snapshot.uploadId,
        chunkSize: DEFAULT_CHUNK_SIZE,
        chunkCount: Math.max(1, Math.ceil(this.file.size / DEFAULT_CHUNK_SIZE)),
        received: [...this.received],
        status: body.status ?? "uploading",
        maxBytes: this.file.size,
      });
    } catch (e) {
      this.emit({
        phase: "failed",
        error: uploadRecoveryMessage({
          phase: "failed",
          online: navigator.onLine,
          reason: e instanceof Error ? e.message : "Retry failed.",
        }),
      });
    }
  }

  cancel() {
    this.aborted = true;
    this.emit({ phase: "cancelled", error: null });
    writePendingVideo(null);
    const id = this.snapshot.uploadId;
    if (id) {
      void fetch(`/api/media/upload?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
        credentials: "include",
      }).catch(() => undefined);
    }
  }

  dispose() {
    this.aborted = true;
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
  }

  private async start(file: File, opts: { purpose: UploadPurpose; conversationId?: string; idempotencyKey: string }) {
    const res = await fetch("/api/media/upload", {
      method: "POST",
      credentials: "include",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        purpose: opts.purpose,
        mime: file.type || "application/octet-stream",
        filename: file.name,
        totalBytes: file.size,
        chunkSize: DEFAULT_CHUNK_SIZE,
        idempotencyKey: opts.idempotencyKey,
        conversationId: opts.conversationId,
      }),
    });
    const body = (await res.json()) as {
      id: string;
      chunkSize: number;
      chunkCount: number;
      maxBytes: number;
      received: number[];
      status: string;
      error?: string;
    };
    if (!res.ok) throw new Error(body.error || "Could not start upload.");
    return body;
  }

  private async uploadChunks(
    file: File,
    started: { id: string; chunkSize: number; chunkCount: number; received: number[]; status: string; maxBytes: number },
  ) {
    const chunkSize = started.chunkSize || DEFAULT_CHUNK_SIZE;
    const count = started.chunkCount;
    this.emit({ phase: "uploading", uploadId: started.id, pct: uploadPct(this.received.size, count) });
    const queue: number[] = [];
    for (let i = 0; i < count; i++) if (!this.received.has(i)) queue.push(i);
    let sentBytes = this.received.size * chunkSize;
    let windowStart = Date.now();
    let windowBytes = 0;
    const workers = 3;
    const run = async () => {
      while (queue.length && !this.aborted) {
        if (!navigator.onLine) {
          this.emit({
            online: false,
            error: uploadRecoveryMessage({ phase: "uploading", online: false }),
          });
          await sleep(800);
          continue;
        }
        const index = queue.shift();
        if (index == null) return;
        const { start, end } = chunkRange(index, file.size, chunkSize);
        const blob = file.slice(start, end);
        const buf = await blob.arrayBuffer();
        const checksum = await sha256Hex(buf);
        let attempt = 0;
        while (!this.aborted) {
          try {
            const res = await fetch(`/api/media/upload?id=${encodeURIComponent(started.id)}&i=${index}`, {
              method: "PUT",
              credentials: "include",
              headers: authHeaders({ "content-type": "application/octet-stream", "x-nyx-checksum": checksum }),
              body: buf,
            });
            const json = (await res.json()) as { error?: string; receivedCount?: number };
            if (!res.ok) throw new Error(json.error || "Chunk rejected.");
            this.received.add(index);
            sentBytes += buf.byteLength;
            windowBytes += buf.byteLength;
            const dt = Math.max(1, Date.now() - windowStart);
            if (dt > 800) {
              const speed = (windowBytes / dt) * 1000;
              windowStart = Date.now();
              windowBytes = 0;
              const remaining = Math.max(0, file.size - sentBytes);
              this.emit({
                online: true,
                error: null,
                pct: uploadPct(this.received.size, count),
                speedBps: speed,
                speedLabel: formatSpeed(speed),
                etaSec: etaSeconds(remaining, speed),
              });
            } else {
              this.emit({ pct: uploadPct(this.received.size, count), online: true, error: null });
            }
            break;
          } catch (e) {
            attempt += 1;
            if (attempt >= 5) {
              queue.unshift(index);
              throw e;
            }
            await sleep(400 * attempt);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: workers }, () => run()));
    if (this.aborted) return;
    this.emit({ phase: "processing", pct: 99 });
    const done = await fetch("/api/media/complete", {
      method: "POST",
      credentials: "include",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        id: started.id,
        thumbUrl: this.snapshot.thumbUrl,
        width: this.snapshot.width,
        height: this.snapshot.height,
        durationMs: this.snapshot.durationMs,
      }),
    });
    const body = (await done.json()) as { error?: string; mediaUrl?: string; status?: string; thumbUrl?: string | null };
    if (!done.ok) throw new Error(body.error || "Video processing failed. Retry processing.");
    this.emit({
      phase: "ready",
      pct: 100,
      mediaUrl: body.mediaUrl ?? `/api/media/${started.id}`,
      thumbUrl: body.thumbUrl ?? this.snapshot.thumbUrl,
      error: null,
    });
  }
}

export function mediaSrc(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("/api/media/")) {
    const token = getBearerToken();
    if (!token) return url;
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}access=${encodeURIComponent(token)}`;
  }
  return url;
}

export async function dataUrlToFile(url: string, filename: string): Promise<File> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "video/webm" });
}
