import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";

export const Route = createFileRoute("/api/video/$taskId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const authz = request.headers.get("authorization") ?? "";
        const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : undefined;
        try {
          const userId = await requireUserId(bearer);
          const { sqlClient } = await import("@/lib/kchat/server/helpers");
          const sql = await sqlClient();
          const rows = await sql<{
            id: string;
            provider: string;
            model: string;
            prompt: string;
            status: string;
            output_url: string | null;
            error: string | null;
            created_at: string;
            completed_at: string | null;
          }>`
            select id, provider, model, prompt, status, output_url, error, created_at, completed_at
            from nyx_video_jobs where id = ${params.taskId} and user_id = ${userId}
          `;
          const job = rows[0];
          if (!job) return Response.json({ error: "Video not found." }, { status: 404 });
          return Response.json({
            id: job.id,
            provider: job.provider,
            model: job.model,
            prompt: job.prompt,
            status: job.status,
            outputUrl: job.output_url,
            error: job.error,
            createdAt: job.created_at,
            completedAt: job.completed_at,
          });
        } catch {
          return Response.json({ error: "Sign in to view this video." }, { status: 401 });
        }
      },
    },
  },
});
