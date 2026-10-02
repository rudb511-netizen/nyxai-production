import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import {
  clipBounds,
  FOCUS_MUTED_KINDS,
  hashSource,
  inRollout,
  isInterestTag,
  NYX_INTERESTS,
  type FeedTab,
} from "../platform";
import { takeToken, rateError } from "../rate-limit";
import { completeChat } from "../xai";
import { authorLite, ensureProfile, getProfile, notify, sqlClient } from "./helpers";

export type { FeedTab };

async function flagOn(sql: Awaited<ReturnType<typeof sqlClient>>, key: string, userId: string): Promise<boolean> {
  try {
    const rows = await sql<{ enabled: boolean; rollout: number }>`
      select enabled, rollout from feature_flags where key = ${key} limit 1
    `;
    const row = rows[0];
    if (!row) return true;
    if (!row.enabled) return false;
    return inRollout(userId, row.rollout);
  } catch {
    return true;
  }
}

export const listFeatureFlags = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    try {
      const rows = await sql<{ key: string; enabled: boolean; rollout: number }>`
        select key, enabled, rollout from feature_flags order by key
      `;
      return Object.fromEntries(rows.map((r) => [r.key, r.enabled && inRollout(context.userId, r.rollout)]));
    } catch {
      return {} as Record<string, boolean>;
    }
  });

export const trackAnalytics = createServerFn({ method: "POST" })
  .validator((d: { name: string; entityKind?: string; entityId?: string; meta?: Record<string, unknown> }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const wait = takeToken(`analytics:${context.userId}`, 80, 60_000);
    if (wait) return { ok: false as const };
    const name = data.name.trim().slice(0, 64);
    if (!name) return { ok: false as const };
    try {
      await sql`
        insert into analytics_events (id, user_id, name, entity_kind, entity_id, meta)
        values (
          ${newId("ev")},
          ${context.userId},
          ${name},
          ${data.entityKind?.slice(0, 32) ?? null},
          ${data.entityId?.slice(0, 64) ?? null},
          ${JSON.stringify(data.meta ?? {})}::jsonb
        )
      `;
    } catch {
      return { ok: false as const };
    }
    return { ok: true as const };
  });

export const saveInterests = createServerFn({ method: "POST" })
  .validator((d: { tags: string[] }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const tags = [...new Set(data.tags.map((t) => t.trim().toLowerCase()).filter(isInterestTag))].slice(0, 12);
    if (tags.length < 3) throw new Error("Pick at least 3 interests.");
    await sql`delete from user_interests where user_id = ${context.userId}`;
    for (const tag of tags) {
      await sql`
        insert into user_interests (user_id, tag) values (${context.userId}, ${tag})
        on conflict do nothing
      `;
    }
    await sql`update profiles set interests_set = true, updated_at = now() where user_id = ${context.userId}`;
    return { ok: true as const, tags };
  });

export const listMyInterests = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    try {
      const rows = await sql<{ tag: string }>`select tag from user_interests where user_id = ${context.userId}`;
      return { catalog: NYX_INTERESTS, selected: rows.map((r) => r.tag) };
    } catch {
      return { catalog: NYX_INTERESTS, selected: [] as string[] };
    }
  });

export const hideFromFeed = createServerFn({ method: "POST" })
  .validator((d: { targetKind: "post" | "author" | "video"; targetId: string; reason?: "not_interested" | "mute" | "hide" }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    await sql`
      insert into feed_hides (user_id, target_kind, target_id, reason)
      values (${context.userId}, ${data.targetKind}, ${data.targetId}, ${data.reason ?? "not_interested"})
      on conflict (user_id, target_kind, target_id) do update set reason = excluded.reason
    `;
    return { ok: true as const };
  });

export const toggleCloseFriend = createServerFn({ method: "POST" })
  .validator((d: { username: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const target = await sql<{ user_id: string }>`
      select user_id from profiles where username_lc = ${data.username.trim().toLowerCase()} limit 1
    `;
    if (!target[0] || target[0].user_id === context.userId) throw new Error("User not found.");
    const [a, b] = me.user_id < target[0].user_id ? [me.user_id, target[0].user_id] : [target[0].user_id, me.user_id];
    const friend = await sql<{ n: number }>`
      select count(*)::int as n from friendships where user_a = ${a} and user_b = ${b}
    `;
    if ((friend[0]?.n ?? 0) === 0) throw new Error("Close Friends is only for people you are friends with.");
    const existing = await sql<{ n: number }>`
      select count(*)::int as n from close_friends
      where user_id = ${context.userId} and friend_id = ${target[0].user_id}
    `;
    if ((existing[0]?.n ?? 0) > 0) {
      await sql`
        delete from close_friends where user_id = ${context.userId} and friend_id = ${target[0].user_id}
      `;
      return { close: false };
    }
    await sql`
      insert into close_friends (user_id, friend_id) values (${context.userId}, ${target[0].user_id})
      on conflict do nothing
    `;
    return { close: true };
  });

export const saveDraft = createServerFn({ method: "POST" })
  .validator((d: { id?: string | null; kind: "post" | "story" | "status" | "video" | "comment" | "message"; body?: string; payload?: Record<string, unknown> }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    if (!(await flagOn(sql, "drafts", context.userId))) throw new Error("Drafts are unavailable.");
    const wait = takeToken(`draft:${context.userId}`, 40, 60_000);
    if (wait) throw new Error(rateError(wait));
    const id = data.id && data.id.startsWith("dr_") ? data.id : newId("dr");
    const body = (data.body ?? "").slice(0, 4000);
    await sql`
      insert into composition_drafts (id, user_id, kind, body, payload, updated_at)
      values (${id}, ${context.userId}, ${data.kind}, ${body}, ${JSON.stringify(data.payload ?? {})}::jsonb, now())
      on conflict (id) do update set
        body = excluded.body,
        payload = excluded.payload,
        kind = excluded.kind,
        updated_at = now()
      where composition_drafts.user_id = ${context.userId}
    `;
    return { id };
  });

export const listDrafts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    try {
      const rows = await sql<{
        id: string;
        kind: string;
        body: string;
        payload: unknown;
        updated_at: string;
      }>`
        select id, kind, body, payload, updated_at
        from composition_drafts where user_id = ${context.userId}
        order by updated_at desc limit 40
      `;
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        body: r.body,
        payload: (r.payload && typeof r.payload === "object" ? r.payload : {}) as Record<string, never>,
        updatedAt: r.updated_at,
      }));
    } catch {
      return [] as Array<{
        id: string;
        kind: string;
        body: string;
        payload: Record<string, never>;
        updatedAt: string;
      }>;
    }
  });

export const deleteDraft = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`delete from composition_drafts where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const createCollection = createServerFn({ method: "POST" })
  .validator((d: { name: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const name = data.name.trim().slice(0, 40);
    if (name.length < 1) throw new Error("Name this collection.");
    const id = newId("col");
    await sql`
      insert into bookmark_collections (id, user_id, name) values (${id}, ${context.userId}, ${name})
    `;
    return { id, name };
  });

export const listCollections = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    try {
      const cols = await sql<{ id: string; name: string; n: number }>`
        select c.id, c.name, count(b.post_id)::int as n
        from bookmark_collections c
        left join bookmarks b on b.collection_id = c.id
        where c.user_id = ${context.userId}
        group by c.id, c.name
        order by c.created_at desc
      `;
      const loose = await sql<{ n: number }>`
        select count(*)::int as n from bookmarks where user_id = ${context.userId} and collection_id is null
      `;
      return {
        collections: cols.map((c) => ({ id: c.id, name: c.name, count: c.n })),
        uncategorized: loose[0]?.n ?? 0,
      };
    } catch {
      return { collections: [], uncategorized: 0 };
    }
  });

export const assignBookmark = createServerFn({ method: "POST" })
  .validator((d: { postId: string; collectionId: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`
      update bookmarks set collection_id = ${data.collectionId}
      where user_id = ${context.userId} and post_id = ${data.postId}
    `;
    return { ok: true as const };
  });

export const createEvent = createServerFn({ method: "POST" })
  .validator((d: {
    title: string;
    description?: string;
    startsAt: string;
    endsAt?: string | null;
    location?: string | null;
    isOnline?: boolean;
    coverUrl?: string | null;
  }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    if (!(await flagOn(sql, "events", context.userId))) throw new Error("Events are unavailable.");
    const title = data.title.trim().slice(0, 80);
    if (title.length < 2) throw new Error("Give the event a title.");
    const starts = new Date(data.startsAt);
    if (Number.isNaN(starts.getTime())) throw new Error("Pick a start time.");
    if (starts.getTime() < Date.now() - 60_000) throw new Error("Start time must be in the future.");
    const id = newId("evt");
    await sql`
      insert into nyx_events (id, host_id, title, description, starts_at, ends_at, location, is_online, cover_url)
      values (
        ${id},
        ${context.userId},
        ${title},
        ${(data.description ?? "").slice(0, 2000)},
        ${starts.toISOString()},
        ${data.endsAt ? new Date(data.endsAt).toISOString() : null},
        ${data.location?.slice(0, 120) ?? null},
        ${Boolean(data.isOnline)},
        ${data.coverUrl ?? null}
      )
    `;
    await notify(sql, {
      userId: me.user_id,
      kind: "event",
      body: `Your event “${title}” is live.`,
      actorId: me.user_id,
      entityId: id,
    }).catch(() => {});
    return { id };
  });

export const listEvents = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    try {
      const rows = await sql<{
        id: string;
        host_id: string;
        title: string;
        description: string;
        starts_at: string;
        ends_at: string | null;
        location: string | null;
        is_online: boolean;
        cover_url: string | null;
        going: number;
        interested: number;
        mine: string | null;
      }>`
        select e.id, e.host_id, e.title, e.description, e.starts_at, e.ends_at, e.location, e.is_online, e.cover_url,
          (select count(*)::int from event_rsvps r where r.event_id = e.id and r.status = 'going') as going,
          (select count(*)::int from event_rsvps r where r.event_id = e.id and r.status = 'interested') as interested,
          (select status from event_rsvps r where r.event_id = e.id and r.user_id = ${context.userId}) as mine
        from nyx_events e
        where e.starts_at > now() - interval '6 hours'
        order by e.starts_at asc
        limit 40
      `;
      const authors = await import("./helpers").then((m) => m.loadAuthors(sql, rows.map((r) => r.host_id)));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        location: r.location,
        isOnline: r.is_online,
        coverUrl: r.cover_url,
        going: r.going,
        interested: r.interested,
        myRsvp: r.mine,
        host: authors.get(r.host_id) ? authorLite(authors.get(r.host_id)!) : null,
      }));
    } catch {
      return [];
    }
  });

export const rsvpEvent = createServerFn({ method: "POST" })
  .validator((d: { id: string; status: "going" | "interested" | "not_going" }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const ev = await sql<{ host_id: string; title: string }>`
      select host_id, title from nyx_events where id = ${data.id} limit 1
    `;
    if (!ev[0]) throw new Error("Event not found.");
    await sql`
      insert into event_rsvps (event_id, user_id, status)
      values (${data.id}, ${context.userId}, ${data.status})
      on conflict (event_id, user_id) do update set status = excluded.status
    `;
    if (data.status === "going" && ev[0].host_id !== context.userId) {
      const me = await getProfile(sql, context.userId);
      await notify(sql, {
        userId: ev[0].host_id,
        kind: "event",
        body: `${me?.display_name ?? "Someone"} is going to ${ev[0].title}`,
        actorId: context.userId,
        entityId: data.id,
      });
    }
    return { ok: true as const, status: data.status };
  });

export const createChallenge = createServerFn({ method: "POST" })
  .validator((d: { title: string; rules?: string; hashtag: string; deadline?: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    if (!(await flagOn(sql, "challenges", context.userId))) throw new Error("Challenges are unavailable.");
    const title = data.title.trim().slice(0, 80);
    const tag = data.hashtag.replace(/^#/, "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);
    if (title.length < 2) throw new Error("Name the challenge.");
    if (tag.length < 2) throw new Error("Add a hashtag.");
    const id = newId("ch");
    await sql`
      insert into challenges (id, creator_id, title, rules, hashtag, deadline)
      values (
        ${id},
        ${context.userId},
        ${title},
        ${(data.rules ?? "").slice(0, 2000)},
        ${tag},
        ${data.deadline ? new Date(data.deadline).toISOString() : null}
      )
    `;
    return { id, hashtag: tag };
  });

export const listChallenges = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    try {
      const rows = await sql<{
        id: string;
        creator_id: string;
        title: string;
        rules: string;
        hashtag: string;
        deadline: string | null;
        entries: number;
      }>`
        select c.id, c.creator_id, c.title, c.rules, c.hashtag, c.deadline,
          (select count(*)::int from challenge_entries e where e.challenge_id = c.id) as entries
        from challenges c
        where c.deadline is null or c.deadline > now()
        order by entries desc, c.created_at desc
        limit 30
      `;
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        rules: r.rules,
        hashtag: r.hashtag,
        deadline: r.deadline,
        entries: r.entries,
        creatorId: r.creator_id,
      }));
    } catch {
      return [];
    }
  });

export const submitChallenge = createServerFn({ method: "POST" })
  .validator((d: { challengeId: string; videoId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const ch = await sql<{ id: string; deadline: string | null; hashtag: string }>`
      select id, deadline, hashtag from challenges where id = ${data.challengeId} limit 1
    `;
    if (!ch[0]) throw new Error("Challenge not found.");
    if (ch[0].deadline && new Date(ch[0].deadline).getTime() < Date.now()) {
      throw new Error("This challenge has closed.");
    }
    const vid = await sql<{ author_id: string; caption: string }>`
      select author_id, caption from videos where id = ${data.videoId} and is_removed = false limit 1
    `;
    if (!vid[0] || vid[0].author_id !== context.userId) {
      throw new Error("Submit one of your own videos.");
    }
    await sql`
      insert into challenge_entries (challenge_id, video_id, user_id)
      values (${data.challengeId}, ${data.videoId}, ${context.userId})
      on conflict do nothing
    `;
    return { ok: true as const };
  });

export const createWatchParty = createServerFn({ method: "POST" })
  .validator((d: { videoId: string; conversationId?: string | null }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    if (!(await flagOn(sql, "watch_parties", context.userId))) throw new Error("Watch parties are unavailable.");
    const vid = await sql<{ id: string }>`select id from videos where id = ${data.videoId} and is_removed = false`;
    if (!vid[0]) throw new Error("Video not found.");
    const id = newId("wp");
    await sql`
      insert into watch_parties (id, host_id, video_id, conversation_id, playing)
      values (${id}, ${context.userId}, ${data.videoId}, ${data.conversationId ?? null}, false)
    `;
    await sql`
      insert into watch_party_members (party_id, user_id) values (${id}, ${context.userId})
      on conflict do nothing
    `;
    return { id };
  });

export const syncWatchParty = createServerFn({ method: "POST" })
  .validator((d: { id: string; positionMs?: number; playing?: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const party = await sql<{ host_id: string; video_id: string; position_ms: number; playing: boolean; updated_at: string }>`
      select host_id, video_id, position_ms, playing, updated_at from watch_parties where id = ${data.id} limit 1
    `;
    if (!party[0]) throw new Error("Party not found.");
    await sql`
      insert into watch_party_members (party_id, user_id, last_seen_at)
      values (${data.id}, ${context.userId}, now())
      on conflict (party_id, user_id) do update set last_seen_at = now()
    `;
    if (party[0].host_id === context.userId && (data.positionMs != null || data.playing != null)) {
      await sql`
        update watch_parties set
          position_ms = ${Math.max(0, Math.floor(data.positionMs ?? party[0].position_ms))},
          playing = ${data.playing ?? party[0].playing},
          updated_at = now()
        where id = ${data.id}
      `;
    }
    const fresh = await sql<{ position_ms: number; playing: boolean; video_id: string; host_id: string; updated_at: string }>`
      select position_ms, playing, video_id, host_id, updated_at from watch_parties where id = ${data.id}
    `;
    const members = await sql<{ n: number }>`
      select count(*)::int as n from watch_party_members
      where party_id = ${data.id} and last_seen_at > now() - interval '30 seconds'
    `;
    return {
      positionMs: fresh[0]?.position_ms ?? 0,
      playing: Boolean(fresh[0]?.playing),
      videoId: fresh[0]?.video_id ?? party[0].video_id,
      hostId: fresh[0]?.host_id ?? party[0].host_id,
      viewers: members[0]?.n ?? 1,
      isHost: party[0].host_id === context.userId,
      updatedAt: fresh[0]?.updated_at ?? party[0].updated_at,
    };
  });

export const saveClip = createServerFn({ method: "POST" })
  .validator((d: { videoId: string; startMs: number; endMs: number; caption?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    if (!(await flagOn(sql, "clips", context.userId))) throw new Error("Clips are unavailable.");
    const vid = await sql<{ duration_ms: number | null; author_id: string }>`
      select duration_ms, author_id from videos where id = ${data.videoId} and is_removed = false
    `;
    if (!vid[0]) throw new Error("Video not found.");
    const bounds = clipBounds(data.startMs, data.endMs, vid[0].duration_ms);
    if (!bounds) throw new Error("Clip a section between 1 and 60 seconds.");
    const id = newId("cl");
    await sql`
      insert into video_clips (id, video_id, author_id, start_ms, end_ms, caption)
      values (${id}, ${data.videoId}, ${context.userId}, ${bounds.start}, ${bounds.end}, ${(data.caption ?? "").slice(0, 180)})
    `;
    return { id, startMs: bounds.start, endMs: bounds.end };
  });

export const translateText = createServerFn({ method: "POST" })
  .validator((d: { text: string; lang?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    if (!(await flagOn(sql, "translate", context.userId))) throw new Error("Translation is unavailable.");
    const wait = takeToken(`tr:${context.userId}`, 12, 60_000);
    if (wait) throw new Error(rateError(wait));
    const text = data.text.trim().slice(0, 2000);
    if (!text) throw new Error("Nothing to translate.");
    const lang = (data.lang ?? "en").trim().slice(0, 16) || "en";
    const sourceHash = hashSource(`${lang}:${text}`);
    const cached = await sql<{ text: string }>`
      select text from translations where source_hash = ${sourceHash} and lang = ${lang} limit 1
    `.catch(() => [] as { text: string }[]);
    if (cached[0]?.text) return { text: cached[0].text, cached: true };
    const result = await completeChat(
      [
        {
          role: "system",
          content: `Translate the user text into ${lang}. Return only the translation, no quotes or notes.`,
        },
        { role: "user", content: text },
      ],
      400,
    );
    if (!result.ok) throw new Error("Translation is not available right now.");
    const out = result.text.trim();
    await sql`
      insert into translations (source_hash, lang, text)
      values (${sourceHash}, ${lang}, ${out})
      on conflict (source_hash, lang) do nothing
    `.catch(() => {});
    return { text: out, cached: false };
  });

export const creatorStudio = createServerFn({ method: "GET" })
  .validator((d: { range?: "7" | "28" | "90" } = {}) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, { id: context.userId });
    const days = data.range === "90" ? 90 : data.range === "28" ? 28 : 7;
    const dayInt = days === 90 ? "90 days" : days === 28 ? "28 days" : "7 days";
    const videos = await sql<{
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
      from videos
      where author_id = ${context.userId} and is_removed = false
        and created_at > now() - ${dayInt}::interval
      order by view_count desc, created_at desc
      limit 40
    `;
    const followers = await sql<{ n: number }>`
      select count(*)::int as n from follows
      where following_id = ${context.userId} and created_at > now() - ${dayInt}::interval
    `.catch(() => [{ n: 0 }]);
    const gifts = await sql<{ n: number; coins: number }>`
      select count(*)::int as n, coalesce(sum(net_coins),0)::int as coins
      from coin_gifts where recipient_id = ${context.userId}
        and created_at > now() - ${dayInt}::interval
    `.catch(() => [{ n: 0, coins: 0 }]);
    const views = videos.reduce((s, v) => s + (v.view_count ?? 0), 0);
    const likes = videos.reduce((s, v) => s + (v.like_count ?? 0), 0);
    const comments = videos.reduce((s, v) => s + (v.comment_count ?? 0), 0);
    const watchMs = videos.reduce((s, v) => s + Number(v.watch_ms_total ?? 0), 0);
    return {
      rangeDays: days,
      totals: {
        views,
        likes,
        comments,
        shares: videos.reduce((s, v) => s + (v.share_count ?? 0), 0),
        watchMs,
        followersGained: followers[0]?.n ?? 0,
        gifts: gifts[0]?.n ?? 0,
        giftCoins: gifts[0]?.coins ?? 0,
        videos: videos.length,
      },
      videos: videos.map((v) => ({
        id: v.id,
        caption: v.caption,
        views: v.view_count,
        likes: v.like_count,
        comments: v.comment_count,
        shares: v.share_count,
        saves: v.save_count,
        watchMs: Number(v.watch_ms_total ?? 0),
        createdAt: v.created_at,
      })),
    };
  });

export const profileCard = createServerFn({ method: "GET" })
  .validator((d: { username?: string } = {}) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    const uname = (data.username ?? me.username).trim().toLowerCase();
    const p = await sql<{
      user_id: string;
      username: string;
      display_name: string;
      bio: string;
      avatar_url: string | null;
      verify_kind: string | null;
      is_arc: boolean | null;
      is_premium: boolean | null;
      score: number;
    }>`
      select user_id, username, display_name, bio, avatar_url, verify_kind, is_arc, is_premium, score
      from profiles where username_lc = ${uname} and onboarded = true limit 1
    `;
    if (!p[0]) throw new Error("Profile not found.");
    const followers = await sql<{ n: number }>`
      select count(*)::int as n from follows where following_id = ${p[0].user_id}
    `;
    return {
      userId: p[0].user_id,
      username: p[0].username,
      displayName: p[0].display_name,
      bio: p[0].bio,
      avatarUrl: p[0].avatar_url,
      verifyKind: p[0].verify_kind,
      isArc: Boolean(p[0].is_arc),
      isPremium: Boolean(p[0].is_premium),
      score: p[0].score ?? 0,
      followers: followers[0]?.n ?? 0,
      path: `/u/${p[0].username}`,
    };
  });

export const updateModes = createServerFn({ method: "POST" })
  .validator((d: { safeMode?: boolean; focusMode?: boolean }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const p = await getProfile(sql, context.userId);
    if (!p) throw new Error("Profile not found.");
    await sql`
      update profiles set
        safe_mode = ${data.safeMode ?? Boolean((p as { safe_mode?: boolean }).safe_mode)},
        focus_mode = ${data.focusMode ?? Boolean((p as { focus_mode?: boolean }).focus_mode)},
        updated_at = now()
      where user_id = ${context.userId}
    `;
    return {
      safeMode: data.safeMode ?? Boolean((p as { safe_mode?: boolean }).safe_mode),
      focusMode: data.focusMode ?? Boolean((p as { focus_mode?: boolean }).focus_mode),
    };
  });

export { FOCUS_MUTED_KINDS, flagOn };
