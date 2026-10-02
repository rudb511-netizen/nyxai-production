import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Flame, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { openFlash, peekFlash } from "@/lib/kchat/server/flashes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/flash/$id")({ component: FlashView });

function FlashView() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [opened, setOpened] = useState<Awaited<ReturnType<typeof openFlash>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(5);
  const peek = useQuery({
    queryKey: ["flash-peek", id],
    queryFn: () => peekFlash({ data: { flashId: id } }),
  });

  useEffect(() => {
    const meta = peek.data;
    if (!meta) return;
    if (meta.role !== "recipient" || meta.opened || meta.expired) return;
    let cancel = false;
    void openFlash({ data: { flashId: id } })
      .then((r) => {
        if (cancel) return;
        setOpened(r);
        setLeft(r.durationSec);
      })
      .catch((e) => {
        if (cancel) return;
        setError(e instanceof Error ? e.message : "This Flash is gone.");
      });
    return () => {
      cancel = true;
    };
  }, [peek.data, id]);

  useEffect(() => {
    if (!opened) return;
    const t = window.setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          window.clearInterval(t);
          nav({ to: "/inbox" });
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [opened, nav]);

  const meta = peek.data;
  const gone =
    error ||
    meta?.role === "none" ||
    (meta?.role === "recipient" && (meta.opened || meta.expired)) ||
    (meta?.role === "author" && meta.expired);

  return (
    <div className="relative flex min-h-dvh flex-col bg-bg">
      <header className="absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between px-3">
        <Button variant="ghost" size="icon-sm" onClick={() => nav({ to: "/inbox" })} aria-label="Close">
          <X className="size-5" />
        </Button>
        {opened ? (
          <span className="rounded-full bg-bg/70 px-3 py-1 text-sm tabular-nums text-fg backdrop-blur-md">
            {left}s
          </span>
        ) : (
          <span className="text-sm font-medium">Flash</span>
        )}
        <span className="w-9" />
      </header>
      {opened ? (
        <div className="relative min-h-dvh">
          {opened.mediaKind === "video" ? (
            <video
              src={opened.mediaUrl}
              className={cn("min-h-dvh w-full object-cover", `filter-${opened.filterName}`)}
              autoPlay
              playsInline
            />
          ) : (
            <img
              src={opened.mediaUrl}
              alt=""
              className={cn("min-h-dvh w-full object-cover", `filter-${opened.filterName}`)}
            />
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg to-transparent px-5 pb-10 pt-16">
            <p className="font-medium">{opened.author.displayName}</p>
            {opened.caption ? <p className="mt-1 text-sm text-muted">{opened.caption}</p> : null}
          </div>
        </div>
      ) : gone ? (
        <div className="grid min-h-dvh place-items-center px-6 text-center">
          <div>
            <Flame className="mx-auto size-8 text-streak" />
            <h1 className="mt-4 text-xl font-semibold">
              {meta?.role === "author" ? "You sent this Flash" : "This Flash is gone"}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {meta?.role === "author"
                ? "Recipients can open it once. You don’t get a replay either."
                : "Flashes play once, then burn."}
            </p>
            <Button className="mt-6" onClick={() => nav({ to: "/inbox" })}>
              Back to Inbox
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid min-h-dvh place-items-center text-sm text-muted">Opening…</div>
      )}
    </div>
  );
}
