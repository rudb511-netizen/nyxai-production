/** Licensed music catalog parsers. Never invent tracks — empty/invalid JSON yields []. */

export type MusicProvider = "itunes" | "jamendo" | "audius" | "archive" | "nyx";

export type MusicPlayback = "full" | "preview" | "none";

/** What NYX is actually allowed to do with this row. Never inferred by stretching a preview. */
export type PlaybackType = "FULL_TRACK" | "PREVIEW" | "OFFICIAL_PLAYER" | "UNAVAILABLE";

export type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  /** Catalog length in milliseconds. Null for a preview whose real clip length comes from the file. */
  durationMs: number | null;
  duration?: number | null;
  previewUrl: string | null;
  /** Authorized full-length stream. Null when the provider did not give one. */
  fullTrackUrl?: string | null;
  audioUrl: string | null;
  officialPlayerUrl?: string | null;
  downloadUrl: string | null;
  provider: MusicProvider;
  playbackProvider?: MusicProvider;
  providerTrackId: string;
  album: string | null;
  genre: string | null;
  license: string;
  rightsReason?: string;
  previewAvailable: boolean;
  playback: MusicPlayback;
  playbackType?: PlaybackType;
  canStreamFull?: boolean;
  downloadable: boolean;
  canDownload?: boolean;
  /** Other legal full-track sources for the same recording. Playback may try these. Previews are never stored here. */
  alternates?: MusicTrack[];
  isrc?: string | null;
  providerUrl?: string | null;
  attribution?: string | null;
};

export const ITUNES_PREVIEW_LICENSE =
  "30-second licensed preview from Apple. Full tracks are not stored or sold by NYX.";

export const JAMENDO_LICENSE =
  "Creative Commons / Jamendo. Streamed from Jamendo. Download only when the license allows it.";

export const NYX_ORIGINAL_LICENSE = "NYX original audio recorded by a NYX account. Full playback and download allowed.";

export const AUDIUS_LICENSE =
  "Full track from Audius. NYX plays the official Audius stream and does not keep a copy of the file.";

export const PREVIEW_ONLY = "This track is available as a preview only.";
export const FULL_TRACK_FAILED = "Unable to load the full track.";
export const TRY_ANOTHER_PROVIDER = "Playback source temporarily unavailable. Trying another provider.";
export const NO_FULL_TRACK = "No full-track stream is available for this song.";
export const USE_NEEDS_FILE = "Only a full track file can be used here. This source does not give NYX the audio.";
export const PLAYBACK_UNAVAILABLE = "Playback unavailable";
export const APPLE_PREVIEW_REASON =
  "Apple's public catalog API only returns a 30-second preview. Full playback stays in Apple Music and needs the listener's own subscription. NYX does not use MusicKit or extract that audio.";
export const APPLE_OFFICIAL_REASON =
  "Apple does not give NYX the song file. Playback stays in Apple's official embed, which may require the listener's own Apple Music subscription. NYX does not extract that audio.";
export const AUDIUS_GATED_REASON =
  "Audius gated this stream. NYX opens the official Audius player and does not extract the audio.";
export const AUDIUS_STREAM_REASON =
  "Audius allows third-party apps to stream the full track from its official stream API. Download stays off unless the artist allowed it.";
export const JAMENDO_STREAM_REASON =
  "Jamendo allows full streaming of this file. Download stays off unless that license allows it.";

export const FULL_CATALOG_LICENSE =
  "Full tracks stream from the source audio file. Download saves the file to this device when the license allows it.";

function isStreamOnlyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith("/stream") || path.includes("/stream/");
  } catch {
    return /\/stream(\?|$)/.test(url);
  }
}

/** Official embeds only. Anything else is not treated as an authorized player. */
export function isOfficialPlayerUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "embed.audius.co" && /^\/v1\/tracks\/[^/]+/.test(url.pathname)) return true;
    if ((host === "audius.co" || host === "www.audius.co") && url.pathname.startsWith("/embed/track")) return true;
    if (host === "embed.music.apple.com" && /^\/[a-z]{2}\/(album|song)\/\d+/.test(url.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function audiusEmbedUrl(providerTrackId: string): string {
  return `https://embed.audius.co/v1/tracks/${encodeURIComponent(providerTrackId)}`;
}

/** Official Apple Music embed built only from an Apple catalog URL. Never a raw audio file. */
export function appleEmbedFromView(view: string | null | undefined, trackId = ""): string | null {
  if (!view) return null;
  try {
    const url = new URL(view);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host !== "music.apple.com" && host !== "geo.music.apple.com") return null;
    const match = url.pathname.match(/^\/([a-z]{2})\/(album|song)\/(?:[^/]+\/)?(\d+)/i);
    if (!match) return null;
    const country = match[1].toLowerCase();
    const kind = match[2].toLowerCase();
    const collectionId = match[3];
    const songId = /^\d+$/.test(trackId) ? trackId : url.searchParams.get("i") || "";
    if (kind === "song") return `https://embed.music.apple.com/${country}/song/${collectionId}`;
    if (!/^\d+$/.test(songId)) return null;
    return `https://embed.music.apple.com/${country}/album/${collectionId}?i=${songId}`;
  } catch {
    return null;
  }
}

function withRights(
  t: Omit<MusicTrack, "playback" | "downloadable" | "downloadUrl" | "audioUrl" | "playbackType" | "canStreamFull" | "canDownload" | "fullTrackUrl" | "playbackProvider" | "rightsReason" | "duration"> & {
    audioUrl?: string | null;
    downloadUrl?: string | null;
    playback?: MusicPlayback;
    downloadable?: boolean;
    officialPlayerUrl?: string | null;
    rightsReason?: string;
    providerUrl?: string | null;
    attribution?: string | null;
    isrc?: string | null;
    alternates?: MusicTrack[];
  },
): MusicTrack {
  const provider = t.provider;
  let audioUrl = t.audioUrl && !isPreviewAudioUrl(t.audioUrl) ? t.audioUrl : null;
  let previewUrl = t.previewUrl || null;
  if (provider === "itunes") audioUrl = null;
  if (previewUrl && audioUrl && previewUrl === audioUrl) previewUrl = null;
  if (previewUrl && provider !== "itunes" && !isPreviewAudioUrl(previewUrl)) {
    if (!audioUrl) audioUrl = previewUrl;
    previewUrl = null;
  }
  if (previewUrl && !previewUrl.startsWith("https://")) previewUrl = null;
  const officialPlayerUrl = isOfficialPlayerUrl(t.officialPlayerUrl) ? t.officialPlayerUrl! : null;
  const explicitDownload = t.downloadUrl || null;
  const downloadUrl =
    provider === "itunes"
      ? null
      : explicitDownload && !isStreamOnlyUrl(explicitDownload) && !isPreviewAudioUrl(explicitDownload)
        ? explicitDownload
        : t.downloadable && provider !== "audius" && audioUrl && !isStreamOnlyUrl(audioUrl)
          ? audioUrl
          : null;
  const downloadable = Boolean(t.downloadable && downloadUrl);
  if (!audioUrl && provider !== "itunes" && provider !== "audius" && downloadUrl) audioUrl = downloadUrl;
  let playbackType: PlaybackType = "UNAVAILABLE";
  if (provider !== "itunes" && audioUrl) playbackType = "FULL_TRACK";
  else if (officialPlayerUrl) playbackType = "OFFICIAL_PLAYER";
  else if (previewUrl) playbackType = "PREVIEW";
  const playback: MusicPlayback = playbackType === "FULL_TRACK" ? "full" : playbackType === "PREVIEW" ? "preview" : "none";
  const durationMs = playbackType === "PREVIEW" ? null : t.durationMs ?? null;
  const rightsReason =
    t.rightsReason ||
    (playbackType === "FULL_TRACK"
      ? provider === "audius"
        ? AUDIUS_STREAM_REASON
        : provider === "jamendo"
          ? JAMENDO_STREAM_REASON
          : provider === "nyx"
            ? NYX_ORIGINAL_LICENSE
            : t.license
      : playbackType === "PREVIEW"
        ? provider === "itunes"
          ? APPLE_PREVIEW_REASON
          : PREVIEW_ONLY
        : playbackType === "OFFICIAL_PLAYER"
          ? provider === "itunes"
            ? APPLE_OFFICIAL_REASON
            : AUDIUS_GATED_REASON
          : PLAYBACK_UNAVAILABLE);
  return {
    ...t,
    provider,
    playbackProvider: provider,
    audioUrl: playbackType === "FULL_TRACK" ? audioUrl : null,
    fullTrackUrl: playbackType === "FULL_TRACK" ? audioUrl : null,
    previewUrl: playbackType === "PREVIEW" ? previewUrl : null,
    officialPlayerUrl: playbackType === "OFFICIAL_PLAYER" ? officialPlayerUrl : null,
    downloadUrl: downloadable ? downloadUrl : null,
    downloadable,
    canDownload: downloadable,
    canStreamFull: playbackType === "FULL_TRACK",
    playback,
    playbackType,
    durationMs,
    duration: durationMs,
    rightsReason,
    previewAvailable: playbackType === "PREVIEW" || playbackType === "FULL_TRACK" || playbackType === "OFFICIAL_PLAYER",
  };
}

export function normalizeTrackRights(track: MusicTrack): MusicTrack {
  return withRights(track);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function int(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function artworkBigger(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/100x100bb/g, "300x300bb").replace(/\/100x100bb/, "/300x300bb");
}

export function trackId(provider: MusicProvider, providerTrackId: string): string {
  return `${provider}:${providerTrackId}`;
}

export function normalizeProvider(raw: string | null | undefined): MusicProvider {
  if (raw === "jamendo" || raw === "audius" || raw === "archive" || raw === "nyx") return raw;
  return "itunes";
}

export const FULL_DOWNLOAD_UNAVAILABLE = "Full download unavailable";
export const DOWNLOAD_NOT_ALLOWED = "Download unavailable for this track.";
export const DOWNLOAD_FAILED = "Download failed. Please try again.";
export const DOWNLOAD_INTERRUPTED = "Your connection was interrupted.";
export const DOWNLOAD_DENIED = "Download permission was denied.";
export const FULL_TRACK_DOWNLOAD_MISSING = "Full track unavailable for download.";

/** Official Audius stream. Playback only — never a download. */
export function audiusStreamUrl(providerTrackId: string): string {
  return `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(providerTrackId)}/stream?app_name=NYX`;
}

/** Official Audius download. Only valid when the artist marked the track downloadable and it is not gated. */
export function audiusDownloadUrl(providerTrackId: string): string {
  return `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(providerTrackId)}/download?app_name=NYX`;
}

/** Artist-permitted Audius download. Gated or follow-only files are not downloadable. */
export function audiusDownloadPermitted(raw: Record<string, unknown>): boolean {
  const flagged = raw.is_downloadable === true || raw.downloadable === true;
  if (!flagged) return false;
  if (raw.is_download_gated === true) return false;
  const download = raw.download;
  if (download && typeof download === "object") {
    const row = download as Record<string, unknown>;
    if (row.requires_follow === true || row.is_downloadable === false) return false;
  }
  return true;
}

export function parseAudiusTracks(json: unknown): MusicTrack[] {
  const root = json as { data?: unknown };
  const list = Array.isArray(root?.data) ? root.data : root?.data && typeof root.data === "object" ? [root.data] : [];
  const out: MusicTrack[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const providerTrackId = str(r.id);
    const title = str(r.title);
    const user = r.user as { name?: string } | undefined;
    const artist = str(user?.name) || str(r.artist) || "Audius";
    if (!providerTrackId || !title) continue;
    const artwork = r.artwork as Record<string, unknown> | undefined;
    const art = str(artwork?.["480x480"]) || str(artwork?.["150x150"]) || null;
    const seconds = int(r.duration);
    const durationMs = seconds == null ? null : seconds > 10_000 ? seconds : seconds * 1000;
    const permitted = audiusDownloadPermitted(r);
    const gated = r.is_stream_gated === true;
    const streamable = r.is_streamable !== false && !gated;
    const stream = streamable ? audiusStreamUrl(providerTrackId) : null;
    out.push(
      withRights({
        id: trackId("audius", providerTrackId),
        provider: "audius",
        providerTrackId,
        title: title.slice(0, 180),
        artist: artist.slice(0, 120),
        album: null,
        artworkUrl: art,
        audioUrl: stream,
        previewUrl: null,
        officialPlayerUrl: stream ? null : audiusEmbedUrl(providerTrackId),
        downloadUrl: permitted ? audiusDownloadUrl(providerTrackId) : null,
        durationMs,
        genre: str(r.genre) || null,
        license: AUDIUS_LICENSE,
        previewAvailable: false,
        playback: stream ? "full" : "none",
        downloadable: permitted,
        rightsReason: stream ? undefined : AUDIUS_GATED_REASON,
      }),
    );
  }
  return out;
}

export function parseItunesSearch(json: unknown): MusicTrack[] {
  const root = json as { results?: unknown };
  if (!Array.isArray(root?.results)) return [];
  const out: MusicTrack[] = [];
  for (const raw of root.results) {
    const r = raw as Record<string, unknown>;
    const trackIdRaw = r.trackId ?? r.track_id;
    const providerTrackId = trackIdRaw != null ? String(trackIdRaw) : "";
    const title = str(r.trackName);
    const artist = str(r.artistName);
    const previewUrl = str(r.previewUrl) || null;
    if (!providerTrackId || !title || !artist) continue;
    out.push(
      withRights({
        id: trackId("itunes", providerTrackId),
        provider: "itunes",
        providerTrackId,
        title: title.slice(0, 180),
        artist: artist.slice(0, 120),
        album: str(r.collectionName) || null,
        artworkUrl: artworkBigger(str(r.artworkUrl100) || str(r.artworkUrl60) || null),
        audioUrl: null,
        previewUrl,
        officialPlayerUrl: appleEmbedFromView(str(r.trackViewUrl), providerTrackId),
        durationMs: int(r.trackTimeMillis),
        genre: str(r.primaryGenreName) || null,
        license: ITUNES_PREVIEW_LICENSE,
        previewAvailable: Boolean(previewUrl),
      }),
    );
  }
  return out;
}

function rssLabel(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object" && "label" in v) return str((v as { label: unknown }).label);
  return "";
}

function rssId(entry: Record<string, unknown>): string {
  const id = entry.id as { attributes?: { "im:id"?: string }; label?: string } | string | undefined;
  if (typeof id === "string") {
    const m = id.match(/id(\d+)/);
    return m?.[1] ?? id;
  }
  if (id?.attributes?.["im:id"]) return String(id.attributes["im:id"]);
  if (id?.label) {
    const m = id.label.match(/id(\d+)/);
    return m?.[1] ?? "";
  }
  return "";
}

function rssArtwork(entry: Record<string, unknown>): string | null {
  const images = entry["im:image"];
  if (!Array.isArray(images) || images.length === 0) return null;
  const last = images[images.length - 1] as { label?: string };
  return str(last?.label) || null;
}

function rssLinks(entry: Record<string, unknown>): string[] {
  const link = entry.link;
  const links = Array.isArray(link) ? link : link ? [link] : [];
  const out: string[] = [];
  for (const item of links) {
    const href = (item as { attributes?: { href?: string } })?.attributes?.href;
    if (href) out.push(href);
  }
  return out;
}

function rssPreview(entry: Record<string, unknown>): string | null {
  const link = entry.link;
  const links = Array.isArray(link) ? link : link ? [link] : [];
  for (const item of links) {
    const href = (item as { attributes?: { href?: string; rel?: string; type?: string } })?.attributes;
    if (href?.rel === "enclosure" && href.href) return href.href;
    if (href?.type?.startsWith("audio") && href.href) return href.href;
  }
  return null;
}

export function parseItunesRss(json: unknown): MusicTrack[] {
  const feed = (json as { feed?: { entry?: unknown } })?.feed;
  const entries = feed?.entry;
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
  const out: MusicTrack[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const providerTrackId = rssId(e);
    const title = rssLabel(e["im:name"]) || rssLabel(e.title);
    const artist = rssLabel(e["im:artist"]);
    if (!providerTrackId || !title || !artist) continue;
    const previewUrl = rssPreview(e);
    const view = rssLinks(e).find((href) => href.includes("music.apple.com")) || null;
    out.push(
      withRights({
        id: trackId("itunes", providerTrackId),
        provider: "itunes",
        providerTrackId,
        title: title.slice(0, 180),
        artist: artist.slice(0, 120),
        album: rssLabel((e["im:collection"] as { "im:name"?: unknown } | undefined)?.["im:name"]) || null,
        artworkUrl: rssArtwork(e),
        audioUrl: null,
        previewUrl,
        officialPlayerUrl: appleEmbedFromView(view, providerTrackId),
        durationMs: null,
        genre: rssLabel(e.category) || null,
        license: ITUNES_PREVIEW_LICENSE,
        previewAvailable: Boolean(previewUrl),
      }),
    );
  }
  return out;
}

export function parseJamendoTracks(json: unknown): MusicTrack[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: MusicTrack[] = [];
  for (const raw of results) {
    const r = raw as Record<string, unknown>;
    const providerTrackId = str(r.id);
    const title = str(r.name);
    const artist = str(r.artist_name);
    const audio = str(r.audio) || null;
    const downloadUrl = str(r.audiodownload) || null;
    const allowed = r.audiodownload_allowed === true || r.audiodownload_allowed === "true";
    if (!providerTrackId || !title || !artist) continue;
    out.push(
      withRights({
        id: trackId("jamendo", providerTrackId),
        provider: "jamendo",
        providerTrackId,
        title: title.slice(0, 180),
        artist: artist.slice(0, 120),
        album: str(r.album_name) || null,
        artworkUrl: str(r.image) || str(r.album_image) || null,
        audioUrl: audio,
        previewUrl: null,
        downloadUrl: allowed ? downloadUrl : null,
        durationMs: int(r.duration) ? int(r.duration)! * 1000 : null,
        genre: null,
        license: JAMENDO_LICENSE,
        previewAvailable: false,
        playback: audio ? "full" : "none",
        downloadable: allowed && Boolean(downloadUrl),
      }),
    );
  }
  return out;
}

export function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  return formatDuration(ms) || "0:00";
}

export function playbackTypeOf(
  track: { playback?: MusicPlayback | null; playbackType?: PlaybackType | null; previewUrl?: string | null; audioUrl?: string | null; downloadUrl?: string | null; officialPlayerUrl?: string | null; fullTrackUrl?: string | null },
): PlaybackType {
  if (track.playbackType) return track.playbackType;
  if (track.officialPlayerUrl && isOfficialPlayerUrl(track.officialPlayerUrl) && !track.audioUrl && !track.fullTrackUrl) return "OFFICIAL_PLAYER";
  const fullSrc = track.fullTrackUrl || track.audioUrl || (track.playback === "full" ? track.downloadUrl : null);
  if (fullSrc && !isPreviewAudioUrl(fullSrc) && track.playback !== "preview") return "FULL_TRACK";
  if (track.previewUrl || track.playback === "preview") return "PREVIEW";
  return "UNAVAILABLE";
}

export function fullTrackUrl(
  track: { playback?: MusicPlayback | null; playbackType?: PlaybackType | null; previewUrl?: string | null; downloadUrl?: string | null; audioUrl?: string | null; fullTrackUrl?: string | null; officialPlayerUrl?: string | null },
): string | null {
  if (playbackTypeOf(track) !== "FULL_TRACK") return null;
  const src = track.fullTrackUrl || track.audioUrl || track.downloadUrl || null;
  if (!src || isPreviewAudioUrl(src)) return null;
  return src;
}

export function playableUrl(
  track: { playback?: MusicPlayback | null; playbackType?: PlaybackType | null; previewUrl?: string | null; downloadUrl?: string | null; audioUrl?: string | null; fullTrackUrl?: string | null; officialPlayerUrl?: string | null },
): string | null {
  const type = playbackTypeOf(track);
  if (type === "FULL_TRACK") return fullTrackUrl(track);
  if (type === "PREVIEW" && track.previewUrl?.startsWith("https://")) return track.previewUrl;
  return null;
}

export const PREVIEW_UNAVAILABLE = "Preview currently unavailable for this track.";
export const TRACK_UNAVAILABLE = "This track is currently unavailable.";
export const FORMAT_UNSUPPORTED = "This audio format isn't supported on your device.";
export const PLAYBACK_FAILED = "Unable to play this track. Try again.";

export type MediaErrorKind = "autoplay" | "abort" | "network" | "decode" | "unsupported" | "unavailable" | "unknown";

export type AudioSource = { src: string; type: string };

export type UrlProbe = {
  ok: boolean;
  status: number | null;
  contentType: string | null;
  kind: "ok" | "unavailable" | "network" | "mismatch";
};

export function mimeForAudioUrl(url: string): string {
  const u = url.split("?")[0]?.toLowerCase() ?? "";
  if (u.endsWith(".mp3") || u.includes(".mp3") || u.includes("audioformat=mp3")) return "audio/mpeg";
  if (u.endsWith(".m4a") || u.endsWith(".aac") || u.endsWith(".mp4") || u.includes(".m4a")) return "audio/mp4";
  if (u.endsWith(".ogg") || u.endsWith(".oga")) return "audio/ogg";
  if (u.endsWith(".wav")) return "audio/wav";
  if (u.endsWith(".webm")) return "audio/webm";
  return "audio/mpeg";
}

export function isAudioContentType(type: string): boolean {
  const t = type.toLowerCase();
  return (
    t.startsWith("audio/") ||
    t.includes("mpeg") ||
    t.includes("mp4") ||
    t.includes("aac") ||
    t.includes("m4a") ||
    t.includes("octet-stream")
  );
}

export function playbackSources(
  track: { playback?: MusicPlayback | null; playbackType?: PlaybackType | null; previewUrl?: string | null; downloadUrl?: string | null; audioUrl?: string | null; fullTrackUrl?: string | null; officialPlayerUrl?: string | null },
): AudioSource[] {
  const type = playbackTypeOf(track);
  if (type === "PREVIEW") {
    const src = track.previewUrl;
    if (!src || !src.startsWith("https://")) return [];
    return [{ src, type: mimeForAudioUrl(src) }];
  }
  if (type !== "FULL_TRACK") return [];
  const seen = new Set<string>();
  const out: AudioSource[] = [];
  for (const src of [track.fullTrackUrl, track.audioUrl, track.downloadUrl]) {
    if (!src || seen.has(src) || isPreviewAudioUrl(src)) continue;
    seen.add(src);
    out.push({ src, type: mimeForAudioUrl(src) });
  }
  return out;
}

export function classifyProbe(status: number | null, contentType: string | null): UrlProbe["kind"] {
  if (status === 401 || status === 403 || status === 404 || status === 410 || status === 416) return "unavailable";
  if (status != null && status >= 500) return "network";
  if (status != null && status >= 200 && status < 400) {
    const t = (contentType || "").toLowerCase();
    if (t && !isAudioContentType(t) && (t.includes("html") || t.includes("json") || t.includes("text/"))) {
      return "mismatch";
    }
    return "ok";
  }
  return "network";
}

export function mediaErrorKind(code: number | undefined): MediaErrorKind {
  if (code === 1) return "abort";
  if (code === 2) return "network";
  if (code === 3) return "decode";
  if (code === 4) return "unsupported";
  return "unknown";
}

export function deviceCanPlayMime(mime: string): boolean | null {
  if (typeof document === "undefined") return null;
  try {
    const probe = document.createElement("audio");
    const result = probe.canPlayType(mime);
    if (result === "") return false;
    return true;
  } catch {
    return null;
  }
}

export function shouldClaimUnsupported(url: string, mediaCode: number | undefined): boolean {
  if (mediaCode !== 3 && mediaCode !== 4) return false;
  const mime = mimeForAudioUrl(url);
  const can = deviceCanPlayMime(mime);
  if (can === true) return false;
  if (can === false) return true;
  return !url;
}

export function mediaErrorMessage(
  code: number | undefined,
  opts: { url?: string; kind?: MediaErrorKind | UrlProbe["kind"] } = {},
): string {
  const url = opts.url ?? "";
  const kind = opts.kind;
  if (kind === "unavailable" || kind === "mismatch") return TRACK_UNAVAILABLE;
  if (kind === "network") {
    return shouldClaimUnsupported(url, code) ? FORMAT_UNSUPPORTED : TRACK_UNAVAILABLE;
  }
  if (kind === "ok") {
    return shouldClaimUnsupported(url, code) ? FORMAT_UNSUPPORTED : PLAYBACK_FAILED;
  }
  if (!kind && (code === 4 || code === 3)) return FORMAT_UNSUPPORTED;
  if (kind === "decode" || kind === "unsupported") {
    return shouldClaimUnsupported(url, code ?? 4) ? FORMAT_UNSUPPORTED : TRACK_UNAVAILABLE;
  }
  return PLAYBACK_FAILED;
}

export function sanitizeMediaSrcForLog(url: string): string {
  try {
    const u = new URL(url, "https://nyx.invalid");
    return `${u.origin}${u.pathname}`.slice(0, 180);
  } catch {
    return url.split("?")[0]?.slice(0, 180) || "[src]";
  }
}

export function isAutoplayBlock(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "name" in err && (err as { name: string }).name === "NotAllowedError");
}

export function isAbortPlay(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError");
}

export function isNotSupportedPlay(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "name" in err && (err as { name: string }).name === "NotSupportedError",
  );
}

export function safeHttpsAudio(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function looseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Prefer an exact artist+title hit, then the same title, then the first preview. */
export function pickPreviewTrack(tracks: MusicTrack[], artist: string, title: string): MusicTrack | null {
  const playable = tracks.filter((t) => safeHttpsAudio(t.previewUrl) || safeHttpsAudio(t.audioUrl));
  if (!playable.length) return null;
  const a = looseName(artist);
  const n = looseName(title);
  const exact = a && n ? playable.find((t) => looseName(t.artist) === a && looseName(t.title) === n) : undefined;
  if (exact) return exact;
  const titled = n ? playable.find((t) => looseName(t.title) === n) : undefined;
  if (titled) return titled;
  const artistHit = a ? playable.find((t) => looseName(t.artist) === a) : undefined;
  return artistHit ?? playable[0] ?? null;
}

export function pickItunesPreview(json: unknown, artist: string, title: string): string | null {
  const hit = pickPreviewTrack(parseItunesSearch(json), artist, title);
  return safeHttpsAudio(hit?.previewUrl) || safeHttpsAudio(hit?.audioUrl);
}

/**
 * Ask the public iTunes Search API for a 30-second preview when the catalog URL is missing or dead.
 * Never invents a stream: no result means null.
 */
export async function getFallbackPreviewUrl(artistName: string, trackTitle: string): Promise<string | null> {
  const artist = artistName.trim().slice(0, 120);
  const title = trackTitle.trim().slice(0, 180);
  const term = `${artist} ${title}`.trim();
  if (term.length < 2) return null;
  const endpoint = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=5`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const response = await fetch(endpoint, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return pickItunesPreview(data, artist, title);
  } catch (error) {
    try {
      if (import.meta.env?.DEV) {
        console.error("Fallback preview search failed:", error instanceof Error ? error.name : "error");
      }
    } catch {
      /* tests and non-vite runtimes have no import.meta.env */
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Swap a missing or dead source for a verified https preview without changing the track id. */
export function applyFallbackPreview(track: MusicTrack, previewUrl: string, deadUrls: string[] = []): MusicTrack {
  const preview = safeHttpsAudio(previewUrl);
  if (!preview) return track;
  const dead = new Set(deadUrls.filter(Boolean));
  const audioUrl =
    track.provider !== "itunes" && track.audioUrl && !dead.has(track.audioUrl) ? track.audioUrl : null;
  const downloadUrl = track.downloadUrl && !dead.has(track.downloadUrl) ? track.downloadUrl : null;
  return withRights({
    ...track,
    audioUrl,
    previewUrl: preview,
    downloadUrl: audioUrl ? downloadUrl : null,
    downloadable: Boolean(audioUrl && track.downloadable && downloadUrl),
    officialPlayerUrl: audioUrl ? track.officialPlayerUrl : null,
    rightsReason: audioUrl ? track.rightsReason : APPLE_PREVIEW_REASON,
  });
}

export function applyItunesLookup(tracks: MusicTrack[], lookup: MusicTrack[]): MusicTrack[] {
  const byId = new Map(lookup.map((t) => [t.providerTrackId, t]));
  return tracks.map((t) => {
    if (t.previewUrl) return t;
    const hit = byId.get(t.providerTrackId);
    if (!hit?.previewUrl) return t;
    return withRights({
      ...t,
      audioUrl: t.audioUrl ?? hit.audioUrl,
      previewUrl: hit.previewUrl,
      durationMs: t.durationMs ?? hit.durationMs,
      artworkUrl: t.artworkUrl ?? hit.artworkUrl,
      album: t.album ?? hit.album,
      genre: t.genre ?? hit.genre,
    });
  });
}

export function playbackLabel(track: Pick<MusicTrack, "playback"> & { playbackType?: PlaybackType | null }): string {
  const type = track.playbackType ?? (track.playback === "full" ? "FULL_TRACK" : track.playback === "preview" ? "PREVIEW" : "UNAVAILABLE");
  if (type === "FULL_TRACK") return "Full track";
  if (type === "PREVIEW") return "Preview";
  if (type === "OFFICIAL_PLAYER") return "Official player";
  return "Unavailable";
}

export function canPlay(
  track: { playback?: MusicPlayback | null; playbackType?: PlaybackType | null; previewUrl?: string | null; downloadUrl?: string | null; audioUrl?: string | null; fullTrackUrl?: string | null; officialPlayerUrl?: string | null },
): boolean {
  const type = playbackTypeOf(track);
  if (type === "FULL_TRACK") return Boolean(fullTrackUrl(track));
  if (type === "PREVIEW") return Boolean(track.previewUrl?.startsWith("https://"));
  if (type === "OFFICIAL_PLAYER") return isOfficialPlayerUrl(track.officialPlayerUrl);
  return false;
}

export function canDownload(
  track: Pick<MusicTrack, "playback" | "downloadable" | "downloadUrl"> & { audioUrl?: string | null; provider?: MusicProvider | null; playbackType?: PlaybackType | null },
): boolean {
  if (playbackTypeOf(track) === "PREVIEW" || track.provider === "itunes") return false;
  if (!track.downloadable || !track.downloadUrl) return false;
  if (isPreviewAudioUrl(track.downloadUrl) || isStreamOnlyUrl(track.downloadUrl)) return false;
  return true;
}

/** Why Download must stay disabled. Null when a full authorized file can be saved. */
export function downloadBlockReason(
  track: Pick<MusicTrack, "playback" | "downloadable" | "downloadUrl" | "provider"> & { audioUrl?: string | null },
): string | null {
  if (canDownload(track)) return null;
  if (track.playback !== "full" || track.provider === "itunes" || isPreviewAudioUrl(track.downloadUrl || track.audioUrl || "")) {
    return FULL_DOWNLOAD_UNAVAILABLE;
  }
  return DOWNLOAD_NOT_ALLOWED;
}

/** True for 30-second store clips and other preview URLs. Those must never be saved as a download. */
export function isPreviewAudioUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === "itunes.apple.com" || host.endsWith(".itunes.apple.com") || host.endsWith(".mzstatic.com")) return true;
    const path = `${url.pathname}${url.search}`.toLowerCase();
    if (path.includes("/preview") || path.includes("preview.m4a") || path.includes("preview.mp3")) return true;
    return false;
  } catch {
    return true;
  }
}

export function parseTrackKey(raw: string | null | undefined): { provider: MusicProvider; providerTrackId: string } | null {
  if (!raw) return null;
  let id = raw.trim();
  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }
  if (!id || id.includes("://") || id.includes("/") || id.includes("\\") || id.includes("?") || id.includes("#")) return null;
  const split = id.indexOf(":");
  if (split <= 0) return null;
  const provider = id.slice(0, split);
  if (provider !== "itunes" && provider !== "jamendo" && provider !== "audius" && provider !== "archive" && provider !== "nyx") return null;
  const providerTrackId = id.slice(split + 1).trim();
  if (!providerTrackId || providerTrackId.length > 160) return null;
  return { provider, providerTrackId };
}

export function contentDisposition(filename: string): string {
  const clean = filename.replace(/[\r\n"]/g, "").trim() || "track.mp3";
  const ascii = clean.replace(/[^\x20-\x7E]/g, "_");
  const star = encodeURIComponent(clean);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

export function filenameForTrack(title: string, url: string, mime = ""): string {
  const base = (title || "track").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "track";
  const type = mime.toLowerCase();
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  const ext = type.includes("wav") || path.endsWith(".wav")
    ? "wav"
    : type.includes("ogg") || path.endsWith(".ogg")
      ? "ogg"
      : type.includes("aac") || path.endsWith(".aac")
        ? "aac"
        : type.includes("flac") || path.endsWith(".flac")
          ? "flac"
          : type.includes("mp4") || type.includes("m4a") || path.endsWith(".m4a")
            ? "m4a"
            : "mp3";
  return `${base}.${ext}`;
}

function matchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Same recording across providers. Remix titles stay distinct because parentheses are kept as words. */
export function trackMatchKey(track: { artist: string; title: string }): string {
  return `${matchText(track.artist)}|${matchText(track.title)}`;
}

export function providerLabel(provider: MusicProvider | string): string {
  if (provider === "audius") return "Audius";
  if (provider === "jamendo") return "Jamendo";
  if (provider === "archive") return "Internet Archive";
  if (provider === "nyx") return "NYX";
  return "Apple Music";
}

function sourceScore(track: MusicTrack): number {
  const type = playbackTypeOf(track);
  if (type === "FULL_TRACK") return canDownload(track) ? 4 : 3;
  if (type === "OFFICIAL_PLAYER") return 2;
  if (type === "PREVIEW") return 1;
  return 0;
}

function recordingIsrc(track: { isrc?: string | null }): string {
  return (track.isrc || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function durationAgrees(a: MusicTrack, b: MusicTrack): boolean {
  if (!a.durationMs || !b.durationMs) return true;
  return Math.abs(a.durationMs - b.durationMs) <= 15_000;
}

function sameRecording(a: MusicTrack, b: MusicTrack): boolean {
  const left = recordingIsrc(a);
  const right = recordingIsrc(b);
  if (left && right && left !== right) return false;
  if (left && right) return durationAgrees(a, b);
  if (trackMatchKey(a) !== trackMatchKey(b)) return false;
  return durationAgrees(a, b);
}

function withoutAlternates(track: MusicTrack): MusicTrack {
  return { ...track, alternates: undefined };
}

function fullAlternates(track: MusicTrack): MusicTrack[] {
  return (track.alternates || []).filter((item) => playbackTypeOf(item) === "FULL_TRACK").map(withoutAlternates);
}

/** Keep the best legal source for each recording. Full+download beats full stream, then official player, then preview. */
export function preferAuthorizedSource(tracks: MusicTrack[]): MusicTrack[] {
  const best: MusicTrack[] = [];
  for (const track of tracks) {
    if (playbackTypeOf(track) === "UNAVAILABLE") continue;
    const incoming = withoutAlternates(track);
    const index = best.findIndex((item) => sameRecording(item, incoming));
    if (index < 0) {
      best.push(incoming);
      continue;
    }
    const current = best[index]!;
    const incomingWins = sourceScore(incoming) > sourceScore(current);
    const winner = incomingWins ? incoming : current;
    const loser = incomingWins ? current : incoming;
    const pool = [...fullAlternates(winner), ...fullAlternates(loser)];
    if (playbackTypeOf(loser) === "FULL_TRACK") pool.unshift(withoutAlternates(loser));
    const seen = new Set<string>();
    winner.alternates = pool.filter((item) => {
      if (item.id === winner.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return playbackTypeOf(item) === "FULL_TRACK";
    }).slice(0, 3);
    best[index] = winner;
  }
  return best;
}


