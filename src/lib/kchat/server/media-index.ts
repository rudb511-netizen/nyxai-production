import { newId } from "../ids";
import { hashUrl } from "../link-preview";
import { extractMessageLinks, mediaKindFromMessage } from "../media-pipeline";
import { parseExtra } from "../comms-extra";
import type { Sql } from "@/lib/db";

export async function indexMessageMedia(
  sql: Sql,
  opts: {
    messageId: string;
    conversationId: string;
    senderId: string;
    kind: string;
    body: string;
    mediaUrl?: string | null;
    filename?: string | null;
    mime?: string | null;
    bytes?: number | null;
    viewOnce?: boolean;
    extra?: unknown;
  },
): Promise<void> {
  if (opts.viewOnce) return;
  const kind = mediaKindFromMessage(opts.kind, opts.mime);
  if (kind && opts.mediaUrl) {
    const urlHash = hashUrl(opts.mediaUrl);
    const id = newId("mm");
    await sql`
      insert into message_media_index (
        id, message_id, conversation_id, sender_id, kind, media_url, filename, mime, bytes, title, url_hash
      ) values (
        ${id}, ${opts.messageId}, ${opts.conversationId}, ${opts.senderId}, ${kind},
        ${opts.mediaUrl}, ${opts.filename ?? (kind === "file" ? opts.body.slice(0, 180) : null)},
        ${opts.mime ?? null}, ${opts.bytes ?? null}, ${kind === "file" ? opts.body.slice(0, 180) : null}, ${urlHash}
      )
      on conflict (message_id, kind, url_hash) do nothing
    `.catch(async () => {
      await sql`
        insert into message_media_index (
          id, message_id, conversation_id, sender_id, kind, media_url, filename, mime, bytes, title
        ) values (
          ${id}, ${opts.messageId}, ${opts.conversationId}, ${opts.senderId}, ${kind},
          ${opts.mediaUrl}, ${opts.filename ?? (kind === "file" ? opts.body.slice(0, 180) : null)},
          ${opts.mime ?? null}, ${opts.bytes ?? null}, ${kind === "file" ? opts.body.slice(0, 180) : null}
        )
        on conflict do nothing
      `.catch(() => undefined);
    });
  }
  const extra = parseExtra(opts.extra);
  const links = extractMessageLinks(opts.body);
  if (extra?.linkPreview?.url && !links.some((l) => l.url === extra.linkPreview!.url)) {
    links.unshift({ url: extra.linkPreview.url, domain: extra.linkPreview.domain });
  }
  if (opts.kind === "text" || links.length) {
    for (const link of links) {
      const id = newId("mm");
      const urlHash = hashUrl(link.url);
      await sql`
        insert into message_media_index (
          id, message_id, conversation_id, sender_id, kind, media_url, title, domain, url_hash
        ) values (
          ${id}, ${opts.messageId}, ${opts.conversationId}, ${opts.senderId}, 'link',
          ${link.url}, ${link.domain}, ${link.domain}, ${urlHash}
        )
        on conflict (message_id, kind, url_hash) do nothing
      `.catch(() => undefined);
    }
  }
}

export async function backfillConversationMedia(sql: Sql, conversationId: string): Promise<void> {
  const rows = await sql<{
    id: string;
    sender_id: string;
    kind: string;
    body: string;
    media_url: string | null;
    extra_json: unknown;
    view_once: boolean | null;
  }>`
    select id, sender_id, kind, body, media_url, extra_json, view_once
    from messages
    where conversation_id = ${conversationId}
      and deleted_at is null
      and coalesce(view_once, false) = false
      and not exists (
        select 1 from message_media_index i where i.message_id = messages.id
      )
    order by created_at desc
    limit 400
  `.catch(async () =>
    sql<{
      id: string;
      sender_id: string;
      kind: string;
      body: string;
      media_url: string | null;
      extra_json: unknown;
      view_once: boolean | null;
    }>`
      select id, sender_id, kind, body, media_url, null as extra_json, view_once
      from messages
      where conversation_id = ${conversationId} and deleted_at is null
      order by created_at desc
      limit 400
    `.catch(() => []),
  );
  for (const r of rows) {
    await indexMessageMedia(sql, {
      messageId: r.id,
      conversationId,
      senderId: r.sender_id,
      kind: r.kind,
      body: r.body,
      mediaUrl: r.media_url,
      viewOnce: Boolean(r.view_once),
      extra: r.extra_json,
    }).catch(() => undefined);
  }
}
