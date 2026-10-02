import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Search, Sparkles, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { listStickerPacks, toggleFavoriteSticker, toggleStickerPack } from "@/lib/kchat/server/comms";
import { NYX_STICKER_PACKS, searchStickers, stickerRenderUrl } from "@/lib/kchat/stickers";
import { cn } from "@/lib/utils";
import { StickerBubble } from "./sticker-bubble";

const CACHE_KEY = "nyx-sticker-installed";

export type PickedSticker = {
  packId: string;
  stickerId: string;
  emoji: string;
  name: string;
  url: string;
  mediaKind?: string;
};

type Tab = "recent" | "favorites" | "packs" | "store";

function readCachedInstalls(): string[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeCachedInstalls(ids: string[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function tileUrl(packId: string, stickerId: string, url?: string | null) {
  return url || stickerRenderUrl({ packId, stickerId }) || "";
}

export function StickerPicker({
  onPick,
  compact,
}: {
  onPick: (sticker: PickedSticker) => void;
  compact?: boolean;
}) {
  const packs = useQuery({
    queryKey: ["sticker-packs"],
    queryFn: () => listStickerPacks(),
    staleTime: 30_000,
  });
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("packs");
  const [packId, setPackId] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const data = packs.data;
  const cached = useMemo(() => readCachedInstalls(), [data]);

  const installedIds = useMemo(() => {
    const ids = (data?.packs ?? []).filter((p) => p.installed).map((p) => p.id);
    if (ids.length) writeCachedInstalls(ids);
    return ids.length ? ids : cached;
  }, [data, cached]);

  const favSet = new Set(data?.favoriteIds ?? []);
  const catalogFallback = useMemo(() => {
    if (data?.packs?.length) return [];
    return NYX_STICKER_PACKS.filter((p) => installedIds.includes(p.id) || installedIds.length === 0).map((p) => ({
      id: p.id,
      title: p.title,
      authorName: p.authorName,
      description: p.description,
      category: p.category,
      kind: "official",
      coverUrl: null as string | null,
      stickerCount: p.stickers.length,
      animated: p.stickers.some((s) => s.animated),
      installed: true,
      mine: false,
      stickers: p.stickers.map((s) => ({
        id: s.id,
        name: s.name,
        emoji: s.emoji,
        tags: s.tags.join(" "),
        animated: Boolean(s.animated),
        mediaKind: "svg",
        url: "",
      })),
    }));
  }, [data, installedIds]);

  const allPacks = data?.packs?.length ? data.packs : catalogFallback;
  const installed = allPacks.filter((p) => p.installed);
  const store = allPacks.filter((p) => !p.installed);
  const activePack = installed.find((p) => p.id === packId) ?? installed[0] ?? null;

  const allStickers = useMemo(() => {
    const out: PickedSticker[] = [];
    for (const p of allPacks) {
      for (const s of p.stickers) {
        out.push({
          packId: p.id,
          stickerId: s.id,
          emoji: s.emoji,
          name: s.name || s.emoji,
          url: tileUrl(p.id, s.id, s.url),
          mediaKind: s.mediaKind,
        });
      }
    }
    return out;
  }, [allPacks]);

  const searchHits = useMemo(() => {
    if (!needle) return [];
    const local = searchStickers(needle).map((s) => ({
      packId: s.packId,
      stickerId: s.id,
      emoji: s.emoji,
      name: s.name,
      url: tileUrl(s.packId, s.id),
      mediaKind: s.animated ? "svg" : "svg",
    }));
    const extra = allStickers.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.emoji.toLowerCase().includes(needle) ||
        s.packId.toLowerCase().includes(needle),
    );
    const seen = new Set(local.map((s) => s.stickerId));
    return [...local, ...extra.filter((s) => !seen.has(s.stickerId))].slice(0, 80);
  }, [needle, allStickers]);

  const recent = (data?.recentIds ?? [])
    .map((id) => allStickers.find((s) => s.stickerId === id))
    .filter(Boolean) as PickedSticker[];

  const favorites = allStickers.filter((s) => favSet.has(s.stickerId));

  function pick(s: PickedSticker) {
    if (!s.stickerId) return;
    onPick({ ...s, url: s.url || tileUrl(s.packId, s.stickerId) });
  }

  function Grid({ items }: { items: PickedSticker[] }) {
    if (!items.length) return <p className="py-6 text-center text-sm text-muted">Nothing here yet.</p>;
    return (
      <div className="grid grid-cols-5 gap-1 sm:grid-cols-6">
        {items.map((s) => (
          <div key={`${s.packId}:${s.stickerId}`} className="relative">
            <button
              type="button"
              className="grid aspect-square w-full place-items-center rounded-xl bg-elevated p-1"
              onClick={() => pick(s)}
              aria-label={s.name}
            >
              <StickerBubble
                packId={s.packId}
                stickerId={s.stickerId}
                mediaUrl={s.url || null}
                name={s.name}
                mediaKind={s.mediaKind}
                className="mt-0 size-12"
              />
            </button>
            <button
              type="button"
              className={cn("absolute right-0 top-0 grid size-7 place-items-center", favSet.has(s.stickerId) ? "text-like" : "text-subtle")}
              aria-label={favSet.has(s.stickerId) ? "Remove favorite" : "Favorite"}
              onClick={() => void toggleFavoriteSticker({ data: { stickerId: s.stickerId } }).then(() => packs.refetch())}
            >
              <Star className={cn("size-3.5", favSet.has(s.stickerId) && "fill-current")} />
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2 rounded-2xl border border-border bg-surface p-3", compact && "max-h-72 overflow-y-auto")}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search stickers"
          aria-label="Search stickers"
          className="pl-9"
        />
      </div>
      {needle ? (
        <Grid items={searchHits} />
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto text-xs">
            {(
              [
                ["recent", "Recent"],
                ["favorites", "Favorites"],
                ["packs", "Packs"],
                ["store", "Store"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={cn("shrink-0 rounded-full px-3 py-1.5", tab === id ? "bg-elevated text-fg" : "text-muted")}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
            <Link
              to="/stickers/create"
              className="inline-flex h-10 min-h-10 shrink-0 items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-accent-fg"
            >
              <Plus className="size-3.5" /> Create
            </Link>
          </div>
          {tab === "recent" ? <Grid items={recent} /> : null}
          {tab === "favorites" ? <Grid items={favorites} /> : null}
          {tab === "packs" ? (
            <div className="space-y-2">
              <div className="flex gap-1 overflow-x-auto">
                {installed.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1.5 text-xs",
                      (activePack?.id ?? "") === p.id ? "bg-fg text-bg" : "bg-elevated text-muted",
                    )}
                    onClick={() => setPackId(p.id)}
                  >
                    {p.title}
                  </button>
                ))}
              </div>
              {activePack ? (
                <Grid
                  items={activePack.stickers.map((s) => ({
                    packId: activePack.id,
                    stickerId: s.id,
                    emoji: s.emoji,
                    name: s.name || s.emoji,
                    url: tileUrl(activePack.id, s.id, s.url),
                    mediaKind: s.mediaKind,
                  }))}
                />
              ) : (
                <p className="py-6 text-center text-sm text-muted">Download a pack from the store.</p>
              )}
            </div>
          ) : null}
          {tab === "store" ? (
            <div className="space-y-3">
              {store.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">Every official pack is already yours.</p>
              ) : (
                store.map((p) => (
                  <div key={p.id} className="rounded-2xl border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{p.title}</p>
                        <p className="text-xs text-muted">
                          {p.authorName} · {p.stickerCount || p.stickers.length} stickers
                          {p.animated ? " · animated" : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="rounded-full bg-accent px-3 py-1 text-xs text-bg"
                        onClick={() =>
                          void toggleStickerPack({ data: { packId: p.id, install: true } }).then(() => packs.refetch())
                        }
                      >
                        Download
                      </button>
                    </div>
                    <div className="mt-2 flex gap-1 overflow-x-auto">
                      {p.stickers.slice(0, 6).map((s) => (
                        <StickerBubble
                          key={s.id}
                          packId={p.id}
                          stickerId={s.id}
                          mediaUrl={s.url}
                          name={s.name}
                          mediaKind={s.mediaKind}
                          className="mt-0 size-10 shrink-0"
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
              <Link to="/stickers" className="flex items-center justify-center gap-1 py-2 text-sm text-accent">
                <Sparkles className="size-4" /> Open sticker store
              </Link>
            </div>
          ) : null}
        </>
      )}
      {packs.isError ? (
        <p className="text-center text-xs text-danger">
          Couldn’t refresh packs. Downloaded stickers still work offline.
        </p>
      ) : null}
    </div>
  );
}
