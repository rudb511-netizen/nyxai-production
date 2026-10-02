import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";

const RATIOS = new Set(["1280:720", "720:1280", "1104:832", "960:960", "832:1104", "1584:672"]);

export const Route = createFileRoute("/api/video/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authz = request.headers.get("authorization") ?? "";
        const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : undefined;
        let userId = "";
        try {
          userId = await requireUserId(bearer);
        } catch {
          return Response.json({ error: "Sign in to generate a video." }, { status: 401 });
        }
        let prompt = "";
        let image = "";
        let ratio = "1280:720";
        let duration = 5;
        try {
          const body = (await request.json()) as { prompt?: string; image?: string; ratio?: string; duration?: number };
          prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
          image = typeof body.image === "string" ? body.image.trim() : "";
          if (typeof body.ratio === "string" && RATIOS.has(body.ratio)) ratio = body.ratio;
          if (body.duration === 5 || body.duration === 8 || body.duration === 10) duration = body.duration;
        } catch {
          return Response.json({ error: "Invalid request." }, { status: 400 });
        }
        if (!prompt) return Response.json({ error: "Describe the video." }, { status: 400 });
        if (image && !image.startsWith("data:image/") && !image.startsWith("https://")) {
          return Response.json({ error: "Upload a JPEG, PNG, or WebP image." }, { status: 400 });
        }
        if (image.length > 8_000_000) return Response.json({ error: "That image is too large." }, { status: 400 });
        try {
          if (!image) {
            const { geminiGenerateImage } = await import("@/lib/kchat/gemini");
            const frame = await geminiGenerateImage({ prompt, aspect: ratio.startsWith("720") ? "9:16" : "16:9" });
            if (!frame.ok) {
              return Response.json(
                { error: `Runway Gen-4.5 needs a starting image, and creating one failed. ${frame.error}` },
                { status: 502 },
              );
            }
            image = frame.url;
          }
          const { createRunwayVideo } = await import("@/lib/kchat/server/runway");
          const { sqlClient } = await import("@/lib/kchat/server/helpers");
          const { newId } = await import("@/lib/kchat/ids");
          const created = await createRunwayVideo({ prompt, image: image || undefined, ratio, duration });
          const id = newId("vid");
          const sql = await sqlClient();
          await sql`
            insert into nyx_video_jobs (id, user_id, provider, model, prompt, input_image, task_id, status)
            values (${id}, ${userId}, 'runway', ${created.model}, ${prompt.slice(0, 1000)}, ${image ? "uploaded" : null}, ${created.taskId}, 'RUNNING')
          `;
          return Response.json({ id, taskId: created.taskId, status: "RUNNING", provider: "runway", model: created.model });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Runway video generation failed. Please try again.";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});
