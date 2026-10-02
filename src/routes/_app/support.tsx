import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMeQuery } from "@/lib/kchat/hooks";
import { listSupportInbox, supportInboxUnread } from "@/lib/kchat/server/support-inbox";
import { cn, inboxTime } from "@/lib/utils";

export const Route = createFileRoute("/_app/support")({ component: SupportInbox });

function SupportInbox() {
  const me = useMeQuery();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const unread = useQuery({
    queryKey: ["support-unread"],
    queryFn: () => supportInboxUnread(),
    refetchInterval: 4_000,
    enabled: Boolean(me.data?.isArc),
  });
  const list = useInfiniteQuery({
    queryKey: ["support-inbox", search],
    queryFn: ({ pageParam }) => listSupportInbox({ data: { q: search || undefined, cursor: pageParam } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 4_000,
    enabled: Boolean(me.data?.isArc),
  });

  if (me.data && !me.data.isArc) {
    return (
      <div className="kc-page px-4 py-8 text-center">
        <p className="text-sm text-muted">Only ARC Admins can open the support inbox.</p>
        <Button className="mt-4" onClick={() => nav({ to: "/" })}>
          Home
        </Button>
      </div>
    );
  }

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="kc-page">
      <header className="px-4 py-4">
        <h1 className="text-lg font-semibold">NYX Support inbox</h1>
        <p className="mt-1 text-sm text-muted">
          Conversations members send to NYX Support. Both ARC Admins see the same threads.
          {unread.data ? ` · ${unread.data.count} unread` : ""}
        </p>
      </header>
      <form
        className="flex gap-2 px-4 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members or messages" aria-label="Search support" />
        <Button type="submit" size="icon" variant="secondary" aria-label="Search">
          <Search className="size-4" />
        </Button>
      </form>
      {list.isLoading ? <p className="px-4 text-sm text-muted">Loading…</p> : null}
      {list.isError ? (
        <div className="px-4">
          <p className="text-sm text-danger">{list.error instanceof Error ? list.error.message : "Couldn't load support."}</p>
          <Button className="mt-2" size="sm" variant="secondary" onClick={() => void list.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {!list.isLoading && items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">No support conversations yet.</p>
      ) : null}
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <Link
              to="/inbox/$id"
              params={{ id: it.id }}
              className={cn("flex items-center gap-3 px-4 py-3 hover:bg-elevated/50", it.unread && "bg-elevated/60")}
            >
              <Avatar src={it.user.avatarUrl} name={it.user.displayName} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{it.user.displayName}</span>
                  <span className="shrink-0 text-[11px] text-muted">{it.lastAt ? inboxTime(it.lastAt) : ""}</span>
                </span>
                <span className="mt-0.5 block truncate text-sm text-muted">
                  {it.lastKind && it.lastKind !== "text" ? `${it.lastKind} · ` : ""}
                  {it.lastMessage || "No messages yet"}
                </span>
              </span>
              {it.unread ? <span className="size-2 shrink-0 rounded-full bg-accent" /> : null}
            </Link>
          </li>
        ))}
      </ul>
      {list.hasNextPage ? (
        <button
          type="button"
          className="w-full py-3 text-sm text-muted"
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}
