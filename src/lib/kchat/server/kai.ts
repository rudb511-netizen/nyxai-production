import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "../ids";
import type { KaiMessage, KaiThread } from "../types";
import { sqlClient } from "./helpers";
import { runFeedAssist, runOmniTurn } from "./omni";

export const listKaiThreads = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<KaiThread[]> => {
    const sql = await sqlClient();
    const rows = await sql<{ id: string; title: string; updated_at: string }>`
      select id, title, updated_at from kai_threads
      where user_id = ${context.userId}
      order by updated_at desc limit 40
    `;
    return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
  });

export const createKaiThread = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const id = newId("kai");
    await sql`
      insert into kai_threads (id, user_id, title) values (${id}, ${context.userId}, 'New chat')
    `;
    return { id };
  });

export const deleteKaiThread = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    await sql`delete from kai_threads where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listKaiMessages = createServerFn({ method: "GET" })
  .validator((d: { threadId: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<KaiMessage[]> => {
    const sql = await sqlClient();
    const owned = await sql<{ n: number }>`
      select count(*)::int as n from kai_threads where id = ${data.threadId} and user_id = ${context.userId}
    `;
    if ((owned[0]?.n ?? 0) === 0) throw new Error("Conversation not found.");
    const rows = await sql<{
      id: string;
      role: "user" | "assistant";
      content: string;
      created_at: string;
    }>`
      select id, role, content, created_at from kai_messages
      where thread_id = ${data.threadId} order by created_at
    `;
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
    }));
  });

export const sendKaiMessage = createServerFn({ method: "POST" })
  .validator((d: { threadId: string; content: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const reply = await runOmniTurn({
      userId: context.userId,
      threadId: data.threadId,
      content: data.content,
    });
    return { text: reply.text, prompts: reply.prompts };
  });

export const kaiHelpWrite = createServerFn({ method: "POST" })
  .validator((d: { kind: "post" | "caption" | "message" | "rewrite" | "translate"; text: string; extra?: string }) => d)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const r = await runFeedAssist(
      context.userId,
      data.kind === "message" ? "rewrite" : data.kind,
      data.text,
      data.extra,
    );
    return { ok: true as const, text: r.text };
  });
