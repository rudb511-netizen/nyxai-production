import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { takeToken, rateError } from "@/lib/kchat/rate-limit";
import { omniCaps } from "@/lib/kchat/superomni";
import { speakXai } from "@/lib/kchat/xai";

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

  let body: { text?: string; voiceId?: string };
  try {
    body = (await request.json()) as { text?: string; voiceId?: string };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return new Response(JSON.stringify({ error: "Nothing to speak." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let ttsPerHour = omniCaps(false).ttsPerHour;
  try {
    const { sqlClient } = await import("@/lib/kchat/server/helpers");
    const { hasSuperOmni } = await import("@/lib/kchat/server/billing");
    const sql = await sqlClient();
    ttsPerHour = omniCaps(await hasSuperOmni(sql, userId)).ttsPerHour;
  } catch {
    /* stay on free cap */
  }
  const wait = takeToken(`omni-tts:${userId}`, ttsPerHour, 60 * 60 * 1000);
  if (wait) {
    return new Response(JSON.stringify({ error: rateError(wait) }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  const spoken = await speakXai(text, body.voiceId || "eve");
  if (!spoken.ok) {
    return new Response(JSON.stringify({ error: spoken.error, code: spoken.code }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(spoken.bytes, {
    headers: {
      "Content-Type": spoken.contentType,
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/omni-tts")({
  server: { handlers: { POST: handle } },
});
