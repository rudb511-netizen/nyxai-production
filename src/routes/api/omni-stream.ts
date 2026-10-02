import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import type { OmniAttachment } from "@/lib/kchat/omni-files";
import type { OmniMode } from "@/lib/kchat/omni-router";
import { runOmniTurn } from "@/lib/kchat/server/omni";
import { NYXAI_UNAVAILABLE } from "@/lib/kchat/xai";

type StreamBody = {
  threadId: string;
  content: string;
  attachments?: OmniAttachment[];
  mode?: OmniMode;
  modelId?: string;
  agent?: string | null;
  aspect?: string;
  style?: string;
  searchPref?: "auto" | "on" | "off";
};


function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function handle({ request }: { request: Request }) {
  const authz = request.headers.get("authorization") ?? "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : undefined;
  let userId: string;
  try {
    userId = await requireUserId(bearer);
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: StreamBody;
  try {
    body = (await request.json()) as StreamBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!body.threadId || typeof body.content !== "string") {
    return new Response(JSON.stringify({ error: "threadId and content are required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

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
        const result = await runOmniTurn({
          userId,
          threadId: body.threadId,
          content: body.content,
          attachments: body.attachments,
          mode: body.mode,
          modelId: body.modelId,
          agent: body.agent,
          aspect: body.aspect,
          style: body.style,
          searchPref: body.searchPref,
          onEvent: (e) => {
            if (e.type === "status") send("status", { text: e.text });
            if (e.type === "delta") send("delta", { text: e.text });
            if (e.type === "citation") send("citation", { citations: e.citations });
          },
        });
        send("done", result);
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : NYXAI_UNAVAILABLE });
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
}

export const Route = createFileRoute("/api/omni-stream")({
  server: { handlers: { POST: handle } },
});
