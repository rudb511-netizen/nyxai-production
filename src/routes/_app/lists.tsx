import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListFilter, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/kchat/empty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createList, listMyLists } from "@/lib/kchat/server/graph";

export const Route = createFileRoute("/_app/lists")({ component: ListsPage });

function ListsPage() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["lists"], queryFn: () => listMyLists() });
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <div className="kc-page px-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Lists</h1>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" /> New
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted">Curate people and read only their posts — same idea as X lists, stored on your account.</p>
      {open ? (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void createList({ data: { name, isPrivate: true } })
              .then((r) => {
                toast.success("List created");
                setName("");
                setOpen(false);
                void q.refetch();
                nav({ to: "/lists/$id", params: { id: r.id } });
              })
              .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="List name" maxLength={40} />
          <Button type="submit" disabled={!name.trim()}>
            Create
          </Button>
        </form>
      ) : null}
      {(q.data?.owned.length ?? 0) === 0 && (q.data?.following.length ?? 0) === 0 && !q.isLoading ? (
        <EmptyState icon={ListFilter} title="No lists yet" body="Group accounts you care about and open a dedicated feed." />
      ) : null}
      <ul className="mt-4 space-y-2">
        {(q.data?.owned ?? []).map((l) => (
          <li key={l.id}>
            <Link to="/lists/$id" params={{ id: l.id }} className="block rounded-2xl bg-elevated p-3">
              <p className="font-medium">{l.name}</p>
              <p className="text-xs text-muted">
                {l.memberCount} people · {l.isPrivate ? "Private" : "Public"} · {l.followerCount} following
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {(q.data?.following.length ?? 0) > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-muted">Following</h2>
          <ul className="mt-2 space-y-2">
            {q.data!.following.map((l) => (
              <li key={l.id}>
                <Link to="/lists/$id" params={{ id: l.id }} className="block rounded-2xl bg-elevated p-3">
                  <p className="font-medium">{l.name}</p>
                  <p className="text-xs text-muted">@{l.ownerUsername} · {l.memberCount} people</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
