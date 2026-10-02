import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { communityFeed, joinCommunity, postToCommunity } from "@/lib/kchat/server/more";
import { timeAgo } from "@/lib/utils";

export const Route = createFileRoute("/_app/communities/$id")({ component: Community });

function Community() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ["community", id],
    queryFn: () => communityFeed({ data: { id } }),
  });
  const [body, setBody] = useState("");
  if (!q.data) return <p className="p-6 text-sm text-muted">Loading…</p>;
  const c = q.data.community;
  const canPost =
    q.data.isMember &&
    (c.kind !== "channel" || ["owner", "admin", "moderator"].includes(q.data.role ?? ""));
  return (
    <div>
      <div className="border-b border-border px-4 py-4">
        <h1 className="text-xl font-semibold">{c.name}</h1>
        <p className="mt-1 text-sm text-muted">{c.description}</p>
        <p className="mt-1 text-xs text-subtle">
          {c.kind === "channel" ? "Channel · admins publish" : "Community"} · {c.member_count} members
        </p>
        <Button
          className="mt-3"
          size="sm"
          variant={q.data.isMember ? "outline" : "default"}
          onClick={() =>
            void joinCommunity({ data: { id, join: !q.data.isMember } }).then(() => q.refetch())
          }
        >
          {q.data.isMember ? "Joined" : "Join"}
        </Button>
      </div>
      {canPost ? (
        <form
          className="space-y-2 border-b border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void postToCommunity({ data: { id, body } })
              .then(() => {
                setBody("");
                void q.refetch();
              })
              .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
          }}
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={c.kind === "channel" ? "Publish to subscribers" : "Post to this space"}
          />
          <Button type="submit" size="sm">
            Post
          </Button>
        </form>
      ) : null}
      <ul>
        {q.data.posts.map((p) => (
          <li key={p.id} className="flex gap-3 border-b border-border px-4 py-3">
            <Avatar src={p.author.avatarUrl} name={p.author.displayName} />
            <div>
              <p className="text-sm font-medium">
                {p.author.displayName}{" "}
                <span className="font-normal text-subtle">{timeAgo(p.createdAt)}</span>
              </p>
              <p className="text-sm">{p.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
