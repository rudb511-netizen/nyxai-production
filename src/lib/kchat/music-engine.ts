import { create } from "zustand";
import {
  canPlay,
  classifyProbe,
  FULL_TRACK_FAILED,
  isAbortPlay,
  isAutoplayBlock,
  isNotSupportedPlay,
  isOfficialPlayerUrl,
  mediaErrorMessage,
  playbackSources,
  playbackTypeOf,
  playableUrl,
  PLAYBACK_UNAVAILABLE,
  PREVIEW_ONLY,
  TRY_ANOTHER_PROVIDER,
  sanitizeMediaSrcForLog,
  type AudioSource,
  type MusicTrack,
  type UrlProbe,
} from "./music";
import { getBearerToken } from "@/lib/auth/client";
import { remoteAudioUrl, streamPlaybackSources } from "./music-stream";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error" | "ended" | "blocked";

type PlayOpts = {
  fromUserGesture?: boolean;
  mutedAutoplay?: boolean;
};

type Engine = {
  track: MusicTrack | null;
  queue: MusicTrack[];
  index: number;
  status: PlayerStatus;
  currentMs: number;
  durationMs: number;
  error: string | null;
  needsUserInteraction: boolean;
  muted: boolean;
  buffering: boolean;
  mutedAutoplay: boolean;
  officialUrl: string | null;
  repeat: "off" | "all" | "one";
  shuffle: boolean;
  play: (track: MusicTrack, queue?: MusicTrack[]) => void;
  retry: () => void;
  pause: () => void;
  resume: () => void;
  tapPlay: () => void;
  unmute: () => void;
  toggle: () => void;
  seek: (ms: number) => void;
  next: (opts?: PlayOpts) => void;
  prev: () => void;
  stop: () => void;
  setMutedAutoplay: (on: boolean) => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
};

let audio: HTMLAudioElement | null = null;
let raf = 0;
let playGen = 0;
let bound = false;
let pagehideBound = false;
let sourceIndex = 0;
let activeSources: AudioSource[] = [];
const failedFullIds = new Set<string>();
let recovering = false;
const refreshedIds = new Set<string>();
let attemptSeq = 0;

function unexpectedPlaybackLog(message: string): void {
  try {
    if (import.meta.env?.DEV) console.warn("[nyx-music]", message);
  } catch {
    /* no debug bus in production or node tests */
  }
}

function el(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    // Do not set crossOrigin. CDN previews often omit CORS headers; the browser
    // then reports MEDIA_ERR_SRC_NOT_SUPPORTED even though the codec is fine.
    bindAudio(audio);
  }
  return audio;
}

function bindAudio(a: HTMLAudioElement): void {
  if (bound) return;
  bound = true;
  a.addEventListener("loadedmetadata", syncTime);
  a.addEventListener("canplay", () => {
    const s = useMusicEngine.getState();
    if (s.status === "loading") useMusicEngine.setState({ buffering: false });
  });
  a.addEventListener("timeupdate", syncTime);
  a.addEventListener("play", () => {
    const s = useMusicEngine.getState();
    if (s.needsUserInteraction) return;
    useMusicEngine.setState({ status: "playing", error: null, buffering: false });
    syncMediaSession(useMusicEngine.getState().track, true);
    startTick();
  });
  a.addEventListener("pause", () => {
    const s = useMusicEngine.getState();
    if (s.status === "loading" || s.status === "blocked") return;
    if (s.status === "playing") useMusicEngine.setState({ status: "paused", buffering: false });
    syncMediaSession(s.track, false);
    stopTick();
  });
  a.addEventListener("ended", () => {
    stopTick();
    const s = useMusicEngine.getState();
    const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration * 1000 : s.durationMs;
    useMusicEngine.setState({ status: "ended", currentMs: dur, buffering: false });
    advanceAfterEnd();
  });
  a.addEventListener("error", () => {
    void handleMediaError(playGen);
  });
  a.addEventListener("waiting", () => {
    const s = useMusicEngine.getState();
    if (s.status === "blocked") return;
    useMusicEngine.setState({ buffering: true, status: s.status === "playing" ? "playing" : "loading" });
  });
  a.addEventListener("playing", () => {
    useMusicEngine.setState({ status: "playing", buffering: false, error: null, needsUserInteraction: false });
    startTick();
  });
  a.addEventListener("stalled", () => {
    const s = useMusicEngine.getState();
    if (s.status === "playing" || s.status === "loading") useMusicEngine.setState({ buffering: true });
  });
  if (!pagehideBound) {
    pagehideBound = true;
  }
}

function syncTime() {
  const a = audio;
  if (!a) return;
  useMusicEngine.setState({
    currentMs: (a.currentTime || 0) * 1000,
    durationMs: Number.isFinite(a.duration) && a.duration > 0 ? a.duration * 1000 : useMusicEngine.getState().durationMs,
  });
}

function tick() {
  syncTime();
  if (typeof window === "undefined") return;
  raf = window.requestAnimationFrame(tick);
}

function startTick() {
  if (typeof window === "undefined") return;
  window.cancelAnimationFrame(raf);
  raf = window.requestAnimationFrame(tick);
}

function stopTick() {
  if (typeof window === "undefined") return;
  window.cancelAnimationFrame(raf);
}

function authedStreamSources(sources: AudioSource[]): AudioSource[] {
  const token = getBearerToken();
  if (!token) return sources;
  return sources.map((source) =>
    source.src.startsWith("/api/music-stream?")
      ? { ...source, src: `${source.src}&access=${encodeURIComponent(token)}` }
      : source,
  );
}

function applySource(a: HTMLAudioElement, source: AudioSource): void {
  while (a.firstChild) a.removeChild(a.firstChild);
  a.removeAttribute("src");
  a.src = source.src;
  a.load();
}

function currentSrcForLog(a: HTMLAudioElement): string {
  return sanitizeMediaSrcForLog(a.currentSrc || a.src || activeSources[sourceIndex]?.src || "");
}

async function probeAudioUrl(url: string): Promise<UrlProbe> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-64" },
      mode: "cors",
      cache: "no-store",
      signal: ctrl.signal,
    });
    const contentType = r.headers.get("content-type");
    const status = r.status === 206 ? 200 : r.status;
    return {
      ok: r.ok || r.status === 206,
      status: r.status,
      contentType,
      kind: classifyProbe(status, contentType),
    };
  } catch {
    return { ok: false, status: null, contentType: null, kind: "network" };
  } finally {
    window.clearTimeout(timer);
  }
}

async function refreshPreview(track: MusicTrack, failedUrl: string): Promise<MusicTrack | null> {
  if (refreshedIds.has(track.id)) return null;
  refreshedIds.add(track.id);
  try {
    const { refreshMusicPreview } = await import("./server/music");
    const r = await refreshMusicPreview({
      data: {
        provider: track.provider,
        providerTrackId: track.providerTrackId,
        artist: track.artist,
        title: track.title,
        failedUrl,
      },
    });
    return r.track;
  } catch {
    return null;
  }
}

function swapTrack(queue: MusicTrack[], next: MusicTrack): MusicTrack[] {
  return queue.map((t) => (t.id === next.id ? next : t));
}

async function handleMediaError(gen: number): Promise<void> {
  const a = audio;
  const s = useMusicEngine.getState();
  if (!a || gen !== playGen) return;
  if (s.needsUserInteraction || s.status === "blocked") return;
  if (recovering) return;
  recovering = true;
  let handedOff = false;

  try {
    const media = a.error;
    const rawSrc = a.currentSrc || a.src || activeSources[sourceIndex]?.src || "";
    const src = remoteAudioUrl(rawSrc);

    if (sourceIndex + 1 < activeSources.length) {
      sourceIndex += 1;
      applySource(a, activeSources[sourceIndex]);
      handedOff = true;
      recovering = false;
      await attemptPlay(gen);
      return;
    }

    const probe = rawSrc
      ? await probeAudioUrl(rawSrc)
      : { ok: false, status: null, contentType: null, kind: "unavailable" as const };
    if (gen !== playGen) return;

    const track = useMusicEngine.getState().track;
    unexpectedPlaybackLog(
      `provider=${track?.provider ?? "none"} playback=${track?.playback ?? "none"} full=${Boolean(track && playableUrl(track))} previewUsed=false src=${currentSrcForLog(a)} status=${probe.status ?? "none"} type=${probe.contentType ?? "none"} media.code=${media?.code ?? "none"}`,
    );
    const barelyStarted = (a.currentTime || 0) < 0.4;
    const dead = [...new Set([src, ...activeSources.map((item) => remoteAudioUrl(item.src))].filter(Boolean))];
    if (track && track.playback === "full" && barelyStarted && (probe.kind === "unavailable" || probe.kind === "mismatch" || probe.kind === "network" || probe.kind === "ok")) {
      useMusicEngine.setState({ status: "loading", buffering: true, error: null, currentMs: 0 });
      const fresh = await refreshPreview(track, src);
      if (gen !== playGen) return;
      const freshUrl = fresh && fresh.playback === "full" ? playableUrl(fresh) : null;
      if (fresh && freshUrl && !dead.includes(freshUrl)) {
        handedOff = true;
        recovering = false;
        playAt(s.index, swapTrack(s.queue, fresh), { fromUserGesture: false });
        return;
      }
    }

    const alternate = nextFullAlternate(track, dead);
    if (track && alternate && playbackTypeOf(track) === "FULL_TRACK") {
      failedFullIds.add(track.id);
      const rest = (track.alternates || []).filter((item) => item.id !== alternate.id && !failedFullIds.has(item.id));
      const nextTrack = { ...alternate, alternates: rest };
      handedOff = true;
      recovering = false;
      useMusicEngine.setState({ status: "loading", buffering: true, error: TRY_ANOTHER_PROVIDER, currentMs: 0 });
      playAt(s.index, swapTrack(s.queue, nextTrack), { fromUserGesture: false });
      return;
    }

    stopTick();
    try {
      a.pause();
    } catch {
      /* already failed */
    }
    useMusicEngine.setState({
      status: "error",
      buffering: false,
      needsUserInteraction: false,
      currentMs: 0,
      durationMs: Number.isFinite(a.duration) && a.duration > 0 ? a.duration * 1000 : 0,
      error: track?.playback === "full" ? FULL_TRACK_FAILED : mediaErrorMessage(media?.code, { url: src, kind: probe.kind }),
    });
  } finally {
    if (!handedOff) recovering = false;
  }
}

/**
 * Attempt real HTMLAudioElement playback.
 * Browsers may block unmuted autoplay without a user gesture.
 * play() returns a Promise — isPlaying must wait until it resolves.
 * NotAllowedError means autoplay was blocked; wait for an explicit tap.
 * Muted autoplay can be used where the product opts in — never force unmuted autoplay.
 */
async function attemptPlay(gen: number): Promise<void> {
  const a = audio;
  if (!a || gen !== playGen) return;
  const token = ++attemptSeq;
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(Object.assign(new Error("Playback timed out."), { name: "TimeoutError" }));
    }, 8000);
  });
  try {
    const started = a.play();
    started.catch(() => undefined);
    await Promise.race([started, timeout]);
    if (gen !== playGen || token !== attemptSeq) return;
    useMusicEngine.setState({
      status: "playing",
      needsUserInteraction: false,
      error: null,
      muted: a.muted,
      buffering: false,
    });
    startTick();
  } catch (error) {
    if (gen !== playGen || token !== attemptSeq) return;
    if (isAbortPlay(error)) return;
    if (isAutoplayBlock(error)) {
      a.pause();
      stopTick();
      useMusicEngine.setState({
        status: "blocked",
        needsUserInteraction: true,
        error: null,
        buffering: false,
      });
      return;
    }
    const timedOut = Boolean(error && typeof error === "object" && "name" in error && (error as { name: string }).name === "TimeoutError");
    if (timedOut) {
      try {
        a.pause();
      } catch {
        /* element already failed */
      }
    }
    if (timedOut || isNotSupportedPlay(error)) {
      await handleMediaError(gen);
      return;
    }
    unexpectedPlaybackLog(error instanceof Error ? error.name : "playback");
    await handleMediaError(gen);
  } finally {
    window.clearTimeout(timer);
  }
}

function nextFullAlternate(track: MusicTrack | null, dead: string[]): MusicTrack | null {
  if (!track) return null;
  for (const alternate of track.alternates || []) {
    if (failedFullIds.has(alternate.id)) continue;
    if (playbackTypeOf(alternate) !== "FULL_TRACK") continue;
    const url = playableUrl(alternate);
    if (!url || dead.includes(url)) continue;
    return alternate;
  }
  return null;
}

function advanceAfterEnd() {
  const s = useMusicEngine.getState();
  if (!s.queue.length || !s.track) return;
  if (s.repeat === "one") {
    playAt(s.index, s.queue, { fromUserGesture: false });
    return;
  }
  if (s.shuffle && s.queue.length > 1) {
    let nextIndex = s.index;
    for (let attempt = 0; attempt < 5 && nextIndex === s.index; attempt += 1) {
      nextIndex = Math.floor(Math.random() * s.queue.length);
    }
    playAt(nextIndex, s.queue, { fromUserGesture: false });
    return;
  }
  if (s.index < s.queue.length - 1) {
    playAt(s.index + 1, s.queue, { fromUserGesture: false });
    return;
  }
  if (s.repeat === "all") playAt(0, s.queue, { fromUserGesture: false });
}

function syncMediaSession(track: MusicTrack | null, playing: boolean) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !track || playbackTypeOf(track) !== "FULL_TRACK" && playbackTypeOf(track) !== "PREVIEW") {
    return;
  }
  try {
    const artwork = track.artworkUrl?.startsWith("https://") ? [{ src: track.artworkUrl, sizes: "300x300", type: "image/jpeg" }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || providerSessionAlbum(track),
      artwork,
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    navigator.mediaSession.setActionHandler("play", () => useMusicEngine.getState().resume());
    navigator.mediaSession.setActionHandler("pause", () => useMusicEngine.getState().pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => useMusicEngine.getState().next({ fromUserGesture: true }));
    navigator.mediaSession.setActionHandler("previoustrack", () => useMusicEngine.getState().prev());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) useMusicEngine.getState().seek(details.seekTime * 1000);
    });
  } catch {
    /* Media Session is missing on some webviews. Playback still uses the audio element. */
  }
}

function providerSessionAlbum(track: MusicTrack): string {
  if (track.provider === "archive") return "Internet Archive";
  if (track.provider === "audius") return "Audius";
  if (track.provider === "jamendo") return "Jamendo";
  if (track.provider === "nyx") return "NYX";
  return "Apple Music";
}

function playAt(index: number, queue: MusicTrack[], opts: PlayOpts = {}) {
  const track = queue[index];
  const a = el();
  if (!track || !a) return;
  const type = playbackTypeOf(track);
  const official = type === "OFFICIAL_PLAYER" && isOfficialPlayerUrl(track.officialPlayerUrl) ? track.officialPlayerUrl! : null;
  if (type === "OFFICIAL_PLAYER" && official) {
    playGen += 1;
    recovering = false;
    activeSources = [];
    a.pause();
    a.removeAttribute("src");
    while (a.firstChild) a.removeChild(a.firstChild);
    a.load();
    stopTick();
    useMusicEngine.setState({
      track,
      queue,
      index,
      status: "playing",
      officialUrl: official,
      error: null,
      currentMs: 0,
      durationMs: track.durationMs ?? 0,
      needsUserInteraction: false,
      buffering: false,
      muted: false,
    });
    return;
  }
  const sources = authedStreamSources(streamPlaybackSources(playbackSources(track)));
  const src = playableUrl(track);
  if (type === "UNAVAILABLE" || !canPlay(track) || !src || !sources.length) {
    playGen += 1;
    a.pause();
    useMusicEngine.setState({
      track,
      queue,
      index,
      status: "error",
      officialUrl: null,
      error: type === "PREVIEW" ? PREVIEW_ONLY : type === "FULL_TRACK" ? FULL_TRACK_FAILED : PLAYBACK_UNAVAILABLE,
      currentMs: 0,
      durationMs: 0,
      needsUserInteraction: false,
      buffering: false,
      muted: false,
    });
    return;
  }

  playGen += 1;
  const gen = playGen;
  recovering = false;
  sourceIndex = 0;
  activeSources = sources;
  a.pause();
  stopTick();
  applySource(a, sources[0]);
  try {
    a.currentTime = 0;
  } catch {
    /* some browsers throw until metadata is ready */
  }

  const mutedAutoplay = Boolean(opts.mutedAutoplay ?? useMusicEngine.getState().mutedAutoplay);
  a.muted = Boolean(mutedAutoplay && !opts.fromUserGesture);

  useMusicEngine.setState({
    track,
    queue,
    index,
    status: "loading",
    officialUrl: null,
    error: null,
    currentMs: 0,
    durationMs: type === "PREVIEW" ? 0 : track.durationMs ?? 0,
    needsUserInteraction: false,
    buffering: true,
    muted: a.muted,
  });

  void attemptPlay(gen);
}

export const useMusicEngine = create<Engine>((set, get) => ({
  track: null,
  queue: [],
  index: 0,
  status: "idle",
  currentMs: 0,
  durationMs: 0,
  error: null,
  needsUserInteraction: false,
  muted: false,
  buffering: false,
  mutedAutoplay: false,
  officialUrl: null,
  repeat: "off",
  shuffle: false,
  play: (track, queue) => {
    refreshedIds.delete(track.id);
    failedFullIds.clear();
    const list = queue && queue.length ? queue : [track];
    const idx = Math.max(0, list.findIndex((t) => t.id === track.id));
    playAt(idx === -1 ? 0 : idx, list, { fromUserGesture: true });
  },
  retry: () => {
    const s = get();
    if (!s.track) return;
    refreshedIds.delete(s.track.id);
    playAt(s.index, s.queue.length ? s.queue : [s.track], { fromUserGesture: true });
  },
  pause: () => {
    el()?.pause();
    set({ status: "paused", buffering: false, officialUrl: null });
    stopTick();
  },
  resume: () => {
    const s = get();
    if (s.track && playbackTypeOf(s.track) === "OFFICIAL_PLAYER") {
      playAt(s.index, s.queue.length ? s.queue : [s.track], { fromUserGesture: true });
      return;
    }
    const a = el();
    if (!a || !s.track) return;
    a.muted = false;
    set({ muted: false, status: "loading", error: null, needsUserInteraction: false });
    void attemptPlay(playGen);
  },
  tapPlay: () => {
    const a = el();
    if (!a || !get().track) return;
    a.muted = false;
    set({ muted: false, status: "loading", error: null, needsUserInteraction: false });
    // Directly from the click/touch handler — do not await anything first.
    void attemptPlay(playGen);
  },
  unmute: () => {
    const a = el();
    if (a) a.muted = false;
    set({ muted: false });
  },
  toggle: () => {
    const s = get();
    if (s.status === "playing") s.pause();
    else if (s.needsUserInteraction || s.status === "blocked") s.tapPlay();
    else if (s.track) s.resume();
  },
  seek: (ms) => {
    const a = el();
    if (!a || !Number.isFinite(ms)) return;
    try {
      a.currentTime = Math.max(0, ms / 1000);
    } catch {
      return;
    }
    set({ currentMs: Math.max(0, ms) });
  },
  next: (opts) => {
    const s = get();
    if (s.shuffle && s.queue.length > 1) {
      let nextIndex = s.index;
      for (let attempt = 0; attempt < 5 && nextIndex === s.index; attempt += 1) {
        nextIndex = Math.floor(Math.random() * s.queue.length);
      }
      playAt(nextIndex, s.queue, { fromUserGesture: opts?.fromUserGesture ?? true, mutedAutoplay: opts?.mutedAutoplay });
      return;
    }
    if (s.index < s.queue.length - 1) {
      playAt(s.index + 1, s.queue, { fromUserGesture: opts?.fromUserGesture ?? true, mutedAutoplay: opts?.mutedAutoplay });
    } else if (s.repeat === "all" && s.queue.length) {
      playAt(0, s.queue, { fromUserGesture: opts?.fromUserGesture ?? true, mutedAutoplay: opts?.mutedAutoplay });
    }
  },
  prev: () => {
    const s = get();
    if (s.currentMs > 3000) {
      s.seek(0);
      return;
    }
    if (s.index > 0) playAt(s.index - 1, s.queue, { fromUserGesture: true });
    else s.seek(0);
  },
  stop: () => {
    playGen += 1;
    recovering = false;
    activeSources = [];
    sourceIndex = 0;
    const a = el();
    if (a) {
      a.pause();
      a.removeAttribute("src");
      while (a.firstChild) a.removeChild(a.firstChild);
      a.load();
    }
    stopTick();
    set({
      track: null,
      queue: [],
      index: 0,
      status: "idle",
      currentMs: 0,
      durationMs: 0,
      error: null,
      needsUserInteraction: false,
      muted: false,
      buffering: false,
      officialUrl: null,
    });
  },
  setMutedAutoplay: (on) => set({ mutedAutoplay: on }),
  toggleRepeat: () => {
    const current = get().repeat;
    set({ repeat: current === "off" ? "all" : current === "all" ? "one" : "off" });
  },
  toggleShuffle: () => set({ shuffle: !get().shuffle }),
}));

export { downloadTrack, startTrackDownload } from "./music-download";

export async function downloadLicensedTrack(
  track: MusicTrack,
  onProgress?: (pct: number | null) => void,
): Promise<void> {
  const { startTrackDownload } = await import("./music-download");
  await startTrackDownload(track, onProgress);
}
