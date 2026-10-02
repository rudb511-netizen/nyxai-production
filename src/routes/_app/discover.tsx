import type { ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Radio, Search, Users, Clapperboard, MapPin } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { globalSearch, listLive, trendingTags } from "@/lib/kchat/server/more";
import { clearSearchHistory, listSearchHistory } from "@/lib/kchat/server/graph";
import { suggestedFriends } from "@/lib/kchat/server/social";
import { listSounds, toggleSoundSave, videoFeed } from "@/lib/kchat/server/videos";
import { NameMark } from "@/components/kchat/verified-badge";
import { TrackPlayButton } from "@/components/kchat/music-player";
import { normalizeProvider, playbackLabel, type MusicTrack } from "@/lib/kchat/music";
import { formatCount } from "@/lib/utils";

export const Route = createFileRoute("/_app/discover")({ component: Discover });

function Discover() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const results = useQuery({
    queryKey: ["search", q],
    queryFn: () => globalSearch({ data: { q } }),
    enabled: q.trim().length > 0,
  });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => trendingTags() });
  const people = useQuery({ queryKey: ["suggested"], queryFn: () => suggestedFriends() });
  const live = useQuery({ queryKey: ["live"], queryFn: () => listLive() });
  const videos = useQuery({ queryKey: ["videos-preview"], queryFn: () => videoFeed({ data: {} }) });
  const sounds = useQuery({ queryKey: ["sounds"], queryFn: () => listSounds({ data: { q } }) });
  const history = useQuery({ queryKey: ["search-history"], queryFn: () => listSearchHistory(), enabled: q.trim().length === 0 });

  return (
    <div className="kc-page px-4 py-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people, posts, tags, sounds"
          className="pl-9"
        />
      </div>
      {q.trim() ? (
        <div className="mt-4 space-y-5">
          <Section title="People">
            {(results.data?.users ?? []).map((u) => (
              <Link
                key={u.userId}
                to="/u/$username"
                params={{ username: u.username }}
                className="flex items-center gap-3 rounded-xl px-1 py-2 hover:bg-elevated"
              >
                <Avatar src={u.avatarUrl} name={u.displayName} />
                <div>
                  <NameMark name={u.displayName} verifyKind={u.verifyKind} isArc={u.isArc} isPremium={u.isPremium} className="font-medium" />
                  <p className="text-sm text-muted">@{u.username}</p>
                </div>
              </Link>
            ))}
          </Section>
          <Section title="Tags">
            {(results.data?.tags ?? []).map((t) => (
              <Link key={t.tag} to="/tag/$tag" params={{ tag: t.tag }} className="block py-1 text-sm">
                #{t.tag} <span className="text-muted tabular-nums">{t.use_count}</span>
              </Link>
            ))}
          </Section>
          <Section title="Sounds">
            {(sounds.data ?? []).map((s) => {
              const track = soundToTrack(s);
              return (
                <div key={s.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0">
                    {s.title}{" "}
                    <span className="text-muted">
                      · {s.artist}
                      {track ? ` · ${playbackLabel(track)}` : ""}
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {track ? <TrackPlayButton track={track} queue={(sounds.data ?? []).map(soundToTrack).filter(Boolean) as MusicTrack[]} /> : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void toggleSoundSave({
                          data: {
                            id: s.id,
                            provider: s.provider,
                            providerTrackId: s.providerTrackId,
                            title: s.title,
                            artist: s.artist,
                            previewUrl: s.previewUrl,
                            audioUrl: s.audioUrl,
                            durationMs: s.duration_ms,
                            license: s.license,
                          },
                        }).then(() => sounds.refetch())
                      }
                    >
                      {s.saved ? "Saved" : "Save"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </Section>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {(history.data ?? []).length > 0 ? (
            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Recent searches</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void clearSearchHistory().then(() => history.refetch())}
                >
                  Clear
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(history.data ?? []).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className="rounded-full bg-elevated px-3 py-1.5 text-sm"
                    onClick={() => setQ(h.query)}
                  >
                    {h.query}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => nav({ to: "/watch" })}>
              <Clapperboard className="size-4" /> Watch
            </Button>
            <Button variant="secondary" size="sm" onClick={() => nav({ to: "/live" })}>
              <Radio className="size-4" /> Live
            </Button>
            <Button variant="secondary" size="sm" onClick={() => nav({ to: "/map" })}>
              <MapPin className="size-4" /> Atlas
            </Button>
            <Button variant="secondary" size="sm" onClick={() => nav({ to: "/communities" })}>
              <Users className="size-4" /> Spaces
            </Button>
            <Button variant="outline" size="sm" onClick={() => nav({ to: "/capture" })}>
              Capture
            </Button>
          </div>
          <Section title="Trending">
            <div className="flex flex-wrap gap-2">
              {(tags.data ?? []).map((t) => (
                <span key={t.tag} className="rounded-full bg-elevated px-3 py-1.5 text-sm">
                  #{t.tag}
                </span>
              ))}
            </div>
          </Section>
          <Section title="Licensed sounds">
            <div className="space-y-1">
              {(sounds.data ?? []).map((s) => {
                const track = soundToTrack(s);
                return (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl px-1 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.title}</p>
                      <p className="text-xs text-muted">
                        {s.original ? "NYX original" : s.artist}
                        {s.use_count ? ` · ${formatCount(s.use_count)} uses` : ""}
                        {track ? ` · ${playbackLabel(track)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {track ? <TrackPlayButton track={track} queue={(sounds.data ?? []).map(soundToTrack).filter(Boolean) as MusicTrack[]} /> : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void toggleSoundSave({ data: { id: s.id } }).then(() => sounds.refetch())}
                      >
                        {s.saved ? "Saved" : "Save"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
          {(live.data ?? []).length > 0 ? (
            <Section title="Live now">
              {live.data!.map((l) => (
                <Link
                  key={l.id}
                  to="/live/$id"
                  params={{ id: l.id }}
                  className="flex items-center gap-3 py-2"
                >
                  <Avatar src={l.host.avatarUrl} name={l.host.displayName} />
                  <div>
                    <p className="font-medium">{l.title}</p>
                    <p className="text-sm text-live">@{l.host.username} is live</p>
                  </div>
                </Link>
              ))}
            </Section>
          ) : null}
          <Section title="People to follow">
            {(people.data ?? []).map((p) => (
              <Link
                key={p.userId}
                to="/u/$username"
                params={{ username: p.username }}
                className="flex items-center gap-3 py-2"
              >
                <Avatar src={p.avatarUrl} name={p.displayName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.displayName}</p>
                  <p className="text-sm text-muted">@{p.username}</p>
                </div>
              </Link>
            ))}
          </Section>
          {(videos.data?.items.length ?? 0) > 0 ? (
            <Section title="Short videos">
              <div className="kc-video-grid">
                {videos.data!.items.slice(0, 6).map((v) => (
                  <Link key={v.id} to="/watch" className="aspect-[9/16] overflow-hidden rounded-lg bg-elevated">
                    {v.thumbUrl ? (
                      <img src={v.thumbUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <video src={v.mediaUrl} className="size-full object-cover" muted />
                    )}
                  </Link>
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function soundToTrack(s: {
  id: string;
  title: string;
  artist: string;
  duration_ms: number | null;
  previewUrl?: string | null;
  audioUrl?: string | null;
  downloadUrl?: string | null;
  artworkUrl?: string | null;
  provider?: string;
  providerTrackId?: string;
  license?: string;
  previewAvailable?: boolean;
  playback?: MusicTrack["playback"];
  downloadable?: boolean;
  album?: string | null;
  genre?: string | null;
}): MusicTrack | null {
  if (!s.audioUrl && !s.previewUrl && !s.downloadUrl) return null;
  const provider = normalizeProvider(s.provider);
  const audioUrl = provider === "itunes" ? null : s.audioUrl ?? s.downloadUrl ?? null;
  return {
    id: s.id,
    provider,
    providerTrackId: s.providerTrackId || s.id,
    title: s.title,
    artist: s.artist,
    album: s.album ?? null,
    artworkUrl: s.artworkUrl ?? null,
    audioUrl,
    previewUrl: provider === "itunes" ? s.previewUrl ?? null : null,
    downloadUrl: s.downloadUrl ?? null,
    durationMs: s.duration_ms,
    genre: s.genre ?? null,
    license: s.license || "",
    previewAvailable: provider === "itunes" && Boolean(s.previewUrl),
    playback: s.playback ?? (audioUrl ? "full" : s.previewUrl ? "preview" : "none"),
    downloadable: Boolean(s.downloadable && provider !== "itunes"),
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-muted">{title}</h2>
      {children}
    </section>
  );
}
