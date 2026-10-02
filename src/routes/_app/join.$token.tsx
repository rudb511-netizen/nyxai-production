import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { joinByInvite } from "@/lib/kchat/server/comms";

export const Route = createFileRoute("/_app/join/$token")({ component: JoinInvite });

function JoinInvite() {
  const { token } = Route.useParams();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    try {
      const r = await joinByInvite({ data: { token } });
      if (r.pending) {
        toast.success("Request sent. Admins will review it.");
        nav({ to: "/inbox" });
        return;
      }
      nav({ to: "/inbox/$id", params: { id: r.conversationId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't join.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[70dvh] place-items-center px-6 text-center">
      <div className="max-w-sm space-y-3">
        <p className="text-lg font-medium">Group invite</p>
        <p className="text-sm text-muted">This link adds you to a NYX group or channel. You’ll see its messages after you join.</p>
        <Button className="w-full" disabled={busy} onClick={() => void join()}>
          {busy ? "Joining…" : "Join"}
        </Button>
        <Button className="w-full" variant="ghost" onClick={() => nav({ to: "/inbox" })}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
