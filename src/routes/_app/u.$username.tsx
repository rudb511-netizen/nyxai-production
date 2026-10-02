import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PostCard } from "@/components/kchat/post-card";
import { StatusAvatar } from "@/components/kchat/status-avatar";
import { useLiveHostMap } from "@/components/kchat/use-live-hosts";
import { Button } from "@/components/ui/button";
import { getUserProfile } from "@/lib/kchat/server/profiles";
import { userPosts } from "@/lib/kchat/server/posts";
import { openDm } from "@/lib/kchat/server/messages";
import {
  blockUser,
  cancelFriendRequest,
  followUser,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  unblockUser,
  unfollowUser,
} from "@/lib/kchat/server/social";
import { listHighlights, muteUser, unmuteUser, restrictUser, unrestrictUser } from "@/lib/kchat/server/graph";
import { formatCount } from "@/lib/utils";
import { NameMark } from "@/components/kchat/verified-badge";
import { ReportSheet } from "@/components/kchat/report-sheet";
import { Flag } from "lucide-react";
import { useState } from "react";
import { useAuthorStatusRing } from "@/lib/kchat/hooks";
import { triggerHaptic } from "@/utils/nativeCapabilities";
import { userVideos } from "@/lib/kchat/server/videos";
import { ProfileVideoGrid } from "@/components/kchat/profile-videos";

export const Route = createFileRoute("/_app/u/$username")({ component: Profile });

function Profile() {
  const { username } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["profile", username],
    queryFn: () => getUserProfile({ data: { username } }),
    refetchInterval: 8_000,
  });
  const posts = useQuery({
    queryKey: ["user-posts", username, "posts"],
    queryFn: () => userPosts({ data: { username, tab: "posts" } }),
  });
  const videos = useQuery({
    queryKey: ["user-videos", username],
    queryFn: () => userVideos({ data: { username } }),
  });
  const highlights = useQuery({
    queryKey: ["highlights", username],
    queryFn: () => listHighlights({ data: { username } }),
  });
  const [tab, setTab] = useState<"posts" | "videos">("posts");
  const p = q.data;
  const liveHosts = useLiveHostMap();
  const statusRing = useAuthorStatusRing(p?.userId);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["profile", username] });
  const [report, setReport] = useState(false);

  const act = useMutation({
    mutationFn: async (kind: string) => {
      triggerHaptic();
      if (kind === "follow") return followUser({ data: { username } });
      if (kind === "unfollow") return unfollowUser({ data: { username } });
      if (kind === "friend") return sendFriendRequest({ data: { username } });
      if (kind === "accept") return respondFriendRequest({ data: { username, accept: true } });
      if (kind === "decline") return respondFriendRequest({ data: { username, accept: false } });
      if (kind === "cancel") return cancelFriendRequest({ data: { username } });
      if (kind === "unfriend") return removeFriend({ data: { username } });
      if (kind === "block") return blockUser({ data: { username } });
      if (kind === "unblock") return unblockUser({ data: { username } });
      if (kind === "mute") return p?.isMuted ? unmuteUser({ data: { username } }) : muteUser({ data: { username } });
      if (kind === "restrict") return p?.isRestricted ? unrestrictUser({ data: { username } }) : restrictUser({ data: { username } });
      return null;
    },
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (q.isError) {
    return <p className="p-6 text-sm text-muted">{(q.error as Error).message}</p>;
  }
  if (!p) return <div className="p-6 text-sm text-muted">Loading…</div>;
  if (p.isSelf) {
    nav({ to: "/me" });
    return null;
  }

  return (
    <div className="kc-page-wide">
      <div className="relative h-28 bg-elevated">
        {p.coverUrl ? <img src={p.coverUrl} alt="" className="size-full object-cover" /> : null}
      </div>
      <div className="px-4">
        <div className="-mt-8">
          <StatusAvatar
            src={p.avatarUrl}
            name={p.displayName}
            size="xl"
            segments={statusRing.ring?.items.map((s) => ({ id: s.id, seen: s.seen }))}
            liveId={p.userId ? liveHosts.get(p.userId) : null}
            onOpenChat={() => nav({ to: "/inbox" })}
          />
        </div>
        <h1 className="mt-2 text-xl font-semibold">
          <NameMark name={p.displayName} verifyKind={p.verifyKind} isArc={p.isArc} isPremium={p.isPremium} />
        </h1>
        <p className="text-sm text-muted">
          @{p.username}
          {p.isOnline ? <span className="ml-2 text-ok">Online</span> : null}
        </p>
        {p.bio ? <p className="mt-3 text-sm">{p.bio}</p> : null}
        {p.website || p.location ? (
          <p className="mt-2 text-sm text-muted">
            {p.location ? <span>{p.location}</span> : null}
            {p.website ? (
              <a href={p.website} className="ml-2 text-accent" target="_blank" rel="noreferrer">
                {p.website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
          </p>
        ) : null}
        {(highlights.data?.items.length ?? 0) > 0 ? (
          <div className="kc-hide-scrollbar mt-3 flex gap-3 overflow-x-auto">
            {highlights.data!.items.map((h) => (
              <Link key={h.id} to="/hl/$id" params={{ id: h.id }} className="w-16 shrink-0 text-center">
                <div className="mx-auto size-14 overflow-hidden rounded-full bg-elevated">
                  {h.coverUrl ? <img src={h.coverUrl} alt="" className="size-full object-cover" /> : null}
                </div>
                <span className="mt-1 block truncate text-[11px]">{h.name}</span>
              </Link>
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex gap-4 text-sm tabular-nums">
          <span>
            <strong>{formatCount(p.friends)}</strong> friends
          </span>
          <span>
            <strong>{formatCount(p.followers)}</strong> followers
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {p.isFollowing ? (
            <Button size="sm" variant="secondary" onClick={() => act.mutate("unfollow")}>
              Following
            </Button>
          ) : (
            <Button size="sm" onClick={() => act.mutate("follow")}>
              Follow
            </Button>
          )}
          {p.isFriend ? (
            <Button size="sm" variant="outline" onClick={() => act.mutate("unfriend")}>
              Friends
            </Button>
          ) : p.friendRequest === "incoming" ? (
            <>
              <Button size="sm" onClick={() => act.mutate("accept")}>
                Accept
              </Button>
              <Button size="sm" variant="outline" onClick={() => act.mutate("decline")}>
                Decline
              </Button>
            </>
          ) : p.friendRequest === "outgoing" ? (
            <Button size="sm" variant="outline" onClick={() => act.mutate("cancel")}>
              Requested
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => act.mutate("friend")}>
              Add friend
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const r = await openDm({ data: { username } });
                if (!r?.id) throw new Error("Couldn't open this conversation. Please try again.");
                nav({ to: "/inbox/$id", params: { id: r.id } });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't open this conversation. Please try again.");
              }
            }}
          >
            Message
          </Button>
          {p.isBlocked ? (
            <Button size="sm" variant="secondary" onClick={() => act.mutate("unblock")}>
              Unblock
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => act.mutate("block")}>
              Block
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => act.mutate("mute")}>
            {p.isMuted ? "Unmute" : "Mute"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => act.mutate("restrict")}>
            {p.isRestricted ? "Unrestrict" : "Restrict"}
          </Button>
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => setReport(true)}>
            <Flag className="size-3.5" />
            Report
          </Button>
        </div>
      </div>
      <div className="mt-4 border-t border-border">
        {p.isPrivate && !p.isFollowing && !p.isFriend ? (
          <p className="p-8 text-center text-sm text-muted">This account is private.</p>
        ) : (
          <>
            <div className="flex border-b border-border">
              {(["posts", "videos"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`flex-1 py-3 text-sm capitalize ${tab === t ? "border-b-2 border-fg font-medium" : "text-muted"}`}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === "videos" ? (
              <ProfileVideoGrid items={videos.data?.items ?? []} />
            ) : (
              (posts.data?.items ?? []).map((post) => (
                <PostCard key={post.id} post={post} onChange={() => void posts.refetch()} />
              ))
            )}
          </>
        )}
      </div>
      {report ? (
        <ReportSheet targetKind="user" targetId={p.userId} onClose={() => setReport(false)} />
      ) : null}
    </div>
  );
}
