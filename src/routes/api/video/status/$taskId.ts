import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";

async function readJob(request: Request, taskId: string) {
  const authz = request.headers.get("authorization") ?? "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : undefined;
  const userId = await requireUserId(bearer);
  const { sqlClient } = await import("@/lib/kchat/server/helpers");
  const sql = await sqlClient();
  const rows = await sql<{
    id: string;
    user_id: string;
    provider: string;
    model: string;
    prompt: string;
    task_id: string | null;
    status: string;
    output_url: string | null;
    error: string | null;
    created_at: string;
    completed_at: string | null;
  }>`
    select id, user_id, provider, model, prompt, task_id, status, output_url, error, created_at, completed_at
    from nyx_video_jobs where id = ${taskId} and user_id = ${userId}
  `;
  return { userId, sql, job: rows[0] || null };
}

export const Route = createFileRoute("/api/video/status/$taskId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { sql, job } = await readJob(request, params.taskId);
          if (!job) return Response.json({ error: "Video not found." }, { status: 404 });
          if ((job.status === "SUCCEEDED" || job.status === "FAILED") || !job.task_id) {
            return Response.json({
              id: job.id,
              provider: job.provider,
              model: job.model,
              status: job.status,
              outputUrl: job.output_url,
              error: job.error,
            });
          }
          const { fetchRunwayTask } = await import("@/lib/kchat/server/runway");
          const live = await fetchRunwayTask(job.task_id);
          const done = live.status === "SUCCEEDED" || live.status === "FAILED";
          if (done) {
            await sql`
              update nyx_video_jobs
              set status = ${live.status}, output_url = ${live.outputUrl}, error = ${live.error}, completed_at = now()
              where id = ${job.id}
            `;
          } else {
            await sql`update nyx_video_jobs set status = ${live.status} where id = ${job.id}`;
          }
          return Response.json({
            id: job.id,
            provider: job.provider,
            model: job.model,
            status: live.status,
            outputUrl: live.outputUrl,
            error: live.error,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not check the video.";
          const status = message === "Unauthorized" ? 401 : 502;
          return Response.json({ error: status === 401 ? "Sign in to view this video." : message }, { status });
        }
      },
    },
  },
});
