import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/kchat/empty";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { listNotifications, markNotificationsRead } from "@/lib/kchat/server/more";
import { respondLiveInvite } from "@/lib/kchat/server/live-session";
import { timeAgo } from "@/lib/utils";

export const Route = createFileRoute("/_app/alerts")({ component: Alerts });

function Alerts() {
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(),
    refetchInterval: 8000,
  });
  const items = q.data?.items ?? [];
  return (
    <div className="kc-page">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">Notifications</h1>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void markNotificationsRead().then(() => q.refetch())}
        >
          Mark read
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Bell} title="You're all caught up" body="Likes, follows, and messages will land here." />
      ) : (
        <ul className="kc-page-enter">
          {items.map((n) => (
            <li key={n.id} className={`flex items-center gap-3 px-4 py-3 ${n.isRead ? "" : "kc-alert-unread"}`}>
              <Avatar src={n.actor?.avatarUrl} name={n.actor?.displayName ?? "K"} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{n.body}</p>
                <p className="text-xs text-subtle tabular-nums">{timeAgo(n.createdAt)}</p>
              </div>
              {n.kind === "flash" && n.entityId ? (
                <Link to="/flash/$id" params={{ id: n.entityId }} className="text-xs text-capture">
                  Open
                </Link>
              ) : n.kind === "call" && n.entityId ? (
                <Link to="/call/$id" params={{ id: n.entityId }} className="text-xs text-accent">
                  Join
                </Link>
              ) : n.kind === "support" && n.entityId ? (
                <Link to="/inbox/$id" params={{ id: n.entityId }} className="text-xs text-accent">
                  Open
                </Link>
              ) : (n.kind === "message" || n.kind === "message_reminder") && n.entityId ? (
                <Link to="/inbox/$id" params={{ id: n.entityId }} className="text-xs text-accent">
                  Open
                </Link>
              ) : (n.kind === "video_comment" || n.kind === "comment_reply" || n.kind === "comment_like" || n.kind === "mention") && n.entityId ? (
                <Link to="/watch" search={{ v: n.entityId }} className="text-xs text-accent">
                  Open
                </Link>
              ) : n.kind === "live_invite" && n.entityId ? (
                <LiveInviteActions streamId={n.entityId} />
              ) : n.kind === "live_mention" && n.entityId ? (
                <Link to="/live/$id" params={{ id: n.entityId }} className="text-xs text-accent">
                  Open
                </Link>
              ) : n.kind === "report" ? (
                <Link to="/admin" className="text-xs text-accent">
                  Review
                </Link>
              ) : n.kind === "sanction" || n.kind === "warning" || n.kind === "appeal" ? (
                <Link to="/settings" className="text-xs text-warn">
                  Details
                </Link>
              ) : n.actor ? (
                <Link to="/u/$username" params={{ username: n.actor.username }} className="text-xs text-accent">
                  View
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LiveInviteActions({ streamId }: { streamId: string }) {
  const qc = useQueryClient();
  const [done, setDone] = useState<string | null>(null);
  async function respond(accept: boolean) {
    try {
      const r = await respondLiveInvite({ data: { streamId, accept } });
      setDone(r.status);
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not respond.");
    }
  }
  if (done) {
    return <span className="text-xs text-muted">{done === "accepted" ? "Accepted" : "Declined"}</span>;
  }
  return (
    <span className="flex gap-1">
      <Button size="sm" onClick={() => void respond(true)}>
        Accept
      </Button>
      <Button size="sm" variant="outline" onClick={() => void respond(false)}>
        Decline
      </Button>
      <Link to="/live/$id" params={{ id: streamId }} className="self-center text-xs text-accent">
        Watch
      </Link>
    </span>
  );
}
