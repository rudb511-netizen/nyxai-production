import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { REPORT_CATEGORIES, callRefusal } from "../privacy";
import { isReportTargetKind } from "../safety";
import { asVerifyKind, identityKind } from "../types";
import type { RestrictCaps } from "../restrict";
import { newId, newRoomCode } from "../ids";
import { takeToken, rateError } from "../rate-limit";
import { scanText } from "../moderation";
import { publicError } from "../public-error";
import { parseRestrict } from "../restrict";
import {
  assertCapability,
  assertNotBanned,
  assertCanPunish,
  authorLite,
  ensureProfile,
  getProfile,
  getProfileByUsername,
  getRelation,
  loadAuthors,
  notify,
  notifySafetyTeam,
  requireAdmin,
  requireArc,
  requireSafety,
  sqlClient,
} from "./helpers";

type AnyRow = Record<string, any>;

export const globalSearch = createServerFn({ method: "GET" }).validator((d: { q: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await ensureProfile(sql, { id: context.userId });
	const wait = takeToken(`search:${context.userId}`, 40, 60_000);
	if (wait) throw new Error(rateError(wait));
	const q = data.q.trim().replace(/^@/, "").slice(0, 60);
	if (q.length < 1) return {
		users: [],
		posts: [],
		tags: [],
		communities: [],
		videos: [],
		channels: [],
	};
	try {
		await sql`
      insert into search_history (id, user_id, query, kind)
      values (${newId("sh")}, ${context.userId}, ${q}, 'all')
    `;
	} catch {
		/* 0028 */
	}
	const like = `%${q.toLowerCase()}%`;
	const users = await sql<AnyRow>`
      select user_id, username, display_name, avatar_url, verify_kind, is_arc, is_premium from profiles
      where onboarded = true and is_banned = false
        and (username_lc like ${like} or lower(display_name) like ${like})
      order by (verify_kind <> 'none' or coalesce(is_arc, false)) desc, username_lc
      limit 12
    `;
	const tags = await sql<AnyRow>`
      select tag, use_count from hashtags where tag like ${like} order by use_count desc limit 10
    `;
	const posts = await sql<AnyRow>`
      select id, body, author_id from posts
      where is_removed = false and lower(body) like ${like}
      order by created_at desc limit 10
    `;
	const communities = await sql<AnyRow>`
      select id, name, slug, kind, member_count from communities
      where is_private = false and (lower(name) like ${like} or slug like ${like})
      limit 8
    `;
	const videos = await sql<AnyRow>`
      select id, caption from videos where is_removed = false and lower(caption) like ${like} limit 8
    `;
	const channels = await sql<AnyRow>`
      select id, title, username_lc, image_url from conversations
      where is_broadcast = true and username_lc is not null
        and (username_lc like ${like} or lower(title) like ${like})
      limit 8
    `.catch(() => [] as AnyRow[]);
	return {
		users: users.map((u) => ({
			userId: u.user_id,
			username: u.username,
			displayName: u.display_name,
			avatarUrl: u.avatar_url,
			verifyKind: identityKind(u.verify_kind),
			isArc: Boolean(u.is_arc) || u.verify_kind === "arc",
			isPremium: Boolean(u.is_premium)
		})),
		tags: tags.map((t) => ({ tag: String(t.tag), use_count: Number(t.use_count ?? 0) })),
		posts: posts.map((r) => ({ id: String(r.id), body: String(r.body ?? ""), author_id: String(r.author_id ?? "") })),
		communities: communities.map((c) => ({
			id: String(c.id),
			name: String(c.name ?? ""),
			slug: String(c.slug ?? ""),
			kind: String(c.kind ?? ""),
			member_count: Number(c.member_count ?? 0),
		})),
		videos: videos.map((v) => ({ id: String(v.id), caption: String(v.caption ?? "") })),
		channels: channels.map((c) => ({
			id: String(c.id),
			title: String(c.title ?? "Channel"),
			username: String(c.username_lc ?? ""),
			imageUrl: c.image_url ? String(c.image_url) : null,
		})),
	};
});
export const listNotifications = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	const rows = await sql<AnyRow>`
      select id, kind, body, actor_id, entity_id, is_read, created_at
      from notifications where user_id = ${context.userId}
      order by created_at desc limit 50
    `;
	const authors = await loadAuthors(sql, rows.map((r) => r.actor_id ?? ""));
	return {
		unread: (await sql<AnyRow>`
      select count(*)::int as n from notifications where user_id = ${context.userId} and is_read = false
    `)[0]?.n ?? 0,
		items: rows.map((r) => ({
			id: r.id,
			kind: r.kind,
			body: r.body,
			actor: r.actor_id && authors.get(r.actor_id) ? authorLite(authors.get(r.actor_id)!) : null,
			entityId: r.entity_id,
			isRead: r.is_read,
			createdAt: r.created_at
		}))
	};
});
export const markNotificationsRead = createServerFn({ method: "POST" }).middleware([authMiddleware]).handler(async ({ context }) => {
	await (await sqlClient())`update notifications set is_read = true where user_id = ${context.userId}`;
	return { ok: true };
});
export const fileReport = createServerFn({ method: "POST" }).validator((d: { targetKind: string; targetId: string; category: string; details?: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	if (!REPORT_CATEGORIES.some((c) => c.id === data.category)) throw new Error("Pick a report category.");
	if (!isReportTargetKind(data.targetKind)) throw new Error("What are you reporting?");
	const targetId = data.targetId.trim();
	if (!targetId) throw new Error("Nothing to report.");
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	assertNotBanned(me);
	if (data.targetKind === "user" && targetId === context.userId) throw new Error("You can't report yourself.");
	const wait = takeToken(`report:${context.userId}`, 8, 3_600_000);
	if (wait) throw new Error(rateError(wait));
	if ((await sql<AnyRow>`
      select id from reports
      where reporter_id = ${context.userId}
        and target_kind = ${data.targetKind}
        and target_id = ${targetId}
        and status = 'open'
      limit 1
    `)[0]) return {
		ok: true,
		already: true
	};
	let label = "this content";
	if (data.targetKind === "user") {
		const target = await getProfile(sql, targetId);
		if (!target) throw new Error("Account not found.");
		if (target.user_id === context.userId) throw new Error("You can't report yourself.");
		label = `@${target.username}`;
	} else if (data.targetKind === "post") {
		const post = await sql<AnyRow>`
        select author_id from posts where id = ${targetId} and is_removed = false
      `;
		if (!post[0]) throw new Error("Post not found.");
		if (post[0].author_id === context.userId) throw new Error("Delete your post instead of reporting it.");
		label = "a post";
	} else if (data.targetKind === "comment") {
		const c = await sql<AnyRow>`
        select author_id from comments where id = ${targetId} and is_removed = false
      `;
		if (!c[0]) throw new Error("Comment not found.");
		if (c[0].author_id === context.userId) throw new Error("Delete your comment instead of reporting it.");
		label = "a comment";
	} else if (data.targetKind === "video") {
		if (!(await sql<AnyRow>`
        select author_id from videos where id = ${targetId} and is_removed = false
      `)[0]) throw new Error("Video not found.");
		label = "a video";
	} else if (data.targetKind === "video_comment") {
		if (!(await sql<AnyRow>`
        select author_id from video_comments where id = ${targetId} and is_removed = false
      `)[0]) throw new Error("Comment not found.");
		label = "a comment";
	}
	await sql<AnyRow>`
      insert into reports (id, reporter_id, target_kind, target_id, category, details)
      values (${newId("rp")}, ${context.userId}, ${data.targetKind}, ${targetId}, ${data.category}, ${(data.details ?? "").slice(0, 500)})
    `;
	const cat = REPORT_CATEGORIES.find((c) => c.id === data.category)?.label ?? data.category;
	await notifySafetyTeam(sql, {
		body: `${me.display_name} reported ${label} for ${cat.toLowerCase()}`,
		actorId: me.user_id,
		entityId: data.targetKind === "user" ? targetId : targetId
	});
	return {
		ok: true,
		already: false
	};
});
export const createCommunity = createServerFn({ method: "POST" }).validator((d: { name: string; kind: string; description?: string; imageUrl?: string | null; isPrivate?: boolean }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	assertNotBanned(me);
	const name = data.name.trim().slice(0, 40);
	if (name.length < 2) throw new Error("Name is too short.");
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || newId("c").slice(0, 8);
	const id = newId("cm");
	await sql<AnyRow>`
      insert into communities (id, kind, slug, name, description, image_url, is_private, created_by)
      values (${id}, ${data.kind}, ${slug}, ${name}, ${(data.description ?? "").slice(0, 240)}, ${data.imageUrl ?? null}, ${Boolean(data.isPrivate)}, ${context.userId})
    `;
	await sql<AnyRow>`
      insert into community_members (community_id, user_id, role)
      values (${id}, ${context.userId}, 'owner')
    `;
	return {
		id,
		slug
	};
});
export const listCommunities = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	const rows = await sql<AnyRow>`
      select * from communities
      where is_private = false
         or created_by = ${context.userId}
         or exists (
           select 1 from community_members m
           where m.community_id = communities.id and m.user_id = ${context.userId}
         )
      order by member_count desc, created_at desc
      limit 40
    `;
	const memberships = await sql<AnyRow>`
      select community_id, role from community_members where user_id = ${context.userId}
    `;
	const mine = new Map(memberships.map((m) => [m.community_id, m.role]));
	return rows.map((r) => ({
		id: r.id,
		kind: r.kind,
		slug: r.slug,
		name: r.name,
		description: r.description,
		imageUrl: r.image_url,
		isPrivate: r.is_private,
		memberCount: r.member_count,
		isMember: mine.has(r.id),
		isAdmin: [
			"owner",
			"admin",
			"moderator"
		].includes(mine.get(r.id) ?? "")
	}));
});
export const joinCommunity = createServerFn({ method: "POST" }).validator((d: { id: string; join: boolean }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	if (data.join) {
		await sql<AnyRow>`
        insert into community_members (community_id, user_id, role)
        values (${data.id}, ${context.userId}, 'member') on conflict do nothing
      `;
		await sql<AnyRow>`update communities set member_count = member_count + 1 where id = ${data.id}`;
	} else {
		await sql<AnyRow>`delete from community_members where community_id = ${data.id} and user_id = ${context.userId}`;
		await sql<AnyRow>`update communities set member_count = greatest(member_count - 1, 0) where id = ${data.id}`;
	}
	return { ok: true };
});
export const communityFeed = createServerFn({ method: "GET" }).validator((d: { id: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const c = await sql<AnyRow>`select * from communities where id = ${data.id}`;
	if (!c[0]) throw new Error("Not found.");
	const posts = await sql<AnyRow>`
      select id, author_id, body, media_url, created_at from community_posts
      where community_id = ${data.id} order by created_at desc limit 40
    `;
	const authors = await loadAuthors(sql, posts.map((p) => p.author_id));
	const member = await sql<AnyRow>`
      select role from community_members where community_id = ${data.id} and user_id = ${context.userId}
    `;
	return {
		community: c[0],
		isMember: Boolean(member[0]),
		role: member[0]?.role ?? null,
		posts: posts.map((p) => ({
			id: p.id,
			body: p.body,
			mediaUrl: p.media_url,
			createdAt: p.created_at,
			author: authors.get(p.author_id) ? authorLite(authors.get(p.author_id)!) : {
				userId: p.author_id,
				username: "",
				displayName: "User",
				avatarUrl: null,
				verifyKind: "none" as const,
				isArc: false,
				isPremium: false
			}
		}))
	};
});
export const postToCommunity = createServerFn({ method: "POST" }).validator((d: { id: string; body: string; mediaUrl?: string | null }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const member = await sql<AnyRow>`
      select m.role, c.kind from community_members m
      join communities c on c.id = m.community_id
      where m.community_id = ${data.id} and m.user_id = ${context.userId}
    `;
	if (!member[0]) throw new Error("Join this space first.");
	if (member[0].kind === "channel" && ![
		"owner",
		"admin",
		"moderator"
	].includes(member[0].role)) throw new Error("Only admins can post in this channel.");
	const body = data.body.trim().slice(0, 2000);
	if (!body && !data.mediaUrl) throw new Error("Write something.");
	const id = newId("cp");
	await sql<AnyRow>`
      insert into community_posts (id, community_id, author_id, body, media_url)
      values (${id}, ${data.id}, ${context.userId}, ${body}, ${data.mediaUrl ?? null})
    `;
	return { id };
});
export const startLive = createServerFn({ method: "POST" }).validator((d: { title: string; kind?: "video" | "audio"; description?: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	assertNotBanned(me);
	await sql<AnyRow>`update live_streams set status = 'ended', ended_at = now() where host_id = ${context.userId} and status = 'live'`;
	const id = newId("lv");
	const room = `live${newRoomCode()}`;
	const title = data.title.trim().slice(0, 80) || (data.kind === "audio" ? "Audio room" : "Live");
	const kind = data.kind === "audio" ? "audio" : "video";
	try {
		await sql<AnyRow>`
      insert into live_streams (id, host_id, title, status, room_code, kind, description)
      values (${id}, ${context.userId}, ${title}, 'live', ${room}, ${kind}, ${(data.description ?? "").slice(0, 200)})
    `;
	} catch {
		await sql<AnyRow>`
      insert into live_streams (id, host_id, title, status, room_code)
      values (${id}, ${context.userId}, ${title}, 'live', ${room})
    `;
	}
	try {
		await sql`
      insert into live_speakers (stream_id, user_id, role)
      values (${id}, ${context.userId}, 'host')
      on conflict do nothing
    `;
	} catch {
		/* 0028 */
	}
	return {
		id,
		roomCode: room,
		kind
	};
});
export const endLive = createServerFn({ method: "POST" }).validator((d: { id: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await sql`
      update live_streams set status = 'ended', ended_at = now()
      where id = ${data.id} and host_id = ${context.userId} and status = 'live'
    `;
	await sql`delete from live_presence where stream_id = ${data.id}`.catch(() => undefined);
	return { ok: true };
});
export const listLive = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	await ensureProfile(sql, { id: context.userId });
	const rows = await sql<AnyRow>`
      select id, host_id, title, status, viewer_peak, room_code, started_at, coalesce(kind, 'video') as kind
      from live_streams where status = 'live' order by started_at desc limit 30
    `.catch(async () => sql<AnyRow>`
      select id, host_id, title, status, viewer_peak, room_code, started_at
      from live_streams where status = 'live' order by started_at desc limit 30
    `);
	const authors = await loadAuthors(sql, rows.map((r) => r.host_id));
	let nowViewers = new Map<string, number>();
	try {
		const { sweepDisconnectedLives } = await import("./live-session");
		await sweepDisconnectedLives(sql);
		const pres = await sql<{ stream_id: string; n: number }>`
      select stream_id, count(*)::int as n from live_presence
      where last_seen > now() - interval '25 seconds'
      group by stream_id
    `;
		nowViewers = new Map(pres.map((p) => [p.stream_id, p.n]));
	} catch {
		nowViewers = new Map();
	}
	return rows.map((r) => {
		const host = authors.get(r.host_id);
		if (!host) return null;
		return {
			id: r.id,
			host: authorLite(host),
			title: r.title,
			status: r.status,
			viewers: nowViewers.get(r.id) ?? r.viewer_peak,
			roomCode: r.room_code,
			startedAt: r.started_at,
			kind: String(r.kind ?? "video")
		};
	}).filter((x): x is NonNullable<typeof x> => Boolean(x));
});
export const getLive = createServerFn({ method: "GET" }).validator((d: { id: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const rows = await sql<AnyRow>`select * from live_streams where id = ${data.id}`;
	if (!rows[0]) throw new Error("Stream not found.");
	if (((await sql<AnyRow>`
      select count(*)::int as n from live_bans where stream_id = ${data.id} and user_id = ${context.userId}
    `)[0]?.n ?? 0) > 0) throw new Error("You were removed from this stream.");
	const host = await getProfile(sql, rows[0].host_id);
	const comments = await sql<AnyRow>`
      select id, user_id, body, created_at, sticker_id from live_comments
      where stream_id = ${data.id} order by created_at desc limit 40
    `.catch(async () =>
      sql<AnyRow>`
        select id, user_id, body, created_at from live_comments
        where stream_id = ${data.id} order by created_at desc limit 40
      `,
    );
	const authors = await loadAuthors(sql, comments.map((c) => c.user_id));
	const { stickerViews } = await import("./stickers");
	const stickers = await stickerViews(sql, comments.map((c) => (c.sticker_id ? String(c.sticker_id) : null)));
	const live = rows[0];
	return {
		id: String(live.id),
		host_id: String(live.host_id),
		title: String(live.title ?? ""),
		status: String(live.status),
		viewer_peak: Number(live.viewer_peak ?? 0),
		room_code: String(live.room_code),
		started_at: String(live.started_at ?? ""),
		kind: String(live.kind ?? "video"),
		description: String(live.description ?? ""),
		isHost: live.host_id === context.userId,
		host: host ? authorLite(host) : null,
		comments: comments.reverse().map((c) => ({
			id: c.id,
			body: c.body,
			createdAt: c.created_at,
			sticker: c.sticker_id ? stickers.get(String(c.sticker_id)) ?? null : null,
			author: authors.get(c.user_id) ? authorLite(authors.get(c.user_id)!) : {
				userId: c.user_id,
				username: "",
				displayName: "Viewer",
				avatarUrl: null,
				verifyKind: "none" as const,
				isArc: false,
				isPremium: false
			}
		}))
	};
});
export const liveComment = createServerFn({ method: "POST" }).validator((d: { id: string; body: string; stickerId?: string | null }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	const wait = takeToken(`live-comment:${context.userId}`, 20, 60_000);
	if (wait) throw new Error(rateError(wait));
	const body = data.body.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, 200);
	const stickerId = data.stickerId?.trim() || null;
	if (!body && !stickerId) throw new Error("Say something.");
	const live = await sql<AnyRow>`select status from live_streams where id = ${data.id} limit 1`;
	if (!live[0] || live[0].status !== "live") throw new Error("This live has ended.");
	if (((await sql<AnyRow>`
      select count(*)::int as n from live_bans where stream_id = ${data.id} and user_id = ${context.userId}
    `)[0]?.n ?? 0) > 0) throw new Error("You were removed from this stream.");
	if (body) {
		const hit = scanText(body);
		if (hit?.severity === "high") throw new Error("That comment isn't allowed.");
		const dup = await sql<AnyRow>`
      select id from live_comments
      where stream_id = ${data.id} and user_id = ${context.userId} and body = ${body}
        and created_at > now() - interval '2 seconds'
      limit 1
    `;
		if (dup[0]) return { ok: true, id: String(dup[0].id) };
	}
	const id = newId("lc");
	await sql<AnyRow>`
      insert into live_comments (id, stream_id, user_id, body, sticker_id)
      values (${id}, ${data.id}, ${context.userId}, ${body}, ${stickerId})
    `.catch(async () => {
		await sql<AnyRow>`
        insert into live_comments (id, stream_id, user_id, body)
        values (${id}, ${data.id}, ${context.userId}, ${body})
      `;
	});
	if (body) {
		const { mentionLiveWatchers } = await import("./live-session");
		await mentionLiveWatchers(sql, {
			streamId: data.id,
			body,
			actorId: context.userId,
			actorName: me.display_name,
			commentId: id,
		}).catch(() => undefined);
	}
	return { ok: true, id };
});
export const banLiveViewer = createServerFn({ method: "POST" }).validator((d: { streamId: string; userId: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	if (((await sql<AnyRow>`
      select count(*)::int as n from live_streams where id = ${data.streamId} and host_id = ${context.userId}
    `)[0]?.n ?? 0) === 0) throw new Error("Only the host can moderate.");
	await sql<AnyRow>`
      insert into live_bans (stream_id, user_id) values (${data.streamId}, ${data.userId})
      on conflict do nothing
    `;
	return { ok: true };
});
export const startCall = createServerFn({ method: "POST" }).validator((d: { usernames: string[]; kind: "voice" | "video"; conversationId?: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	assertCapability(me, "call");
	const id = newId("cl");
	const room = `call${newRoomCode()}`;
	const targets: { user_id: string; display_name: string }[] = [];
	const skipped: string[] = [];
	const memberIds = new Set<string>();
	let names = data.usernames.filter(Boolean);
	if (data.conversationId) {
		const mine = await sql<{ user_id: string }>`
        select user_id from conversation_members
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
        limit 1
      `;
		if (!mine[0]) throw new Error("You're not in this chat.");
		const members = await sql<{ user_id: string; username: string }>`
        select p.user_id, p.username
        from conversation_members m
        join profiles p on p.user_id = m.user_id
        where m.conversation_id = ${data.conversationId}
      `;
		for (const m of members) memberIds.add(m.user_id);
		if (names.length === 0) {
			names = members.filter((m) => m.user_id !== context.userId).map((m) => m.username);
		}
	}
	const group = names.length > 1 || memberIds.size > 2;
	for (const u of names.slice(0, 7)) {
		const p = await getProfileByUsername(sql, u);
		if (!p) {
			skipped.push(`${u} is not on NYX.`);
			continue;
		}
		if (p.user_id === context.userId) continue;
		if (p.user_id === "omni_ai_system" || p.user_id === "omni_support_system") {
			skipped.push("NYXAI and NYX Support cannot be called.");
			continue;
		}
		const rel = await getRelation(sql, context.userId, p.user_id);
		if (memberIds.has(p.user_id)) rel.isContact = true;
		const who = (p.who_can_call ?? "friends") as "everyone" | "friends" | "nobody";
		const reason = callRefusal(rel, who);
		if (reason) {
			skipped.push(reason);
			continue;
		}
		targets.push({ user_id: p.user_id, display_name: p.display_name });
	}
	if (targets.length === 0) {
		throw new Error(skipped[0] || "No one to call.");
	}
	await sql<AnyRow>`
      insert into calls (id, room_code, kind, is_group, created_by, status)
      values (${id}, ${room}, ${data.kind}, ${targets.length > 1 || group}, ${context.userId}, 'ringing')
    `;
	await sql<AnyRow>`insert into call_participants (call_id, user_id, outcome) values (${id}, ${context.userId}, 'accepted')`;
	for (const p of targets) {
		await sql<AnyRow>`insert into call_participants (call_id, user_id, outcome) values (${id}, ${p.user_id}, 'ringing') on conflict do nothing`;
		await notify(sql, {
			userId: p.user_id,
			kind: "call",
			body: `${me.display_name} is calling`,
			actorId: me.user_id,
			entityId: id,
			prefKey: "messages",
		});
	}
	return { id, roomCode: room, skipped };
});
export const getIceConfig = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async () => {
		const stun = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"];
		const extra = (process.env.ICE_STUN_URLS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
		const servers: { urls: string | string[]; username?: string; credential?: string }[] = [
			{ urls: extra.length ? extra : stun },
		];
		const turn = process.env.ICE_TURN_URI?.trim();
		if (turn) {
			servers.push({
				urls: turn,
				username: process.env.ICE_TURN_USERNAME?.trim() || undefined,
				credential: process.env.ICE_TURN_CREDENTIAL?.trim() || undefined,
			});
		}
		return { iceServers: servers, turnConfigured: Boolean(turn) };
	});
export const incomingCalls = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	await sql<AnyRow>`
      update calls set status = 'missed', ended_at = now()
      where status = 'ringing' and started_at <= now() - interval '45 seconds'
    `;
	await sql<AnyRow>`
      update call_participants set outcome = 'missed'
      where outcome = 'ringing'
        and call_id in (select id from calls where status = 'missed')
    `;
	const rows = await sql<AnyRow>`
      select c.id, c.room_code, c.kind, c.status, c.created_by, c.started_at, c.is_group
      from calls c
      join call_participants p on p.call_id = c.id
      where p.user_id = ${context.userId}
        and p.outcome = 'ringing'
        and c.status = 'ringing'
        and c.created_by <> ${context.userId}
        and c.started_at > now() - interval '45 seconds'
      order by c.started_at desc
      limit 3
    `;
	const authors = await loadAuthors(sql, rows.map((r) => r.created_by));
	return rows.map((r) => ({
		id: r.id,
		kind: r.kind,
		roomCode: r.room_code,
		startedAt: r.started_at,
		isGroup: r.is_group,
		caller: authors.get(r.created_by) ? authorLite(authors.get(r.created_by)!) : null
	}));
});
export const acceptCall = createServerFn({ method: "POST" }).validator((d: { id: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	if (((await sql<AnyRow>`
      select count(*)::int as n from call_participants where call_id = ${data.id} and user_id = ${context.userId}
    `)[0]?.n ?? 0) === 0) throw new Error("You were not invited.");
	await sql<AnyRow>`
      update call_participants set outcome = 'accepted' where call_id = ${data.id} and user_id = ${context.userId}
    `;
	await sql<AnyRow>`
      update calls set status = 'live', answered_at = coalesce(answered_at, now())
      where id = ${data.id} and status in ('ringing','live')
    `;
	return { ok: true };
});
export const declineCall = createServerFn({ method: "POST" }).validator((d: { id: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await sql<AnyRow>`
      update call_participants set outcome = 'declined', left_at = now()
      where call_id = ${data.id} and user_id = ${context.userId}
    `;
	if (((await sql<AnyRow>`
      select count(*)::int as n from call_participants
      where call_id = ${data.id} and outcome in ('ringing','accepted') and user_id <> (
        select created_by from calls where id = ${data.id}
      )
    `)[0]?.n ?? 0) === 0) await sql<AnyRow>`update calls set status = 'ended', ended_at = now() where id = ${data.id} and status = 'ringing'`;
	return { ok: true };
});
export const getCall = createServerFn({ method: "GET" }).validator((d: { id: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const rows = await sql<AnyRow>`select id, room_code, kind, status, created_by, is_group, started_at from calls where id = ${data.id}`;
	if (!rows[0]) throw new Error("Call not found.");
	if (((await sql<AnyRow>`
      select count(*)::int as n from call_participants where call_id = ${data.id} and user_id = ${context.userId}
    `)[0]?.n ?? 0) === 0) throw new Error("You were not invited.");
	if (rows[0].status === "ringing" && Date.now() - new Date(rows[0].started_at).getTime() > 45e3) {
		await sql<AnyRow>`update calls set status = 'missed', ended_at = now() where id = ${data.id} and status = 'ringing'`;
		await sql<AnyRow>`update call_participants set outcome = 'missed' where call_id = ${data.id} and outcome = 'ringing'`;
		rows[0].status = "missed";
	}
	const caller = await getProfile(sql, rows[0].created_by);
	const partRows = await sql<AnyRow>`
      select user_id from call_participants where call_id = ${data.id}
    `;
	const people = await loadAuthors(sql, partRows.map((p) => p.user_id));
	const call = rows[0];
	return {
		id: String(call.id),
		room_code: String(call.room_code),
		kind: (call.kind === "video" ? "video" : "voice") as "voice" | "video",
		status: String(call.status),
		created_by: String(call.created_by),
		is_group: Boolean(call.is_group),
		started_at: String(call.started_at ?? ""),
		callerName: caller?.display_name ?? "Someone",
		callerAvatar: caller?.avatar_url ?? null,
		participants: partRows.map((p) => people.get(p.user_id)).filter((a): a is NonNullable<typeof a> => Boolean(a)).map((a) => authorLite(a))
	};
});
export const endCall = createServerFn({ method: "POST" }).validator((d: { id: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await sql<AnyRow>`
      update call_participants set left_at = now(), outcome = 'left'
      where call_id = ${data.id} and user_id = ${context.userId}
    `;
	await sql<AnyRow>`
      update calls set status = 'ended', ended_at = now()
      where id = ${data.id} and status in ('ringing','live')
    `;
	return { ok: true };
});
export const callHistory = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	const rows = await sql<AnyRow>`
      select c.id, c.kind, c.status, c.created_by, c.started_at, c.ended_at, c.answered_at, p.outcome
      from calls c
      join call_participants p on p.call_id = c.id
      where p.user_id = ${context.userId}
      order by c.started_at desc limit 40
    `;
	const people = await sql<AnyRow>`
      select call_id, user_id from call_participants
      where call_id in (select c.id from calls c join call_participants p on p.call_id = c.id where p.user_id = ${context.userId})
    `;
	const authors = await loadAuthors(sql, [...rows.map((r) => r.created_by), ...people.map((p) => p.user_id)]);
	return rows.map((r) => {
		const others = people.filter((p) => p.call_id === r.id && p.user_id !== context.userId).map((p) => authors.get(p.user_id)).filter((a): a is NonNullable<typeof a> => Boolean(a)).map((a) => authorLite(a));
		const outgoing = r.created_by === context.userId;
		return {
			id: r.id,
			kind: r.kind,
			status: r.status,
			outcome: r.outcome,
			outgoing,
			startedAt: r.started_at,
			endedAt: r.ended_at,
			answeredAt: r.answered_at,
			others
		};
	});
});
export const adminOverview = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	requireSafety(me);
	try {
		const { maybeSweepMarks } = await import("./arc");
		await maybeSweepMarks(sql);
	} catch {
		/* ignore */
	}
	const num = async (q: string) => {
		return (await sql.query<AnyRow>(q))[0]?.n ?? 0;
	};
	return {
		role: me.role,
		users: await num("select count(*)::int as n from profiles"),
		onboarded: await num("select count(*)::int as n from profiles where onboarded = true"),
		posts: await num("select count(*)::int as n from posts"),
		videos: await num("select count(*)::int as n from videos"),
		messages: await num("select count(*)::int as n from messages"),
		reportsOpen: await num("select count(*)::int as n from reports where status = 'open'"),
		live: await num("select count(*)::int as n from live_streams where status = 'live'"),
		suspended: await num("select count(*)::int as n from profiles where is_suspended = true"),
		banned: await num("select count(*)::int as n from profiles where is_banned = true"),
		kai: await num("select count(*)::int as n from kai_messages")
	};
});
export const adminReports = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	requireSafety(me);
	let rows: AnyRow[] = [];
	try {
		rows = await sql<AnyRow>`
        select id, reporter_id, target_kind, target_id, category, details, status, created_at,
               coalesce(priority, 'normal') as priority, coalesce(source, 'user') as source,
               evidence_json
        from reports
        order by
          case when coalesce(priority, 'normal') = 'high' and status <> 'resolved' then 0 else 1 end,
          created_at desc
        limit 80
      `;
	} catch {
		rows = await sql<AnyRow>`
        select id, reporter_id, target_kind, target_id, category, details, status, created_at
        from reports order by created_at desc limit 80
      `;
	}
	const peopleIds = [...rows.map((r) => r.reporter_id), ...rows.filter((r) => r.target_kind === "user").map((r) => r.target_id)];
	const postIds = rows.filter((r) => r.target_kind === "post").map((r) => r.target_id);
	const commentIds = rows.filter((r) => r.target_kind === "comment").map((r) => r.target_id);
	const authors = await loadAuthors(sql, peopleIds);
	const postBy = new Map();
	if (postIds.length) {
		const ph = postIds.map((_, i) => `$${i + 1}`).join(",");
		const posts = await sql.query<AnyRow>(`select id, author_id, body from posts where id in (${ph})`, postIds);
		for (const p of posts) postBy.set(p.id, p);
		await loadAuthors(sql, posts.map((p) => p.author_id)).then((more) => {
			for (const [k, v] of more) authors.set(k, v);
		});
	}
	const commentBy = new Map();
	if (commentIds.length) {
		const ph = commentIds.map((_, i) => `$${i + 1}`).join(",");
		const comments = await sql.query<AnyRow>(`select id, author_id, body from comments where id in (${ph})`, commentIds);
		for (const c of comments) commentBy.set(c.id, c);
		await loadAuthors(sql, comments.map((c) => c.author_id)).then((more) => {
			for (const [k, v] of more) authors.set(k, v);
		});
	}
	const extraBy = new Map();
	async function pullExtra(kind: string, query: string) {
		const ids = rows.filter((r) => r.target_kind === kind).map((r) => r.target_id);
		if (!ids.length) return;
		const ph = ids.map((_, i) => `$${i + 1}`).join(",");
		const found = await sql.query<AnyRow>(query.replace("__IN__", ph), ids);
		for (const f of found) extraBy.set(f.id, f);
		await loadAuthors(sql, found.map((f) => f.author_id)).then((more) => {
			for (const [k, v] of more) authors.set(k, v);
		});
	}
	await pullExtra("video", `select id, author_id, caption as body from videos where id in (__IN__)`);
	await pullExtra("video_comment", `select id, author_id, body from video_comments where id in (__IN__)`);
	await pullExtra("story", `select id, author_id, text_body as body from stories where id in (__IN__)`);
	await pullExtra("status", `select id, author_id, text_body as body from statuses where id in (__IN__)`);
	await pullExtra("flash", `select id, author_id, caption as body from flashes where id in (__IN__)`);
	const targetUserIds = [];
	for (const r of rows) {
		const post = postBy.get(r.target_id);
		const comment = commentBy.get(r.target_id);
		const extra = extraBy.get(r.target_id);
		const uid = r.target_kind === "user" ? r.target_id : post?.author_id ?? comment?.author_id ?? extra?.author_id ?? null;
		if (uid) targetUserIds.push(uid);
	}
	const uniqueTargets = [...new Set(targetUserIds)];
	const warnMap = new Map();
	const sanctionMap = new Map();
	if (uniqueTargets.length) {
		const ph = uniqueTargets.map((_, i) => `$${i + 1}`).join(",");
		try {
			const warns = await sql.query<AnyRow>(`select user_id, category, body, created_at from user_warnings where user_id in (${ph}) order by created_at desc`, uniqueTargets);
			for (const w of warns) {
				const cur = warnMap.get(w.user_id) ?? {
					count: 0,
					items: []
				};
				cur.count += 1;
				if (cur.items.length < 8) cur.items.push({
					category: w.category,
					body: w.body,
					created_at: w.created_at
				});
				warnMap.set(w.user_id, cur);
			}
		} catch {
		/* ignore */
	}
		try {
			const sans = await sql.query<AnyRow>(`select user_id, kind, reason, status, created_at from sanctions where user_id in (${ph}) order by created_at desc`, uniqueTargets);
			for (const s of sans) {
				const cur = sanctionMap.get(s.user_id) ?? [];
				if (cur.length < 6) cur.push({
					kind: s.kind,
					reason: s.reason,
					status: s.status,
					created_at: s.created_at
				});
				sanctionMap.set(s.user_id, cur);
			}
		} catch {
		/* ignore */
	}
	}
	const appealMap = new Map();
	if (uniqueTargets.length) {
		const ph = uniqueTargets.map((_, i) => `$${i + 1}`).join(",");
		try {
			const aps = await sql.query<AnyRow>(`select user_id, status from appeals where user_id in (${ph}) order by created_at desc`, uniqueTargets);
			for (const a of aps) if (!appealMap.has(a.user_id)) appealMap.set(a.user_id, a.status);
		} catch {
		/* ignore */
	}
	}
	return rows.map((r) => {
		const post = postBy.get(r.target_id);
		const comment = commentBy.get(r.target_id);
		const extra = extraBy.get(r.target_id);
		const targetUserId = r.target_kind === "user" ? r.target_id : post?.author_id ?? comment?.author_id ?? extra?.author_id ?? null;
		const target = targetUserId ? authors.get(targetUserId) : null;
		const w = targetUserId ? warnMap.get(targetUserId) : null;
		let evidence = null;
		const raw = r.evidence_json;
		if (raw && typeof raw === "object" && "evidence" in raw) {
			const ev = raw.evidence;
			if (typeof ev === "string" && ev.trim()) evidence = ev.slice(0, 280);
		}
		return {
			id: r.id,
			category: r.category,
			targetKind: r.target_kind,
			targetId: r.target_id,
			details: r.details,
			status: r.status,
			createdAt: r.created_at,
			snippet: (post?.body ?? comment?.body ?? extra?.body ?? r.details).slice(0, 160),
			reporter: authors.get(r.reporter_id) ? authorLite(authors.get(r.reporter_id)!) : null,
			target: target ? authorLite(target) : null,
			priority: r.priority ?? (r.reporter_id === "omni_support_system" ? "high" : "normal"),
			source: r.source ?? (r.reporter_id === "omni_support_system" ? "omnisupport" : "user"),
			warningCount: w?.count ?? 0,
			warnings: w?.items ?? [],
			sanctions: targetUserId ? sanctionMap.get(targetUserId) ?? [] : [],
			evidence,
			appealStatus: targetUserId ? appealMap.get(targetUserId) ?? null : null
		};
	});
});
export const reviewReport = createServerFn({ method: "POST" }).validator((d: { id: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	requireSafety(me);
	await sql<AnyRow>`update reports set status = 'pending' where id = ${data.id} and status = 'open'`;
	await sql<AnyRow>`
      insert into mod_actions (id, actor_id, action, target_kind, target_id, note)
      values (${newId("ma")}, ${context.userId}, 'review', 'report', ${data.id}, 'Moved to pending review')
    `;
	return { ok: true };
});
export const resolveReport = createServerFn({ method: "POST" }).validator((d: { id: string; action: string; note?: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	requireSafety(me);
	if ((data.action === "ban" || data.action === "suspend") && me.role !== "admin" && me.role !== "super_admin") requireAdmin(me);
	const report = await sql<AnyRow>`select * from reports where id = ${data.id}`;
	if (!report[0]) throw new Error("Report not found.");
	const r = report[0];
	if (data.action !== "dismiss") {
		let subject = r.target_kind === "user" ? r.target_id : "";
		if (!subject && r.target_kind === "post") subject = (await sql<AnyRow>`select author_id from posts where id = ${r.target_id}`)[0]?.author_id ?? "";
		if (!subject && r.target_kind === "comment") subject = (await sql<AnyRow>`select author_id from comments where id = ${r.target_id}`)[0]?.author_id ?? "";
		if (!subject && r.target_kind === "video") subject = (await sql<AnyRow>`select author_id from videos where id = ${r.target_id}`)[0]?.author_id ?? "";
		if (!subject && r.target_kind === "video_comment") subject = (await sql<AnyRow>`select author_id from video_comments where id = ${r.target_id}`)[0]?.author_id ?? "";
		if (!subject && r.target_kind === "story") subject = (await sql<AnyRow>`select author_id from stories where id = ${r.target_id}`)[0]?.author_id ?? "";
		if (!subject && r.target_kind === "status") subject = (await sql<AnyRow>`select author_id from statuses where id = ${r.target_id}`)[0]?.author_id ?? "";
		if (!subject && r.target_kind === "flash") subject = (await sql<AnyRow>`select author_id from flashes where id = ${r.target_id}`)[0]?.author_id ?? "";
		if (subject) {
			const target = await getProfile(sql, subject);
			if (target) try {
				assertCanPunish(me, target);
			} catch (e) {
				throw publicError(e, "Could not apply that action.");
			}
		}
	}
	if (data.action === "remove") {
		if (r.target_kind === "post") await sql<AnyRow>`update posts set is_removed = true where id = ${r.target_id}`;
		if (r.target_kind === "video") await sql<AnyRow>`update videos set is_removed = true where id = ${r.target_id}`;
		if (r.target_kind === "comment") await sql<AnyRow>`update comments set is_removed = true where id = ${r.target_id}`;
		if (r.target_kind === "video_comment") await sql<AnyRow>`update video_comments set is_removed = true where id = ${r.target_id}`;
	}
	if (data.action === "suspend" || data.action === "ban") {
		let uid = r.target_id;
		if (r.target_kind === "post") uid = (await sql<AnyRow>`select author_id from posts where id = ${r.target_id}`)[0]?.author_id ?? uid;
		if (r.target_kind === "comment") uid = (await sql<AnyRow>`select author_id from comments where id = ${r.target_id}`)[0]?.author_id ?? uid;
		if (r.target_kind === "video") uid = (await sql<AnyRow>`select author_id from videos where id = ${r.target_id}`)[0]?.author_id ?? uid;
		if (r.target_kind === "video_comment") uid = (await sql<AnyRow>`select author_id from video_comments where id = ${r.target_id}`)[0]?.author_id ?? uid;
		if (data.action === "suspend") await sql<AnyRow>`update profiles set is_suspended = true, suspended_reason = ${data.note ?? "Policy"} where user_id = ${uid}`;
		else await sql<AnyRow>`update profiles set is_banned = true, banned_reason = ${data.note ?? "Policy"} where user_id = ${uid}`;
		try {
			await sql<AnyRow>`
          insert into sanctions (id, user_id, actor_id, kind, capabilities, reason, ends_at, status)
          values (
            ${newId("sn")}, ${uid}, ${context.userId}, ${data.action === "ban" ? "ban" : "suspension"},
            '{}'::jsonb, ${data.note ?? "Policy"},
            ${data.action === "ban" ? null : new Date(Date.now() + 604_800_000).toISOString()},
            'active'
          )
        `;
		} catch {
		/* ignore */
	}
		await notify(sql, {
			userId: uid,
			kind: "sanction",
			body: data.action === "ban" ? `Your account has been banned. ${data.note ?? ""} You can appeal.` : `Your account has been suspended. ${data.note ?? ""} You can appeal.`,
			actorId: me.user_id
		});
	}
	if (data.action === "warn") {
		let warnId = r.target_id;
		if (r.target_kind === "post") warnId = (await sql<AnyRow>`select author_id from posts where id = ${r.target_id}`)[0]?.author_id ?? warnId;
		if (r.target_kind === "comment") warnId = (await sql<AnyRow>`select author_id from comments where id = ${r.target_id}`)[0]?.author_id ?? warnId;
		if (r.target_kind === "video") warnId = (await sql<AnyRow>`select author_id from videos where id = ${r.target_id}`)[0]?.author_id ?? warnId;
		const warnBody = data.note || "Safety reviewed a report about your account.";
		await notify(sql, {
			userId: warnId,
			kind: "warning",
			body: warnBody,
			actorId: me.user_id
		});
		try {
			await sql<AnyRow>`
          insert into user_warnings (id, user_id, actor_id, category, body, evidence, target_kind, target_id, report_id)
          values (
            ${newId("uw")}, ${warnId}, ${me.user_id}, ${"other"}, ${warnBody},
            ${""}, ${r.target_kind}, ${r.target_id}, ${r.id}
          )
        `;
		} catch {
		/* ignore */
	}
	}
	await sql<AnyRow>`
      update reports set status = 'resolved', resolved_by = ${context.userId}, resolved_at = now(),
        resolution = ${data.action}
      where id = ${data.id}
    `;
	await sql<AnyRow>`
      insert into mod_actions (id, actor_id, action, target_kind, target_id, note)
      values (${newId("ma")}, ${context.userId}, ${data.action}, ${r.target_kind}, ${r.target_id}, ${data.note ?? ""})
    `;
	return { ok: true };
});
export const applySanction = createServerFn({ method: "POST" }).validator((d: { username: string; kind: string; reason: string; days?: number; capabilities?: RestrictCaps }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	if (data.kind === "ban" || data.kind === "close" || data.kind === "suspension") requireAdmin(me);
	else requireSafety(me);
	const target = await getProfileByUsername(sql, data.username);
	if (!target) throw new Error("User not found.");
	try {
		assertCanPunish(me, target);
	} catch (e) {
		throw publicError(e, "Could not apply that action.");
	}
	const { writeAdminAudit } = await import("./security-log.server");
	await writeAdminAudit(sql, {
		actorId: context.userId,
		action: `sanction_${data.kind}`,
		targetId: target.user_id,
		detail: data.reason.slice(0, 120)
	});
	if (data.kind === "lift") {
		await sql<AnyRow>`update sanctions set status = 'lifted' where user_id = ${target.user_id} and status = 'active'`;
		await sql<AnyRow>`
        update profiles set
          restrict_json = '{}'::jsonb,
          is_suspended = false,
          is_banned = false,
          sanction_until = null
        where user_id = ${target.user_id}
      `;
		await notify(sql, {
			userId: target.user_id,
			kind: "sanction",
			body: data.reason.trim() ? `A restriction on your account was lifted. ${data.reason.slice(0, 160)}` : "A restriction on your account was lifted.",
			actorId: me.user_id
		});
		await sql<AnyRow>`
        insert into mod_actions (id, actor_id, action, target_kind, target_id, note)
        values (${newId("ma")}, ${context.userId}, 'lift', 'user', ${target.user_id}, ${data.reason.slice(0, 400)})
      `;
		return { id: target.user_id };
	}
	const days = data.days ?? (data.kind === "warning" ? 0 : 7);
	const endsAt = days <= 0 || data.kind === "close" || data.kind === "ban" || data.kind === "warning" ? null : new Date(Date.now() + days * 86_400_000).toISOString();
	const caps = data.capabilities ?? {};
	const id = newId("sn");
	await sql<AnyRow>`
      insert into sanctions (id, user_id, actor_id, kind, capabilities, reason, ends_at, status)
      values (
        ${id}, ${target.user_id}, ${context.userId}, ${data.kind},
        ${JSON.stringify(caps)}::jsonb, ${data.reason.slice(0, 400)}, ${endsAt},
        ${data.kind === "warning" ? "completed" : "active"}
      )
    `;
	if (data.kind === "restriction") {
		const merged = {
			...parseRestrict(target.restrict_json),
			...caps
		};
		await sql<AnyRow>`
        update profiles set restrict_json = ${JSON.stringify(merged)}::jsonb, sanction_until = ${endsAt}
        where user_id = ${target.user_id}
      `;
	} else if (data.kind === "suspension") await sql<AnyRow>`
        update profiles set is_suspended = true, suspended_reason = ${data.reason.slice(0, 200)}, sanction_until = ${endsAt}
        where user_id = ${target.user_id}
      `;
	else if (data.kind === "ban" || data.kind === "close") await sql<AnyRow>`
        update profiles set is_banned = true, banned_reason = ${data.reason.slice(0, 200)}
        where user_id = ${target.user_id}
      `;
	const untilLabel = endsAt ? new Date(endsAt).toLocaleDateString() : "permanent";
	const body = data.kind === "warning" ? `Warning: ${data.reason.slice(0, 160)}` : `Your account has been ${data.kind === "close" ? "closed" : data.kind} (${untilLabel}). ${data.reason.slice(0, 120)} You can appeal.`;
	await notify(sql, {
		userId: target.user_id,
		kind: "sanction",
		body,
		actorId: me.user_id,
		entityId: id
	});
	await sql<AnyRow>`
      insert into mod_actions (id, actor_id, action, target_kind, target_id, note)
      values (${newId("ma")}, ${context.userId}, ${data.kind}, 'user', ${target.user_id}, ${data.reason.slice(0, 400)})
    `;
	if (data.kind === "ban" || data.kind === "close" || data.kind === "suspension") {
		const { revokeUserSessions } = await import("./arc");
		await revokeUserSessions(sql, target.user_id);
	}
	return { id };
});
export const mySanctions = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	await ensureProfile(sql, { id: context.userId });
	const rows = await sql<AnyRow>`
      select id, kind, reason, capabilities, starts_at, ends_at, status
      from sanctions where user_id = ${context.userId}
      order by created_at desc limit 20
    `;
	const appeals = await sql<AnyRow>`
      select sanction_id, status from appeals where user_id = ${context.userId}
    `;
	const appealBy = new Map(appeals.map((a) => [a.sanction_id, a.status]));
	return rows.map((r) => ({
		id: r.id,
		kind: r.kind,
		reason: r.reason,
		capabilities: parseRestrict(r.capabilities),
		startsAt: r.starts_at,
		endsAt: r.ends_at,
		status: r.status,
		appealStatus: appealBy.get(r.id) ?? null
	}));
});
export const myWarningStatus = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	await ensureProfile(sql, { id: context.userId });
	const { getWarningStatus } = await import("./omni-support");
	return getWarningStatus(sql, context.userId);
});
export const submitAppeal = createServerFn({ method: "POST" }).validator((d: { sanctionId: string; body: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	const body = data.body.trim().slice(0, 2000);
	if (body.length < 8) throw new Error("Explain why this action should be reviewed.");
	const s = await sql<AnyRow>`
      select id, status from sanctions where id = ${data.sanctionId} and user_id = ${context.userId}
    `;
	if (!s[0]) throw new Error("Sanction not found.");
	if (((await sql<AnyRow>`
      select count(*)::int as n from appeals where sanction_id = ${data.sanctionId} and status = 'open'
    `)[0]?.n ?? 0) > 0) throw new Error("An appeal is already open.");
	const id = newId("ap");
	await sql<AnyRow>`
      insert into appeals (id, sanction_id, user_id, body)
      values (${id}, ${data.sanctionId}, ${context.userId}, ${body})
    `;
	await notifySafetyTeam(sql, {
		body: `${me.display_name} appealed a ${s[0].status} sanction`,
		actorId: me.user_id,
		entityId: id
	});
	return { id };
});
export const listAppeals = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	requireSafety(me);
	const rows = await sql<AnyRow>`
      select a.id, a.sanction_id, a.user_id, a.body, a.status, a.created_at,
             s.kind, s.reason
      from appeals a
      join sanctions s on s.id = a.sanction_id
      order by a.created_at desc
      limit 50
    `;
	const authors = await loadAuthors(sql, rows.map((r) => r.user_id));
	return rows.map((r) => ({
		id: r.id,
		sanctionId: r.sanction_id,
		body: r.body,
		status: r.status,
		createdAt: r.created_at,
		kind: r.kind,
		reason: r.reason,
		user: authors.get(r.user_id) ? authorLite(authors.get(r.user_id)!) : null
	}));
});
export const reviewAppeal = createServerFn({ method: "POST" }).validator((d: { id: string; action: string; days?: number; note?: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	requireSafety(me);
	const row = await sql<AnyRow>`select id, sanction_id, user_id, status from appeals where id = ${data.id}`;
	if (!row[0] || row[0].status !== "open") throw new Error("Appeal not found.");
	const sanction = await sql<AnyRow>`select id, kind, user_id from sanctions where id = ${row[0].sanction_id}`;
	if (!sanction[0]) throw new Error("Sanction not found.");
	if (data.action === "approve") {
		await sql<AnyRow>`update sanctions set status = 'lifted' where id = ${sanction[0].id}`;
		await sql<AnyRow>`
        update profiles set
          restrict_json = '{}'::jsonb,
          is_suspended = false,
          is_banned = false,
          sanction_until = null
        where user_id = ${sanction[0].user_id}
      `;
		await notify(sql, {
			userId: sanction[0].user_id,
			kind: "appeal",
			body: "Your appeal was approved. The restriction has been removed.",
			actorId: me.user_id,
			entityId: data.id
		});
	} else if (data.action === "reduce") {
		const days = Math.max(1, data.days ?? 3);
		const ends = new Date(Date.now() + days * 86_400_000).toISOString();
		await sql<AnyRow>`update sanctions set ends_at = ${ends}, status = 'active' where id = ${sanction[0].id}`;
		await sql<AnyRow>`update profiles set sanction_until = ${ends} where user_id = ${sanction[0].user_id}`;
		await notify(sql, {
			userId: sanction[0].user_id,
			kind: "appeal",
			body: `Your appeal reduced the restriction to ${days} day${days === 1 ? "" : "s"}.`,
			actorId: me.user_id,
			entityId: data.id
		});
	} else await notify(sql, {
		userId: sanction[0].user_id,
		kind: "appeal",
		body: data.note || "Your appeal was reviewed and the original action stands.",
		actorId: me.user_id,
		entityId: data.id
	});
	await sql<AnyRow>`
      update appeals set status = ${data.action === "reject" ? "rejected" : "approved"},
        reviewed_by = ${context.userId}, reviewed_at = now()
      where id = ${data.id}
    `;
	await sql<AnyRow>`
      insert into mod_actions (id, actor_id, action, target_kind, target_id, note)
      values (${newId("ma")}, ${context.userId}, ${`appeal_${data.action}`}, 'appeal', ${data.id}, ${data.note ?? ""})
    `;
	return { ok: true };
});
export const listModActions = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	requireSafety(me);
	return await sql<AnyRow>`
      select id, actor_id, action, target_kind, target_id, note, created_at
      from mod_actions
      order by created_at desc
      limit 80
    `;
});
export const listTagFeed = createServerFn({ method: "GET" }).validator((d: { tag: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await ensureProfile(sql, { id: context.userId });
	const tag = data.tag.replace(/^#/, "").toLowerCase().slice(0, 30);
	const posts = await sql<AnyRow>`
      select p.id, p.body, p.author_id, p.created_at
      from post_hashtags h
      join posts p on p.id = h.post_id
      where h.tag = ${tag} and p.is_removed = false
      order by p.created_at desc
      limit 40
    `;
	const videos = await sql<AnyRow>`
      select v.id, v.caption, v.author_id, v.media_url, v.thumb_url, v.like_count, v.comment_count, v.created_at, v.download_allowed
      from video_hashtags h
      join videos v on v.id = h.video_id
      where h.tag = ${tag} and v.is_removed = false
      order by v.like_count desc, v.created_at desc
      limit 24
    `;
	const authors = await loadAuthors(sql, [...posts.map((p) => p.author_id), ...videos.map((v) => v.author_id)]);
	return {
		tag,
		posts: posts.map((p) => ({
			id: p.id,
			body: p.body,
			createdAt: p.created_at,
			author: authors.get(p.author_id) ? authorLite(authors.get(p.author_id)!) : {
				userId: p.author_id,
				username: "",
				displayName: "User",
				avatarUrl: null,
				verifyKind: "none" as const,
				isArc: false,
				isPremium: false
			}
		})),
		videos: videos.map((v) => ({
			id: v.id,
			caption: v.caption,
			mediaUrl: v.media_url,
			thumbUrl: v.thumb_url,
			likes: v.like_count,
			comments: v.comment_count,
			createdAt: v.created_at,
			downloadAllowed: v.download_allowed !== false,
			author: authors.get(v.author_id) ? authorLite(authors.get(v.author_id)!) : {
				userId: v.author_id,
				username: "",
				displayName: "User",
				avatarUrl: null,
				verifyKind: "none" as const,
				isArc: false,
				isPremium: false
			}
		}))
	};
});
export const trendingTags = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async () => {
	const sql = await sqlClient();
	try {
		const rows = await sql<AnyRow>`
      select h.tag, h.use_count,
        (
          select count(*) from post_hashtags ph
          join posts p on p.id = ph.post_id
          where ph.tag = h.tag and p.created_at > now() - interval '24 hours' and p.is_removed = false
        )::int as velocity
      from hashtags h
      order by velocity desc, h.use_count desc, h.updated_at desc
      limit 16
    `;
		return rows.map((r) => ({
			tag: String(r.tag),
			use_count: Number(r.use_count ?? 0),
			velocity: Number(r.velocity ?? 0),
		}));
	} catch {
		const rows = await sql<AnyRow>`
      select tag, use_count from hashtags order by use_count desc, updated_at desc limit 12
    `;
		return rows.map((r) => ({ tag: String(r.tag), use_count: Number(r.use_count ?? 0), velocity: 0 }));
	}
});
export const listAdministrators = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	requireArc(me);
	const rows = await sql<AnyRow>`
      select user_id, username, display_name, avatar_url, verify_kind, is_arc, is_premium, role, is_suspended, is_banned
      from profiles
      where is_banned = false
        and user_id not in ('omni_ai_system', 'omni_support_system')
        and (
          role in ('moderator', 'admin', 'super_admin')
          or verify_kind in ('org', 'founder', 'developer', 'arc')
          or is_arc = true
        )
      order by
        case when is_arc or verify_kind = 'arc' then 0 when verify_kind = 'founder' then 1 when verify_kind = 'org' then 2 else 3 end,
        username_lc
      limit 80
    `;
	const pendingBy = new Map();
	try {
		const pending = await sql<AnyRow>`
        select user_id, ends_at from pending_restorations where status = 'pending'
      `;
		for (const p of pending) pendingBy.set(p.user_id, p.ends_at);
	} catch {
		/* ignore */
	}
	return rows.map((r) => ({
		userId: r.user_id,
		username: r.username,
		displayName: r.display_name,
		avatarUrl: r.avatar_url,
		verifyKind: identityKind(r.verify_kind),
		isArc: Boolean(r.is_arc) || r.verify_kind === "arc",
		isPremium: Boolean(r.is_premium),
		role: r.role,
		isSuspended: r.is_suspended,
		isBanned: r.is_banned,
		restoreAt: pendingBy.get(r.user_id) ?? null
	}));
});
export const listBadgeHistory = createServerFn({ method: "GET" }).validator((d: { username?: string } = {}) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	requireArc(me);
	let userId = null;
	if (data.username) userId = (await getProfileByUsername(sql, data.username))?.user_id ?? null;
	let rows: AnyRow[] = [];
	try {
		if (userId) rows = await sql<AnyRow>`
          select id, user_id, actor_id, action, badge, previous_kind, new_kind, reason, status, ends_at, created_at
          from badge_events where user_id = ${userId} order by created_at desc limit 40
        `;
		else rows = await sql<AnyRow>`
          select id, user_id, actor_id, action, badge, previous_kind, new_kind, reason, status, ends_at, created_at
          from badge_events order by created_at desc limit 40
        `;
	} catch {
		rows = [];
	}
	const authors = await loadAuthors(sql, [...rows.map((r) => r.user_id), ...rows.map((r) => r.actor_id)]);
	return rows.map((r) => ({
		id: r.id,
		action: r.action,
		badge: r.badge,
		previousKind: asVerifyKind(r.previous_kind),
		newKind: asVerifyKind(r.new_kind),
		reason: r.reason,
		status: r.status,
		endsAt: r.ends_at,
		createdAt: r.created_at,
		user: authors.get(r.user_id) ? authorLite(authors.get(r.user_id)!) : null,
		actor: authors.get(r.actor_id) ? authorLite(authors.get(r.actor_id)!) : null
	}));
});
export const manageAdministrator = createServerFn({ method: "POST" }).validator((d: { username: string; action: string; badge?: string; days?: number; reason: string }) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	requireArc(me);
	const target = await getProfileByUsername(sql, data.username.replace(/^@/, "").trim());
	if (!target) throw new Error("User not found.");
	try {
		const { applyAdminDemotion } = await import("./arc");
		const result = await applyAdminDemotion(sql, {
			actor: me,
			target,
			action: data.action as "demote" | "revoke_badge" | "restore",
			badge: data.badge as "org" | "founder" | "developer" | "all" | undefined,
			days: data.days,
			reason: data.reason
		});
		const { writeAdminAudit } = await import("./security-log.server");
		await writeAdminAudit(sql, {
			actorId: context.userId,
			action: `admin_${data.action}`,
			targetId: target.user_id,
			detail: data.reason.slice(0, 120)
		});
		await sql<AnyRow>`
        insert into mod_actions (id, actor_id, action, target_kind, target_id, note)
        values (
          ${newId("ma")}, ${context.userId}, ${data.action}, 'user', ${target.user_id}, ${data.reason.slice(0, 400)}
        )
      `;
		const body = data.action === "restore" ? `An administrator restored a mark on your account. ${data.reason.slice(0, 120)}` : data.action === "demote" ? `Your administrative role was removed. ${data.reason.slice(0, 120)}` : `A verification mark was removed from your account. ${data.reason.slice(0, 120)}`;
		await notify(sql, {
			userId: target.user_id,
			kind: "sanction",
			body,
			actorId: me.user_id
		});
		return result;
	} catch (e) {
		throw publicError(e, "Could not apply that action.");
	}
});
