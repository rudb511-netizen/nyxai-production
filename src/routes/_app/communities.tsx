import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";
import { createCommunity, listCommunities } from "@/lib/kchat/server/more";

export const Route = createFileRoute("/_app/communities")({ component: Communities });

function Communities() {
  const q = useQuery({ queryKey: ["communities"], queryFn: () => listCommunities() });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"channel" | "community">("community");
  const [desc, setDesc] = useState("");

  return (
    <div className="kc-page px-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Spaces</h1>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          New
        </Button>
      </div>
      {open ? (
        <form
          className="mt-4 space-y-3 rounded-2xl bg-elevated p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void createCommunity({ data: { kind, name, description: desc } })
              .then(() => {
                setOpen(false);
                setName("");
                void q.refetch();
              })
              .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
          }}
        >
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={kind === "community" ? "default" : "outline"} onClick={() => setKind("community")}>
              Community
            </Button>
            <Button type="button" size="sm" variant={kind === "channel" ? "default" : "outline"} onClick={() => setKind("channel")}>
              Channel
            </Button>
          </div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" />
          <Button type="submit" className="w-full">
            Create
          </Button>
        </form>
      ) : null}
      <ul className="mt-4 space-y-2">
        {(q.data ?? []).map((c) => (
          <li key={c.id}>
            <Link to="/communities/$id" params={{ id: c.id }} className="block rounded-2xl bg-elevated p-4">
              <p className="font-medium">{c.name}</p>
              <p className="text-sm text-muted">
                {c.kind} · {c.memberCount} members
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
