import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { inboxUnreadCount } from "@/lib/kchat/server/chat-custom";
import { useMeQuery } from "@/lib/kchat/hooks";
import { cn } from "@/lib/utils";

export function IncomingMessageHost() {
  const me = useMeQuery();
  const nav = useNavigate();
  const prefs = me.data?.notifPrefs;
  const q = useQuery({
    queryKey: ["inbox-unread"],
    queryFn: () => inboxUnreadCount(),
    refetchInterval: 4000,
    enabled: Boolean(me.data),
  });
  const [banner, setBanner] = useState<{
    conversationId: string;
    body: string;
    senderName: string;
    senderAvatar: string | null;
  } | null>(null);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    const p = q.data?.preview;
    if (!p) return;
    const key = `${p.conversationId}:${p.body}`;
    if (seen.current === key) return;
    const first = seen.current === null;
    seen.current = key;
    if (first) return;
    if (prefs?.messages === false || prefs?.messagePopup === false) return;
    if (typeof document !== "undefined" && document.hidden) {
      try {
        if (Notification.permission === "granted") {
          new Notification(`${p.senderName} on NYX`, { body: p.body.slice(0, 80), silent: false });
        } else if (Notification.permission === "default") {
          void Notification.requestPermission();
        }
      } catch {
        /* notifications unsupported */
      }
      return;
    }
    setBanner(p);
    const t = window.setTimeout(() => setBanner(null), 5200);
    return () => window.clearTimeout(t);
  }, [q.data?.preview?.conversationId, q.data?.preview?.body, prefs?.messages, prefs?.messagePopup]);

  if (!banner) return null;
  return (
    <button
      type="button"
      className={cn(
        "kc-incoming-msg fixed left-1/2 top-[max(0.75rem,var(--kc-safe-top))] z-50 flex w-[min(92%,24rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-border bg-surface/95 px-3 py-2.5 text-left shadow-(--shadow-border-hover) backdrop-blur-md",
      )}
      onClick={() => {
        nav({ to: "/inbox/$id", params: { id: banner.conversationId } });
        setBanner(null);
      }}
    >
      <Avatar src={banner.senderAvatar} name={banner.senderName} className="size-10" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{banner.senderName}</span>
        <span className="block truncate text-xs text-muted">{banner.body}</span>
      </span>
    </button>
  );
}

export function formatUnreadBadge(n: number): string {
  if (n <= 0) return "";
  if (n > 99) return "99+";
  return String(n);
}
