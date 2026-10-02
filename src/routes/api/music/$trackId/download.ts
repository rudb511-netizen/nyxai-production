import { createFileRoute } from "@tanstack/react-router";
import { handleMusicDownload } from "@/lib/kchat/server/music-download-http";

async function handle({ request, params }: { request: Request; params: { trackId: string } }) {
  return handleMusicDownload(request, params.trackId);
}

export const Route = createFileRoute("/api/music/$trackId/download")({
  server: { handlers: { GET: handle } },
});
