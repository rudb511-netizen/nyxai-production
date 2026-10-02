import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { createEvent, listEvents, rsvpEvent } from "@/lib/kchat/server/platform";

export const Route = createFileRoute("/_app/events")({ component: EventsPage });

function EventsPage() {
  const q = useQuery({ queryKey: ["events"], queryFn: () => listEvents(), refetchInterval: 15_000 });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [location, setLocation] = useState("");
  const [online, setOnline] = useState(false);

  return (
    <div className="kc-page px-4 py-5 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Events</h1>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          New
        </Button>
      </div>
      {open ? (
        <form
          className="space-y-3 rounded-2xl bg-elevated p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void createEvent({ data: { title, description, startsAt, location, isOnline: online } })
              .then(() => {
                setOpen(false);
                setTitle("");
                void q.refetch();
                toast.success("Event published");
              })
              .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is it?" />
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location or link" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
            Online
          </label>
          <Button type="submit" className="w-full">
            Publish event
          </Button>
        </form>
      ) : null}
      <ul className="space-y-3">
        {(q.data ?? []).map((ev) => (
          <li key={ev.id} className="kc-card p-4">
            <p className="font-medium">{ev.title}</p>
            <p className="mt-1 text-sm text-muted">{ev.description}</p>
            <p className="mt-1 text-xs text-subtle">
              {new Date(ev.startsAt).toLocaleString()} · {ev.isOnline ? "Online" : ev.location || "Location TBA"} · {ev.going} going
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant={ev.myRsvp === "going" ? "default" : "outline"}
                onClick={() => void rsvpEvent({ data: { id: ev.id, status: "going" } }).then(() => q.refetch())}
              >
                Going
              </Button>
              <Button
                size="sm"
                variant={ev.myRsvp === "interested" ? "default" : "outline"}
                onClick={() => void rsvpEvent({ data: { id: ev.id, status: "interested" } }).then(() => q.refetch())}
              >
                Interested
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
