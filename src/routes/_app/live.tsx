import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Mic, Radio } from "lucide-react";
import { EmptyState } from "@/components/kchat/empty";
import { StatusAvatar } from "@/components/kchat/status-avatar";
import { useLiveHostMap } from "@/components/kchat/use-live-hosts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listLive } from "@/lib/kchat/server/more";

export const Route = createFileRoute("/_app/live")({ component: LiveList });

function LiveList() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["live"], queryFn: () => listLive(), refetchInterval: 8000 });
  const items = q.data ?? [];
  const audio = items.filter((l) => l.kind === "audio");
  const video = items.filter((l) => l.kind !== "audio");
  return (
    <div className="kc-page px-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Live</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              try {
                sessionStorage.setItem("omni-create-tab", "live");
              } catch {
                /* ignore */
              }
              nav({ to: "/create" });
            }}
          >
            Audio room
          </Button>
          <Button
            size="sm"
            onClick={() => {
              try {
                sessionStorage.setItem("omni-create-tab", "live");
              } catch {
                /* ignore */
              }
              nav({ to: "/create" });
            }}
          >
            Go live
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="Nobody is live"
          body="Start a video stream or an audio room from Create. Viewers join over a real WebRTC session."
        />
      ) : null}
      {audio.length > 0 ? (
        <section className="mt-4">
          <h2 className="text-sm font-medium text-muted">Audio rooms</h2>
          <ul className="mt-2 space-y-2">
            {audio.map((l) => (
              <LiveRow key={l.id} l={l} audio />
            ))}
          </ul>
        </section>
      ) : null}
      {video.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {video.map((l) => (
            <LiveRow key={l.id} l={l} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LiveRow({
  l,
  audio,
}: {
  l: {
    id: string;
    title: string;
    viewers?: number;
    host: { userId?: string; username: string; displayName: string; avatarUrl: string | null };
  };
  audio?: boolean;
}) {
  const hosts = useLiveHostMap();
  const nav = useNavigate();
  const liveId = (l.host.userId && hosts.get(l.host.userId)) || l.id;
  return (
    <li className="flex items-center gap-2 rounded-2xl bg-elevated p-3">
      <Link to="/live/$id" params={{ id: l.id }} className="flex min-w-0 flex-1 items-center gap-3">
        <StatusAvatar src={l.host.avatarUrl} name={l.host.displayName} liveId={liveId} interactive={false} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{l.title}</p>
          <p className="text-sm text-muted">
            @{l.host.username}
            {typeof l.viewers === "number" ? ` · ${l.viewers} watching` : ""}
          </p>
        </div>
        <Badge tone="live">
          {audio ? (
            <>
              <Mic className="mr-1 size-3" />
              ROOM
            </>
          ) : (
            "LIVE"
          )}
        </Badge>
      </Link>
      <button
        type="button"
        className="kc-pay-glow min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold !text-white"
        onClick={() => {
          try {
            sessionStorage.setItem("nyx-join-live", l.id);
          } catch {
            /* ignore */
          }
          nav({ to: "/live/$id", params: { id: l.id } });
        }}
      >
        Join Live
      </button>
    </li>
  );
}
