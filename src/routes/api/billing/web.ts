import { createFileRoute } from "@tanstack/react-router";
import { sqlClient } from "@/lib/kchat/server/helpers";
import { handlePaystackWebhook, handleStripeWebhook } from "@/lib/kchat/server/web-checkout";

async function handle({ request }: { request: Request }) {
  const raw = await request.text();
  const sql = await sqlClient();
  const stripeSig = request.headers.get("stripe-signature");
  const paystackSig = request.headers.get("x-paystack-signature");
  if (stripeSig) {
    const result = await handleStripeWebhook(sql, raw, stripeSig);
    return Response.json({ ok: result.ok }, { status: result.status });
  }
  if (paystackSig) {
    const result = await handlePaystackWebhook(sql, raw, paystackSig);
    return Response.json({ ok: result.ok }, { status: result.status });
  }
  return Response.json({ error: "Missing provider signature." }, { status: 400 });
}

export const Route = createFileRoute("/api/billing/web")({
  server: { handlers: { POST: handle } },
});
