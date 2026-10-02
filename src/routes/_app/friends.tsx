import type { ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { NameMark } from "@/components/kchat/verified-badge";
import { openDm, freezeStreak } from "@/lib/kchat/server/messages";
import {
  listFriendRequests,
  listFriends,
  respondFriendRequest,
  suggestedFriends,
} from "@/lib/kchat/server/social";
import { toggleCloseFriend } from "@/lib/kchat/server/platform";
import type { VerifyKind } from "@/lib/kchat/types";

export const Route = createFileRoute("/_app/friends")({ component: Friends });

function Friends() {
  const nav = useNavigate();
  const friends = useQuery({ queryKey: ["friends"], queryFn: () => listFriends() });
  const req = useQuery({ queryKey: ["friend-req"], queryFn: () => listFriendRequests() });
  const suggested = useQuery({ queryKey: ["suggested"], queryFn: () => suggestedFriends() });

  return (
    <div className="kc-page px-4 py-4 space-y-8">
      <section>
        <h2 className="text-sm font-medium text-muted">Requests</h2>
        {(req.data?.incoming.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-subtle">No pending requests.</p>
        ) : (
          req.data!.incoming.map((p) => (
            <Row key={p.userId} {...p}>
              <Button
                size="sm"
                onClick={() =>
                  void respondFriendRequest({ data: { username: p.username, accept: true } }).then(() => {
                    void friends.refetch();
                    void req.refetch();
                  })
                }
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void respondFriendRequest({ data: { username: p.username, accept: false } }).then(() =>
                    req.refetch(),
                  )
                }
              >
                Decline
              </Button>
            </Row>
          ))
        )}
      </section>
      <section>
        <h2 className="text-sm font-medium text-muted">Friends</h2>
        {(friends.data ?? []).map((p) => (
          <Row key={p.userId} {...p}>
            <Button
              size="sm"
              variant={p.isClose ? "default" : "outline"}
              onClick={() =>
                void toggleCloseFriend({ data: { username: p.username } })
                  .then((r) => {
                    toast.success(r.close ? "Added to Close Friends" : "Removed from Close Friends");
                    void friends.refetch();
                  })
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
              }
            >
              {p.isClose ? "Close" : "Close+"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  const r = await openDm({ data: { username: p.username } });
                  nav({ to: "/inbox/$id", params: { id: r.id } });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              Message
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void freezeStreak({ data: { username: p.username } })
                  .then(() => toast.success("Streak frozen for 24 hours"))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
              }
            >
              Freeze
            </Button>
          </Row>
        ))}
      </section>
      <section>
        <h2 className="text-sm font-medium text-muted">Suggested</h2>
        {(suggested.data ?? []).map((p) => (
          <Row key={p.userId} {...p}>
            <Link to="/u/$username" params={{ username: p.username }} className="text-sm text-accent">
              View
            </Link>
          </Row>
        ))}
      </section>
    </div>
  );
}

function Row({
  username,
  displayName,
  avatarUrl,
  verifyKind,
  isArc,
  isPremium,
  children,
}: {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verifyKind?: VerifyKind;
  isArc?: boolean;
  isPremium?: boolean;
  isClose?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="mt-2 flex items-center gap-3">
      <Link to="/u/$username" params={{ username }} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar src={avatarUrl} name={displayName} />
        <div className="min-w-0">
          <NameMark name={displayName} verifyKind={verifyKind} isArc={isArc} isPremium={isPremium} className="font-medium" />
          <p className="text-sm text-muted">@{username}</p>
        </div>
      </Link>
      {children}
    </div>
  );
}
