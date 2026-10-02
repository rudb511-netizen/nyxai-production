import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Clapperboard, Compass, Newspaper, Plus, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/kchat/empty";
import { PostCard } from "@/components/kchat/post-card";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeQuery } from "@/lib/kchat/hooks";
import { FEED_TABS, NYX_INTERESTS, type FeedTab } from "@/lib/kchat/platform";
import { saveInterests } from "@/lib/kchat/server/platform";
import { getFeed } from "@/lib/kchat/server/posts";
import { listLive, trendingTags } from "@/lib/kchat/server/more";
import { suggestedFriends } from "@/lib/kchat/server/social";
import { listStories } from "@/lib/kchat/server/stories";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/")({ component: Home });

function Home() {
  const nav = useNavigate();
  const me = useMeQuery();
  const [tab, setTab] = useState<FeedTab>("foryou");
  const [picked, setPicked] = useState<string[]>([]);
  const stories = useQuery({ queryKey: ["stories"], queryFn: () => listStories() });
  const feed = useInfiniteQuery({
    queryKey: ["feed", tab],
    queryFn: ({ pageParam }) => getFeed({ data: { cursor: pageParam, tab } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 8_000,
  });
  const sentinel = useRef<HTMLDivElement>(null);
  const pull = useRef<{ y: number; pulling: boolean }>({ y: 0, pulling: false });
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && feed.hasNextPage) void feed.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [feed.fetchNextPage, feed.hasNextPage]);

  const posts = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div
      className="kc-page-enter kc-home"
      onTouchStart={(e) => {
        if (window.scrollY < 8) {
          pull.current = { y: e.touches[0]?.clientY ?? 0, pulling: true };
        }
      }}
      onTouchMove={(e) => {
        if (!pull.current.pulling) return;
        const dy = (e.touches[0]?.clientY ?? 0) - pull.current.y;
        if (dy > 72 && !refreshing) {
          pull.current.pulling = false;
          setRefreshing(true);
          void feed.refetch().finally(() => setRefreshing(false));
        }
      }}
      onTouchEnd={() => {
        pull.current.pulling = false;
      }}
    >
      <div className="kc-feed min-w-0">
      {refreshing ? <p className="py-2 text-center text-xs text-muted">Refreshing…</p> : null}
      <div className="kc-hide-scrollbar flex gap-3 overflow-x-auto border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => nav({ to: "/capture" })}
          className="flex w-16 shrink-0 flex-col items-center gap-1"
        >
          <div className="grid size-14 place-items-center rounded-full border border-dashed border-capture/50 bg-elevated text-capture">
            <Plus className="size-5" />
          </div>
          <span className="w-full truncate text-center text-xs text-muted">Story</span>
        </button>
        {(stories.data ?? []).map((s) => (
          <Link
            key={s.id}
            to="/story/$id"
            params={{ id: s.id }}
            className="flex w-16 shrink-0 flex-col items-center gap-1"
          >
            <div className={cn(s.seen ? "kc-story-ring-seen" : "kc-story-ring")}>
              <Avatar src={s.author.avatarUrl} name={s.author.displayName} size="lg" className="size-12 border-2 border-bg" />
            </div>
            <span className="w-full truncate text-center text-xs text-muted">{s.author.username}</span>
          </Link>
        ))}
      </div>
      <div className="kc-hide-scrollbar flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
        {FEED_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm",
              tab === t.id ? "bg-fg text-bg font-medium" : "text-muted hover:bg-elevated",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {me.data && !me.data.interestsSet ? (
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-medium">Tune For You</p>
          <p className="mt-1 text-xs text-muted">Pick at least 3 topics. This ranks your feed from real hashtags, not fake trends.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {NYX_INTERESTS.map((i) => {
              const on = picked.includes(i.tag);
              return (
                <button
                  key={i.tag}
                  type="button"
                  onClick={() => setPicked((cur) => (on ? cur.filter((t) => t !== i.tag) : [...cur, i.tag]))}
                  className={cn("rounded-full px-3 py-1.5 text-xs", on ? "bg-fg text-bg" : "bg-elevated text-muted")}
                >
                  {i.label}
                </button>
              );
            })}
          </div>
          <Button
            className="mt-3"
            size="sm"
            disabled={picked.length < 3}
            onClick={() =>
              void saveInterests({ data: { tags: picked } }).then(() => me.refetch())
            }
          >
            Save interests
          </Button>
        </div>
      ) : null}
      {feed.isLoading ? (
        <div className="space-y-4 p-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : feed.isError ? (
        <EmptyState
          icon={Newspaper}
          title="Couldn’t load your feed"
          body={feed.error instanceof Error ? feed.error.message : "Try again in a moment."}
          action={
            <Button onClick={() => void feed.refetch()} variant="secondary">
              Retry
            </Button>
          }
        />
      ) : posts.length === 0 ? (
        <div className="px-5 py-10">
          <EmptyState
            icon={Newspaper}
            title={tab === "following" ? "No posts from people you follow" : tab === "friends" ? "No posts from friends yet" : tab === "trending" ? "Nothing is trending yet" : "Your feed is quiet"}
            body="Publish a first post, add a story, or find people to follow."
            className="py-6"
          />
          <div className="mx-auto grid max-w-sm grid-cols-2 gap-2">
            <Button onClick={() => nav({ to: "/create" })}>New post</Button>
            <Button variant="secondary" onClick={() => nav({ to: "/discover" })}>
              <Compass className="size-4" />
              Discover
            </Button>
            <Button variant="outline" onClick={() => nav({ to: "/watch" })}>
              <Clapperboard className="size-4" />
              Watch
            </Button>
            <Button variant="outline" onClick={() => nav({ to: "/kai" })}>
              <Sparkles className="size-4" />
              Ask NYXAI
            </Button>
          </div>
        </div>
      ) : (
        posts.map((p) => (
          <PostCard key={p.id} post={p} onChange={() => void feed.refetch()} />
        ))
      )}
      <div ref={sentinel} className="h-8" />
      </div>
      <HomeRail />
    </div>
  );
}

function HomeRail() {
  const people = useQuery({ queryKey: ["suggested"], queryFn: () => suggestedFriends() });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => trendingTags() });
  const live = useQuery({ queryKey: ["live"], queryFn: () => listLive() });
  return (
    <aside className="kc-rail" aria-label="Discover">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold">Live now</p>
        {(live.data ?? []).slice(0, 4).length === 0 ? (
          <p className="mt-2 text-sm text-muted">No live rooms yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {(live.data ?? []).slice(0, 4).map((room) => (
              <li key={room.id}>
                <Link to="/live/$id" params={{ id: room.id }} className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-live kc-live-pulse" />
                  <span className="min-w-0 truncate text-sm">{room.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold">Trending</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(tags.data ?? []).slice(0, 8).map((t) => (
            <Link key={t.tag} to="/tag/$tag" params={{ tag: t.tag }} className="rounded-full bg-elevated px-3 py-1.5 text-sm">
              #{t.tag}
            </Link>
          ))}
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm font-semibold">People to follow</p>
        <ul className="mt-3 space-y-3">
          {(people.data ?? []).slice(0, 6).map((p) => (
            <li key={p.userId}>
              <Link to="/u/$username" params={{ username: p.username }} className="flex items-center gap-2">
                <Avatar src={p.avatarUrl} name={p.displayName} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{p.displayName}</span>
                  <span className="block truncate text-xs text-muted">@{p.username}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/discover" className="mt-3 inline-block text-sm text-accent">
          Open Discover
        </Link>
      </div>
    </aside>
  );
}
