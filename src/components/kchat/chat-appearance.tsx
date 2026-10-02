import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CHAT_COLORS,
  CHAT_FONTS,
  CHAT_THEMES,
  CHAT_WALLPAPERS,
  DISAPPEAR_OPTIONS,
  colorHex,
  fontFamily,
  wallpaperCss,
} from "@/lib/kchat/chat-appearance";
import { compressImage } from "@/lib/kchat/media-client";
import { getChatCustomization, saveChatCustomization } from "@/lib/kchat/server/chat-custom";
import { cn } from "@/lib/utils";

export function ChatAppearancePanel({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["chat-custom", conversationId],
    queryFn: () => getChatCustomization({ data: { conversationId } }),
  });
  const save = useMutation({
    mutationFn: (patch: {
      themeId?: string;
      chatColor?: string;
      wallpaperType?: "builtin" | "gallery" | "none";
      wallpaperKey?: string | null;
      wallpaperUrl?: string | null;
      wallpaperW?: number | null;
      wallpaperH?: number | null;
      fontId?: string;
      disappearingEnabled?: boolean;
      disappearingDurationSec?: number;
      remindersEnabled?: boolean;
      applyDisappearToChat?: boolean;
    }) => saveChatCustomization({ data: { conversationId, ...patch } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["chat-custom", conversationId] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save."),
  });
  const c = q.data;
  if (!c) return <p className="p-4 text-sm text-muted">Loading appearance…</p>;

  return (
    <div className="space-y-5 p-4">
      <section>
        <h3 className="text-sm font-semibold">Chat color</h3>
        <div className="mt-2 grid grid-cols-5 gap-2">
          {CHAT_COLORS.map((col) => (
            <button
              key={col.id}
              type="button"
              aria-label={col.label}
              className={cn(
                "h-10 rounded-full border-2",
                c.chatColor === col.id ? "border-fg" : "border-transparent",
              )}
              style={{ background: col.hex }}
              onClick={() => save.mutate({ chatColor: col.id })}
            />
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-semibold">Theme</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {CHAT_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn(
                "rounded-full px-3 py-1.5 text-sm",
                c.themeId === t.id ? "bg-accent text-accent-fg" : "bg-elevated",
              )}
              onClick={() => save.mutate({ themeId: t.id })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-semibold">Wallpaper</h3>
        <div className="kc-hide-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
          {CHAT_WALLPAPERS.map((w) => (
            <button
              key={w.id}
              type="button"
              className={cn(
                "h-16 w-16 shrink-0 rounded-xl border-2",
                c.wallpaperKey === w.id ? "border-fg" : "border-transparent",
              )}
              style={{ background: w.css }}
              aria-label={w.label}
              onClick={() => save.mutate({ wallpaperType: "builtin", wallpaperKey: w.id })}
            />
          ))}
        </div>
        <label className="mt-3 inline-flex">
          <span className="rounded-full bg-elevated px-3 py-1.5 text-sm">My gallery</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              void compressImage(f, { maxEdge: 1600, maxBytes: 420_000 })
                .then((r) =>
                  save.mutate({
                    wallpaperType: "gallery",
                    wallpaperUrl: r.dataUrl,
                    wallpaperW: r.width,
                    wallpaperH: r.height,
                  }),
                )
                .catch((err) => toast.error(err instanceof Error ? err.message : "Could not use that image."));
            }}
          />
        </label>
      </section>
      <section>
        <h3 className="text-sm font-semibold">Font</h3>
        <div className="mt-2 grid max-h-40 grid-cols-2 gap-2 overflow-y-auto">
          {CHAT_FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={cn(
                "rounded-xl px-3 py-2 text-left text-sm",
                c.fontId === f.id ? "bg-accent text-accent-fg" : "bg-elevated",
              )}
              style={{ fontFamily: f.family }}
              onClick={() => save.mutate({ fontId: f.id })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-semibold">Disappearing messages</h3>
        <p className="mt-1 text-xs text-muted">New messages expire on the server after the timer.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DISAPPEAR_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={cn(
                "rounded-full px-3 py-1.5 text-xs",
                c.disappearingDurationSec === o.id ? "bg-accent text-accent-fg" : "bg-elevated",
              )}
              onClick={() =>
                save.mutate({
                  disappearingEnabled: o.id > 0,
                  disappearingDurationSec: o.id,
                  applyDisappearToChat: true,
                })
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>
      <section className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">20-minute reminders</h3>
          <p className="text-xs text-muted">Stop unread pings for this chat.</p>
        </div>
        <Button
          size="sm"
          variant={c.remindersEnabled ? "secondary" : "outline"}
          onClick={() => save.mutate({ remindersEnabled: !c.remindersEnabled })}
        >
          {c.remindersEnabled ? "On" : "Off"}
        </Button>
      </section>
      <p className="text-[11px] text-muted">
        Color, wallpaper, and font are yours only. Disappearing timers apply to new messages in this chat.
      </p>
    </div>
  );
}

export function chatSurfaceStyle(c: {
  chatColor: string;
  wallpaperType: string;
  wallpaperKey: string | null;
  wallpaperUrl: string | null;
  fontId: string;
}) {
  const paper =
    c.wallpaperType === "gallery" && c.wallpaperUrl
      ? `center / cover no-repeat url(${c.wallpaperUrl})`
      : wallpaperCss(c.wallpaperKey);
  return {
    background: paper,
    fontFamily: fontFamily(c.fontId),
    ["--kc-chat-bubble" as string]: colorHex(c.chatColor),
  } as React.CSSProperties;
}
