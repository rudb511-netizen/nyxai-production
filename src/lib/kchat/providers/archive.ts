import { normalizeTrackRights, trackId, type MusicTrack } from "../music.ts";
import { providerFetch } from "./health.ts";
import { adapterFromTrack } from "./resolve.ts";
import type { MusicProviderAdapter } from "./types.ts";

const SEARCH = "https://archive.org/advancedsearch.php";

export type ArchiveLicense = {
  stream: boolean;
  download: boolean;
  name: string;
  attribution: string | null;
};

/** Only public domain, CC0, CC BY, and CC BY-SA. NC, ND, and unlabeled items are dropped. */
export function archiveLicense(licenseUrl: string | null | undefined): ArchiveLicense {
  const raw = (licenseUrl || "").trim();
  const denied = { stream: false, download: false, name: "", attribution: null };
  if (!raw) return denied;
  let path = "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return denied;
    const host = url.hostname.toLowerCase();
    if (host !== "creativecommons.org" && !host.endsWith(".creativecommons.org")) return denied;
    path = `${host}${url.pathname}`.toLowerCase();
  } catch {
    return denied;
  }
  if (path.includes("publicdomain") || path.includes("/zero/")) {
    return { stream: true, download: true, name: "Public domain / CC0", attribution: null };
  }
  if (path.includes("-nc") || path.includes("-nd") || path.includes("sampling")) return denied;
  if (path.includes("/by-sa/")) {
    return { stream: true, download: true, name: "CC BY-SA", attribution: "Attribution required" };
  }
  if (path.includes("/licenses/by/")) {
    return { stream: true, download: true, name: "CC BY", attribution: "Attribution required" };
  }
  return denied;
}

export function safeArchiveId(raw: string | null | undefined): string | null {
  const id = (raw || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(id)) return null;
  if (id.includes("..")) return null;
  return id;
}

function safeFileName(raw: string | null | undefined): string | null {
  const name = (raw || "").trim();
  if (!name || name.length > 240 || name.includes("..") || name.startsWith("/") || name.includes("\\") || name.includes("?")) return null;
  if (name.split("/").length > 3) return null;
  return name;
}

function fileUrl(id: string, name: string): string {
  const path = name.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `https://archive.org/download/${encodeURIComponent(id)}/${path}`;
}

export function archiveDurationMs(length: unknown, size: unknown): number | null {
  if (typeof length === "number" && Number.isFinite(length) && length > 0) return Math.round(length * 1000);
  if (typeof length === "string") {
    const trimmed = length.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
    const parts = trimmed.split(":").map((part) => Number(part));
    if (parts.length >= 2 && parts.every((part) => Number.isFinite(part) && part >= 0)) {
      const seconds = parts.reduce((total, part) => total * 60 + part, 0);
      return seconds > 0 ? Math.round(seconds * 1000) : null;
    }
  }
  const bytes = typeof size === "number" ? size : typeof size === "string" ? Number(size) : NaN;
  if (Number.isFinite(bytes) && bytes >= 700_000) return null;
  return null;
}

type ArchiveFile = {
  name?: string;
  format?: string;
  size?: string | number;
  length?: string | number;
  source?: string;
  private?: string | boolean;
};

function rejectedName(name: string): boolean {
  const lower = name.toLowerCase();
  return /preview|sample|excerpt|snippet|spectrogram|thumb|_\d{2}kb/.test(lower) || lower.endsWith(".zip");
}

/** Prefer the original full MP3. Skip clips, zips, and 64kbps derivatives when a full file exists. */
export function pickArchiveAudio(files: ArchiveFile[]): { name: string; durationMs: number | null } | null {
  const ranked: { name: string; durationMs: number | null; score: number }[] = [];
  for (const file of files) {
    if (file.private === true || file.private === "true") continue;
    const name = safeFileName(file.name);
    if (!name || rejectedName(name)) continue;
    const format = (file.format || "").toLowerCase();
    const lower = name.toLowerCase();
    const audio = format.includes("mp3") || format.includes("ogg") || format.includes("flac") || format.includes("wave") || /\.(mp3|ogg|flac|wav)$/.test(lower);
    if (!audio || format.includes("zip")) continue;
    const durationMs = archiveDurationMs(file.length, file.size);
    const bytes = Number(file.size);
    if (durationMs != null && durationMs < 45_000) continue;
    if (durationMs == null && !(Number.isFinite(bytes) && bytes >= 700_000)) continue;
    let score = 0;
    if ((file.source || "").toLowerCase() === "original") score += 5;
    if (format.includes("vbr") || (lower.endsWith(".mp3") && !format.includes("64"))) score += 4;
    if (format.includes("64") || lower.includes("64kb")) score -= 3;
    if (lower.endsWith(".ogg")) score += 1;
    if (Number.isFinite(bytes)) score += Math.min(3, bytes / 5_000_000);
    ranked.push({ name, durationMs, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0] ? { name: ranked[0].name, durationMs: ranked[0].durationMs } : null;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return text(value[0]);
  return "";
}

function collectionsOf(meta: Record<string, unknown>): string[] {
  const value = meta.collection;
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") return [value];
  return [];
}

function blockedUpload(title: string, meta: Record<string, unknown>): boolean {
  if (/\bnightcore\b/i.test(title)) return true;
  return collectionsOf(meta).some((name) => /fringe|deemphasize|etree/i.test(name));
}

function trackFromItem(identifier: string, meta: Record<string, unknown>, files: ArchiveFile[]): MusicTrack | null {
  const id = safeArchiveId(identifier);
  const license = archiveLicense(text(meta.licenseurl));
  if (!id || !license.stream) return null;
  if (meta["access-restricted"] === true || meta["access-restricted"] === "true") return null;
  const audio = pickArchiveAudio(files);
  if (!audio) return null;
  const title = text(meta.title).slice(0, 180);
  const artist = (text(meta.creator) || text(meta.artist) || "Internet Archive").slice(0, 120);
  if (!title || blockedUpload(title, meta)) return null;
  const audioUrl = fileUrl(id, audio.name);
  return normalizeTrackRights({
    id: trackId("archive", id),
    provider: "archive",
    providerTrackId: id,
    title,
    artist,
    album: text(meta.album) || null,
    artworkUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
    audioUrl,
    previewUrl: null,
    downloadUrl: license.download ? audioUrl : null,
    durationMs: audio.durationMs,
    genre: text(meta.subject).slice(0, 80) || null,
    license: `${license.name} via Internet Archive.${license.attribution ? " Credit the artist." : ""}`,
    previewAvailable: false,
    playback: "full",
    downloadable: license.download,
    rightsReason: `${license.name} file hosted by the Internet Archive. NYX streams that file and does not re-license it.`,
    providerUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
    attribution: license.attribution,
  });
}

export function parseArchiveMetadata(json: unknown, identifier?: string): MusicTrack | null {
  const root = json as { metadata?: Record<string, unknown>; files?: ArchiveFile[] };
  const meta = root.metadata;
  if (!meta) return null;
  const id = safeArchiveId(identifier || text(meta.identifier));
  if (!id) return null;
  return trackFromItem(id, meta, Array.isArray(root.files) ? root.files : []);
}

export function archiveSearchTerm(query: string): string {
  const clean = query.replace(/[^a-zA-Z0-9\s'.-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const letters = clean.replace(/[^a-zA-Z0-9]/g, "");
  return letters.length >= 2 ? clean : "";
}

async function searchDocs(query: string): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams();
  params.set("q", query);
  for (const field of ["identifier", "title", "creator", "licenseurl"]) params.append("fl[]", field);
  params.set("output", "json");
  params.set("rows", "12");
  const json = await providerFetch("archive", `${SEARCH}?${params.toString()}`);
  const docs = (json as { response?: { docs?: unknown } })?.response?.docs;
  return Array.isArray(docs) ? docs.filter((doc): doc is Record<string, unknown> => Boolean(doc) && typeof doc === "object") : [];
}

async function hydrate(docs: Array<Record<string, unknown>>): Promise<MusicTrack[]> {
  const picked = docs
    .filter((doc) => archiveLicense(text(doc.licenseurl)).stream && safeArchiveId(text(doc.identifier)))
    .slice(0, 6);
  const settled = await Promise.allSettled(
    picked.map(async (doc) => {
      const id = safeArchiveId(text(doc.identifier));
      if (!id) return null;
      const json = await providerFetch("archive", `https://archive.org/metadata/${encodeURIComponent(id)}`, 7000, id);
      return parseArchiveMetadata(json, id);
    }),
  );
  const tracks: MusicTrack[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) tracks.push(result.value);
  }
  return tracks;
}

const methods = {
  searchTracks(query: string) {
    const term = archiveSearchTerm(query);
    if (!term) return Promise.resolve([]);
    const quoted = JSON.stringify(term);
    return searchDocs(
      `mediatype:audio AND format:MP3 AND licenseurl:*creativecommons.org* AND (title:${quoted} OR creator:${quoted})`,
    ).then(hydrate);
  },
  trending() {
    return searchDocs(
      "mediatype:audio AND format:MP3 AND (licenseurl:*creativecommons.org/licenses/by/* OR licenseurl:*creativecommons.org/publicdomain* OR licenseurl:*creativecommons.org/licenses/publicdomain*)",
    ).then(hydrate);
  },
  async getTrack(trackId: string) {
    const id = safeArchiveId(trackId);
    if (!id) return null;
    const json = await providerFetch("archive", `https://archive.org/metadata/${encodeURIComponent(id)}`, 8000, id);
    return parseArchiveMetadata(json, id);
  },
};

export const archiveProvider: MusicProviderAdapter = {
  id: "archive",
  capabilities: {
    provider: "archive",
    enabled: true,
    searchSupported: true,
    metadataSupported: true,
    fullTrackPlaybackSupported: true,
    previewSupported: false,
    officialPlayerSupported: false,
    downloadSupported: true,
    commercialUseAllowed: "per-track",
    streamingRestrictions:
      "Only items whose licenseurl is public domain, CC0, CC BY, or CC BY-SA, with a full audio file of at least 45 seconds. Restricted, unlabeled, NC, and ND items are not searched into the player.",
    downloadRestrictions: "The same open license is required. NYX downloads that Internet Archive file and no other URL.",
    attributionRequired: true,
    authenticationRequired: false,
    apiRateLimit: "Be polite to archive.org. NYX requests at most 12 search rows and hydrates 6 metadata records per search.",
    territoryRestrictions: "Internet Archive does not apply storefront locks to these open files.",
    licenseInformation: "The item licenseurl is stored on the track. A downloadable Internet Archive file is not a license for unrelated recordings.",
    officialDocumentationUrl: "https://archive.org/developers/",
    credentials: [],
  },
  ...methods,
  ...adapterFromTrack(methods),
};
