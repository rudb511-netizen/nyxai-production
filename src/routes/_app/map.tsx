import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ghost, MapPin } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { atlasFriends, pingAtlas, setGhost } from "@/lib/kchat/server/flashes";
import { useMeQuery } from "@/lib/kchat/hooks";
import { getCurrentPosition } from "@/utils/nativeCapabilities";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/map")({ component: Atlas });

function project(
  lat: number,
  lng: number,
  origin: { lat: number; lng: number },
): { x: number; y: number } {
  const dx = (lng - origin.lng) * Math.cos((origin.lat * Math.PI) / 180);
  const dy = lat - origin.lat;
  const scale = 180;
  return {
    x: Math.max(8, Math.min(92, 50 + dx * scale)),
    y: Math.max(10, Math.min(88, 50 - dy * scale)),
  };
}

function Atlas() {
  const me = useMeQuery();
  const qc = useQueryClient();
  const atlas = useQuery({ queryKey: ["atlas"], queryFn: () => atlasFriends(), refetchInterval: 20_000 });
  const ghost = atlas.data?.me.ghost ?? me.data?.ghostMode ?? true;

  const ping = useMutation({
    mutationFn: (d: { lat: number; lng: number; ghost?: boolean }) => pingAtlas({ data: d }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["atlas"] }),
  });

  useEffect(() => {
    let cancelled = false;
    void getCurrentPosition().then((pos) => {
      if (cancelled || !pos) return;
      ping.mutate({ lat: pos.lat, lng: pos.lng });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const origin = {
    lat: atlas.data?.me.lat ?? 0,
    lng: atlas.data?.me.lng ?? 0,
  };
  const hasMe = atlas.data?.me.lat != null && atlas.data?.me.lng != null;
  const friends = (atlas.data?.friends ?? []).filter(Boolean) as Array<{
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    lat: number;
    lng: number;
  }>;

  async function toggleGhost() {
    try {
      await setGhost({ data: { ghost: !ghost } });
      toast.success(!ghost ? "Ghost on — you’re hidden." : "Ghost off — friends can see a rough ping.");
      void qc.invalidateQueries({ queryKey: ["atlas"] });
      void me.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update Ghost.");
    }
  }

  return (
    <div className="kc-page px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Atlas</h1>
          <p className="mt-1 text-sm text-muted">Friends who turned Ghost off. Pings fade after a day.</p>
        </div>
        <Button
          variant={ghost ? "secondary" : "outline"}
          size="sm"
          onClick={() => void toggleGhost()}
          className={cn(!ghost && "text-atlas")}
        >
          <Ghost className="size-4" />
          {ghost ? "Ghost on" : "Ghost off"}
        </Button>
      </div>
      <div className="relative mt-4 aspect-[3/4] overflow-hidden rounded-3xl bg-elevated">
        <div className="atlas-grid absolute inset-0" />
        {hasMe && !ghost ? (
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: "50%", top: "50%" }}
          >
            <span className="grid size-4 place-items-center rounded-full bg-capture ring-4 ring-capture/30" />
          </div>
        ) : null}
        {ghost ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <Ghost className="mx-auto size-8 text-ai" />
              <p className="mt-3 font-medium">You’re a ghost</p>
              <p className="mt-1 text-sm text-muted">Friends can’t see you. Turn Ghost off to drop a ping.</p>
            </div>
          </div>
        ) : friends.length === 0 ? (
          <div className="absolute inset-x-0 bottom-6 px-6 text-center text-sm text-muted">
            No friend pings yet. They have to turn Ghost off too.
          </div>
        ) : (
          friends.map((f) => {
            const p = project(f.lat, f.lng, hasMe ? origin : { lat: f.lat, lng: f.lng });
            return (
              <Link
                key={f.userId}
                to="/u/$username"
                params={{ username: f.username }}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <Avatar src={f.avatarUrl} name={f.displayName} className="size-10 ring-2 ring-atlas" />
              </Link>
            );
          })
        )}
      </div>
      <ul className="mt-4 space-y-1">
        {friends.map((f) => (
          <li key={f.userId}>
            <Link
              to="/u/$username"
              params={{ username: f.username }}
              className="flex items-center gap-3 rounded-xl px-1 py-2 hover:bg-elevated"
            >
              <Avatar src={f.avatarUrl} name={f.displayName} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{f.displayName}</p>
                <p className="text-xs text-muted">@{f.username}</p>
              </div>
              <MapPin className="size-4 text-atlas" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
