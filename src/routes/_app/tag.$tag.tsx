import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Hash } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/kchat/empty";
import { NameMark } from "@/components/kchat/verified-badge";
import { Button } from "@/components/ui/button";
import { listTagFeed } from "@/lib/kchat/server/more";
import { followHashtag, hashtagState } from "@/lib/kchat/server/graph";
import { formatCount, timeAgo } from "@/lib/utils";

export const Route = createFileRoute("/_app/tag/$tag")({ component: TagFeed });

function TagFeed() {
  const { tag } = Route.useParams();
  const q = useQuery({
    queryKey: ["tag", tag],
    queryFn: () => listTagFeed({ data: { tag } }),
  });
  const state = useQuery({
    queryKey: ["tag-state", tag],
    queryFn: () => hashtagState({ data: { tag } }),
  });
  const data = q.data;
  if (q.isError) return <p className="p-6 text-sm text-muted">{(q.error as Error).message}</p>;
  const empty = (data?.posts.length ?? 0) === 0 && (data?.videos.length ?? 0) === 0 && !q.isLoading;

  return (
    <div className="kc-page px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">#{data?.tag ?? tag}</h1>
          <p className="mt-1 text-sm text-muted">
            {formatCount(state.data?.useCount ?? 0)} posts · {formatCount(state.data?.followers ?? 0)} following
          </p>
        </div>
        <Button
          size="sm"
          variant={state.data?.following ? "outline" : "default"}
          onClick={() =>
            void followHashtag({ data: { tag, follow: !state.data?.following } })
              .then((r) => {
                toast.success(r.following ? `Following #${r.tag}` : `Unfollowed #${r.tag}`);
                void state.refetch();
              })
              .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
          }
        >
          {state.data?.following ? "Following" : "Follow"}
        </Button>
      </div>
      {empty ? (
        <EmptyState icon={Hash} title="Nothing tagged yet" body="Be the first to post with this hashtag." />
      ) : null}
      {(data?.videos.length ?? 0) > 0 ? (
        <div className="mt-4 grid grid-cols-3 gap-1">
          {data!.videos.map((v) => (
            <Link key={v.id} to="/watch" className="aspect-[9/16] overflow-hidden rounded-lg bg-elevated">
              {v.thumbUrl ? (
                <img src={v.thumbUrl} alt="" className="size-full object-cover" />
              ) : (
                <video src={v.mediaUrl} className="size-full object-cover" muted />
              )}
            </Link>
          ))}
        </div>
      ) : null}
      <ul className="mt-4 space-y-3">
        {(data?.posts ?? []).map((p) => (
          <li key={p.id} className="rounded-2xl border border-border p-3">
            <Link to="/u/$username" params={{ username: p.author.username }} className="text-sm font-medium">
              <NameMark name={p.author.displayName} verifyKind={p.author.verifyKind} isArc={p.author.isArc} isPremium={p.author.isPremium} />
            </Link>
            <Link to="/p/$id" params={{ id: p.id }} className="mt-1 block text-sm">
              {p.body}
            </Link>
            <p className="mt-1 text-[11px] text-subtle">{timeAgo(p.createdAt)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
