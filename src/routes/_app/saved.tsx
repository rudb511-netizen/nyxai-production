import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PostCard } from "@/components/kchat/post-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMeQuery } from "@/lib/kchat/hooks";
import { assignBookmark, createCollection, listCollections } from "@/lib/kchat/server/platform";
import { userPosts } from "@/lib/kchat/server/posts";

export const Route = createFileRoute("/_app/saved")({ component: SavedPage });

function SavedPage() {
  const me = useMeQuery();
  const cols = useQuery({ queryKey: ["collections"], queryFn: () => listCollections() });
  const posts = useQuery({
    queryKey: ["user-posts", me.data?.username, "saved"],
    enabled: Boolean(me.data?.username),
    queryFn: () => userPosts({ data: { username: me.data!.username, tab: "saved" } }),
  });
  const [name, setName] = useState("");
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="kc-page px-4 py-5">
      <h1 className="text-xl font-semibold">Saved</h1>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void createCollection({ data: { name } })
            .then(() => {
              setName("");
              void cols.refetch();
            })
            .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection" />
        <Button type="submit" size="sm">
          Add
        </Button>
      </form>
      <div className="kc-hide-scrollbar mt-3 flex gap-2 overflow-x-auto">
        <Button size="sm" variant={active == null ? "default" : "outline"} onClick={() => setActive(null)}>
          All ({(posts.data?.items ?? []).length})
        </Button>
        {(cols.data?.collections ?? []).map((c) => (
          <Button key={c.id} size="sm" variant={active === c.id ? "default" : "outline"} onClick={() => setActive(c.id)}>
            {c.name} ({c.count})
          </Button>
        ))}
      </div>
      {(posts.data?.items ?? []).map((post) => (
        <div key={post.id}>
          <PostCard post={post} onChange={() => void posts.refetch()} />
          {active ? (
            <Button
              size="sm"
              variant="ghost"
              className="mb-2 ml-4"
              onClick={() => void assignBookmark({ data: { postId: post.id, collectionId: active } }).then(() => cols.refetch())}
            >
              Add to collection
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
