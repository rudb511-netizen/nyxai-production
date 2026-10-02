import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const Route = createFileRoute("/api/nyx-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authz = request.headers.get("authorization") ?? "";
        const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : undefined;
        let userId = "";
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
        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: string, data: unknown) => {
              try {
                controller.enqueue(sse(event, data));
              } catch {
                /* closed */
              }
            };
            try {
              const { answerUser } = await import("@/lib/kchat/server/reply");
              let streamed = "";
              const spoken = await answerUser(content.slice(0, 8_000), [], (chunk) => {
                streamed += chunk;
                send("delta", { text: chunk });
              });
              const text = (spoken.text || streamed).trim();
              if (!text) {
                send("error", { error: "Empty reply." });
              } else {
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
                      insert into omni_usage (id, user_id, kind, model_id, tokens_in, tokens_out)
                      values (${newId("ou")}, ${userId}, 'chat', ${spoken.provider + "/" + spoken.model}, ${spoken.tokensIn}, ${spoken.tokensOut})
                    `;
                  } catch {
                    /* The spoken reply is still returned. */
                  }
                }
                send("done", { text, model: spoken.model, provider: spoken.provider });
              }
            } catch (error) {
              send("error", { error: error instanceof Error ? error.message : "NYXAI could not answer. Tap Retry." });
            } finally {
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
