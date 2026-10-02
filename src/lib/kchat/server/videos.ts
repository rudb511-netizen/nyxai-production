import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { takeToken, rateError } from "../rate-limit";
import type { ShortVideo } from "../types";
import { extractHashtags } from "../usernames";
import { canDeleteComment, canDeleteOwned } from "../safety";
import { qualityFromHeight } from "../video-quality";
import {
  assertCapability,
  authorLite,
  ensureProfile,
  loadAuthors,
  notify,
  sqlClient,
} from "./helpers";
import { insertOmniVideoCommentReply, omniMentionReply } from "./omniai-mention";
import { queryMusicCatalog } from "./music";
import { AUDIUS_LICENSE, ITUNES_PREVIEW_LICENSE, JAMENDO_LICENSE, normalizeProvider, NYX_ORIGINAL_LICENSE } from "../music";

type RenditionIn = { quality: string; height: number; url: string; bytes?: number };

export const uploadVideo = createServerFn({ method: "POST" })
  .validator((d: {
    caption: string;
    mediaUrl: string;
    thumbUrl?: string | null;
    durationMs?: number;
    musicTitle?: string | null;
    speed?: number;
    filterName?: string | null;
    sourceBytes?: number;
    downloadAllowed?: boolean;
    width?: number | null;
    height?: number | null;
    sourceWidth?: number | null;
    sourceHeight?: number | null;
    sourceLabel?: string | null;
    fps?: number | null;
    codec?: string | null;
    aspectRatio?: string | null;
    hdr?: boolean;
    soundId?: string | null;
    originalAudio?: boolean;
    allowOriginalAudio?: boolean;
    overlayJson?: unknown;
    isDraft?: boolean;
    remixOfId?: string | null;
    renditions?: RenditionIn[];
    uploadId?: string | null;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertCapability(me, "video");
    const wait = takeToken(`vid:${context.userId}`, 8, 60_000);
    if (wait) throw new Error(rateError(wait));
    if (!data.mediaUrl && !data.uploadId) throw new Error("Record or upload a video first.");
    const { isMediaApiUrl } = await import("../media-pipeline");
    const { getOwnedUpload, markUploadPublished, platformMax } = await import("./media-upload");
    if ((data.sourceBytes ?? 0) > platformMax()) {
      throw new Error(`This platform accepts files up to ${Math.round(platformMax() / (1024 * 1024))} MB.`);
    }
    let mediaUrl = data.mediaUrl;
    if (data.uploadId) {
      const owned = await getOwnedUpload(sql, context.userId, data.uploadId);
      if (!owned) throw new Error("Upload session not found.");
      if (owned.status === "published" && owned.published_id) {
        return { id: owned.published_id };
      }
      const already = await sql<{ id: string }>`
        select id from videos where upload_id = ${data.uploadId} limit 1
      `.catch(() => []);
      if (already[0]) {
        await markUploadPublished(sql, data.uploadId, already[0].id);
        return { id: already[0].id };
      }
      if (owned.status === "processing" || owned.status === "upload_complete" || owned.status === "uploading") {
        throw new Error("Video uploaded. Processing is still in progress.");
      }
      if (owned.status !== "ready" && owned.status !== "publishing") {
        throw new Error(owned.fail_reason || "Video processing failed. Retry processing.");
      }
      mediaUrl = owned.media_url || `/api/media/${owned.id}`;
      await sql`update media_uploads set status = 'publishing', updated_at = now() where id = ${data.uploadId}`;
    } else if (!isMediaApiUrl(mediaUrl)) {
      if (mediaUrl.length > 18_000_000) {
        throw new Error("Clip is still too large after compression. Use a shorter take.");
      }
    }
    const storedH = data.height ?? 0;
    const sourceH = data.sourceHeight ?? storedH;
    if (storedH && sourceH && storedH > sourceH) {
      throw new Error("Playback cannot be taller than the source.");
    }
    const sourceLabel = data.sourceLabel ?? (sourceH ? qualityFromHeight(sourceH) : null);
    const id = newId("v");
    try {
      await sql`
      insert into videos (
        id, author_id, caption, media_url, thumb_url, duration_ms, music_title, speed, filter_name, download_allowed,
        width, height, fps, codec, hdr, source_width, source_height, source_label, aspect_ratio, sound_id,
        original_audio, allow_original_audio, overlay_json, is_draft, remix_of_id, upload_id, publish_state
      )
      values (
        ${id}, ${context.userId}, ${data.caption.slice(0, 300)}, ${mediaUrl},
        ${data.thumbUrl ?? null}, ${data.durationMs ?? null}, ${data.musicTitle ?? null},
        ${data.speed ?? 1}, ${data.filterName ?? null}, ${data.downloadAllowed !== false},
        ${data.width ?? null}, ${data.height ?? null}, ${data.fps ?? null}, ${data.codec ?? null},
        ${Boolean(data.hdr)}, ${data.sourceWidth ?? null}, ${data.sourceHeight ?? null},
        ${sourceLabel}, ${data.aspectRatio ?? null}, ${data.soundId ?? null},
        ${data.originalAudio !== false}, ${data.allowOriginalAudio !== false},
        ${JSON.stringify(data.overlayJson ?? null)}, ${Boolean(data.isDraft)},
        ${data.remixOfId ?? null}, ${data.uploadId ?? null}, ${data.isDraft ? "draft" : "published"}
      )
    `;
    } catch {
      try {
        await sql`
      insert into videos (
        id, author_id, caption, media_url, thumb_url, duration_ms, music_title, speed, filter_name, download_allowed,
        width, height, fps, codec, hdr, source_width, source_height, source_label, aspect_ratio, sound_id,
        original_audio, allow_original_audio, overlay_json, is_draft, remix_of_id
      )
      values (
        ${id}, ${context.userId}, ${data.caption.slice(0, 300)}, ${mediaUrl},
        ${data.thumbUrl ?? null}, ${data.durationMs ?? null}, ${data.musicTitle ?? null},
        ${data.speed ?? 1}, ${data.filterName ?? null}, ${data.downloadAllowed !== false},
        ${data.width ?? null}, ${data.height ?? null}, ${data.fps ?? null}, ${data.codec ?? null},
        ${Boolean(data.hdr)}, ${data.sourceWidth ?? null}, ${data.sourceHeight ?? null},
        ${sourceLabel}, ${data.aspectRatio ?? null}, ${data.soundId ?? null},
        ${data.originalAudio !== false}, ${data.allowOriginalAudio !== false},
        ${JSON.stringify(data.overlayJson ?? null)}, ${Boolean(data.isDraft)},
        ${data.remixOfId ?? null}
      )
    `;
      } catch {
      await sql`
      insert into videos (
        id, author_id, caption, media_url, thumb_url, duration_ms, music_title, speed, filter_name, download_allowed,
        width, height, fps, codec, hdr, source_width, source_height, source_label, aspect_ratio, sound_id,
        original_audio, allow_original_audio, overlay_json, is_draft
      )
      values (
        ${id}, ${context.userId}, ${data.caption.slice(0, 300)}, ${mediaUrl},
        ${data.thumbUrl ?? null}, ${data.durationMs ?? null}, ${data.musicTitle ?? null},
        ${data.speed ?? 1}, ${data.filterName ?? null}, ${data.downloadAllowed !== false},
        ${data.width ?? null}, ${data.height ?? null}, ${data.fps ?? null}, ${data.codec ?? null},
        ${Boolean(data.hdr)}, ${data.sourceWidth ?? null}, ${data.sourceHeight ?? null},
        ${sourceLabel}, ${data.aspectRatio ?? null}, ${data.soundId ?? null},
        ${data.originalAudio !== false}, ${data.allowOriginalAudio !== false},
        ${JSON.stringify(data.overlayJson ?? null)}, ${Boolean(data.isDraft)}
      )
    `;
      }
    }
    if (data.uploadId) {
      await markUploadPublished(sql, data.uploadId, id);
    }
    for (const r of (data.renditions ?? []).slice(0, 4)) {
      if (!r.url || r.url.length > 18_000_000) continue;
      if (r.height > (sourceH || r.height)) continue;
      await sql`
        insert into video_renditions (video_id, quality, height, media_url, bytes)
        values (${id}, ${r.quality.slice(0, 12)}, ${r.height}, ${r.url}, ${r.bytes ?? r.url.length})
        on conflict do nothing
      `;
    }
    if (data.soundId) {
      await sql`update sounds set use_count = use_count + 1 where id = ${data.soundId}`;
    }
    for (const tag of extractHashtags(data.caption)) {
      await sql`
        insert into hashtags (tag, use_count) values (${tag}, 1)
        on conflict (tag) do update set use_count = hashtags.use_count + 1, updated_at = now()
      `;
      await sql`insert into video_hashtags (video_id, tag) values (${id}, ${tag}) on conflict do nothing`;
    }
    const { moderateContent } = await import("./omni-support");
    await moderateContent(sql, {
      actorId: context.userId,
      targetKind: "video",
      targetId: id,
      text: data.caption ?? "",
      username: me.username,
    }).catch(() => {});
    return { id };
  });

async function mapVideos(
  sql: Awaited<ReturnType<typeof sqlClient>>,
  viewerId: string,
  rows: Array<{
    id: string;
    author_id: string;
    caption: string;
    media_url: string;
    thumb_url: string | null;
    like_count: number;
    comment_count: number;
    view_count: number | null;
    created_at: string;
    download_allowed: boolean | null;
    music_title: string | null;
    sound_id: string | null;
    width: number | null;
    height: number | null;
    source_label: string | null;
    hdr: boolean | null;
    duration_ms: number | null;
    original_audio: boolean | null;
    allow_original_audio: boolean | null;
    share_count: number | null;
    save_count: number | null;
    music_preview_url?: string | null;
    music_license?: string | null;
  }>,
): Promise<ShortVideo[]> {
  const authors = await loadAuthors(sql, rows.map((r) => r.author_id));
  const liked = await sql<{ video_id: string }>`
    select video_id from video_likes where user_id = ${viewerId}
  `;
  const saved = await sql<{ video_id: string }>`
    select video_id from video_saves where user_id = ${viewerId}
  `;
  const following = await sql<{ following_id: string }>`
    select following_id from follows where follower_id = ${viewerId}
  `;
  const likeSet = new Set(liked.map((l) => l.video_id));
  const saveSet = new Set(saved.map((s) => s.video_id));
  const followSet = new Set(following.map((f) => f.following_id));
  const soundIds = [...new Set(rows.map((r) => r.sound_id).filter((x): x is string => Boolean(x)))];
  const previewBySound = new Map<string, { url: string | null; license: string | null }>();
  if (soundIds.length) {
    try {
      const snd = await sql.query<{ id: string; media_url: string | null; license_note: string | null }>(
        `select id, media_url, license_note from sounds where id in (${soundIds.map((_, i) => `$${i + 1}`).join(",")})`,
        soundIds,
      );
      for (const s of snd) previewBySound.set(s.id, { url: s.media_url, license: s.license_note });
    } catch {
      /* pre-migration */
    }
  }
  const renditions = rows.length
    ? await sql.query<{ video_id: string; quality: string; height: number; media_url: string }>(
        `select video_id, quality, height, media_url from video_renditions
         where video_id in (${rows.map((_, i) => `$${i + 1}`).join(",")})`,
        rows.map((r) => r.id),
      )
    : [];
  const byVid = new Map<string, ShortVideo["renditions"]>();
  for (const r of renditions) {
    const arr = byVid.get(r.video_id) ?? [];
    arr.push({ quality: r.quality, height: r.height, url: r.media_url });
    byVid.set(r.video_id, arr);
  }
  const items: ShortVideo[] = [];
  for (const r of rows) {
    const a = authors.get(r.author_id);
    if (!a) continue;
    const rungs = byVid.get(r.id) ?? [];
    items.push({
      id: r.id,
      author: authorLite(a),
      caption: r.caption,
      mediaUrl: r.media_url,
      thumbUrl: r.thumb_url,
      likes: r.like_count,
      comments: r.comment_count,
      views: r.view_count ?? 0,
      liked: likeSet.has(r.id),
      saved: saveSet.has(r.id),
      createdAt: r.created_at,
      mine: r.author_id === viewerId,
      downloadAllowed: r.download_allowed !== false,
      following: followSet.has(r.author_id),
      musicTitle: r.music_title,
      soundId: r.sound_id,
      musicPreviewUrl: r.music_preview_url ?? previewBySound.get(r.sound_id ?? "")?.url ?? null,
      musicLicense: r.music_license ?? previewBySound.get(r.sound_id ?? "")?.license ?? null,
      originalAudio: r.original_audio !== false,
      allowOriginalAudio: r.allow_original_audio !== false,
      width: r.width,
      height: r.height,
      sourceLabel: r.source_label,
      playbackLabel: r.height ? qualityFromHeight(r.height) : r.source_label,
      hdr: Boolean(r.hdr),
      durationMs: r.duration_ms,
      renditions: rungs,
      shareCount: r.share_count ?? 0,
      saveCount: r.save_count ?? 0,
    });
  }
  return items;
}

export const videoFeed = createServerFn({ method: "GET" })
  .validator((d: { cursor?: string | null; tab?: "fyp" | "following" } = {}) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    let rows: Array<{
      id: string;
      author_id: string;
      caption: string;
      media_url: string;
      thumb_url: string | null;
      like_count: number;
      comment_count: number;
      view_count: number | null;
      created_at: string;
      download_allowed: boolean | null;
      music_title: string | null;
      sound_id: string | null;
      width: number | null;
      height: number | null;
      source_label: string | null;
      hdr: boolean | null;
      duration_ms: number | null;
      original_audio: boolean | null;
      allow_original_audio: boolean | null;
      share_count: number | null;
      save_count: number | null;
    }>;
    const followingOnly = data.tab === "following";
    const hideClause = `and not exists (
               select 1 from feed_hides h
               where h.user_id = $2
                 and (
                   (h.target_kind = 'video' and h.target_id = v.id)
                   or (h.target_kind = 'author' and h.target_id = v.author_id)
                 )
             )`;
    const followingSql = `select v.id, v.author_id, v.caption, v.media_url, v.thumb_url, v.like_count, v.comment_count,
                  v.view_count, v.created_at, v.download_allowed, v.music_title, v.sound_id,
                  v.width, v.height, v.source_label, v.hdr, v.duration_ms, v.original_audio,
                  v.allow_original_audio, v.share_count, v.save_count
           from videos v
           where v.is_removed = false and coalesce(v.is_draft, false) = false
             and ($1::timestamptz is null or v.created_at < $1)
             and exists (select 1 from follows f where f.follower_id = $2 and f.following_id = v.author_id)
             and not exists (
               select 1 from blocks b
               where (b.blocker_id = $2 and b.blocked_id = v.author_id)
                  or (b.blocker_id = v.author_id and b.blocked_id = $2)
             )
             ${hideClause}
           order by v.created_at desc
           limit 12`;
    const fypSql = `select v.id, v.author_id, v.caption, v.media_url, v.thumb_url, v.like_count, v.comment_count,
                  v.view_count, v.created_at, v.download_allowed, v.music_title, v.sound_id,
                  v.width, v.height, v.source_label, v.hdr, v.duration_ms, v.original_audio,
                  v.allow_original_audio, v.share_count, v.save_count
           from videos v
           where v.is_removed = false and coalesce(v.is_draft, false) = false
             and ($1::timestamptz is null or v.created_at < $1)
             and not exists (
               select 1 from blocks b
               where (b.blocker_id = $2 and b.blocked_id = v.author_id)
                  or (b.blocker_id = v.author_id and b.blocked_id = $2)
             )
             ${hideClause}
           order by (v.like_count * 2 + v.comment_count + coalesce(v.view_count, 0) * 0.05) desc, v.created_at desc
           limit 12`;
    try {
      rows = await sql.query(followingOnly ? followingSql : fypSql, [data.cursor ?? null, context.userId]);
    } catch {
      rows = await sql.query(
        (followingOnly ? followingSql : fypSql).replace(hideClause, ""),
        [data.cursor ?? null, context.userId],
      );
    }
    const items = await mapVideos(sql, context.userId, rows);
    return { items, nextCursor: rows.length === 12 ? rows[rows.length - 1]!.created_at : null };
  });

export const recordVideoView = createServerFn({ method: "POST" })
  .validator((d: { id: string; watchMs?: number; completed?: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const watch = Math.max(0, Math.min(data.watchMs ?? 0, 180_000));
    const inserted = await sql<{ video_id: string }>`
      insert into video_views (video_id, user_id, watch_ms, completed)
      values (${data.id}, ${context.userId}, ${watch}, ${Boolean(data.completed)})
      on conflict (video_id, user_id) do nothing
      returning video_id
    `;
    if (inserted[0]) {
      await sql`update videos set view_count = coalesce(view_count, 0) + 1, watch_ms_total = coalesce(watch_ms_total, 0) + ${watch} where id = ${data.id}`;
    } else {
      await sql`
        update video_views set watch_ms = greatest(watch_ms, ${watch}),
          completed = completed or ${Boolean(data.completed)}, updated_at = now()
        where video_id = ${data.id} and user_id = ${context.userId}
      `;
      await sql`update videos set watch_ms_total = coalesce(watch_ms_total, 0) + ${Math.min(watch, 4000)} where id = ${data.id}`;
    }
    return { ok: true as const };
  });

export const shareVideo = createServerFn({ method: "POST" })
  .validator((d: { id: string; conversationId?: string; as?: "dm" | "story" | "status" }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const v = await sql<{
      id: string;
      caption: string;
      media_url: string;
      author_id: string;
      is_removed: boolean;
    }>`select id, caption, media_url, author_id, is_removed from videos where id = ${data.id}`;
    if (!v[0] || v[0].is_removed) throw new Error("Video not found.");
    if (data.conversationId) {
      await sql`
        insert into messages (id, conversation_id, sender_id, kind, body, media_url)
        values (${newId("m")}, ${data.conversationId}, ${context.userId}, 'video', ${v[0].caption.slice(0, 200)}, ${v[0].media_url})
      `;
      await sql`
        update conversations set last_message_at = now(), last_message_body = ${"Shared a video"}
        where id = ${data.conversationId}
      `;
    }
    await sql`update videos set share_count = share_count + 1 where id = ${data.id}`;
    if (v[0].author_id !== context.userId) {
      await notify(sql, {
        userId: v[0].author_id,
        kind: "video_share",
        body: `${me.display_name} shared your video`,
        actorId: me.user_id,
        entityId: data.id,
        prefKey: "likes",
      });
    }
    return { ok: true as const };
  });

export const repostVideo = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const existing = await sql<{ n: number }>`
      select count(*)::int as n from video_reposts where video_id = ${data.id} and user_id = ${context.userId}
    `;
    if ((existing[0]?.n ?? 0) > 0) {
      await sql`delete from video_reposts where video_id = ${data.id} and user_id = ${context.userId}`;
      return { reposted: false };
    }
    await sql`
      insert into video_reposts (video_id, user_id) values (${data.id}, ${context.userId})
      on conflict do nothing
    `;
    return { reposted: true };
  });

export const myVideoAnalytics = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      caption: string;
      like_count: number;
      comment_count: number;
      view_count: number;
      share_count: number;
      save_count: number;
      watch_ms_total: number;
      created_at: string;
    }>`
      select id, caption, like_count, comment_count, view_count, share_count, save_count, watch_ms_total, created_at
      from videos where author_id = ${context.userId} and is_removed = false
      order by created_at desc limit 20
    `;
    return rows.map((r) => ({
      id: r.id,
      caption: r.caption,
      likes: r.like_count,
      comments: r.comment_count,
      views: r.view_count,
      shares: r.share_count,
      saves: r.save_count,
      watchMs: Number(r.watch_ms_total ?? 0),
      createdAt: r.created_at,
    }));
  });

export const listSounds = createServerFn({ method: "GET" })
  .validator((d: { q?: string; section?: string } = {}) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const catalog = await queryMusicCatalog(sql, context.userId, { q: data.q, section: data.section });
    const saved = await sql<{ sound_id: string; provider: string | null; provider_track_id: string | null }>`
      select s.id as sound_id, s.provider, s.provider_track_id
      from sound_saves ss
      join sounds s on s.id = ss.sound_id
      where ss.user_id = ${context.userId}
    `;
    const savedKeys = new Set(
      saved.map((s) => (s.provider && s.provider_track_id ? `${s.provider}:${s.provider_track_id}` : s.sound_id)),
    );
    return catalog.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      duration_ms: t.durationMs,
      use_count: 0,
      original: t.provider === "nyx",
      saved: savedKeys.has(t.id),
      previewUrl: t.previewUrl,
      audioUrl: t.audioUrl,
      downloadUrl: t.downloadUrl,
      artworkUrl: t.artworkUrl,
      provider: t.provider,
      providerTrackId: t.providerTrackId,
      license: t.license,
      previewAvailable: t.previewAvailable,
      playback: t.playback,
      downloadable: t.downloadable,
      album: t.album,
      genre: t.genre,
      source: catalog.source,
    }));
  });

export const toggleSoundSave = createServerFn({ method: "POST" })
  .validator((d: {
    id: string;
    provider?: string;
    providerTrackId?: string;
    title?: string;
    artist?: string;
    album?: string | null;
    artworkUrl?: string | null;
    previewUrl?: string | null;
    audioUrl?: string | null;
    durationMs?: number | null;
    license?: string;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    let soundId = data.id;
    if (data.provider && data.providerTrackId) {
      const { upsertLicensedSound } = await import("./music");
      soundId = await upsertLicensedSound(sql, {
        id: `${data.provider}:${data.providerTrackId}`,
        provider: normalizeProvider(data.provider),
        providerTrackId: data.providerTrackId,
        title: (data.title ?? "Untitled").slice(0, 180),
        artist: (data.artist ?? "Unknown").slice(0, 120),
        album: data.album ?? null,
        artworkUrl: data.artworkUrl ?? null,
        audioUrl: normalizeProvider(data.provider) === "itunes" ? null : data.audioUrl ?? null,
        previewUrl: normalizeProvider(data.provider) === "itunes" ? data.previewUrl ?? null : null,
        downloadUrl: null,
        durationMs: data.durationMs ?? null,
        genre: null,
        license:
          data.license ??
          (normalizeProvider(data.provider) === "jamendo"
            ? JAMENDO_LICENSE
            : normalizeProvider(data.provider) === "audius"
              ? AUDIUS_LICENSE
              : normalizeProvider(data.provider) === "nyx"
                ? NYX_ORIGINAL_LICENSE
                : ITUNES_PREVIEW_LICENSE),
        previewAvailable: normalizeProvider(data.provider) === "itunes" && Boolean(data.previewUrl),
        playback: normalizeProvider(data.provider) === "itunes" ? (data.previewUrl ? "preview" : "none") : data.audioUrl ? "full" : "none",
        downloadable: false,
      });
    } else if (data.id.includes(":")) {
      const [provider, providerTrackId] = data.id.split(":");
      const cached = await sql<{
        title: string;
        artist: string | null;
        album: string | null;
        artwork_url: string | null;
        preview_url: string | null;
        duration_ms: number | null;
        license_note: string;
      }>`
        select title, artist, album, artwork_url, preview_url, duration_ms, license_note
        from music_cache where id = ${data.id} limit 1
      `;
      if (cached[0] && provider && providerTrackId) {
        const { upsertLicensedSound } = await import("./music");
        const providerName = normalizeProvider(provider);
        soundId = await upsertLicensedSound(sql, {
          id: data.id,
          provider: providerName,
          providerTrackId,
          title: cached[0].title,
          artist: cached[0].artist ?? "",
          album: cached[0].album,
          artworkUrl: cached[0].artwork_url,
          audioUrl: providerName === "itunes" ? null : cached[0].preview_url,
          previewUrl: providerName === "itunes" ? cached[0].preview_url : null,
          downloadUrl: null,
          durationMs: cached[0].duration_ms,
          genre: null,
          license: cached[0].license_note,
          previewAvailable: providerName === "itunes" && Boolean(cached[0].preview_url),
          playback: providerName === "itunes" ? (cached[0].preview_url ? "preview" : "none") : cached[0].preview_url ? "full" : "none",
          downloadable: false,
        });
      }
    }
    const existing = await sql<{ n: number }>`
      select count(*)::int as n from sound_saves where sound_id = ${soundId} and user_id = ${context.userId}
    `;
    if ((existing[0]?.n ?? 0) > 0) {
      await sql`delete from sound_saves where sound_id = ${soundId} and user_id = ${context.userId}`;
      return { saved: false, soundId };
    }
    await sql`insert into sound_saves (sound_id, user_id) values (${soundId}, ${context.userId}) on conflict do nothing`;
    return { saved: true, soundId };
  });

export const videosBySound = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const rows = await sql.query<{
      id: string;
      author_id: string;
      caption: string;
      media_url: string;
      thumb_url: string | null;
      like_count: number;
      comment_count: number;
      view_count: number | null;
      created_at: string;
      download_allowed: boolean | null;
      music_title: string | null;
      sound_id: string | null;
      width: number | null;
      height: number | null;
      source_label: string | null;
      hdr: boolean | null;
      duration_ms: number | null;
      original_audio: boolean | null;
      allow_original_audio: boolean | null;
      share_count: number | null;
      save_count: number | null;
    }>(
      `select v.id, v.author_id, v.caption, v.media_url, v.thumb_url, v.like_count, v.comment_count,
              v.view_count, v.created_at, v.download_allowed, v.music_title, v.sound_id,
              v.width, v.height, v.source_label, v.hdr, v.duration_ms, v.original_audio,
              v.allow_original_audio, v.share_count, v.save_count
       from videos v where v.sound_id = $1 and v.is_removed = false limit 20`,
      [data.id],
    );
    return mapVideos(sql, context.userId, rows);
  });

export const toggleVideoLike = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const existing = await sql<{ n: number }>`
      select count(*)::int as n from video_likes where video_id = ${data.id} and user_id = ${context.userId}
    `;
    if ((existing[0]?.n ?? 0) > 0) {
      await sql`delete from video_likes where video_id = ${data.id} and user_id = ${context.userId}`;
      await sql`update videos set like_count = greatest(like_count - 1, 0) where id = ${data.id}`;
      return { liked: false };
    }
    await sql`insert into video_likes (video_id, user_id) values (${data.id}, ${context.userId}) on conflict do nothing`;
    await sql`update videos set like_count = like_count + 1 where id = ${data.id}`;
    const v = await sql<{ author_id: string }>`select author_id from videos where id = ${data.id}`;
    if (v[0]) {
      await notify(sql, {
        userId: v[0].author_id,
        kind: "video_like",
        body: `${me.display_name} liked your video`,
        actorId: me.user_id,
        entityId: data.id,
        prefKey: "likes",
      });
    }
    return { liked: true };
  });

export const toggleVideoSave = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const existing = await sql<{ n: number }>`
      select count(*)::int as n from video_saves where video_id = ${data.id} and user_id = ${context.userId}
    `;
    if ((existing[0]?.n ?? 0) > 0) {
      await sql`delete from video_saves where video_id = ${data.id} and user_id = ${context.userId}`;
      await sql`update videos set save_count = greatest(save_count - 1, 0) where id = ${data.id}`;
      return { saved: false };
    }
    await sql`insert into video_saves (video_id, user_id) values (${data.id}, ${context.userId}) on conflict do nothing`;
    await sql`update videos set save_count = save_count + 1 where id = ${data.id}`;
    return { saved: true };
  });

export const addVideoComment = createServerFn({ method: "POST" })
  .validator((d: { id: string; body: string; parentId?: string | null; mediaUrl?: string | null; stickerId?: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    assertCapability(me, "comment");
    const wait = takeToken(`vcomment:${context.userId}`, 20, 60_000);
    if (wait) throw new Error(rateError(wait));
    const body = data.body.trim().slice(0, 400);
    const stickerId = data.stickerId?.trim() || null;
    if (!body && !data.mediaUrl && !stickerId) throw new Error("Write a comment.");
    if (data.mediaUrl) {
      const { assertMediaRef } = await import("../upload-guard");
      assertMediaRef(data.mediaUrl);
    }
    const video = await sql<{ author_id: string; caption: string }>`
      select author_id, caption from videos where id = ${data.id}
    `;
    if (!video[0]) throw new Error("Video not found.");
    const { getRelation } = await import("./helpers");
    const rel = await getRelation(sql, context.userId, video[0].author_id);
    if (rel.isBlocked || rel.isBlockedBy) throw new Error("You can't comment on this video.");
    const id = newId("vc");
    await sql`
      insert into video_comments (id, video_id, author_id, body, parent_id, media_url, sticker_id)
      values (${id}, ${data.id}, ${context.userId}, ${body}, ${data.parentId ?? null}, ${data.mediaUrl ?? null}, ${stickerId})
    `.catch(async () => {
      await sql`
        insert into video_comments (id, video_id, author_id, body, parent_id, media_url)
        values (${id}, ${data.id}, ${context.userId}, ${body}, ${data.parentId ?? null}, ${data.mediaUrl ?? null})
      `;
    });
    await sql`update videos set comment_count = comment_count + 1 where id = ${data.id}`;
    if (video[0] && video[0].author_id !== context.userId) {
      await notify(sql, {
        userId: video[0].author_id,
        kind: "video_comment",
        body: `${me.display_name} commented on your video`,
        actorId: context.userId,
        entityId: data.id,
        prefKey: "comments",
      });
    }
    if (data.parentId) {
      const parent = await sql<{ author_id: string }>`
        select author_id from video_comments where id = ${data.parentId}
      `;
      if (parent[0] && parent[0].author_id !== context.userId) {
        await notify(sql, {
          userId: parent[0].author_id,
          kind: "comment_reply",
          body: `${me.display_name} replied to your comment`,
          actorId: context.userId,
          entityId: data.id,
          prefKey: "comments",
        });
      }
    }
    const { splitRichTokens } = await import("../mention");
    const names = splitRichTokens(body)
      .filter((t) => t.type === "mention")
      .map((t) => t.value.replace(/^@/, "").toLowerCase());
    if (names.length) {
      const mentioned = await sql.query<{ user_id: string; username: string }>(
        `select user_id, username from profiles where username_lc in (${names.map((_, i) => `$${i + 1}`).join(",")})`,
        names,
      );
      for (const u of mentioned) {
        if (u.user_id === context.userId) continue;
        await notify(sql, {
          userId: u.user_id,
          kind: "mention",
          body: `${me.display_name} mentioned you in a comment`,
          actorId: context.userId,
          entityId: data.id,
          prefKey: "mentions",
        });
      }
    }
    const { moderateContent } = await import("./omni-support");
    await moderateContent(sql, {
      actorId: context.userId,
      targetKind: "video_comment",
      targetId: id,
      text: body,
      username: me.username,
    }).catch(() => {});
    const reply = await omniMentionReply({ sql, actorId: context.userId, text: body });
    if (reply) {
      await insertOmniVideoCommentReply(sql, data.id, id, reply);
    }
    return { id };
  });

export const toggleVideoCommentLike = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const existing = await sql<{ n: number }>`
      select count(*)::int as n from video_comment_likes where comment_id = ${data.id} and user_id = ${context.userId}
    `;
    if ((existing[0]?.n ?? 0) > 0) {
      await sql`delete from video_comment_likes where comment_id = ${data.id} and user_id = ${context.userId}`;
      await sql`update video_comments set like_count = greatest(like_count - 1, 0) where id = ${data.id}`;
      return { liked: false };
    }
    await sql`insert into video_comment_likes (comment_id, user_id) values (${data.id}, ${context.userId}) on conflict do nothing`;
    await sql`update video_comments set like_count = like_count + 1 where id = ${data.id}`;
    const author = await sql<{ author_id: string; video_id: string }>`
      select author_id, video_id from video_comments where id = ${data.id}
    `;
    if (author[0] && author[0].author_id !== context.userId) {
      const me = await ensureProfile(sql, { id: context.userId });
      await notify(sql, {
        userId: author[0].author_id,
        kind: "comment_like",
        body: `${me.display_name} liked your comment`,
        actorId: context.userId,
        entityId: author[0].video_id,
        prefKey: "likes",
      });
    }
    return { liked: true };
  });

export const listVideoComments = createServerFn({ method: "GET" })
  .validator((d: { id: string; q?: string; cursor?: string | null; parentId?: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const q = (data.q ?? "").trim().slice(0, 80);
    const parent = data.parentId ?? null;
    const like = q ? `%${q.toLowerCase()}%` : null;
    const rows = await sql.query<{
      id: string;
      author_id: string;
      body: string;
      created_at: string;
      parent_id: string | null;
      like_count: number | null;
      media_url: string | null;
      edited_at: string | null;
      reply_n: number;
      sticker_id: string | null;
    }>(
      `select c.id, c.author_id, c.body, c.created_at, c.parent_id, c.like_count, c.media_url, c.edited_at,
              (select count(*)::int from video_comments r where r.parent_id = c.id and r.is_removed = false) as reply_n,
              c.sticker_id
       from video_comments c
       where c.video_id = $1 and c.is_removed = false
         and (($2::text is null and c.parent_id is null) or c.parent_id = $2)
         and ($3::text is null or lower(c.body) like $3)
         and ($4::timestamptz is null or c.created_at < $4)
       order by c.created_at desc
       limit 40`,
      [data.id, parent, like, data.cursor ?? null],
    ).catch(async () =>
      sql.query<{
        id: string;
        author_id: string;
        body: string;
        created_at: string;
        parent_id: string | null;
        like_count: number | null;
        media_url: string | null;
        edited_at: string | null;
        reply_n: number;
        sticker_id: string | null;
      }>(
        `select c.id, c.author_id, c.body, c.created_at, c.parent_id, c.like_count, c.media_url, c.edited_at,
                (select count(*)::int from video_comments r where r.parent_id = c.id and r.is_removed = false) as reply_n,
                null as sticker_id
         from video_comments c
         where c.video_id = $1 and c.is_removed = false
           and (($2::text is null and c.parent_id is null) or c.parent_id = $2)
           and ($3::text is null or lower(c.body) like $3)
           and ($4::timestamptz is null or c.created_at < $4)
         order by c.created_at desc
         limit 40`,
        [data.id, parent, like, data.cursor ?? null],
      ),
    );
    const authors = await loadAuthors(sql, rows.map((r) => r.author_id));
    const liked = rows.length
      ? await sql.query<{ comment_id: string }>(
          `select comment_id from video_comment_likes where user_id = $1 and comment_id in (${rows.map((_, i) => `$${i + 2}`).join(",")})`,
          [context.userId, ...rows.map((r) => r.id)],
        )
      : [];
    const likedSet = new Set(liked.map((l) => l.comment_id));
    const { stickerViews } = await import("./stickers");
    const stickers = await stickerViews(sql, rows.map((r) => r.sticker_id));
    return {
      items: rows.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.created_at,
        parentId: r.parent_id,
        likes: r.like_count ?? 0,
        liked: likedSet.has(r.id),
        mediaUrl: r.media_url,
        editedAt: r.edited_at,
        replyCount: r.reply_n,
        sticker: r.sticker_id ? stickers.get(r.sticker_id) ?? null : null,
        author: authors.get(r.author_id)
          ? authorLite(authors.get(r.author_id)!)
          : { userId: r.author_id, username: "", displayName: "User", avatarUrl: null, verifyKind: "none" as const, isArc: false },
      })),
      nextCursor: rows.length === 40 ? rows[rows.length - 1]!.created_at : null,
    };
  });

export const deleteVideoComment = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const row = await sql<{
      id: string;
      author_id: string;
      video_id: string;
      is_removed: boolean;
    }>`
      select id, author_id, video_id, is_removed from video_comments where id = ${data.id}
    `;
    if (!row[0] || row[0].is_removed) throw new Error("Comment not found.");
    const video = await sql<{ author_id: string }>`
      select author_id from videos where id = ${row[0].video_id}
    `;
    if (
      !canDeleteComment({
        viewerId: context.userId,
        commentAuthorId: row[0].author_id,
        postAuthorId: video[0]?.author_id ?? null,
        role: me.role,
      })
    ) {
      throw new Error("You can only delete your own comments.");
    }
    await sql`update video_comments set is_removed = true where id = ${data.id}`;
    await sql`update videos set comment_count = greatest(comment_count - 1, 0) where id = ${row[0].video_id}`;
    return { ok: true as const };
  });

export const deleteVideo = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const row = await sql<{ id: string; author_id: string; is_removed: boolean }>`
      select id, author_id, is_removed from videos where id = ${data.id}
    `;
    if (!row[0] || row[0].is_removed) throw new Error("Video not found.");
    if (!canDeleteOwned(context.userId, row[0].author_id, me.role)) {
      throw new Error("You can only delete your own videos.");
    }
    await sql`update videos set is_removed = true, media_url = '', thumb_url = null where id = ${data.id}`;
    await sql`delete from video_hashtags where video_id = ${data.id}`;
    await sql`delete from video_renditions where video_id = ${data.id}`;
    return { ok: true as const };
  });

export const editVideoComment = createServerFn({ method: "POST" })
  .validator((d: { id: string; body: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const body = data.body.trim().slice(0, 400);
    if (!body) throw new Error("Write a comment.");
    const row = await sql<{ id: string; author_id: string; is_removed: boolean }>`
      select id, author_id, is_removed from video_comments where id = ${data.id}
    `;
    if (!row[0] || row[0].is_removed) throw new Error("Comment not found.");
    if (row[0].author_id !== context.userId) throw new Error("You can only edit your own comments.");
    await sql`update video_comments set body = ${body}, edited_at = now() where id = ${data.id}`;
    return { ok: true as const };
  });

export const userVideos = createServerFn({ method: "GET" })
  .validator((d: { username: string; cursor?: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const { getProfileByUsername, getRelation } = await import("./helpers");
    const { canViewPrivateAccount } = await import("../privacy");
    const target = await getProfileByUsername(sql, data.username);
    if (!target) throw new Error("User not found.");
    const rel = await getRelation(sql, context.userId, target.user_id);
    if (rel.isBlocked || rel.isBlockedBy) throw new Error("User not found.");
    if (target.is_private && !canViewPrivateAccount(rel, true) && target.user_id !== context.userId) {
      return { items: [], nextCursor: null as string | null };
    }
    const rows = await sql.query<{
      id: string;
      author_id: string;
      caption: string;
      media_url: string;
      thumb_url: string | null;
      like_count: number;
      comment_count: number;
      view_count: number | null;
      created_at: string;
      download_allowed: boolean | null;
      music_title: string | null;
      sound_id: string | null;
      width: number | null;
      height: number | null;
      source_label: string | null;
      hdr: boolean | null;
      duration_ms: number | null;
      original_audio: boolean | null;
      allow_original_audio: boolean | null;
      share_count: number | null;
      save_count: number | null;
      pinned: boolean | null;
    }>(
      `select v.id, v.author_id, v.caption, v.media_url, v.thumb_url, v.like_count, v.comment_count,
              v.view_count, v.created_at, v.download_allowed, v.music_title, v.sound_id,
              v.width, v.height, v.source_label, v.hdr, v.duration_ms, v.original_audio,
              v.allow_original_audio, v.share_count, v.save_count, coalesce(v.pinned, false) as pinned
       from videos v
       where v.author_id = $1 and v.is_removed = false and coalesce(v.is_draft, false) = false
         and ($2::timestamptz is null or v.created_at < $2)
       order by coalesce(v.pinned, false) desc, v.pinned_at desc nulls last, v.created_at desc
       limit 24`,
      [target.user_id, data.cursor ?? null],
    );
    const items = await mapVideos(sql, context.userId, rows);
    return {
      items: items.map((v, i) => ({ ...v, pinned: Boolean(rows[i]?.pinned) })),
      nextCursor: rows.length === 24 ? rows[rows.length - 1]!.created_at : null,
    };
  });

export const pinVideo = createServerFn({ method: "POST" })
  .validator((d: { id: string; pin: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const row = await sql<{ id: string; author_id: string }>`
      select id, author_id from videos where id = ${data.id} and is_removed = false
    `;
    if (!row[0] || row[0].author_id !== context.userId) {
      throw new Error("You can only pin your own videos.");
    }
    if (data.pin) {
      await sql`update videos set pinned = true, pinned_at = now() where id = ${data.id}`;
    } else {
      await sql`update videos set pinned = false, pinned_at = null where id = ${data.id}`;
    }
    return { pinned: data.pin };
  });

export const getVideo = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<ShortVideo | null> => {
    const sql = await sqlClient();
    const rows = await sql.query<{
      id: string;
      author_id: string;
      caption: string;
      media_url: string;
      thumb_url: string | null;
      like_count: number;
      comment_count: number;
      view_count: number | null;
      created_at: string;
      download_allowed: boolean | null;
      music_title: string | null;
      sound_id: string | null;
      width: number | null;
      height: number | null;
      source_label: string | null;
      hdr: boolean | null;
      duration_ms: number | null;
      original_audio: boolean | null;
      allow_original_audio: boolean | null;
      share_count: number | null;
      save_count: number | null;
    }>(
      `select v.id, v.author_id, v.caption, v.media_url, v.thumb_url, v.like_count, v.comment_count,
              v.view_count, v.created_at, v.download_allowed, v.music_title, v.sound_id,
              v.width, v.height, v.source_label, v.hdr, v.duration_ms, v.original_audio,
              v.allow_original_audio, v.share_count, v.save_count
       from videos v
       where v.id = $1 and v.is_removed = false and coalesce(v.is_draft, false) = false
         and not exists (
           select 1 from blocks b
           where (b.blocker_id = $2 and b.blocked_id = v.author_id)
              or (b.blocker_id = v.author_id and b.blocked_id = $2)
         )
       limit 1`,
      [data.id, context.userId],
    );
    if (!rows[0]) return null;
    const items = await mapVideos(sql, context.userId, rows);
    return items[0] ?? null;
  });

