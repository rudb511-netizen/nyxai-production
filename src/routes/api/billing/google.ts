import { createFileRoute } from "@tanstack/react-router";
import { sqlClient } from "@/lib/kchat/server/helpers";
import { applyVerifiedEntitlement } from "@/lib/kchat/server/billing";
import { verifyGoogleWebhook } from "@/lib/kchat/server/store-verify";

async function handle({ request }: { request: Request }) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Malformed payload." }, { status: 400 });
  }
  const verified = await verifyGoogleWebhook(body);
  if (!verified.ok) {
    const status = verified.code === "malformed" ? 400 : verified.code === "ignore" ? 200 : 401;
    return Response.json({ error: verified.error, code: verified.code }, { status });
  }
  const sql = await sqlClient();
  const result = await applyVerifiedEntitlement(sql, verified.entitlement);
  return Response.json({ ok: true, applied: result.applied, duplicate: result.duplicate });
}

export const Route = createFileRoute("/api/billing/google")({
  server: { handlers: { POST: handle } },
});
