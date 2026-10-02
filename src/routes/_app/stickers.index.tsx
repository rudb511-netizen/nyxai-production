import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { StickerBubble } from "@/components/kchat/sticker-bubble";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listStickerPacks, toggleStickerPack } from "@/lib/kchat/server/comms";
import {
  deleteCustomSticker,
  deleteStickerPack,
  exportStickerPack,
  importStickerPack,
  renameStickerPack,
  reportSticker,
} from "@/lib/kchat/server/stickers";
import { searchStickers } from "@/lib/kchat/stickers";
import { copyText, nativeShare } from "@/utils/nativeCapabilities";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/stickers/")({ component: StickerStore });

function StickerStore() {
  const packs = useQuery({ queryKey: ["sticker-packs"], queryFn: () => listStickerPacks() });
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"store" | "mine" | "search">("store");
  const [openId, setOpenId] = useState<string | null>(null);
  const needle = q.trim();
  const all = packs.data?.packs ?? [];
  const mine = all.filter((p) => p.mine || p.kind === "custom");
  const store = all.filter((p) => p.kind !== "custom");
  const hits = needle ? searchStickers(needle).slice(0, 60) : [];

  async function download(id: string, install: boolean) {
    try {
      await toggleStickerPack({ data: { packId: id, install } });
      toast.success(install ? "Pack downloaded." : "Pack removed from your picker.");
      void packs.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update pack.");
    }
  }

  async function sharePack(id: string, title: string) {
    try {
      const payload = await exportStickerPack({ data: { packId: id } });
      const text = `${payload.title} · ${payload.stickers.length} stickers on NYX`;
      const ok = await nativeShare({ title: payload.title, text });
      if (!ok) {
        await copyText(JSON.stringify(payload));
        toast.success("Pack copied.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not share pack.");
    }
  }

  async function exportFile(id: string, title: string) {
    try {
      const payload = await exportStickerPack({ data: { packId: id } });
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/\s+/g, "-").toLowerCase() || "pack"}.nyx-stickers.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Pack exported.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export pack.");
    }
  }

  return (
    <div className="mx-auto max-w-lg pb-24">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Stickers</h1>
          <Button size="sm" className="h-11 min-h-11" asChild>
            <Link to="/stickers/create">Create</Link>
          </Button>
        </div>
        <Input
          className="mt-3"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value.trim()) setTab("search");
          }}
          placeholder="Search names, tags, omo, love, gaming…"
        />
        <div className="mt-3 flex gap-2 text-xs">
          {(["store", "mine"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={cn("rounded-full px-3 py-1.5 capitalize", tab === t ? "bg-fg text-bg" : "bg-elevated text-muted")}
              onClick={() => setTab(t)}
            >
              {t === "store" ? "Store" : "My stickers"}
            </button>
          ))}
          <label className="ml-auto cursor-pointer rounded-full bg-elevated px-3 py-1.5 text-muted">
            Import
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                void f.text().then(async (raw) => {
                  try {
                    const payload = JSON.parse(raw) as { title?: string; stickers?: Array<{ name?: string; mediaUrl?: string | null; mediaKind?: string }> };
                    const r = await importStickerPack({ data: { payload } });
                    toast.success(`Imported ${r.title} (${r.count}).`);
                    void packs.refetch();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not import that file.");
                  }
                });
              }}
            />
          </label>
        </div>
      </header>
      <div className="space-y-3 p-4">
        {tab === "search" || needle ? (
          hits.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No stickers match “{needle}”.</p>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {hits.map((s) => (
                <StickerBubble
                  key={s.id}
                  packId={s.packId}
                  stickerId={s.id}
                  name={s.name}
                  className="mt-0 size-14"
                />
              ))}
            </div>
          )
        ) : (
          (tab === "mine" ? mine : store).map((p) => {
            const open = openId === p.id;
            return (
              <article key={p.id} className="rounded-2xl border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" className="min-w-0 text-left" onClick={() => setOpenId(open ? null : p.id)}>
                    <p className="font-medium">{p.title}</p>
                    <p className="text-xs text-muted">
                      {p.authorName} · {p.stickerCount || p.stickers.length} stickers
                      {p.animated ? " · animated" : ""} · {p.category}
                    </p>
                    {p.description ? <p className="mt-1 text-xs text-muted">{p.description}</p> : null}
                  </button>
                  {p.kind === "custom" && p.mine ? (
                    <Button size="sm" variant="outline" onClick={() => void download(p.id, !p.installed)}>
                      {p.installed ? "Hide" : "Add"}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => void download(p.id, !p.installed)}>
                      {p.installed ? "Remove" : "Download"}
                    </Button>
                  )}
                </div>
                <div className="mt-2 flex gap-1 overflow-x-auto">
                  {p.stickers.slice(0, 8).map((s) => (
                    <StickerBubble
                      key={s.id}
                      packId={p.id}
                      stickerId={s.id}
                      mediaUrl={s.url}
                      name={s.name}
                      mediaKind={s.mediaKind}
                      className="mt-0 size-12 shrink-0"
                    />
                  ))}
                </div>
                {open ? (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-5 gap-1">
                      {p.stickers.map((s) => (
                        <div key={s.id} className="relative">
                          <StickerBubble
                            packId={p.id}
                            stickerId={s.id}
                            mediaUrl={s.url}
                            name={s.name}
                            mediaKind={s.mediaKind}
                            className="mt-0 size-12"
                          />
                          {p.mine ? (
                            <button
                              type="button"
                              className="absolute right-0 top-0 text-[10px] text-danger"
                              aria-label="Delete sticker"
                              onClick={() =>
                                void deleteCustomSticker({ data: { stickerId: s.id } })
                                  .then(() => {
                                    toast.success("Sticker removed.");
                                    void packs.refetch();
                                  })
                                  .catch((e) => toast.error(e instanceof Error ? e.message : "Could not delete."))
                              }
                            >
                              ×
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="absolute right-0 top-0 text-[10px] text-muted"
                              onClick={() =>
                                void reportSticker({ data: { stickerId: s.id, reason: "inappropriate" } })
                                  .then(() => toast.success("Reported."))
                                  .catch((e) => toast.error(e instanceof Error ? e.message : "Could not report."))
                              }
                            >
                              !
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void sharePack(p.id, p.title)}>
                        Share
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void exportFile(p.id, p.title)}>
                        Export
                      </Button>
                      {p.mine ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const title = window.prompt("Rename pack", p.title);
                              if (!title) return;
                              void renameStickerPack({ data: { packId: p.id, title } })
                                .then(() => {
                                  toast.success("Renamed.");
                                  void packs.refetch();
                                })
                                .catch((e) => toast.error(e instanceof Error ? e.message : "Could not rename."));
                            }}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            onClick={() => {
                              if (!window.confirm("Delete this pack? Sent stickers stay in chats.")) return;
                              void deleteStickerPack({ data: { packId: p.id } })
                                .then(() => {
                                  toast.success("Pack deleted.");
                                  void packs.refetch();
                                })
                                .catch((e) => toast.error(e instanceof Error ? e.message : "Could not delete pack."));
                            }}
                          >
                            Delete pack
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
        <Link
          to="/stickers/create"
          className="flex min-h-14 items-center justify-center rounded-2xl border border-dashed border-border p-4 text-center text-sm font-medium text-accent"
        >
          Create a sticker from a photo, GIF, or video
        </Link>
      </div>
    </div>
  );
}
