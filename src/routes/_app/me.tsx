import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { useState } from "react";
import { PostCard } from "@/components/kchat/post-card";
import { StatusAvatar } from "@/components/kchat/status-avatar";
import { useLiveHostMap } from "@/components/kchat/use-live-hosts";
import { Button } from "@/components/ui/button";
import { UserButton } from "@/lib/auth/gates";
import { useMeQuery, useAuthorStatusRing } from "@/lib/kchat/hooks";
import { userPosts } from "@/lib/kchat/server/posts";
import { listDrafts } from "@/lib/kchat/server/platform";
import { createHighlight, listHighlights, listMyStoriesForHighlights, listScheduledPosts, cancelScheduledPost } from "@/lib/kchat/server/graph";
import { myVideoAnalytics, pinVideo, userVideos, deleteVideo } from "@/lib/kchat/server/videos";
import { NameMark } from "@/components/kchat/verified-badge";
import { formatCount } from "@/lib/utils";
import { ProfileVideoGrid } from "@/components/kchat/profile-videos";

export const Route = createFileRoute("/_app/me")({ component: MePage });

function MePage() {
  const me = useMeQuery();
  const nav = useNavigate();
  const [tab, setTab] = useState<"posts" | "videos" | "media" | "likes" | "saved" | "reposts" | "studio" | "drafts" | "scheduled">("posts");
  const posts = useQuery({
    queryKey: ["user-posts", me.data?.username, tab],
    enabled: Boolean(me.data?.username) && tab !== "studio" && tab !== "videos" && tab !== "drafts" && tab !== "scheduled",
    queryFn: () =>
      userPosts({
        data: {
          username: me.data!.username,
          tab: tab === "likes" || tab === "saved" || tab === "reposts" || tab === "media" ? tab : "posts",
        },
      }),
  });
  const videos = useQuery({
    queryKey: ["user-videos", me.data?.username],
    enabled: Boolean(me.data?.username) && tab === "videos",
    queryFn: () => userVideos({ data: { username: me.data!.username } }),
  });
  const drafts = useQuery({
    queryKey: ["drafts"],
    enabled: tab === "drafts",
    queryFn: () => listDrafts(),
  });
  const scheduled = useQuery({
    queryKey: ["scheduled-posts"],
    enabled: tab === "scheduled",
    queryFn: () => listScheduledPosts(),
  });
  const highlights = useQuery({
    queryKey: ["highlights", me.data?.username],
    enabled: Boolean(me.data?.username),
    queryFn: () => listHighlights({ data: { username: me.data!.username } }),
  });
  const myStories = useQuery({
    queryKey: ["my-stories-hl"],
    queryFn: () => listMyStoriesForHighlights(),
  });
  const analytics = useQuery({
    queryKey: ["video-analytics"],
    enabled: tab === "studio",
    queryFn: () => myVideoAnalytics(),
  });
  const p = me.data;
  const liveHosts = useLiveHostMap();
  const statusRing = useAuthorStatusRing(p?.userId);
  if (!p) return null;

  return (
    <div className="kc-page-wide">
      <div className="relative h-28 kc-cover-wash">
        {p.coverUrl ? <img src={p.coverUrl} alt="" className="size-full object-cover" /> : null}
        <div className="absolute right-3 top-3 flex gap-2">
          <Button variant="secondary" size="icon-sm" onClick={() => nav({ to: "/settings" })} aria-label="Settings">
            <Settings className="size-4" />
          </Button>
          <UserButton />
        </div>
      </div>
      <div className="px-4">
        <div className="-mt-8 flex items-end gap-3">
          <StatusAvatar
            src={p.avatarUrl}
            name={p.displayName}
            size="xl"
            segments={statusRing.ring?.items.map((s) => ({ id: s.id, seen: s.seen }))}
            liveId={p.userId ? liveHosts.get(p.userId) : null}
            onOpenChat={() => {
              try {
                sessionStorage.setItem("omni-create-tab", "status");
              } catch {
                /* ignore */
              }
              nav({ to: "/create" });
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="mb-1"
            onClick={() => {
              try {
                sessionStorage.setItem("omni-create-tab", "status");
              } catch {
                /* ignore */
              }
              nav({ to: "/create" });
            }}
          >
            Add status
          </Button>
        </div>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              <NameMark name={p.displayName} verifyKind={p.verifyKind} isArc={p.isArc} isPremium={p.isPremium} />
            </h1>
            <p className="text-sm text-muted">@{p.username}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => nav({ to: "/settings" })}>
            Edit profile
          </Button>
        </div>
        {p.bio ? <p className="mt-3 text-sm leading-relaxed">{p.bio}</p> : null}
        {p.website || p.location ? (
          <p className="mt-2 text-sm text-muted">
            {p.location}
            {p.website ? (
              <a href={p.website} className="ml-2 text-accent" target="_blank" rel="noreferrer">
                {p.website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
          </p>
        ) : null}
        <p className="mt-3 text-sm">
          <strong className="text-streak tabular-nums">{p.score}</strong>{" "}
          <span className="text-muted">Score</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => nav({ to: "/memories" })}>
            Memories
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav({ to: "/map" })}>
            Atlas {p.ghostMode ? "· Ghost" : ""}
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav({ to: "/capture" })}>
            Capture
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav({ to: "/plus" })}>
            {p.isPremium ? "Verified" : "Get verified"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav({ to: "/studio" })}>
            Studio
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav({ to: "/card" })}>
            NYX card
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav({ to: "/stickers" })}>
            Stickers
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav({ to: "/saved" })}>
            Saved
          </Button>
          <Button variant="outline" size="sm" onClick={() => nav({ to: "/lists" })}>
            Lists
          </Button>
        </div>
        <div className="mt-4 flex gap-4 text-sm">
          <Link to="/friends" className="tabular-nums">
            <strong>{formatCount(p.friends)}</strong> <span className="text-muted">friends</span>
          </Link>
          <span className="tabular-nums">
            <strong>{formatCount(p.followers)}</strong> <span className="text-muted">followers</span>
          </span>
          <span className="tabular-nums">
            <strong>{formatCount(p.following)}</strong> <span className="text-muted">following</span>
          </span>
        </div>
      </div>
      <HighlightsRow
        items={highlights.data?.items ?? []}
        stories={myStories.data ?? []}
        isSelf
        onChanged={() => {
          void highlights.refetch();
          void myStories.refetch();
        }}
      />
      <div className="mt-4 flex border-b border-border">
        {(["posts", "videos", "media", "reposts", "likes", "saved", "drafts", "scheduled", "studio"] as const).map((t) => (
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
      {tab === "studio" ? (
        <ul className="space-y-2 p-4">
          {(analytics.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">Publish a Watch video to see views, likes, and watch time.</p>
          ) : (
            (analytics.data ?? []).map((v) => (
              <li key={v.id} className="kc-card p-3 text-sm">
                <p className="font-medium">{v.caption || "Untitled"}</p>
                <p className="mt-1 text-xs text-muted tabular-nums">
                  {formatCount(v.views)} views · {formatCount(v.likes)} likes · {formatCount(v.comments)} comments ·{" "}
                  {formatCount(v.shares)} shares · {Math.round(v.watchMs / 1000)}s watched
                </p>
              </li>
            ))
          )}
          <Button className="mt-2" variant="outline" size="sm" onClick={() => nav({ to: "/studio" })}>
            Open full studio
          </Button>
        </ul>
      ) : tab === "scheduled" ? (
        <ul className="space-y-2 p-4">
          {(scheduled.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">Scheduled posts appear here until they go live.</p>
          ) : (
            (scheduled.data ?? []).map((d) => (
              <li key={d.id} className="kc-card p-3 text-sm">
                <p>{d.body || "Scheduled post"}</p>
                <p className="mt-1 text-xs text-muted">{new Date(d.scheduledAt).toLocaleString()}</p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void cancelScheduledPost({ data: { id: d.id } }).then(() => scheduled.refetch())
                  }
                >
                  Cancel
                </Button>
              </li>
            ))
          )}
        </ul>
      ) : tab === "drafts" ? (
        <ul className="space-y-2 p-4">
          {(drafts.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">Unfinished posts, stories, and videos land here automatically.</p>
          ) : (
            (drafts.data ?? []).map((d) => (
              <li key={d.id} className="kc-card p-3 text-sm">
                <p className="text-xs uppercase text-muted">{d.kind}</p>
                <p className="mt-1">{d.body || "Untitled draft"}</p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    try {
                      sessionStorage.setItem("omni-create-tab", d.kind === "video" ? "video" : d.kind === "story" ? "story" : d.kind === "status" ? "status" : "post");
                      sessionStorage.setItem("omni-create-draft", JSON.stringify({ body: d.body, tab: d.kind }));
                    } catch {
                      /* ignore */
                    }
                    nav({ to: "/create" });
                  }}
                >
                  Continue
                </Button>
              </li>
            ))
          )}
        </ul>
      ) : tab === "videos" ? (
        <ProfileVideoGrid
          items={videos.data?.items ?? []}
          mine
          onPin={(id, pin) =>
            void pinVideo({ data: { id, pin } }).then(() => void videos.refetch())
          }
          onDelete={(id) =>
            void deleteVideo({ data: { id } }).then(() => void videos.refetch())
          }
        />
      ) : (
        (posts.data?.items ?? []).map((post) => (
          <PostCard key={post.id} post={post} onChange={() => void posts.refetch()} />
        ))
      )}
    </div>
  );
}

function HighlightsRow({
  items,
  stories,
  isSelf,
  onChanged,
}: {
  items: { id: string; name: string; coverUrl: string | null; count: number }[];
  stories: { id: string; mediaUrl: string | null; mediaKind: string; textBody: string | null }[];
  isSelf?: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <div className="kc-hide-scrollbar flex gap-3 overflow-x-auto px-4 py-3">
      {isSelf ? (
        <div className="w-20 shrink-0">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New"
            className="w-full rounded-lg bg-elevated px-2 py-1 text-xs"
          />
          <Button
            size="sm"
            className="mt-1 w-full"
            disabled={!name.trim()}
            onClick={() =>
              void createHighlight({ data: { name, storyIds: picked } }).then(() => {
                setName("");
                setPicked([]);
                onChanged();
              })
            }
          >
            Pin
          </Button>
        </div>
      ) : null}
      {items.map((h) => (
        <Link key={h.id} to="/hl/$id" params={{ id: h.id }} className="w-16 shrink-0 text-center">
          <div className="mx-auto size-14 overflow-hidden rounded-full bg-elevated">
            {h.coverUrl ? <img src={h.coverUrl} alt="" className="size-full object-cover" /> : null}
          </div>
          <span className="mt-1 block truncate text-[11px]">{h.name}</span>
        </Link>
      ))}
      {isSelf
        ? stories.slice(0, 8).map((s) => {
            const on = picked.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setPicked((c) => (on ? c.filter((x) => x !== s.id) : [...c, s.id]))}
                className={`w-12 shrink-0 overflow-hidden rounded-lg ${on ? "ring-2 ring-accent" : ""}`}
              >
                {s.mediaUrl ? (
                  <img src={s.mediaUrl} alt="" className="aspect-[9/16] w-full object-cover" />
                ) : (
                  <span className="grid aspect-[9/16] place-items-center bg-elevated text-[9px]">{s.textBody}</span>
                )}
              </button>
            );
          })
        : null}
    </div>
  );
}

