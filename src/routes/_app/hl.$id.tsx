import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { deleteHighlight, getHighlight, removeHighlightStory } from "@/lib/kchat/server/graph";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/hl/$id")({ component: HighlightReel });

function HighlightReel() {
  const { id } = Route.useParams();
  const q = useQuery({ queryKey: ["highlight", id], queryFn: () => getHighlight({ data: { id } }) });
  const data = q.data;
  if (q.isError) return <p className="p-6 text-sm text-muted">{(q.error as Error).message}</p>;
  if (!data) return <p className="p-6 text-sm text-muted">Loading…</p>;

  return (
    <div className="kc-page px-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{data.name}</h1>
        {data.isSelf ? (
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              void deleteHighlight({ data: { id } })
                .then(() => {
                  toast.success("Highlight deleted");
                  window.history.back();
                })
                .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
            }
          >
            Delete
          </Button>
        ) : null}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-1">
        {data.items.map((s) => (
          <div key={s.id} className="relative aspect-[9/16] overflow-hidden rounded-lg bg-elevated">
            <Link to="/story/$id" params={{ id: s.id }} className="block size-full">
              {s.mediaUrl && s.mediaKind !== "text" ? (
                s.mediaKind === "video" ? (
                  <video src={s.mediaUrl} className="size-full object-cover" muted />
                ) : (
                  <img src={s.mediaUrl} alt="" className="size-full object-cover" />
                )
              ) : (
                <div className="grid size-full place-items-center px-2 text-center text-xs" style={{ background: s.background ?? "#121214" }}>
                  {s.textBody}
                </div>
              )}
            </Link>
            {data.isSelf ? (
              <button
                type="button"
                className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white"
                onClick={() =>
                  void removeHighlightStory({ data: { highlightId: id, storyId: s.id } }).then(() => q.refetch())
                }
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {data.items.length === 0 ? <p className="mt-6 text-sm text-muted">This highlight is empty.</p> : null}
    </div>
  );
}
