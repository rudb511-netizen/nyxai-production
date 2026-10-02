import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PostCard } from "@/components/kchat/post-card";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addListMember,
  deleteList,
  followList,
  getList,
  listFeed,
  removeListMember,
  updateList,
} from "@/lib/kchat/server/graph";

export const Route = createFileRoute("/_app/lists/$id")({ component: ListDetail });

function ListDetail() {
  const { id } = Route.useParams();
  const list = useQuery({ queryKey: ["list", id], queryFn: () => getList({ data: { id } }) });
  const feed = useQuery({ queryKey: ["list-feed", id], queryFn: () => listFeed({ data: { id } }) });
  const [user, setUser] = useState("");
  const [name, setName] = useState("");
  const data = list.data;

  if (list.isError) return <p className="p-6 text-sm text-muted">{(list.error as Error).message}</p>;
  if (!data) return <p className="p-6 text-sm text-muted">Loading…</p>;

  return (
    <div className="kc-page">
      <div className="border-b border-border px-4 py-4">
        <p className="text-xs text-muted">@{data.owner.username}</p>
        <h1 className="text-lg font-semibold">{data.name}</h1>
        {data.description ? <p className="mt-1 text-sm text-muted">{data.description}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {!data.isOwner ? (
            <Button
              size="sm"
              variant={data.following ? "outline" : "default"}
              onClick={() =>
                void followList({ data: { id, follow: !data.following } })
                  .then(() => list.refetch())
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
              }
            >
              {data.following ? "Following" : "Follow list"}
            </Button>
          ) : (
            <>
              <Input
                value={name || data.name}
                onChange={(e) => setName(e.target.value)}
                className="max-w-[12rem]"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void updateList({ data: { id, name: name || data.name } })
                    .then(() => {
                      toast.success("List updated");
                      void list.refetch();
                    })
                    .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                }
              >
                Rename
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  void deleteList({ data: { id } })
                    .then(() => {
                      toast.success("List deleted");
                      window.history.back();
                    })
                    .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                }
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-medium">People</p>
        {data.isOwner ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addListMember({ data: { listId: id, username: user.replace(/^@/, "") } })
                .then(() => {
                  setUser("");
                  void list.refetch();
                  void feed.refetch();
                })
                .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
            }}
          >
            <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="@username" />
            <Button type="submit" size="sm" disabled={!user.trim()}>
              Add
            </Button>
          </form>
        ) : null}
        <ul className="mt-3 space-y-2">
          {data.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2">
              <Avatar src={m.avatarUrl} name={m.displayName} size="sm" />
              <Link to="/u/$username" params={{ username: m.username }} className="min-w-0 flex-1 text-sm">
                {m.displayName} <span className="text-muted">@{m.username}</span>
              </Link>
              {data.isOwner ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void removeListMember({ data: { listId: id, username: m.username } }).then(() => {
                      void list.refetch();
                      void feed.refetch();
                    })
                  }
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {(feed.data?.items ?? []).map((p) => (
        <PostCard key={p.id} post={p} onChange={() => void feed.refetch()} />
      ))}
      {(feed.data?.items.length ?? 0) === 0 ? (
        <p className="p-6 text-sm text-muted">No posts from people on this list yet.</p>
      ) : null}
    </div>
  );
}
