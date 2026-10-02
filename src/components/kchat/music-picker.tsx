import { useQuery } from "@tanstack/react-query";
import { Music2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDuration, playbackLabel, playbackTypeOf, providerLabel, type MusicTrack, PREVIEW_ONLY, USE_NEEDS_FILE } from "@/lib/kchat/music";
import { searchMusic, useMusicTrack } from "@/lib/kchat/server/music";
import { useMusicEngine } from "@/lib/kchat/music-engine";
import { listOfflineIds, listOfflineTracks, removeOfflineTrack } from "@/lib/kchat/music-offline";
import { TrackPlayButton } from "./music-player";
import { TrackDownloadButton } from "./track-download-button";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "trending", label: "Trending" },
  { id: "recent", label: "Recently used" },
  { id: "saved", label: "Saved" },
  { id: "downloads", label: "Downloads" },
] as const;

export type PickedSound = {
  soundId: string;
  id: string;
  provider: MusicTrack["provider"];
  providerTrackId: string;
  title: string;
  artist: string;
  album: string | null;
  audioUrl: string | null;
  previewUrl: string | null;
  downloadUrl: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  genre: string | null;
  license: string;
  previewAvailable: boolean;
  playback: MusicTrack["playback"];
  downloadable: boolean;
};

export function MusicPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (sound: PickedSound) => void;
}) {
  const [q, setQ] = useState("");
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("trending");
  const [savedIds, setSavedIds] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    void listOfflineIds()
      .then((ids) => setSavedIds(ids))
      .catch(() => setSavedIds([]));
  }, [open]);
  const catalog = useQuery({
    queryKey: ["music", q, section],
    queryFn: async () => {
      if (section === "downloads" && !q.trim()) {
        const tracks = await listOfflineTracks();
        setSavedIds(tracks.map((track) => track.id));
        return {
          tracks,
          section: "downloads",
          source: "offline",
          license: "Licensed downloads saved in this browser. Export goes to device Downloads / Files.",
          jamendo: false,
        };
      }
      return searchMusic({ data: { q: q.trim() || undefined, section: q.trim() ? "search" : section } });
    },
    enabled: open,
  });

  if (!open) return null;

  const tracks = catalog.data?.tracks ?? [];

  async function useTrack(track: MusicTrack) {
    if (playbackTypeOf(track) !== "FULL_TRACK" || !track.audioUrl) {
      toast.error(playbackTypeOf(track) === "PREVIEW" ? PREVIEW_ONLY : USE_NEEDS_FILE);
      return;
    }
    try {
      const used = await useMusicTrack({
        data: {
          provider: track.provider,
          providerTrackId: track.providerTrackId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          artworkUrl: track.artworkUrl,
          audioUrl: track.audioUrl,
          previewUrl: track.previewUrl,
          downloadUrl: track.downloadUrl,
          durationMs: track.durationMs,
          genre: track.genre,
          license: track.license,
          downloadable: track.downloadable,
        },
      });
      onPick({
        soundId: used.soundId,
        id: used.id,
        provider: used.provider,
        providerTrackId: used.providerTrackId,
        title: used.title,
        artist: used.artist,
        album: used.album,
        audioUrl: used.audioUrl,
        previewUrl: used.previewUrl,
        downloadUrl: used.downloadUrl,
        artworkUrl: used.artworkUrl,
        durationMs: used.durationMs,
        genre: used.genre,
        license: used.license,
        previewAvailable: used.previewAvailable,
        playback: used.playback,
        downloadable: used.downloadable,
      });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not attach that song.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-fg">
      <header className="flex h-14 items-center gap-2 border-b border-border px-3">
        <Button variant="ghost" size="icon-sm" aria-label="Close music" onClick={onClose}>
          <X className="size-5" />
        </Button>
        <p className="flex-1 text-sm font-medium">Search music</p>
      </header>
      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Title, artist, album, genre"
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="kc-hide-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSection(s.id);
                setQ("");
              }}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs",
                !q && section === s.id ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-subtle">
          {catalog.data?.license ??
            "Full tracks stream from the source file. Download saves the audio to this device when allowed."}
        </p>
      </div>
      <div className="mt-2 flex-1 overflow-y-auto px-3 pb-[max(6rem,env(safe-area-inset-bottom))]">
        {catalog.isPending ? <p className="py-8 text-center text-sm text-muted">Loading catalog…</p> : null}
        {catalog.isError ? (
          <p className="py-8 text-center text-sm text-muted">
            {catalog.error instanceof Error ? catalog.error.message : "Catalog unavailable."}
          </p>
        ) : null}
        {!catalog.isPending && !catalog.isError && tracks.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            {q.trim() ? "No licensed matches for that search." : "No songs in this section yet."}
          </p>
        ) : null}
        <ul className="space-y-1">
          {tracks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-2xl px-1 py-2 sm:gap-3">
              {t.artworkUrl ? (
                <img src={t.artworkUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-elevated">
                  <Music2 className="size-5 text-muted" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.title}</p>
                <p className="truncate text-xs text-muted">
                  {t.artist}
                  {t.album ? ` · ${t.album}` : ""}
                  {t.durationMs ? ` · ${formatDuration(t.durationMs)}` : ""}
                </p>
                <p className="text-[10px] text-subtle">
                  {providerLabel(t.provider)} · {playbackLabel(t)}
                  {t.attribution ? ` · ${t.attribution}` : ""}
                </p>
              </div>
              <TrackPlayButton track={t} queue={tracks} />
              <div className="flex max-w-[48%] shrink-0 flex-wrap items-center justify-end gap-1.5 sm:max-w-none">
                <Button size="sm" className="min-h-11" onClick={() => void useTrack(t)}>
                  Use
                </Button>
                <TrackDownloadButton
                  track={t}
                  saved={savedIds.includes(t.id) || section === "downloads"}
                  onDone={() => {
                    setSavedIds((ids) => (ids.includes(t.id) ? ids : [...ids, t.id]));
                    if (section === "downloads") void catalog.refetch();
                  }}
                />
                {section === "downloads" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-11"
                    onClick={() => {
                      void removeOfflineTrack(t.id).then(() => {
                        setSavedIds((ids) => ids.filter((id) => id !== t.id));
                        void catalog.refetch();
                      });
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function playPickedSound(sound: PickedSound) {
  useMusicEngine.getState().play({
    id: sound.id || sound.soundId,
    provider: sound.provider || "itunes",
    providerTrackId: sound.providerTrackId || sound.soundId,
    title: sound.title,
    artist: sound.artist,
    album: sound.album ?? null,
    artworkUrl: sound.artworkUrl,
    audioUrl: sound.audioUrl,
    previewUrl: sound.playback === "full" ? null : sound.previewUrl,
    downloadUrl: sound.downloadUrl ?? null,
    durationMs: sound.durationMs ?? null,
    genre: sound.genre ?? null,
    license: sound.license,
    previewAvailable: sound.previewAvailable,
    playback: sound.playback ?? (sound.audioUrl ? "full" : "none"),
    downloadable: Boolean(sound.downloadable),
  });
}
