import type { MusicTrack } from "./music";

const DB_NAME = "nyx-music-offline";
const STORE = "tracks";

export type OfflineRecord = {
  id: string;
  track: MusicTrack;
  savedAt: number;
  bytes: number;
  blob: Blob;
  filename?: string;
  contentType?: string;
  location?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn’t open NYX offline music."));
  });
}

export async function saveOfflineTrack(
  track: MusicTrack,
  blob: Blob,
  meta?: { filename?: string; contentType?: string; location?: string },
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      id: track.id,
      track: { ...track, audioUrl: track.audioUrl, previewUrl: null, downloadUrl: track.downloadUrl },
      savedAt: Date.now(),
      bytes: blob.size,
      blob,
      filename: meta?.filename,
      contentType: meta?.contentType || blob.type,
      location: meta?.location,
    } satisfies OfflineRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Couldn’t save offline."));
  });
  db.close();
}

export async function listOfflineTracks(): Promise<MusicTrack[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  const rows = await new Promise<OfflineRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as OfflineRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows
    .filter((row) => row.blob && row.bytes > 0)
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((r) => {
      const objectUrl = URL.createObjectURL(r.blob);
      return {
        ...r.track,
        audioUrl: objectUrl,
        previewUrl: objectUrl,
        downloadUrl: r.track.downloadUrl,
        playback: "full" as const,
        downloadable: true,
        previewAvailable: true,
      };
    });
}

export async function listOfflineIds(): Promise<string[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  const rows = await new Promise<OfflineRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as OfflineRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.filter((row) => row.blob && row.bytes > 0).map((row) => row.id);
}

export async function removeOfflineTrack(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function hasOfflineTrack(id: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  const db = await openDb();
  const found = await new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(Boolean(req.result && (req.result as OfflineRecord).bytes > 0));
    req.onerror = () => reject(req.error);
  });
  db.close();
  return found;
}

export function downloadLocationHint(): string {
  if (typeof navigator === "undefined") {
    return "Saved to this browser’s Downloads folder when the download is allowed.";
  }
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return "Saved in this browser’s Downloads. On iPhone, use Share → Save to Files. NYX cannot add tracks to Apple Music.";
  }
  if (/Android/i.test(ua)) {
    return "Saved to Downloads / Files when the browser allows it. The web app cannot write into Android’s Music library.";
  }
  return "Saved to this browser’s Downloads folder. It’s also available in NYX Downloads for offline play in this browser.";
}
