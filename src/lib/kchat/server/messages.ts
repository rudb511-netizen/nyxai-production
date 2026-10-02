// @ts-nocheck — reconstructed from the production SSR bundle; runtime types are preserved at call sites.
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import { canMessage, canViewStatus } from "../privacy";
import { hoursLeft, isBroken } from "../streaks";
import { takeToken, rateError } from "../rate-limit";
import type { ChatMessage, ChatMember, ChatThread, ConversationPreview } from "../types";
import { isArcFlag } from "../types";
import { parseExtra, isMutedAt, validateScheduleAt, type MessageExtra } from "../comms-extra";
import { findSticker, stickerDataUrl } from "../stickers";
import { normalizeUsername, usernameError, validateUsername } from "../usernames";
import {
  assertCapability,
  assertNotBanned,
  authorLite,
  ensureProfile,
  friendPair,
  getProfile,
  getProfileByUsername,
  getRelation,
  loadAuthors,
  notify,
  sqlClient,
  touchPresence,
} from "./helpers";
import { mentionsOmniAI } from "../video-quality";
import { insertOmniChatReply, OMNI_AI_USER_ID, omniMentionReply } from "./omniai-mention";
import { isResourceId, publicError } from "../public-error";
import {
  canOpenViewOnce,
  deriveViewOnceState,
  recipientViewOnceCopy,
  senderViewOnceCopy,
} from "../view-once";
import { assertMember, deliverOutgoing, flushDueScheduled } from "./chat-deliver";
import { enrichExtraWithPreview, prepareOutgoingExtras } from "./comms";
import { OMNI_SUPPORT_USER_ID } from "../omni-support-ids";
import { extractMessageLinks, historyBucket } from "../media-pipeline";

export const listConversations = createServerFn({ method: "GET" }).validator((d: any = {}) => d).middleware([authMiddleware]).handler(async ({ context, data }): Promise<ConversationPreview[]> => {
	try {
		const sql = await sqlClient();
		await ensureProfile(sql, { id: context.userId });
		await touchPresence(sql, context.userId).catch(() => undefined);
		await flushDueScheduled(sql).catch(() => 0);
		const archived = Boolean(data.archived);
		let rows;
		try {
			rows = await sql`
      select c.id, c.kind, c.title, c.image_url, c.last_message_body, c.last_message_at,
             c.last_message_kind, m.muted, m.archived, m.last_read_at,
             coalesce(m.pinned, false) as pinned, coalesce(m.favorite, false) as favorite,
             coalesce(m.marked_unread, false) as marked_unread,
             coalesce(c.is_broadcast, false) as is_broadcast, m.mute_until
      from conversation_members m
      join conversations c on c.id = m.conversation_id
      where m.user_id = ${context.userId} and m.archived = ${archived}
        and m.banned_at is null
      order by coalesce(m.pinned, false) desc, c.last_message_at desc nulls last
      limit 80
    `;
		} catch {
			try {
				rows = await sql`
      select c.id, c.kind, c.title, c.image_url, c.last_message_body, c.last_message_at,
             c.last_message_kind, m.muted, m.archived, m.last_read_at,
             coalesce(m.pinned, false) as pinned, coalesce(m.favorite, false) as favorite,
             coalesce(m.marked_unread, false) as marked_unread,
             coalesce(c.is_broadcast, false) as is_broadcast, m.mute_until
      from conversation_members m
      join conversations c on c.id = m.conversation_id
      where m.user_id = ${context.userId} and m.archived = ${archived}
      order by coalesce(m.pinned, false) desc, c.last_message_at desc nulls last
      limit 80
    `;
			} catch {
				rows = (await sql`
      select c.id, c.kind, c.title, c.image_url, c.last_message_body, c.last_message_at,
             c.last_message_kind, m.muted, m.archived, m.last_read_at,
             coalesce(m.pinned, false) as pinned, coalesce(m.favorite, false) as favorite,
             coalesce(m.marked_unread, false) as marked_unread
      from conversation_members m
      join conversations c on c.id = m.conversation_id
      where m.user_id = ${context.userId} and m.archived = ${archived}
      order by coalesce(m.pinned, false) desc, c.last_message_at desc nulls last
      limit 80
    `).map((r) => ({
					...r,
					is_broadcast: false,
					mute_until: null
				}));
			}
		}
		const ids = rows.map((r) => r.id);
		const memberRows = ids.length === 0 ? [] : await sql.query(`select conversation_id, user_id, role from conversation_members
             where conversation_id in (${ids.map((_, i) => `$${i + 1}`).join(",")})`, ids);
		const membersBy =  new Map();
		for (const m of memberRows) {
			const arr = membersBy.get(m.conversation_id) ?? [];
			arr.push(m);
			membersBy.set(m.conversation_id, arr);
		}
		const authorIds = memberRows.map((m) => m.user_id);
		const authors = await loadAuthors(sql, authorIds);
		const unread = ids.length === 0 ? [] : await sql.query(`select m.conversation_id, count(*)::int as n
             from messages m
             join conversation_members cm
               on cm.conversation_id = m.conversation_id and cm.user_id = $1
             where m.conversation_id in (${ids.map((_, i) => `$${i + 2}`).join(",")})
               and m.sender_id <> $1
               and m.deleted_at is null
               and (cm.last_read_at is null or m.created_at > cm.last_read_at)
             group by m.conversation_id`, [context.userId, ...ids]);
		const unreadMap = new Map(unread.map((u) => [u.conversation_id, u.n]));
		const dmPairs = [];
		for (const r of rows) {
			if (r.kind !== "dm") continue;
			const oid = (membersBy.get(r.id) ?? []).map((m) => m.user_id).find((id) => id !== context.userId);
			if (!oid) continue;
			const [ua, ub] = friendPair(context.userId, oid);
			dmPairs.push({
				id: r.id,
				ua,
				ub
			});
		}
		const streakMap =  new Map();
		if (dmPairs.length > 0) {
			const unique = [...new Map(dmPairs.map((p) => [`${p.ua}:${p.ub}`, p])).values()];
			const placeholders = unique.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(",");
			const params = unique.flatMap((p) => [p.ua, p.ub]);
			const stRows = await sql.query(`select user_a, user_b, count, last_qualifying_at, a_sent_at, b_sent_at, freeze_until, icon
         from streaks where (user_a, user_b) in (${placeholders})`, params);
			const byPair = new Map(stRows.map((s) => [`${s.user_a}:${s.user_b}`, s]));
			for (const p of dmPairs) {
				const s = byPair.get(`${p.ua}:${p.ub}`);
				if (s) streakMap.set(p.id, s);
			}
		}
		const friendRows = await sql`
      select user_a, user_b from friendships
      where user_a = ${context.userId} or user_b = ${context.userId}
    `;
		const friendSet = new Set(friendRows.map((f) => f.user_a === context.userId ? f.user_b : f.user_a));
		const otherIds = [...new Set(dmPairs.map((p) => p.ua === context.userId ? p.ub : p.ua))];
		const statusRows = otherIds.length === 0 ? [] : await sql.query(`select id, author_id, coalesce(audience, 'friends') as audience from statuses
             where expires_at > now() and author_id in (${otherIds.map((_, i) => `$${i + 1}`).join(",")})
             order by created_at desc`, otherIds);
		const statusByAuthor =  new Map();
		for (const s of statusRows) if (!statusByAuthor.has(s.author_id)) statusByAuthor.set(s.author_id, s);
		const statusIds = [...statusByAuthor.values()].map((s) => s.id);
		const listedRows = statusIds.length === 0 ? [] : await sql.query(`select status_id, user_id, mode from status_audience
             where status_id in (${statusIds.map((_, i) => `$${i + 1}`).join(",")})`, statusIds);
		const listedBy =  new Map();
		for (const r of listedRows) {
			const arr = listedBy.get(r.status_id) ?? [];
			arr.push(r.user_id);
			listedBy.set(r.status_id, arr);
		}
		const seenStatus = statusIds.length === 0 ? [] : await sql.query(`select status_id from status_views where user_id = $1
             and status_id in (${statusIds.map((_, i) => `$${i + 2}`).join(",")})`, [context.userId, ...statusIds]);
		const seenStatusSet = new Set(seenStatus.map((s) => s.status_id));
		const draftRows = ids.length === 0 ? [] : await sql.query(`select conversation_id, body from conversation_drafts
             where user_id = $1 and conversation_id in (${ids.map((_, i) => `$${i + 2}`).join(",")})`, [context.userId, ...ids]).catch(() => []);
		const draftMap = new Map(draftRows.map((d) => [d.conversation_id, d.body]));
		const out = [];
		for (const r of rows) {
			const mems = membersBy.get(r.id) ?? [];
			let title = r.title ?? "Chat";
			let imageUrl = r.image_url;
			let other;
			let streak = null;
			let online = false;
			let statusId = null;
			let statusSeen = false;
			if (r.kind === "dm") {
				const oid = mems.map((m) => m.user_id).find((id) => id !== context.userId);
				if (oid) {
					const p = authors.get(oid);
					if (p) {
						title = p.display_name;
						imageUrl = p.avatar_url;
						other = authorLite(p);
						online = Boolean(p.show_online) && Boolean(p.last_seen_at) && Date.now() - new Date(p.last_seen_at ?? 0).getTime() < 120000;
						const st = streakMap.get(r.id);
						if (st && st.count > 0) {
							const snap = {
								count: st.count,
								lastQualifyingAt: st.last_qualifying_at ? new Date(st.last_qualifying_at).getTime() : null,
								aSentAt: st.a_sent_at ? new Date(st.a_sent_at).getTime() : null,
								bSentAt: st.b_sent_at ? new Date(st.b_sent_at).getTime() : null,
								freezeUntil: st.freeze_until ? new Date(st.freeze_until).getTime() : null
							};
							if (!isBroken(snap, Date.now())) streak = {
								count: st.count,
								icon: st.icon,
								hoursLeft: hoursLeft(snap, Date.now()) ?? 0
							};
						}
						const live = statusByAuthor.get(oid);
						if (live) {
							const rel = {
								isSelf: false,
								isBlocked: false,
								isBlockedBy: false,
								isFriend: friendSet.has(oid),
								isFollowing: false,
								isFollower: false,
								isCloseFriend: false,
								isContact: true,
								isMutualFollow: false
							};
							const audience = live.audience === "except" || live.audience === "only" ? live.audience : "friends";
							const listed = listedBy.get(live.id) ?? [];
							if (audience === "except" || audience === "only") {
								if (canViewStatus(rel, audience, {
									mode: audience,
									userIds: listed
								}, context.userId)) {
									statusId = live.id;
									statusSeen = seenStatusSet.has(live.id);
								}
							} else if (canViewStatus(rel, "friends")) {
								statusId = live.id;
								statusSeen = seenStatusSet.has(live.id);
							}
						}
					}
				}
			}
			const unread = (unreadMap.get(r.id) ?? 0) + (r.marked_unread ? 1 : 0);
			const draft = (draftMap.get(r.id) ?? "").trim() || null;
			out.push({
				id: r.id,
				kind: r.kind,
				title,
				imageUrl,
				lastBody: r.last_message_body ?? "",
				lastAt: r.last_message_at,
				lastKind: r.last_message_kind,
				unread,
				muted: isMutedAt(Boolean(r.muted), r.mute_until),
				archived: Boolean(r.archived),
				pinned: r.pinned === true,
				favorite: r.favorite === true,
				markedUnread: r.marked_unread === true,
				other,
				streak,
				memberCount: mems.length,
				online,
				statusId,
				statusSeen,
				draft,
				isBroadcast: Boolean(r.is_broadcast),
				muteUntil: r.mute_until
			});
		}
		return out;
	} catch (e) {
		throw publicError(e, "Couldn't load your inbox.");
	}
});
export async function ensureDm(sql: Awaited<ReturnType<typeof sqlClient>>, meId: string, otherId: string): Promise<string> {
	const existing = await sql<{ id: string }>`
    select c.id from conversations c
    join conversation_members a on a.conversation_id = c.id and a.user_id = ${meId}
    join conversation_members b on b.conversation_id = c.id and b.user_id = ${otherId}
    where c.kind = 'dm'
      and (select count(*)::int from conversation_members x where x.conversation_id = c.id) = 2
    limit 1
  `;
	if (existing[0]) return existing[0].id;
	const id = newId("cv");
	await sql`
    insert into conversations (id, kind, created_by) values (${id}, 'dm', ${meId})
  `;
	await sql`insert into conversation_members (conversation_id, user_id, role) values (${id}, ${meId}, 'owner')`;
	await sql`insert into conversation_members (conversation_id, user_id, role) values (${id}, ${otherId}, 'member')`;
	return id;
}
export const openDm = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	try {
		const sql = await sqlClient();
		const me = await ensureProfile(sql, { id: context.userId });
		assertNotBanned(me);
		const wait = takeToken(`opendm:${context.userId}`, 20, 60000);
		if (wait) throw new Error(rateError(wait));
		const other = await getProfileByUsername(sql, data.username);
		if (!other || other.is_banned) throw new Error("This account isn’t available.");
		if (other.user_id === OMNI_SUPPORT_USER_ID) {
			const { ensureOmniSupportUser } = await import("./omni-support");
			await ensureOmniSupportUser(sql);
			return { id: await ensureDm(sql, context.userId, OMNI_SUPPORT_USER_ID) };
		}
		const rel = await getRelation(sql, context.userId, other.user_id);
		if (rel.isBlocked) throw new Error("You blocked this person. Unblock them to message.");
		if (rel.isBlockedBy) throw new Error("You cannot message this person.");
		if (!canMessage(rel, other.who_can_message)) throw new Error(other.who_can_message === "friends" ? "They only accept messages from friends." : "You cannot message this person.");
		return { id: await ensureDm(sql, context.userId, other.user_id) };
	} catch (e) {
		throw publicError(e, "Couldn't open this conversation. Please try again.");
	}
});
export const createGroup = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	assertNotBanned(me);
	const title = data.title.trim().slice(0, 60);
	if (title.length < 2) throw new Error("Give the group a name.");
	const id = newId("cv");
	const broadcast = Boolean(data.broadcast);
	try {
		await sql`
        insert into conversations (id, kind, title, description, image_url, created_by, is_broadcast)
        values (${id}, 'group', ${title}, ${(data.description ?? "").slice(0, 200)}, ${data.imageUrl ?? null}, ${context.userId}, ${broadcast})
      `;
	} catch {
		await sql`
        insert into conversations (id, kind, title, description, image_url, created_by)
        values (${id}, 'group', ${title}, ${(data.description ?? "").slice(0, 200)}, ${data.imageUrl ?? null}, ${context.userId})
      `;
	}
	await sql`insert into conversation_members (conversation_id, user_id, role) values (${id}, ${context.userId}, 'owner')`;
	if (broadcast && data.username) {
		const issue = validateUsername(data.username);
		if (issue) throw new Error(usernameError(issue));
		const uname = normalizeUsername(data.username);
		const takenUser = await sql`select count(*)::int as n from profiles where username_lc = ${uname}`;
		const takenChan = await sql`select count(*)::int as n from conversations where username_lc = ${uname} and id <> ${id}`;
		if ((takenUser[0]?.n ?? 0) > 0 || (takenChan[0]?.n ?? 0) > 0) throw new Error(usernameError("taken"));
		await sql`update conversations set username_lc = ${uname} where id = ${id}`.catch(() => undefined);
	}
	for (const u of data.usernames.slice(0, 48)) {
		const p = await getProfileByUsername(sql, u);
		if (!p || p.user_id === context.userId) continue;
		await sql`
        insert into conversation_members (conversation_id, user_id, role)
        values (${id}, ${p.user_id}, 'member') on conflict do nothing
      `;
		await notify(sql, {
			userId: p.user_id,
			kind: "group",
			body: broadcast ? `${me.display_name} added you to ${title}` : `${me.display_name} added you to ${title}`,
			actorId: me.user_id,
			entityId: id,
			prefKey: "messages"
		});
	}
	const intro = broadcast ? `created the channel “${title}”` : `created the group “${title}”`;
	await sql`
      insert into messages (id, conversation_id, sender_id, kind, body)
      values (${newId("m")}, ${id}, ${context.userId}, 'text', ${intro})
    `;
	await sql`update conversations set last_message_at = now(), last_message_body = ${broadcast ? "Channel created" : "Group created"} where id = ${id}`;
	return { id };
});
export const sendMessage = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	try {
		const sql = await sqlClient();
		const me = await ensureProfile(sql, { id: context.userId });
		assertCapability(me, "message");
		const wait = takeToken(`msg:${context.userId}`, 40, 60000);
		if (wait) throw new Error(rateError(wait));
		await flushDueScheduled(sql).catch(() => 0);
		const membersPeek = await sql`
      select user_id from conversation_members where conversation_id = ${data.conversationId}
    `;
		const { OMNI_SUPPORT_USER_ID, canMessageOmniSupport, handleSupportCommand, insertSupportMessage, moderateContent } = await import("./omni-support");
		const talkingToSupport = membersPeek.some((m) => m.user_id === OMNI_SUPPORT_USER_ID);
		const body = (data.body ?? "").trim().slice(0, 4000);
		const kind = data.kind ?? "text";
		let extra = await prepareOutgoingExtras(sql, {
			userId: context.userId,
			conversationId: data.conversationId,
			kind,
			extra: data.extra ?? (data.noPreview ? { noPreview: true } : null)
		});
		if (kind === "sticker" && extra?.sticker) {
			const def = findSticker(extra.sticker.packId, extra.sticker.stickerId) ?? (await import("../stickers")).findStickerById(extra.sticker.stickerId);
			if (def) {
				extra.sticker = { packId: def.packId, stickerId: def.id, emoji: def.emoji, name: def.name, mediaKind: def.animated ? "svg" : "svg" };
				if (data.mediaUrl && /image\/svg/i.test(String(data.mediaUrl).slice(0, 80))) data.mediaUrl = null;
				await sql`
          insert into sticker_recent (user_id, sticker_id, used_at)
          values (${context.userId}, ${extra.sticker.stickerId}, now())
          on conflict (user_id, sticker_id) do update set used_at = now()
        `.catch(() => undefined);
			} else {
				const row = await sql<{ id: string; pack_id: string; name: string; media_url: string | null; is_removed: boolean; media_kind: string }>`
          select id, pack_id, name, media_url, coalesce(is_removed, false) as is_removed, coalesce(media_kind, 'image') as media_kind from stickers where id = ${extra.sticker.stickerId} limit 1
        `.catch(() => []);
				if (!row[0] || row[0].is_removed) throw new Error("Couldn't send that sticker.");
				extra.sticker = { packId: row[0].pack_id, stickerId: row[0].id, emoji: extra.sticker.emoji, name: row[0].name, mediaKind: row[0].media_kind };
				data.mediaUrl = row[0].media_url;
				await sql`
          insert into sticker_recent (user_id, sticker_id, used_at)
          values (${context.userId}, ${row[0].id}, now())
          on conflict (user_id, sticker_id) do update set used_at = now()
        `.catch(() => undefined);
			}
		}
		if (kind === "text" && body && !data.noPreview && !extra?.noPreview) extra = await enrichExtraWithPreview(extra, body);
		const scheduled = data.scheduleAt ? validateScheduleAt(data.scheduleAt) : null;
		if (scheduled) {
			const sid = newId("sm");
			await sql`
        insert into scheduled_messages (
          id, conversation_id, sender_id, kind, body, media_url, reply_to_id, duration_ms,
          extra_json, silent, album_id, client_id, topic_id, send_at, status
        ) values (
          ${sid}, ${data.conversationId}, ${context.userId}, ${kind}, ${body}, ${data.mediaUrl ?? null},
          ${data.replyToId ?? null}, ${data.durationMs ?? null}, ${extra ? JSON.stringify(extra) : null}::jsonb,
          ${Boolean(data.silent)}, ${data.albumId ?? null}, ${data.clientId ?? null}, ${data.topicId ?? null},
          ${scheduled.toISOString()}, 'pending'
        )
      `;
			return {
				id: sid,
				scheduled: true,
				sendAt: scheduled.toISOString()
			};
		}
		const mineMember = membersPeek.some((m) => m.user_id === context.userId);
		const { isArcFlag } = await import("../types");
		if (talkingToSupport && isArcFlag(me) && !mineMember) {
			const { ensureOmniSupportUser } = await import("./omni-support");
			const support = await ensureOmniSupportUser(sql);
			extra = { ...(extra ?? {}), supportAgentId: me.user_id, supportAgentName: me.display_name };
			const sent = await deliverOutgoing(sql, {
				conversationId: data.conversationId,
				senderId: OMNI_SUPPORT_USER_ID,
				senderName: support.display_name || "NYX Support",
				kind,
				body,
				mediaUrl: data.mediaUrl,
				replyToId: data.replyToId,
				durationMs: data.durationMs,
				forwardedFromId: data.forwardedFromId,
				forwardedLabel: data.forwardedLabel,
				viewOnce: data.viewOnce,
				silent: data.silent,
				clientId: data.clientId,
				albumId: data.albumId,
				extra,
				topicId: data.topicId
			});
			return { id: sent.id, scheduled: false };
		}
		const id = (await deliverOutgoing(sql, {
			conversationId: data.conversationId,
			senderId: context.userId,
			senderName: me.display_name,
			kind,
			body,
			mediaUrl: data.mediaUrl,
			replyToId: data.replyToId,
			durationMs: data.durationMs,
			forwardedFromId: data.forwardedFromId,
			forwardedLabel: data.forwardedLabel,
			viewOnce: data.viewOnce,
			silent: data.silent,
			clientId: data.clientId,
			albumId: data.albumId,
			extra,
			topicId: data.topicId
		})).id;
		if (kind === "poll" && extra?.poll?.id) await sql`update chat_polls set message_id = ${id} where id = ${extra.poll.id}`.catch(() => undefined);
		if (kind === "location" && extra?.location?.liveUntil) await sql`
        insert into live_locations (message_id, conversation_id, user_id, lat, lng, accuracy, live_until)
        values (
          ${id}, ${data.conversationId}, ${context.userId}, ${extra.location.lat}, ${extra.location.lng},
          ${extra.location.accuracy ?? null}, ${extra.location.liveUntil}
        )
        on conflict (message_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now()
      `.catch(() => undefined);
		if (talkingToSupport && canMessageOmniSupport(me) && body) {
			const reply = await handleSupportCommand(sql, body);
			await insertSupportMessage(sql, data.conversationId, reply);
		} else if (talkingToSupport) {
			const { notifySupportAdmins } = await import("./omni-support");
			await notifySupportAdmins(sql, {
				conversationId: data.conversationId,
				fromUserId: context.userId,
				preview: body || (kind === "image" ? "Photo" : kind === "video" ? "Video" : kind === "file" ? "Document" : "Attachment"),
			}).catch(() => undefined);
		} else if (body) await moderateContent(sql, {
			actorId: context.userId,
			targetKind: "user",
			targetId: id,
			text: body,
			username: me.username
		}).catch(() => {});
		if (mentionsOmniAI(body)) {
			const recent = await sql`
        select body, sender_id from messages
        where conversation_id = ${data.conversationId} and deleted_at is null
        order by created_at desc limit 8
      `;
			const members = await sql`
        select user_id, muted from conversation_members where conversation_id = ${data.conversationId}
      `;
			const reply = await omniMentionReply({
				sql,
				actorId: context.userId,
				text: body,
				history: recent.slice().reverse().map((r) => ({
					role: r.sender_id === "omni_ai_system" ? "assistant" : "user",
					content: r.body
				}))
			});
			if (reply) {
				await insertOmniChatReply(sql, data.conversationId, id, reply);
				for (const m of members) {
					if (m.user_id === context.userId) continue;
					if (m.muted) continue;
					await notify(sql, {
						userId: m.user_id,
						kind: "message",
						body: `NYXAI: ${reply.slice(0, 80)}`,
						actorId: context.userId,
						entityId: data.conversationId,
						prefKey: "messages"
					});
				}
			}
		}
		return {
			id,
			scheduled: false
		};
	} catch (e) {
		throw publicError(e, "Couldn't send that message. Please try again.");
	}
});
export const listMessages = createServerFn({ method: "GET" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }): Promise<ChatThread> => {
	try {
		const sql = await sqlClient();
		await assertMember(sql, data.conversationId, context.userId);
		await touchPresence(sql, context.userId).catch(() => undefined);
		await flushDueScheduled(sql).catch(() => 0);
		const convo = (await sql`
      select id, kind, title, image_url, is_broadcast, forum_enabled, username_lc, linked_discussion_id from conversations where id = ${data.conversationId} limit 1
    `.catch(async () => {
			return (await sql`
        select id, kind, title, image_url, is_broadcast, forum_enabled from conversations where id = ${data.conversationId} limit 1
      `.catch(async () => {
				return (await sql`
          select id, kind, title, image_url from conversations where id = ${data.conversationId} limit 1
        `).map((r) => ({
					...r,
					is_broadcast: false,
					forum_enabled: false
				}));
			})).map((r) => ({
				...r,
				username_lc: null,
				linked_discussion_id: null
			}));
		}))[0];
		if (!convo) throw new Error("Couldn't open this conversation. Please try again.");
		const memberRows = await sql`
      select user_id, role, last_read_at, restricted, banned_at from conversation_members where conversation_id = ${data.conversationId}
    `.catch(async () => {
			return (await sql`
        select user_id, role, last_read_at from conversation_members where conversation_id = ${data.conversationId}
      `).map((m) => ({
				...m,
				restricted: false,
				banned_at: null
			}));
		});
		let rows;
		const topicId = data.topicId && data.topicId.startsWith("tp_") ? data.topicId : null;
		try {
			rows = await sql.query(data.before ? `select id, sender_id, kind, body, media_url, reply_to_id, created_at, edited_at, deleted_at,
                    duration_ms, forwarded_from_id, forwarded_label, view_once, opened_at,
                    view_once_state, view_once_revoked_at, expires_at, extra_json, silent, album_id
             from messages
             where conversation_id = $1 and created_at < $2
               and (expires_at is null or expires_at > now())
               and ($4::text is null or topic_id = $4)
               and not exists (
                 select 1 from message_hides h where h.message_id = messages.id and h.user_id = $3
               )
             order by created_at desc limit 50` : `select id, sender_id, kind, body, media_url, reply_to_id, created_at, edited_at, deleted_at,
                    duration_ms, forwarded_from_id, forwarded_label, view_once, opened_at,
                    view_once_state, view_once_revoked_at, expires_at, extra_json, silent, album_id
             from messages
             where conversation_id = $1
               and (expires_at is null or expires_at > now())
               and ($3::text is null or topic_id = $3)
               and not exists (
                 select 1 from message_hides h where h.message_id = messages.id and h.user_id = $2
               )
             order by created_at desc limit 50`, data.before ? [
				data.conversationId,
				data.before,
				context.userId,
				topicId
			] : [
				data.conversationId,
				context.userId,
				topicId
			]);
		} catch {
			rows = await sql.query(data.before ? `select id, sender_id, kind, body, media_url, reply_to_id, created_at, edited_at, deleted_at,
                    duration_ms, forwarded_from_id, forwarded_label, view_once, opened_at,
                    view_once_state, view_once_revoked_at, expires_at
             from messages
             where conversation_id = $1 and created_at < $2
               and (expires_at is null or expires_at > now())
               and not exists (
                 select 1 from message_hides h where h.message_id = messages.id and h.user_id = $3
               )
             order by created_at desc limit 50` : `select id, sender_id, kind, body, media_url, reply_to_id, created_at, edited_at, deleted_at,
                    duration_ms, forwarded_from_id, forwarded_label, view_once, opened_at,
                    view_once_state, view_once_revoked_at, expires_at
             from messages
             where conversation_id = $1
               and (expires_at is null or expires_at > now())
               and not exists (
                 select 1 from message_hides h where h.message_id = messages.id and h.user_id = $2
               )
             order by created_at desc limit 50`, data.before ? [
				data.conversationId,
				data.before,
				context.userId
			] : [data.conversationId, context.userId]);
		}
		const ids = rows.map((r) => r.id);
		const reactions = ids.length ? await sql.query(`select message_id, emoji, count(*)::int as n,
                  count(*) filter (where user_id = $1)::int as mine
           from message_reactions
           where message_id in (${ids.map((_, i) => `$${i + 2}`).join(",")})
           group by message_id, emoji`, [context.userId, ...ids]) : [];
		const byMsg =  new Map();
		for (const r of reactions) {
			const arr = byMsg.get(r.message_id) ?? [];
			arr.push({
				emoji: r.emoji,
				count: r.n,
				mine: r.mine > 0
			});
			byMsg.set(r.message_id, arr);
		}
		let starred = [];
		if (ids.length) try {
			starred = await sql.query(`select message_id from message_stars
           where user_id = $1 and message_id in (${ids.map((_, i) => `$${i + 2}`).join(",")})`, [context.userId, ...ids]);
		} catch {
			starred = [];
		}
		const starSet = new Set(starred.map((s) => s.message_id));
		let openSet =  new Set();
		if (ids.length) try {
			const opens = await sql.query(`select message_id from view_once_opens
           where user_id = $1 and message_id in (${ids.map((_, i) => `$${i + 2}`).join(",")})`, [context.userId, ...ids]);
			openSet = new Set(opens.map((o) => o.message_id));
		} catch {
			openSet =  new Set();
		}
		const me = await getProfile(sql, context.userId);
		const typing = await sql`
      select user_id from typing_state
      where conversation_id = ${data.conversationId}
        and user_id <> ${context.userId}
        and expires_at > now()
    `;
		const recording = await sql`
      select user_id from recording_state
      where conversation_id = ${data.conversationId}
        and user_id <> ${context.userId}
        and expires_at > now()
    `.catch(() => []);
		const authors = await loadAuthors(sql, [
			...memberRows.map((m) => m.user_id),
			...rows.map((r) => r.sender_id),
			...typing.map((t) => t.user_id),
			...recording.map((t) => t.user_id)
		]);
		const others = memberRows.filter((m) => m.user_id !== context.userId);
		const items = rows.slice().reverse().map((r) => {
			const viewOnce = Boolean(r.view_once);
			const mine = r.sender_id === context.userId;
			const storedForViewer = !viewOnce ? r.view_once_state : mine ? r.view_once_state : r.view_once_state === "CONSUMED" || r.view_once_state === "EXPIRED" || r.view_once_state === "REVOKED" ? r.view_once_state : openSet.has(r.id) ? r.view_once_state === "UNOPENED" ? "OPENED" : r.view_once_state : r.view_once_state === "OPENED" || r.view_once_state === "OPENING" ? "UNOPENED" : r.view_once_state;
			const state = deriveViewOnceState({
				viewOnce,
				openedAt: mine ? r.opened_at : openSet.has(r.id) ? r.created_at : null,
				revokedAt: r.view_once_revoked_at,
				createdAt: r.created_at,
				stored: storedForViewer
			});
			const opened = state === "OPENED" || state === "OPENING" || state === "CONSUMED" || mine && Boolean(r.opened_at);
			const mediaUrl = viewOnce || r.deleted_at ? null : r.media_url;
			return {
				id: r.id,
				senderId: r.sender_id,
				senderName: authors.get(r.sender_id)?.display_name ?? "Someone",
				kind: r.kind,
				body: r.deleted_at ? "Message deleted" : viewOnce && mine ? senderViewOnceCopy(state) : viewOnce && state ? recipientViewOnceCopy(state) : r.body,
				mediaUrl,
				replyToId: r.reply_to_id,
				createdAt: r.created_at,
				editedAt: r.edited_at,
				deleted: Boolean(r.deleted_at),
				reactions: byMsg.get(r.id) ?? [],
				delivered: true,
				forwarded: Boolean(r.forwarded_from_id || r.forwarded_label),
				forwardedFrom: r.forwarded_label,
				durationMs: r.duration_ms,
				viewOnce,
				viewOnceState: state,
				opened,
				starred: starSet.has(r.id),
				read: r.sender_id === context.userId && (me?.read_receipts ?? true) && others.length > 0 && others.every((o) => o.last_read_at && new Date(o.last_read_at) >= new Date(r.created_at)),
				expiresAt: r.expires_at ?? null,
				extra: parseExtra(r.extra_json),
				silent: Boolean(r.silent),
				albumId: r.album_id
			};
		});
		try {
			await sql`
        update conversation_members set last_read_at = now(), marked_unread = false
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `;
		} catch {
			await sql`
        update conversation_members set last_read_at = now()
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `;
		}
		await sql`
      insert into support_reads (conversation_id, admin_id, last_read_at)
      values (${data.conversationId}, ${context.userId}, now())
      on conflict (conversation_id, admin_id) do update set last_read_at = now()
    `.catch(() => undefined);
		try {
			const { clearRemindersForConversation, expireChatMessages } = await import("./chat-custom");
			await expireChatMessages(sql);
			await clearRemindersForConversation(sql, data.conversationId, context.userId);
		} catch {}
		const mineRow = memberRows.find((m) => m.user_id === context.userId);
		const mineStaff = mineRow?.role === "owner" || mineRow?.role === "admin";
		const members = memberRows.filter((m) => {
			if (!m.banned_at) return true;
			return mineStaff;
		}).map((m) => {
			const p = authors.get(m.user_id);
			return {
				...p ? authorLite(p) : {
					userId: m.user_id,
					username: "",
					displayName: "Member",
					avatarUrl: null,
					verifyKind: "none",
					isArc: false,
					isPremium: false
				},
				role: m.role,
				restricted: Boolean(m.restricted),
				banned: Boolean(m.banned_at)
			};
		});
		const mine = mineRow;
		let title = convo.title ?? "Chat";
		let imageUrl = convo.image_url;
		const isSupportConvo = memberRows.some((m) => m.user_id === OMNI_SUPPORT_USER_ID);
		const supportStaff = Boolean(isSupportConvo && isArcFlag(me) && !mineRow);
		if (convo.kind === "dm") {
			const o = supportStaff
				? members.find((m) => m.userId !== OMNI_SUPPORT_USER_ID)
				: members.find((m) => m.userId !== context.userId);
			if (o) {
				title = o.displayName;
				imageUrl = o.avatarUrl;
			}
		}
		const pinnedRows = await sql`
      select m.id, m.body, m.kind, m.sender_id
      from pinned_messages p
      join messages m on m.id = p.message_id
      where p.conversation_id = ${data.conversationId} and m.deleted_at is null
      order by m.created_at desc
      limit 5
    `.catch(() => []);
		const draftRow = await sql`
      select body from conversation_drafts
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `.catch(() => []);
		const muteRow = await sql`
      select mute_until from conversation_members
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `.catch(() => []);
		const pinnedIds = new Set(pinnedRows.map((p) => p.id));
		for (const item of items) item.pinned = pinnedIds.has(item.id);
		return {
			conversation: {
				id: convo.id,
				kind: convo.kind,
				title,
				imageUrl,
				myRole: mine?.role ?? "member",
				members,
				isBroadcast: Boolean(convo.is_broadcast),
				forumEnabled: Boolean(convo.forum_enabled),
				username: convo.username_lc ?? null,
				linkedDiscussionId: convo.linked_discussion_id ?? null,
				supportStaff,
			},
			items,
			typing: typing.map((t) => authors.get(t.user_id)?.display_name ?? "Someone"),
			recording: recording.map((t) => authors.get(t.user_id)?.display_name ?? "Someone"),
			members: members.map((m) => ({
				userId: m.userId,
				username: m.username,
				displayName: m.displayName,
				avatarUrl: m.avatarUrl,
				verifyKind: m.verifyKind,
				isArc: m.isArc,
				isPremium: m.isPremium
			})),
			hasMore: rows.length === 50,
			draft: draftRow[0]?.body ?? "",
			pinned: pinnedRows.map((p) => ({
				id: p.id,
				body: p.body,
				kind: p.kind,
				senderName: authors.get(p.sender_id)?.display_name ?? "Someone"
			})),
			muteUntil: muteRow[0]?.mute_until ?? null
		};
	} catch (e) {
		throw publicError(e, "Couldn't open this conversation. Please try again.");
	}
});
export const openViewOnce = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }): Promise<{ mediaUrl: string | null; kind: string; opened: boolean; state: string }> => {
	const sql = await sqlClient();
	if (!isResourceId(data.id, "m")) throw new Error("Message not found.");
	const row = await sql`
      select id, conversation_id, sender_id, media_url, kind, view_once, opened_at, deleted_at, created_at,
             view_once_state, view_once_revoked_at
      from messages where id = ${data.id}
    `;
	if (!row[0] || row[0].deleted_at) throw new Error("Message not found.");
	await assertMember(sql, row[0].conversation_id, context.userId);
	const mine = row[0].sender_id === context.userId;
	let myOpen = [];
	try {
		myOpen = await sql`
        select opened_at from view_once_opens where message_id = ${data.id} and user_id = ${context.userId}
      `;
	} catch {
		myOpen = [];
	}
	const state = deriveViewOnceState({
		viewOnce: row[0].view_once,
		openedAt: mine ? row[0].opened_at : myOpen[0]?.opened_at ?? null,
		revokedAt: row[0].view_once_revoked_at,
		createdAt: row[0].created_at,
		stored: mine ? row[0].view_once_state : myOpen[0] ? row[0].view_once_state : row[0].view_once_state === "OPENED" || row[0].view_once_state === "OPENING" ? "UNOPENED" : row[0].view_once_state
	});
	if (state === "EXPIRED") {
		await sql`
        update messages
           set view_once_state = 'EXPIRED', media_url = null
         where id = ${data.id} and view_once = true
      `;
		throw new Error("This view-once message expired.");
	}
	const gate = canOpenViewOnce(state, mine);
	if (!gate.ok) throw new Error(gate.reason ?? "This isn’t a view-once message.");
	if (!row[0].media_url) throw new Error("This was already opened.");
	try {
		if (!(await sql`
        insert into view_once_opens (message_id, user_id)
        values (${data.id}, ${context.userId})
        on conflict do nothing
        returning message_id
      `)[0]) throw new Error("This was already opened.");
	} catch (e) {
		if (e instanceof Error && e.message === "This was already opened.") throw e;
		throw new Error("This was already opened.");
	}
	const mediaUrl = row[0].media_url;
	const recipients = (await sql`
      select user_id from conversation_members where conversation_id = ${row[0].conversation_id}
    `).filter((m) => m.user_id !== row[0].sender_id);
	const allOpened = ((await sql`
      select count(*)::int as n from view_once_opens where message_id = ${data.id}
    `)[0]?.n ?? 0) >= Math.max(1, recipients.length);
	await sql`
      update messages
         set opened_at = coalesce(opened_at, now()),
             view_once_state = ${allOpened ? "CONSUMED" : "OPENED"},
             media_url = ${allOpened ? null : mediaUrl}
       where id = ${data.id} and view_once = true
    `;
	return {
		mediaUrl,
		kind: row[0].kind,
		opened: true,
		state: allOpened ? "CONSUMED" : "OPENED"
	};
});
export const revokeViewOnce = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	if (!isResourceId(data.id, "m")) throw new Error("Message not found.");
	const row = await sql`
      select sender_id, conversation_id, view_once, view_once_state, opened_at, created_at, view_once_revoked_at
      from messages where id = ${data.id}
    `;
	if (!row[0]) throw new Error("Message not found.");
	if (row[0].sender_id !== context.userId) throw new Error("Only the sender can revoke this.");
	await assertMember(sql, row[0].conversation_id, context.userId);
	if (deriveViewOnceState({
		viewOnce: row[0].view_once,
		openedAt: row[0].opened_at,
		revokedAt: row[0].view_once_revoked_at,
		createdAt: row[0].created_at,
		stored: row[0].view_once_state
	}) !== "UNOPENED") throw new Error("Only unopened view-once media can be revoked.");
	await sql`
      update messages
         set view_once_state = 'REVOKED', view_once_revoked_at = now(), media_url = null
       where id = ${data.id} and view_once = true and view_once_revoked_at is null
    `;
	return {
		ok: true,
		state: "REVOKED"
	};
});
export const editMessage = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const body = data.body.trim().slice(0, 4000);
	if (!body) throw new Error("Message is empty.");
	if (!isResourceId(data.id, "m")) throw new Error("Message not found.");
	const row = await sql`
      select id, conversation_id, sender_id, deleted_at, body from messages where id = ${data.id}
    `;
	if (!row[0] || row[0].sender_id !== context.userId || row[0].deleted_at) throw new Error("You can only edit your own messages.");
	await assertMember(sql, row[0].conversation_id, context.userId);
	await sql`
      insert into message_edits (id, message_id, body)
      values (${newId("me")}, ${data.id}, ${row[0].body})
    `.catch(() => undefined);
	await sql`update messages set body = ${body}, edited_at = now() where id = ${data.id}`;
	if ((await sql`
      select id from messages
      where conversation_id = ${row[0].conversation_id} and deleted_at is null
      order by created_at desc limit 1
    `)[0]?.id === data.id) await sql`update conversations set last_message_body = ${body.slice(0, 80)} where id = ${row[0].conversation_id}`;
	return { ok: true };
});
export const deleteMessage = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	if (!isResourceId(data.id, "m")) throw new Error("Message not found.");
	const row = await sql`
      select id, sender_id, conversation_id from messages where id = ${data.id}
    `;
	if (!row[0]) throw new Error("Message not found.");
	await assertMember(sql, row[0].conversation_id, context.userId);
	if ((data.scope ?? "everyone") === "me") {
		await sql`
        insert into message_hides (message_id, user_id) values (${data.id}, ${context.userId})
        on conflict do nothing
      `;
		return { ok: true };
	}
	if (row[0].sender_id !== context.userId) throw new Error("Only the sender can delete this for everyone.");
	await sql`
      update messages set deleted_at = now(), body = '', media_url = null
      where id = ${data.id} and sender_id = ${context.userId}
    `;
	const last = await sql`
      select body, kind from messages
      where conversation_id = ${row[0].conversation_id} and deleted_at is null
      order by created_at desc limit 1
    `;
	await sql`update conversations set last_message_body = ${last[0] ? (last[0].body || last[0].kind).slice(0, 80) : "Message deleted"} where id = ${row[0].conversation_id}`;
	return { ok: true };
});
export const reactMessage = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	assertCapability(me, "react");
	if (!isResourceId(data.id, "m")) throw new Error("Message not found.");
	const host = await sql`
      select conversation_id from messages where id = ${data.id} and deleted_at is null
    `;
	if (!host[0]) throw new Error("Message not found.");
	await assertMember(sql, host[0].conversation_id, context.userId);
	const emoji = data.emoji.slice(0, 8);
	const existing = await sql`
      select emoji from message_reactions
      where message_id = ${data.id} and user_id = ${context.userId}
    `;
	await sql`delete from message_reactions where message_id = ${data.id} and user_id = ${context.userId}`;
	if (!existing[0] || existing[0].emoji !== emoji) await sql`insert into message_reactions (message_id, user_id, emoji) values (${data.id}, ${context.userId}, ${emoji})`;
	return { ok: true };
});
export const forwardMessage = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	assertCapability(me, "message");
	if (!isResourceId(data.id, "m")) throw new Error("That message is no longer available.");
	const src = await sql`select id, conversation_id, kind, body, media_url, duration_ms, deleted_at, sender_id, view_once, extra_json from messages where id = ${data.id}`;
	if (!src[0] || src[0].deleted_at) throw new Error("That message is no longer available.");
	if (src[0].view_once) throw new Error("View once media can’t be forwarded.");
	await assertMember(sql, src[0].conversation_id, context.userId);
	const author = await getProfile(sql, src[0].sender_id);
	const label = author ? `@${author.username}` : "Forwarded";
	const ids = [];
	for (const cid of data.conversationIds.slice(0, 8)) {
		await assertMember(sql, cid, context.userId);
		const id = newId("m");
		await sql`
        insert into messages (id, conversation_id, sender_id, kind, body, media_url, duration_ms, forwarded_from_id, forwarded_label, extra_json)
        values (
          ${id}, ${cid}, ${context.userId}, ${src[0].kind}, ${src[0].body}, ${src[0].media_url},
          ${src[0].duration_ms}, ${src[0].id}, ${label}, ${src[0].extra_json ? JSON.stringify(src[0].extra_json) : null}::jsonb
        )
      `.catch(async () => {
			await sql`
          insert into messages (id, conversation_id, sender_id, kind, body, media_url, duration_ms, forwarded_from_id, forwarded_label)
          values (
            ${id}, ${cid}, ${context.userId}, ${src[0].kind}, ${src[0].body}, ${src[0].media_url},
            ${src[0].duration_ms}, ${src[0].id}, ${label}
          )
        `;
		});
		const preview = `Forwarded: ${(src[0].body || src[0].kind).slice(0, 60)}`;
		await sql`update conversations set last_message_at = now(), last_message_body = ${preview} where id = ${cid}`;
		const members = await sql`
        select user_id from conversation_members where conversation_id = ${cid}
      `;
		for (const m of members) {
			if (m.user_id === context.userId) continue;
			await notify(sql, {
				userId: m.user_id,
				kind: "message",
				body: `${me.display_name}: ${preview}`,
				actorId: me.user_id,
				entityId: cid,
				prefKey: "messages"
			});
		}
		ids.push(id);
	}
	return { ids };
});
export const setTyping = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await assertMember(sql, data.conversationId, context.userId);
	if (takeToken(`type:${context.userId}`, 40, 1e4)) return { ok: true };
	await sql`
      insert into typing_state (conversation_id, user_id, expires_at)
      values (${data.conversationId}, ${context.userId}, now() + interval '6 seconds')
      on conflict (conversation_id, user_id) do update set expires_at = excluded.expires_at
    `;
	return { ok: true };
});
export const muteChat = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await sql`
      update conversation_members set muted = ${data.muted}, mute_until = ${data.muted ? null : null}
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `.catch(async () => {
		await sql`
        update conversation_members set muted = ${data.muted}
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `;
	});
	if (!data.muted) await sql`
        update conversation_members set mute_until = null
        where conversation_id = ${data.conversationId} and user_id = ${context.userId}
      `.catch(() => undefined);
	return { ok: true };
});
export const archiveChat = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	await (await sqlClient())`
      update conversation_members set archived = ${data.archived}
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
	return { ok: true };
});
export const pinChat = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await assertMember(sql, data.conversationId, context.userId);
	if (data.pinned) {
		if (((await sql`
        select count(*)::int as n from conversation_members
        where user_id = ${context.userId} and pinned = true
      `)[0]?.n ?? 0) >= 8) throw new Error("You can pin up to 8 chats.");
	}
	await sql`
      update conversation_members set pinned = ${data.pinned}
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
	return { ok: true };
});
export const favoriteChat = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await assertMember(sql, data.conversationId, context.userId);
	await sql`
      update conversation_members set favorite = ${data.favorite}
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
	return { ok: true };
});
export const markUnread = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await assertMember(sql, data.conversationId, context.userId);
	await sql`
      update conversation_members set marked_unread = true
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
	return { ok: true };
});
export const starMessage = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	if (!isResourceId(data.id, "m")) throw new Error("Message not found.");
	const row = await sql`
      select conversation_id from messages where id = ${data.id} and deleted_at is null
    `;
	if (!row[0]) throw new Error("Message not found.");
	await assertMember(sql, row[0].conversation_id, context.userId);
	if (((await sql`
      select count(*)::int as n from message_stars where message_id = ${data.id} and user_id = ${context.userId}
    `)[0]?.n ?? 0) > 0) {
		await sql`delete from message_stars where message_id = ${data.id} and user_id = ${context.userId}`;
		return { starred: false };
	}
	await sql`
      insert into message_stars (message_id, user_id) values (${data.id}, ${context.userId})
      on conflict do nothing
    `;
	return { starred: true };
});
export const listStarredMessages = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }): Promise<{ id: string; conversation_id: string; body: string; kind: string; created_at: string; title: string | null }[]> => {
	return await (await sqlClient())`
      select m.id, m.conversation_id, m.body, m.kind, m.created_at, c.title
      from message_stars s
      join messages m on m.id = s.message_id
      join conversations c on c.id = m.conversation_id
      join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${context.userId}
      where s.user_id = ${context.userId} and m.deleted_at is null
      order by s.created_at desc
      limit 50
    `;
});
export const inboxSearch = createServerFn({ method: "GET" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }): Promise<{ messages: { id: string; conversationId: string; body: string; createdAt: string; title: string }[] }> => {
	const sql = await sqlClient();
	const q = data.q.trim().slice(0, 80);
	if (q.length < 2) return { messages: [] };
	const like = `%${q}%`;
	const rows = await sql`
      select m.id, m.conversation_id, m.body, m.created_at, c.title, c.kind
      from messages m
      join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${context.userId}
      join conversations c on c.id = m.conversation_id
      where m.deleted_at is null and m.body ilike ${like} and coalesce(m.view_once, false) = false
      order by m.created_at desc
      limit 20
    `;
	const dmIds = [...new Set(rows.filter((r) => r.kind === "dm").map((r) => r.conversation_id))];
	const names =  new Map();
	if (dmIds.length > 0) {
		const others = await sql.query(`select cm.conversation_id, p.display_name
         from conversation_members cm
         join profiles p on p.user_id = cm.user_id
         where cm.user_id <> $1
           and cm.conversation_id in (${dmIds.map((_, i) => `$${i + 2}`).join(",")})`, [context.userId, ...dmIds]);
		for (const o of others) names.set(o.conversation_id, o.display_name);
	}
	return { messages: rows.map((r) => ({
		id: r.id,
		conversationId: r.conversation_id,
		body: r.body,
		createdAt: r.created_at,
		title: r.kind === "dm" ? names.get(r.conversation_id) ?? "Chat" : r.title ?? "Group"
	})) };
});
export const listInboxLists = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(async ({ context }): Promise<{ id: string; title: string; conversationIds: string[] }[]> => {
	const sql = await sqlClient();
	const lists = await sql`
      select id, title from inbox_lists where user_id = ${context.userId} order by created_at
    `;
	const chats = lists.length ? await sql.query(`select list_id, conversation_id from inbox_list_chats
           where list_id in (${lists.map((_, i) => `$${i + 1}`).join(",")})`, lists.map((l) => l.id)) : [];
	const by =  new Map();
	for (const c of chats) {
		const arr = by.get(c.list_id) ?? [];
		arr.push(c.conversation_id);
		by.set(c.list_id, arr);
	}
	return lists.map((l) => ({
		id: l.id,
		title: l.title,
		conversationIds: by.get(l.id) ?? []
	}));
});
export const saveInboxList = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const title = data.title.trim().slice(0, 32);
	if (title.length < 1) throw new Error("Give the list a name.");
	const id = data.id ?? newId("il");
	await sql`
      insert into inbox_lists (id, user_id, title) values (${id}, ${context.userId}, ${title})
      on conflict (id) do update set title = excluded.title
    `;
	if (!(await sql`
      select id from inbox_lists where id = ${id} and user_id = ${context.userId}
    `)[0]) throw new Error("List not found.");
	await sql`delete from inbox_list_chats where list_id = ${id}`;
	for (const cid of data.conversationIds.slice(0, 40)) {
		await assertMember(sql, cid, context.userId);
		await sql`
        insert into inbox_list_chats (list_id, conversation_id) values (${id}, ${cid})
        on conflict do nothing
      `;
	}
	return { id };
});
export const deleteInboxList = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	await (await sqlClient())`delete from inbox_lists where id = ${data.id} and user_id = ${context.userId}`;
	return { ok: true };
});
export const leaveChat = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	await (await sqlClient())`
      delete from conversation_members
      where conversation_id = ${data.conversationId} and user_id = ${context.userId}
    `;
	return { ok: true };
});
async function staffRole(sql, conversationId, userId) {
	const role = (await sql`
    select role from conversation_members
    where conversation_id = ${conversationId} and user_id = ${userId}
  `)[0]?.role;
	if (!role) throw new Error("Chat not found.");
	return role;
}
function assertStaff(role) {
	if (role !== "owner" && role !== "admin") throw new Error("Only owners and admins can do that.");
}
export const renameGroup = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	assertStaff(await staffRole(sql, data.conversationId, context.userId));
	const title = data.title.trim().slice(0, 60);
	if (title.length < 2) throw new Error("Give the group a name.");
	if ((await sql`select kind from conversations where id = ${data.conversationId}`)[0]?.kind !== "group") throw new Error("Only groups can be renamed.");
	await sql`update conversations set title = ${title} where id = ${data.conversationId}`;
	return {
		ok: true,
		title
	};
});
export const addGroupMembers = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const me = await ensureProfile(sql, { id: context.userId });
	assertStaff(await staffRole(sql, data.conversationId, context.userId));
	const kind = await sql`
      select kind, title from conversations where id = ${data.conversationId}
    `;
	if (kind[0]?.kind !== "group") throw new Error("Not a group.");
	let added = 0;
	for (const u of data.usernames.slice(0, 24)) {
		const p = await getProfileByUsername(sql, u);
		if (!p || p.user_id === context.userId || p.is_banned) continue;
		await sql`
        insert into conversation_members (conversation_id, user_id, role)
        values (${data.conversationId}, ${p.user_id}, 'member') on conflict do nothing
      `;
		await notify(sql, {
			userId: p.user_id,
			kind: "group",
			body: `${me.display_name} added you to ${kind[0]?.title ?? "a group"}`,
			actorId: me.user_id,
			entityId: data.conversationId,
			prefKey: "messages"
		});
		added += 1;
	}
	return {
		ok: true,
		added
	};
});
export const removeGroupMember = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const myRole = await staffRole(sql, data.conversationId, context.userId);
	assertStaff(myRole);
	const p = await getProfileByUsername(sql, data.username);
	if (!p) throw new Error("User not found.");
	if (p.user_id === context.userId) throw new Error("Leave the group instead of removing yourself.");
	const theirs = await staffRole(sql, data.conversationId, p.user_id);
	if (theirs === "owner") throw new Error("You can’t remove the owner.");
	if (theirs === "admin" && myRole !== "owner") throw new Error("Only the owner can remove an admin.");
	await sql`
      delete from conversation_members
      where conversation_id = ${data.conversationId} and user_id = ${p.user_id}
    `;
	return { ok: true };
});
export const setGroupRole = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	if (await staffRole(sql, data.conversationId, context.userId) !== "owner") throw new Error("Only the owner can change roles.");
	const p = await getProfileByUsername(sql, data.username);
	if (!p) throw new Error("User not found.");
	if (p.user_id === context.userId) throw new Error("You are already the owner.");
	await sql`
      update conversation_members set role = ${data.role}
      where conversation_id = ${data.conversationId} and user_id = ${p.user_id}
    `;
	return { ok: true };
});
export const searchMessages = createServerFn({ method: "GET" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await assertMember(sql, data.conversationId, context.userId);
	const q = `%${data.q.trim().slice(0, 80)}%`;
	if (data.q.trim().length < 2 && !data.kind) return [];
	const kind = data.kind && data.kind !== "all" ? data.kind : null;
	if (kind) return sql`
        select id, body, created_at, kind from messages
        where conversation_id = ${data.conversationId}
          and deleted_at is null
          and kind = ${kind}
          and (${data.q.trim().length < 2} or body ilike ${q})
        order by created_at desc limit 30
      `;
	return sql`
      select id, body, created_at, kind from messages
      where conversation_id = ${data.conversationId} and deleted_at is null and body ilike ${q}
      order by created_at desc limit 30
    `;
});
export const freezeStreak = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	const other = await getProfileByUsername(sql, data.username);
	if (!other) throw new Error("User not found.");
	const [ua, ub] = friendPair(context.userId, other.user_id);
	const month = (new Date()).toISOString().slice(0, 7);
	if ((await sql`
      select freeze_month from streaks where user_a = ${ua} and user_b = ${ub}
    `)[0]?.freeze_month === month) throw new Error("You already used a streak freeze this month.");
	await sql`
      update streaks set freeze_until = now() + interval '24 hours', freeze_month = ${month}
      where user_a = ${ua} and user_b = ${ub}
    `;
	return { ok: true };
});
export const listConversationMedia = createServerFn({ method: "GET" }).validator((d: {
	conversationId: string;
	kind?: "image" | "video" | "file" | "link" | "media";
	cursor?: string | null;
	q?: string;
}) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	const sql = await sqlClient();
	await assertMember(sql, data.conversationId, context.userId);
	const { backfillConversationMedia } = await import("./media-index");
	await backfillConversationMedia(sql, data.conversationId).catch(() => undefined);
	const kind = data.kind ?? "media";
	const q = (data.q ?? "").trim().slice(0, 80);
	const like = q ? `%${q.replace(/[%_\\\\]/g, "")}%` : null;
	let kindSql = "kind in ('image','gif','sticker','video')";
	if (kind === "image") kindSql = "kind in ('image','gif','sticker')";
	else if (kind === "video") kindSql = "kind = 'video'";
	else if (kind === "file") kindSql = "kind in ('file','audio')";
	else if (kind === "link") {
		kindSql = `(kind = 'text' and (body ~* 'https?://' or coalesce(extra_json::text, '') ilike '%http%'))`;
	}
	const params: unknown[] = [data.conversationId, context.userId, data.cursor ?? null];
	let searchSql = "";
	if (like) {
		params.push(like);
		searchSql = "and (body ilike $4 or coalesce(extra_json::text, '') ilike $4)";
	}
	type MediaRow = {
		id: string;
		sender_id: string;
		kind: string;
		body: string;
		media_url: string | null;
		extra_json: unknown;
		created_at: string;
	};
	const rows = await sql.query<MediaRow>(
		`select id, sender_id, kind, body, media_url, extra_json, created_at
       from messages
       where conversation_id = $1
         and deleted_at is null
         and coalesce(view_once, false) = false
         and (expires_at is null or expires_at > now())
         and not exists (
           select 1 from message_hides h where h.message_id = messages.id and h.user_id = $2
         )
         and ${kindSql}
         and ($3::timestamptz is null or created_at < $3)
         ${searchSql}
       order by created_at desc
       limit 40`,
		params,
	).catch(async () =>
		sql.query<MediaRow>(
			`select id, sender_id, kind, body, media_url, extra_json, created_at
         from messages
         where conversation_id = $1
           and deleted_at is null
           and coalesce(view_once, false) = false
           and ${kindSql}
           and ($2::timestamptz is null or created_at < $2)
         order by created_at desc
         limit 40`,
			[data.conversationId, data.cursor ?? null],
		),
	);
	const authors = await loadAuthors(sql, rows.map((r) => r.sender_id));
	const items: Array<{
		id: string;
		messageId: string;
		kind: string;
		mediaUrl: string | null;
		thumbUrl: string | null;
		filename: string | null;
		mime: string | null;
		bytes: number | null;
		title: string | null;
		domain: string | null;
		createdAt: string;
		senderName: string;
		body: string;
	}> = [];
	for (const r of rows) {
		const extra = parseExtra(r.extra_json);
		const bucket = historyBucket(r.kind, r.body, extra);
		const senderName = authors.get(r.sender_id)?.display_name ?? "Someone";
		if (kind === "link" || bucket === "link") {
			const links = extractMessageLinks(r.body);
			if (extra?.linkPreview?.url && !links.some((l) => l.url === extra.linkPreview!.url)) {
				links.unshift({ url: extra.linkPreview.url, domain: extra.linkPreview.domain });
			}
			for (const link of links) {
				items.push({
					id: `${r.id}:${link.url}`,
					messageId: r.id,
					kind: "link",
					mediaUrl: link.url,
					thumbUrl: extra?.linkPreview?.imageUrl ?? null,
					filename: null,
					mime: null,
					bytes: null,
					title: extra?.linkPreview?.title || link.domain,
					domain: link.domain,
					createdAt: r.created_at,
					senderName,
					body: r.body,
				});
			}
			continue;
		}
		items.push({
			id: r.id,
			messageId: r.id,
			kind: bucket ?? r.kind,
			mediaUrl: r.media_url,
			thumbUrl: extra?.linkPreview?.imageUrl ?? null,
			filename: bucket === "file" ? r.body.slice(0, 180) : null,
			mime: null,
			bytes: null,
			title: r.body.slice(0, 180) || null,
			domain: extra?.linkPreview?.domain ?? null,
			createdAt: r.created_at,
			senderName,
			body: r.body,
		});
	}
	return {
		items,
		nextCursor: rows.length === 40 ? rows[rows.length - 1]!.created_at : null,
	};
});

export const setStreakIcon = createServerFn({ method: "POST" }).validator((d: any) => d).middleware([authMiddleware]).handler(async ({ context, data }) => {
	if (!(new Set(["flame","bolt","star","heart","spark"])).has(data.icon)) throw new Error("Pick a streak icon.");
	const sql = await sqlClient();
	const other = await getProfileByUsername(sql, data.username);
	if (!other) throw new Error("User not found.");
	const [ua, ub] = friendPair(context.userId, other.user_id);
	await sql`update streaks set icon = ${data.icon} where user_a = ${ua} and user_b = ${ub}`;
	return { ok: true };
});
