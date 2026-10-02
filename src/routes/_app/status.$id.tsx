import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Eye, Repeat2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmojiPicker } from "@/components/kchat/emoji-picker";
import { getStatus, listStatuses, reactStatus, replyStatus, reshareStatus, statusViewers } from "@/lib/kchat/server/status";
import { sortStatusesChronological } from "@/lib/kchat/status-ring";
import { useMeQuery } from "@/lib/kchat/hooks";
import { mediaSrc } from "@/lib/kchat/media-upload";
import { saveMediaToDevice } from "@/utils/nativeCapabilities";

export const Route = createFileRoute("/_app/status/$id")({ component: StatusViewer });

const AUDIENCE: Record<string, string> = {
  friends: "Friends",
  except: "Friends except…",
  only: "Only share with…",
};

function StatusViewer() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const me = useMeQuery();
  const tray = useQuery({ queryKey: ["statuses"], queryFn: () => listStatuses() });
  const card = useQuery({
    queryKey: ["status", id],
    queryFn: () => getStatus({ data: { id } }),
    retry: false,
  });
  const status = card.data;
  const authorItems = sortStatusesChronological(
    (tray.data ?? []).filter((s) => s.author.userId === (status?.author.userId ?? tray.data?.find((x) => x.id === id)?.author.userId)),
  );
  const items = authorItems.length ? authorItems : tray.data ?? [];
  const idx = Math.max(0, items.findIndex((s) => s.id === id));
  const mine = Boolean(status && me.data?.userId === status.author.userId);
  const viewers = useQuery({
    queryKey: ["status-viewers", status?.id],
    enabled: Boolean(status && mine),
    queryFn: () => statusViewers({ data: { id: status!.id } }),
  });
  const [text, setText] = useState("");
  const [hold, setHold] = useState(false);
  const [picker, setPicker] = useState(false);
  const [muted, setMuted] = useState(false);
  const swipe = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!status || hold || picker || status.viewOnce) return;
    if (status.mediaKind === "video") return;
    const t = setTimeout(() => {
      const next = items[idx + 1];
      if (next) nav({ to: "/status/$id", params: { id: next.id } });
      else nav({ to: "/" });
    }, 5000);
    return () => clearTimeout(t);
  }, [status?.id, hold, picker, idx, items, nav, status?.viewOnce, status?.mediaKind]);

  if (card.isError) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <p className="text-sm text-muted">
          {card.error instanceof Error ? card.error.message : "This status isn’t available."}
        </p>
        <Button className="mt-4" onClick={() => nav({ to: "/" })}>
          Home
        </Button>
      </div>
    );
  }

  if (!status) return <p className="p-6 text-sm text-muted">Opening status…</p>;

  const gone = status.viewOnce && !mine && !status.mediaUrl && status.opened;

  return (
    <div
      className="flex min-h-dvh flex-col bg-black text-white"
      onPointerDown={() => setHold(true)}
      onPointerUp={() => setHold(false)}
      onTouchStart={(e) => {
        swipe.current.x = e.changedTouches[0]!.clientX;
        swipe.current.y = e.changedTouches[0]!.clientY;
      }}
      onTouchEnd={(e) => {
        const t = e.changedTouches[0]!;
        const dx = t.clientX - swipe.current.x;
        const dy = t.clientY - swipe.current.y;
        if (dy > 72 && Math.abs(dx) < 48) {
          nav({ to: "/inbox" });
          return;
        }
        if (dx < -56 && Math.abs(dy) < 48 && items[idx + 1]) {
          nav({ to: "/status/$id", params: { id: items[idx + 1]!.id } });
        }
        if (dx > 56 && Math.abs(dy) < 48 && idx > 0) {
          nav({ to: "/status/$id", params: { id: items[idx - 1]!.id } });
        }
      }}
    >
      <div className="flex gap-1 px-3 pt-3">
        {items.map((s, i) => (
          <div key={s.id} className="h-0.5 flex-1 rounded-full bg-white/30">
            <div className={`h-full rounded-full ${i <= idx ? "bg-white" : ""}`} />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="px-4 py-3 text-left text-sm"
        onClick={() => nav({ to: "/u/$username", params: { username: status.author.username } })}
      >
        @{status.author.username} · Status · {AUDIENCE[status.audience] ?? "Friends"}
        {status.viewOnce ? " · View once" : ""}
        {mine && status.viewerCount ? ` · ${status.viewerCount} view${status.viewerCount === 1 ? "" : "s"}` : ""}
        {status.originalAuthor ? ` · Reshared from @${status.originalAuthor.username}` : ""}
      </button>
      <div
        className="flex flex-1 items-center justify-center px-4"
        style={{ background: status.background ?? "#111" }}
        onClick={(e) => {
          const x = e.clientX;
          const w = window.innerWidth;
          if (x < w / 3 && idx > 0) nav({ to: "/status/$id", params: { id: items[idx - 1]!.id } });
          if (x > (w * 2) / 3 && items[idx + 1]) {
            nav({ to: "/status/$id", params: { id: items[idx + 1]!.id } });
          }
        }}
      >
        {gone ? (
          <div className="max-w-xs text-center">
            <Eye className="mx-auto size-8 opacity-70" />
            <p className="mt-3 text-lg font-medium">Opened</p>
            <p className="mt-1 text-sm text-white/70">
              This photo isn’t available again. This device cannot block screenshots.
            </p>
          </div>
        ) : status.mediaUrl && status.mediaKind === "photo" ? (
          <img src={mediaSrc(status.mediaUrl)} alt="" className="max-h-[70dvh] object-contain" />
        ) : status.mediaUrl && status.mediaKind === "video" ? (
          <video
            src={mediaSrc(status.mediaUrl)}
            autoPlay
            playsInline
            muted={muted}
            className="max-h-[70dvh]"
            onEnded={() => {
              if (hold || picker || status.viewOnce) return;
              const next = items[idx + 1];
              if (next) nav({ to: "/status/$id", params: { id: next.id } });
              else nav({ to: "/" });
            }}
          />
        ) : (
          <p className="text-center text-2xl font-medium">{status.textBody}</p>
        )}
      </div>
      {picker ? (
        <div className="p-3">
          <EmojiPicker
            onPick={(emoji) => {
              void reactStatus({ data: { id: status.id, emoji } })
                .then(() => {
                  toast.success("Reaction sent to their chat");
                  setPicker(false);
                })
                .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
            }}
          />
        </div>
      ) : null}
      <form
        className="flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void replyStatus({ data: { id: status.id, body: text } })
            .then((r) => {
              setText("");
              toast.success("Reply sent");
              nav({ to: "/inbox/$id", params: { id: r.conversationId } });
            })
            .catch((err) => toast.error(err instanceof Error ? err.message : "Failed"));
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Reply in chat"
          className="border-white/20 bg-white/10 text-white"
        />
        <Button type="button" variant="secondary" onClick={() => setPicker((v) => !v)}>
          React
        </Button>
        {status.mediaKind === "video" ? (
          <Button type="button" variant="secondary" onClick={() => setMuted((v) => !v)}>
            {muted ? "Unmute" : "Mute"}
          </Button>
        ) : null}
        {!mine && status.allowReshare ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void reshareStatus({ data: { id: status.id } })
                .then(() => {
                  toast.success("Reshared to your status");
                  void tray.refetch();
                })
                .catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't reshare."))
            }
          >
            <Repeat2 className="size-4" />
            Reshare
          </Button>
        ) : null}
        {status.mediaUrl && !status.viewOnce ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void saveMediaToDevice(status.mediaUrl!, {
                fileName: `status-${status.id}`,
                mime: status.mediaKind === "video" ? "video/mp4" : "image/jpeg",
              }).then((r) => {
                if (r.ok) toast.success("Saved");
                else toast.error(r.error);
              })
            }
          >
            Save
          </Button>
        ) : null}
        <Button type="submit">Send</Button>
        <Button type="button" variant="ghost" onClick={() => nav({ to: "/" })}>
          Close
        </Button>
      </form>
      {mine && (viewers.data ?? []).length > 0 ? (
        <p className="px-4 pb-4 text-xs text-white/70">
          Seen by {(viewers.data ?? []).map((v) => v.displayName).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
