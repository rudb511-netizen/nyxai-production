import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";

export const Route = createFileRoute("/api/ai/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authz = request.headers.get("authorization") ?? "";
        const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : undefined;
        try {
          await requireUserId(bearer);
        } catch {
          return Response.json({ error: "Sign in to chat." }, { status: 401 });
        }
        const { refreshProviderStatus, providerOrder } = await import("@/lib/kchat/server/ai-router");
        return Response.json({ providers: await refreshProviderStatus(), order: providerOrder() });
      },
    },
  },
});
