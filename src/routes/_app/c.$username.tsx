import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getPublicChannel, subscribePublicChannel } from "@/lib/kchat/server/comms";

export const Route = createFileRoute("/_app/c/$username")({ component: PublicChannel });

function PublicChannel() {
  const { username } = Route.useParams();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["public-channel", username],
    queryFn: () => getPublicChannel({ data: { username } }),
  });

  async function join() {
    setBusy(true);
    try {
      const r = await subscribePublicChannel({ data: { username } });
      nav({ to: "/inbox/$id", params: { id: r.conversationId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't join this channel.");
    } finally {
      setBusy(false);
    }
  }

  if (q.isError) {
    return (
      <div className="grid min-h-[70dvh] place-items-center px-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-lg font-medium">Channel not found</p>
          <p className="text-sm text-muted">That public username isn’t in use, or it isn’t a channel.</p>
          <Button variant="ghost" onClick={() => nav({ to: "/inbox" })}>
            Back to inbox
          </Button>
        </div>
      </div>
    );
  }

  const ch = q.data;
  return (
    <div className="grid min-h-[70dvh] place-items-center px-6 text-center">
      <div className="max-w-sm space-y-3">
        <Avatar src={ch?.imageUrl} name={ch?.title ?? username} size="lg" className="mx-auto" />
        <p className="text-lg font-medium">{ch?.title ?? "Channel"}</p>
        <p className="text-sm text-muted">@{ch?.username ?? username}</p>
        {ch?.description ? <p className="text-sm">{ch.description}</p> : null}
        <p className="text-xs text-muted">{ch?.subscribers ?? 0} subscribers</p>
        <Button
          className="w-full"
          disabled={busy || q.isLoading}
          onClick={() => {
            if (ch?.joined && ch.id) {
              nav({ to: "/inbox/$id", params: { id: ch.id } });
              return;
            }
            void join();
          }}
        >
          {busy ? "Joining…" : ch?.joined ? "Open channel" : "Subscribe"}
        </Button>
        <Button className="w-full" variant="ghost" onClick={() => nav({ to: "/inbox" })}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
