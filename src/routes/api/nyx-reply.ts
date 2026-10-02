import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";

export const Route = createFileRoute("/api/nyx-reply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authz = request.headers.get("authorization") ?? "";
        const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : undefined;
        let userId: string;
        try {
          userId = await requireUserId(bearer);
        } catch {
          return Response.json({ error: "Sign in to chat." }, { status: 401 });
        }
        let content = "";
        let threadId = "";
        try {
          const body = (await request.json()) as { content?: string; threadId?: string };
          content = typeof body.content === "string" ? body.content.trim() : "";
          threadId = typeof body.threadId === "string" ? body.threadId : "";
        } catch {
          return Response.json({ error: "Invalid request." }, { status: 400 });
        }
        if (!content) return Response.json({ error: "Type a message." }, { status: 400 });
        try {
          const { answerUser } = await import("@/lib/kchat/server/reply");
          const spoken = await answerUser(content.slice(0, 8_000), []);
          const text = spoken.text.trim();
          if (!text) return Response.json({ error: "Empty reply." }, { status: 502 });
          if (threadId) {
            try {
              const { sqlClient } = await import("@/lib/kchat/server/helpers");
              const { newId } = await import("@/lib/kchat/ids");
              const sql = await sqlClient();
              await sql`
                insert into kai_messages (id, thread_id, role, content, attachments_json)
                values (${newId("km")}, ${threadId}, 'user', ${content.slice(0, 8_000)}, '[]'::jsonb)
              `;
              await sql`
                insert into kai_messages (id, thread_id, role, content, model_id, citations_json)
                values (${newId("km")}, ${threadId}, 'assistant', ${text}, ${spoken.model}, '[]'::jsonb)
              `;
              await sql`
                update kai_threads
                set updated_at = now(),
                    title = case when title = 'New chat' then ${content.slice(0, 48)} else title end
                where id = ${threadId} and user_id = ${userId}
              `;
            } catch {
              /* Still return the answer if saving the turn fails. */
            }
          }
          return Response.json({ text, model: spoken.model });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Reply failed.";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
