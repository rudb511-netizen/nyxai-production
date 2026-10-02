import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import { newId } from "../ids";
import { takeToken, rateError } from "../rate-limit";
import { publicError } from "../public-error";
import { sqlClient } from "./helpers";
import { getProviderTrack, searchExternalProviders, searchOneProvider } from "../providers/search.ts";
import { jamendoClientId } from "../providers/jamendo.ts";
import {
  applyFallbackPreview,
  AUDIUS_LICENSE,
  audiusEmbedUrl,
  canDownload,
  isPreviewAudioUrl,
  isOfficialPlayerUrl,
  normalizeProvider,
  normalizeTrackRights,
  pickPreviewTrack,
  playbackTypeOf,
  preferAuthorizedSource,
  parseTrackKey,
  PREVIEW_ONLY,
  type MusicProvider,
  type MusicTrack,
  DOWNLOAD_NOT_ALLOWED,
  FULL_CATALOG_LICENSE,
  FULL_DOWNLOAD_UNAVAILABLE,
  ITUNES_PREVIEW_LICENSE,
  JAMENDO_LICENSE,
  NO_FULL_TRACK,
  NYX_ORIGINAL_LICENSE,
  USE_NEEDS_FILE,
} from "../music";

type CacheRow = {
  id: string;
  provider: string;
  provider_track_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  artwork_url: string | null;
  preview_url: string | null;
  download_url?: string | null;
  downloadable?: boolean | null;
  duration_ms: number | null;
  genre: string | null;
  license_note: string;
};

function rowToTrack(r: CacheRow): MusicTrack {
  const provider = normalizeProvider(r.provider);
  const stored = r.preview_url;
  const officialFromCache = isOfficialPlayerUrl(stored) ? stored : null;
  const preview = officialFromCache ? null : stored;
  let downloadUrl = r.download_url ?? null;
  if (downloadUrl && (isPreviewAudioUrl(downloadUrl) || isOfficialPlayerUrl(downloadUrl) || /\/stream(\?|$)/.test(downloadUrl))) downloadUrl = null;
  if (!downloadUrl && provider !== "itunes" && provider !== "audius" && r.downloadable && preview && !isPreviewAudioUrl(preview)) {
    downloadUrl = preview;
  }
  const audioUrl = provider === "itunes" ? null : (preview && !isPreviewAudioUrl(preview) ? preview : null) || downloadUrl || null;
  const downloadable = Boolean(r.downloadable && downloadUrl && !isPreviewAudioUrl(downloadUrl));
  const officialPlayerUrl = officialFromCache || (provider === "audius" && !audioUrl ? audiusEmbedUrl(r.provider_track_id) : null);
  return normalizeTrackRights({
    id: `${provider}:${r.provider_track_id}`,
    provider,
    providerTrackId: r.provider_track_id,
    title: r.title,
    artist: r.artist ?? "",
    album: r.album,
    artworkUrl: r.artwork_url,
    audioUrl,
    previewUrl: provider === "itunes" ? preview : null,
    officialPlayerUrl,
    downloadUrl: downloadable ? downloadUrl : null,
    durationMs: r.duration_ms,
    genre: r.genre,
    license: r.license_note || (provider === "jamendo" ? JAMENDO_LICENSE : provider === "audius" ? AUDIUS_LICENSE : provider === "nyx" ? NYX_ORIGINAL_LICENSE : ITUNES_PREVIEW_LICENSE),
    previewAvailable: Boolean(audioUrl || officialPlayerUrl || (provider === "itunes" && preview)),
    playback: audioUrl ? "full" : provider === "itunes" && preview ? "preview" : "none",
    downloadable,
  });
}

async function cacheTracks(sql: Sql, tracks: MusicTrack[], section: string | null) {
  for (const t of tracks.slice(0, 40)) {
    try {
      await sql`
        insert into music_cache (
          id, provider, provider_track_id, title, artist, album, artwork_url, preview_url,
          download_url, downloadable, duration_ms, genre, license_note, section, cached_at
        ) values (
          ${t.id}, ${t.provider}, ${t.providerTrackId}, ${t.title}, ${t.artist}, ${t.album},
          ${t.artworkUrl}, ${t.audioUrl || t.previewUrl || t.officialPlayerUrl || null}, ${t.downloadUrl}, ${t.downloadable}, ${t.durationMs}, ${t.genre}, ${t.license}, ${section}, now()
        )
        on conflict (provider, provider_track_id) do update set
          title = excluded.title,
          artist = excluded.artist,
          album = excluded.album,
          artwork_url = excluded.artwork_url,
          preview_url = excluded.preview_url,
          download_url = excluded.download_url,
          downloadable = excluded.downloadable,
          duration_ms = excluded.duration_ms,
          genre = excluded.genre,
          license_note = excluded.license_note,
          section = coalesce(excluded.section, music_cache.section),
          cached_at = now()
      `;
    } catch {
      /* cache is best-effort */
    }
  }
}

async function tracksFor(provider: MusicProvider, id: string): Promise<MusicTrack[]> {
  const track = await getProviderTrack(provider, id);
  return track ? [track] : [];
}

function mergeTracks(into: MusicTrack[], extra: MusicTrack[]): MusicTrack[] {
  const seen = new Set(into.map((t) => t.id));
  const out = into.slice();
  for (const t of extra) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

async function nyxOriginals(sql: Sql, q = ""): Promise<MusicTrack[]> {
  try {
    const term = `%${q.trim().toLowerCase()}%`;
    const rows = q.trim()
      ? await sql<{
          id: string;
          title: string;
          artist: string | null;
          media_url: string | null;
          duration_ms: number | null;
          artwork_url: string | null;
          provider_track_id: string | null;
        }>`
          select id, title, artist, media_url, duration_ms, artwork_url, provider_track_id
          from sounds
          where (original = true or provider = 'nyx')
            and media_url is not null
            and (lower(title) like ${term} or lower(coalesce(artist, '')) like ${term})
          order by use_count desc, created_at desc
          limit 16
        `
      : await sql<{
          id: string;
          title: string;
          artist: string | null;
          media_url: string | null;
          duration_ms: number | null;
          artwork_url: string | null;
          provider_track_id: string | null;
        }>`
          select id, title, artist, media_url, duration_ms, artwork_url, provider_track_id
          from sounds
          where (original = true or provider = 'nyx') and media_url is not null
          order by use_count desc, created_at desc
          limit 16
        `;
    const out: MusicTrack[] = [];
    for (const r of rows) {
      const url = r.media_url?.trim() ?? "";
      if (!url) continue;
      out.push(
        normalizeTrackRights({
          id: `nyx:${r.provider_track_id || r.id}`,
          provider: "nyx",
          providerTrackId: r.provider_track_id || r.id,
          title: r.title,
          artist: r.artist ?? "NYX",
          album: null,
          artworkUrl: r.artwork_url,
          audioUrl: url,
          previewUrl: null,
          downloadUrl: url,
          durationMs: r.duration_ms,
          genre: null,
          license: NYX_ORIGINAL_LICENSE,
          previewAvailable: true,
          playback: "full",
          downloadable: true,
        }),
      );
    }
    return out;
  } catch {
    return [];
  }
}

export async function queryMusicCatalog(
  sql: Sql,
  userId: string,
  opts: { q?: string; section?: string } = {},
): Promise<{ tracks: MusicTrack[]; section: string; source: string; license: string; jamendo: boolean }> {
  const q = (opts.q ?? "").trim().slice(0, 80);
  const section = (opts.section ?? (q ? "search" : "trending")).slice(0, 24);
  const jamendo = Boolean(jamendoClientId());

  if (section === "saved") {
    const rows = await sql<CacheRow>`
      select mc.id, mc.provider, mc.provider_track_id, mc.title, mc.artist, mc.album, mc.artwork_url,
             mc.preview_url, mc.download_url, mc.downloadable, mc.duration_ms, mc.genre, mc.license_note
      from sound_saves ss
      join sounds s on s.id = ss.sound_id
      left join music_cache mc on mc.provider = s.provider and mc.provider_track_id = s.provider_track_id
      where ss.user_id = ${userId} and mc.id is not null
      order by ss.created_at desc
      limit 40
    `;
    return { tracks: rows.map(rowToTrack), section: "saved", source: "saved", license: FULL_CATALOG_LICENSE, jamendo };
  }

  if (section === "recent") {
    const rows = await sql<CacheRow>`
      select mc.id, mc.provider, mc.provider_track_id, mc.title, mc.artist, mc.album, mc.artwork_url,
             mc.preview_url, mc.download_url, mc.downloadable, mc.duration_ms, mc.genre, mc.license_note
      from music_recent r
      join music_cache mc on mc.id = r.track_key
      where r.user_id = ${userId}
      order by r.used_at desc
      limit 30
    `;
    return { tracks: rows.map(rowToTrack), section: "recent", source: "recent", license: FULL_CATALOG_LICENSE, jamendo };
  }

  const cacheKey = q ? `search3:${q.toLowerCase()}` : "trending3";
  const fresh = await sql<CacheRow>`
    select id, provider, provider_track_id, title, artist, album, artwork_url, preview_url,
           download_url, downloadable, duration_ms, genre, license_note
    from music_cache
    where section = ${cacheKey} and cached_at > now() - interval '20 minutes'
    order by cached_at desc
    limit 40
  `;
  const freshTracks = preferAuthorizedSource(fresh.map(rowToTrack));
  if (freshTracks.length >= 4) {
    return {
      tracks: freshTracks,
      section: q ? "search" : "trending",
      source: "cache",
      license: FULL_CATALOG_LICENSE,
      jamendo,
    };
  }

  const nyx = await nyxOriginals(sql, q);
  const external = await searchExternalProviders(q);
  let tracks = mergeTracks(nyx, external.tracks);
  const source = nyx.length
    ? "nyx"
    : external.tracks.find((track) => playbackTypeOf(track) === "FULL_TRACK")?.provider
      || external.tracks[0]?.provider
      || "empty";

  if (!tracks.length) {
    const stale = await sql<CacheRow>`
      select id, provider, provider_track_id, title, artist, album, artwork_url, preview_url,
             download_url, downloadable, duration_ms, genre, license_note
      from music_cache
      where section = ${cacheKey}
      order by cached_at desc
      limit 40
    `;
    const staleTracks = preferAuthorizedSource(stale.map(rowToTrack));
    if (staleTracks.length) {
      return {
        tracks: staleTracks,
        section: q ? "search" : "trending",
        source: "stale-cache",
        license: FULL_CATALOG_LICENSE,
        jamendo,
      };
    }
    throw new Error(external.warnings[0] || NO_FULL_TRACK);
  }

  tracks = preferAuthorizedSource(tracks);
  await cacheTracks(sql, tracks, cacheKey);
  return {
    tracks,
    section: q ? "search" : "trending",
    source,
    license: FULL_CATALOG_LICENSE,
    jamendo,
  };
}

export async function upsertLicensedSound(sql: Sql, track: MusicTrack): Promise<string> {
  const existing = await sql<{ id: string }>`
    select id from sounds
    where provider = ${track.provider} and provider_track_id = ${track.providerTrackId}
    limit 1
  `;
  if (existing[0]?.id) return existing[0].id;
  const id = newId("snd");
  await sql`
    insert into sounds (
      id, title, artist, media_url, duration_ms, original, provider, provider_track_id,
      artwork_url, license_note, preview_available
    ) values (
      ${id}, ${track.title}, ${track.artist}, ${track.audioUrl || track.previewUrl}, ${track.durationMs}, false,
      ${track.provider}, ${track.providerTrackId}, ${track.artworkUrl}, ${track.license},
      ${track.previewAvailable}
    )
    on conflict do nothing
  `;
  const again = await sql<{ id: string }>`
    select id from sounds
    where provider = ${track.provider} and provider_track_id = ${track.providerTrackId}
    limit 1
  `;
  return again[0]?.id ?? id;
}

export const searchMusic = createServerFn({ method: "GET" })
  .validator((d: { q?: string; section?: string } = {}) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    try {
      const wait = takeToken(`music:${context.userId}`, 20, 60_000);
      if (wait) throw new Error(rateError(wait));
      const sql = await sqlClient();
      return await queryMusicCatalog(sql, context.userId, data);
    } catch (e) {
      throw publicError(e, "Couldn't reach the music catalog. Try again.");
    }
  });

export const useMusicTrack = createServerFn({ method: "POST" })
  .validator((d: {
    provider: string;
    providerTrackId: string;
    title: string;
    artist: string;
    album?: string | null;
    artworkUrl?: string | null;
    previewUrl?: string | null;
    audioUrl?: string | null;
    downloadUrl?: string | null;
    durationMs?: number | null;
    genre?: string | null;
    license?: string;
    downloadable?: boolean;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const provider = normalizeProvider(data.provider);
    if (provider === "itunes") throw new Error(PREVIEW_ONLY);
    const providerTrackId = String(data.providerTrackId).slice(0, 160);
    if (!providerTrackId || !data.title?.trim()) throw new Error("Pick a song from the catalog.");

    let track: MusicTrack;
    if (provider === "audius" || provider === "jamendo" || provider === "archive") {
      const fresh = (await tracksFor(provider, providerTrackId))[0];
      if (!fresh || playbackTypeOf(fresh) !== "FULL_TRACK" || !fresh.audioUrl) {
        throw new Error(USE_NEEDS_FILE);
      }
      track = fresh;
    } else {
      const audioUrl = data.audioUrl && !isPreviewAudioUrl(data.audioUrl) ? data.audioUrl : null;
      track = normalizeTrackRights({
        id: `${provider}:${providerTrackId}`,
        provider,
        providerTrackId,
        title: data.title.slice(0, 180),
        artist: data.artist.slice(0, 120),
        album: data.album ?? null,
        artworkUrl: data.artworkUrl ?? null,
        audioUrl,
        previewUrl: null,
        downloadUrl: data.downloadUrl && !isPreviewAudioUrl(data.downloadUrl) ? data.downloadUrl : audioUrl,
        durationMs: data.durationMs ?? null,
        genre: data.genre ?? null,
        license: data.license ?? NYX_ORIGINAL_LICENSE,
        previewAvailable: Boolean(audioUrl),
        playback: "full",
        downloadable: Boolean(data.downloadable && (data.downloadUrl || audioUrl)),
      });
      if (playbackTypeOf(track) !== "FULL_TRACK" || !track.audioUrl) throw new Error("Unable to load the full track.");
    }
    const soundId = await upsertLicensedSound(sql, track);
    await cacheTracks(sql, [track], "used");
    await sql`
      insert into music_recent (user_id, track_key, used_at)
      values (${context.userId}, ${track.id}, now())
      on conflict (user_id, track_key) do update set used_at = now()
    `;
    return {
      soundId,
      title: track.title,
      artist: track.artist,
      audioUrl: track.audioUrl,
      previewUrl: track.previewUrl,
      artworkUrl: track.artworkUrl,
      license: track.license,
      previewAvailable: track.previewAvailable,
      playback: track.playback,
      downloadable: track.downloadable,
      downloadUrl: track.downloadUrl,
      durationMs: track.durationMs,
      provider: track.provider,
      providerTrackId: track.providerTrackId,
      id: track.id,
      album: track.album,
      genre: track.genre,
    };
  });

export const refreshMusicPreview = createServerFn({ method: "POST" })
  .validator(
    (d: { provider: string; providerTrackId: string; artist?: string; title?: string; failedUrl?: string }) => d,
  )
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    try {
      const wait = takeToken(`music-refresh:${context.userId}`, 8, 60_000);
      if (wait) throw new Error(rateError(wait));
      const provider = normalizeProvider(data.provider);
      const id = String(data.providerTrackId).slice(0, 160);
      if (!id) throw new Error("Pick a song from the catalog.");
      const failed = (data.failedUrl ?? "").trim().slice(0, 2000);
      let tracks: MusicTrack[] = provider === "nyx" ? [] : await tracksFor(provider, id);
      let track = tracks[0] ?? null;
      const stillDead = (t: MusicTrack | null) => {
        if (!t) return true;
        const url = t.audioUrl || "";
        return !url || (failed !== "" && url === failed);
      };
      if (provider !== "itunes") {
        if (stillDead(track)) throw new Error("Unable to load the full track.");
      } else if (!track?.previewUrl || (failed !== "" && track.previewUrl === failed)) {
        const artist = (data.artist ?? track?.artist ?? "").trim().slice(0, 120);
        const title = (data.title ?? track?.title ?? "").trim().slice(0, 180);
        const term = `${artist} ${title}`.trim();
        if (term.length >= 2) {
          const searched = await searchOneProvider("itunes", term);
          const hit = pickPreviewTrack(searched, artist, title);
          const preview = hit?.previewUrl && hit.previewUrl !== failed ? hit.previewUrl : null;
          if (preview) {
            const base: MusicTrack = track ?? {
              id: `${provider}:${id}`,
              provider,
              providerTrackId: id,
              title: title || hit?.title || "Track",
              artist: artist || hit?.artist || "Unknown",
              album: hit?.album ?? null,
              artworkUrl: hit?.artworkUrl ?? null,
              audioUrl: null,
              previewUrl: null,
              downloadUrl: null,
              durationMs: hit?.durationMs ?? null,
              genre: hit?.genre ?? null,
              license: provider === "itunes" ? ITUNES_PREVIEW_LICENSE : (hit?.license ?? ITUNES_PREVIEW_LICENSE),
              previewAvailable: false,
              playback: "none",
              downloadable: false,
            };
            track = applyFallbackPreview(base, preview, failed ? [failed] : []);
          }
        }
      }
      if (track) {
        const sql = await sqlClient();
        await cacheTracks(sql, [track], "refresh");
      }
      return { track };
    } catch (e) {
      throw publicError(e, "Couldn't refresh this track. Try again.");
    }
  });

export class DownloadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function nyxDownloadTrack(sql: Sql, providerTrackId: string): Promise<MusicTrack[]> {
  try {
    const rows = await sql<{
      id: string;
      title: string;
      artist: string | null;
      media_url: string | null;
      duration_ms: number | null;
      artwork_url: string | null;
      provider_track_id: string | null;
    }>`
      select id, title, artist, media_url, duration_ms, artwork_url, provider_track_id
      from sounds
      where (provider_track_id = ${providerTrackId} or id = ${providerTrackId})
        and (original = true or provider = 'nyx')
        and media_url is not null
      limit 1
    `;
    const row = rows[0];
    const url = row?.media_url?.trim() ?? "";
    if (!row || !url || isPreviewAudioUrl(url)) return [];
    return [
      normalizeTrackRights({
        id: `nyx:${row.provider_track_id || row.id}`,
        provider: "nyx",
        providerTrackId: row.provider_track_id || row.id,
        title: row.title,
        artist: row.artist ?? "NYX",
        album: null,
        artworkUrl: row.artwork_url,
        audioUrl: url,
        previewUrl: null,
        downloadUrl: url,
        durationMs: row.duration_ms,
        genre: null,
        license: NYX_ORIGINAL_LICENSE,
        previewAvailable: true,
        playback: "full",
        downloadable: true,
      }),
    ];
  } catch {
    return [];
  }
}

/** Resolve a catalog id to the artist-permitted full file. Never trusts a client URL. */
export async function loadTrackForDownload(sql: Sql, rawId: string): Promise<MusicTrack> {
  const key = parseTrackKey(rawId);
  if (!key) throw new DownloadError("That track couldn’t be found.", 404);
  if (key.provider === "itunes") throw new DownloadError(FULL_DOWNLOAD_UNAVAILABLE, 403);
  const tracks = key.provider === "nyx" ? await nyxDownloadTrack(sql, key.providerTrackId) : await tracksFor(key.provider, key.providerTrackId);
  const track = tracks[0] ?? null;
  if (!track || track.playback !== "full" || !track.downloadUrl || isPreviewAudioUrl(track.downloadUrl)) {
    throw new DownloadError(FULL_DOWNLOAD_UNAVAILABLE, 403);
  }
  if (!canDownload(track)) throw new DownloadError(DOWNLOAD_NOT_ALLOWED, 403);
  return track;
}
