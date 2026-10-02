import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FriendPicker } from "@/components/kchat/friend-picker";
import { HashtagChips } from "@/components/kchat/hashtag-chips";
import { LiveSetup } from "@/components/kchat/live-setup";
import { MentionBox } from "@/components/kchat/mention-box";
import {
  captureVideoThumb,
  compressImage,
  probeVideoFile,
  type EncodedRung,
  type VideoProbe,
} from "@/lib/kchat/media-client";
import { useMeQuery } from "@/lib/kchat/hooks";
import { seedDefaultTags } from "@/lib/kchat/graph";
import { triggerHaptic, pickFromLibrary, scheduleLocalNotification } from "@/utils/nativeCapabilities";
import type { StatusAudience } from "@/lib/kchat/privacy";
import { omniFeedAssist } from "@/lib/kchat/server/omni";
import { createPost } from "@/lib/kchat/server/posts";
import { saveDraft } from "@/lib/kchat/server/platform";
import { createStatus } from "@/lib/kchat/server/status";
import { createStory } from "@/lib/kchat/server/stories";
import { uploadVideo } from "@/lib/kchat/server/videos";
import { MusicPicker, type PickedSound } from "@/components/kchat/music-picker";
import { TrackPlayButton } from "@/components/kchat/music-player";
import { VideoReviewActions, VideoReviewPlayer } from "@/components/kchat/video-review";
import { UploadProgress } from "@/components/kchat/upload-progress";
import { MediaUploader, mediaSrc, type UploadSnapshot } from "@/lib/kchat/media-upload";
import { readPendingVideo, writePendingVideo, uploadRecoveryMessage } from "@/lib/kchat/media-pipeline";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/create")({ component: Create });

type Tab = "post" | "story" | "status" | "video" | "live";

function readCreateTab(): Tab {
  if (typeof window === "undefined") return "post";
  try {
    const t = sessionStorage.getItem("omni-create-tab");
    if (t) sessionStorage.removeItem("omni-create-tab");
    if (t === "post" || t === "story" || t === "status" || t === "video" || t === "live") return t;
  } catch {
    /* ignore */
  }
  return "post";
}

function readCreateDraft(): {
  tab?: Tab;
  body?: string;
  mediaUrl?: string | null;
  kind?: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem("omni-create-draft");
    if (!raw) return null;
    sessionStorage.removeItem("omni-create-draft");
    return JSON.parse(raw) as { tab?: Tab; body?: string; mediaUrl?: string | null; kind?: string };
  } catch {
    return null;
  }
}

function consumeCreateLaunch(): {
  tab: Tab;
  body: string;
  media: { kind: "image" | "video" | "gif"; url: string; thumbUrl?: string | null }[];
  storyKind: "photo" | "text";
} {
  if (typeof window === "undefined") {
    return { tab: "post", body: "", media: [], storyKind: "text" };
  }
  const tab = readCreateTab();
  const draft = readCreateDraft();
  const media =
    draft?.mediaUrl
      ? [
          {
            kind: (draft.kind === "video" ? "video" : "image") as "image" | "video",
            url: draft.mediaUrl,
          },
        ]
      : [];
  return {
    tab,
    body: draft?.body ?? "",
    media,
    storyKind: media.length ? "photo" : "text",
  };
}

let launchOnce: ReturnType<typeof consumeCreateLaunch> | null = null;
function onceCreateLaunch() {
  if (typeof window === "undefined") return { tab: "post" as Tab, body: "", media: [], storyKind: "text" as const };
  launchOnce ??= consumeCreateLaunch();
  return launchOnce;
}

function Create() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMeQuery();
  const launch = onceCreateLaunch();
  const [tab, setTab] = useState<Tab>(launch.tab);
  const [body, setBody] = useState(() => seedDefaultTags(launch.body));
  const [location, setLocation] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [threadItems, setThreadItems] = useState<string[]>([]);
  const [quoteOfId, setQuoteOfId] = useState<string | null>(null);
  const [media, setMedia] = useState(launch.media);
  const [poll, setPoll] = useState(["", ""]);
  const [usePoll, setUsePoll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storyKind, setStoryKind] = useState<"photo" | "text">(launch.storyKind);
  const [storyBg, setStoryBg] = useState("#121214");
  const [storyPrivacy, setStoryPrivacy] = useState<"everyone" | "friends" | "close">(
    me.data?.storyVisibility ?? "everyone",
  );
  useEffect(() => {
    try {
      const qid = sessionStorage.getItem("nyx-quote-of");
      if (qid) {
        sessionStorage.removeItem("nyx-quote-of");
        setQuoteOfId(qid);
        setTab("post");
      }
    } catch {
      /* ignore */
    }
  }, []);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [music, setMusic] = useState("");
  const [speed, setSpeed] = useState(1);
  const [filter, setFilter] = useState("none");
  const [downloadAllowed, setDownloadAllowed] = useState(true);
  const [sourceBytes, setSourceBytes] = useState(0);
  const [progress, setProgress] = useState<string | null>(null);
  const [audience, setAudience] = useState<StatusAudience>(me.data?.statusPrivacy ?? "friends");
  const [exceptIds, setExceptIds] = useState<string[]>([]);
  const [onlyIds, setOnlyIds] = useState<string[]>([]);
  const [viewOnce, setViewOnce] = useState(false);
  const [soundId, setSoundId] = useState<string | null>(null);
  const [pickedSound, setPickedSound] = useState<PickedSound | null>(null);
  const [musicOpen, setMusicOpen] = useState(false);
  const [probe, setProbe] = useState<VideoProbe | null>(null);
  const [renditions, setRenditions] = useState<EncodedRung[]>([]);
  const [allowOriginalAudio, setAllowOriginalAudio] = useState(true);
  const [playbackOk, setPlaybackOk] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const postFileRef = useRef<HTMLInputElement>(null);
  const storyFileRef = useRef<HTMLInputElement>(null);
  const statusFileRef = useRef<HTMLInputElement>(null);
  const postPicking = useRef(false);
  const uploaderRef = useRef<MediaUploader | null>(null);
  const [uploadSnap, setUploadSnap] = useState<UploadSnapshot | null>(null);
  const [queuedPublish, setQueuedPublish] = useState<null | "draft" | "post" | "feed">(null);
  const [statusUploadId, setStatusUploadId] = useState<string | null>(null);

  useEffect(() => {
    const pending = readPendingVideo();
    if (!pending?.uploadId) return;
    const up = new MediaUploader();
    uploaderRef.current = up;
    const off = up.onChange(setUploadSnap);
    void up.restore(pending.uploadId).then((ok) => {
      if (!ok) writePendingVideo(null);
    });
    if (pending.caption) setBody(pending.caption);
    if (pending.purpose === "status") setTab("status");
    else if (pending.purpose === "post") setTab("post");
    else if (pending.purpose === "story") setTab("story");
    else setTab("video");
    return () => off();
  }, []);

  useEffect(() => {
    if (!uploadSnap?.uploadId) return;
    writePendingVideo({
      uploadId: uploadSnap.uploadId,
      purpose: tab === "status" ? "status" : tab === "post" ? "post" : tab === "story" ? "story" : "video",
      caption: body,
      phase: uploadSnap.phase,
      mediaUrl: uploadSnap.mediaUrl,
      thumbUrl: uploadSnap.thumbUrl,
      filename: uploadSnap.filename,
      bytes: uploadSnap.bytes,
      mime: uploadSnap.mime,
      width: uploadSnap.width,
      height: uploadSnap.height,
      durationMs: uploadSnap.durationMs,
      fileKey: uploadSnap.fileKey,
    });
  }, [uploadSnap, body, tab]);

  useEffect(() => {
    if (!queuedPublish) return;
    if (uploadSnap?.phase === "ready" || uploadSnap?.phase === "published") {
      if (queuedPublish === "feed") void publishPost();
      else void publishVideo(queuedPublish === "draft");
    }
    if (uploadSnap?.phase === "failed") {
      setQueuedPublish(null);
      toast.error(uploadSnap.error || "Video processing failed. Retry processing.");
    }
  }, [uploadSnap?.phase, queuedPublish]);

  useEffect(() => {
    if (!body.trim() && media.length === 0) return;
    const t = window.setTimeout(() => {
      void saveDraft({
        data: {
          id: draftId,
          kind: tab === "video" ? "video" : tab === "story" ? "story" : tab === "status" ? "status" : "post",
          body,
          payload: { mediaCount: media.length, location },
        },
      })
        .then((r) => setDraftId(r.id))
        .catch(() => {});
    }, 1200);
    return () => window.clearTimeout(t);
  }, [body, tab, media.length, location, draftId]);

  async function addFiles(files: FileList | null, video = false, maxSeconds?: number) {
    if (!files) return;
    try {
      for (const f of [...files].slice(0, 4)) {
        if (f.type.startsWith("video") || video) {
          setSourceBytes(f.size);
          setProgress("Preparing…");
          setPlaybackOk(false);
          setPlaybackError(null);
          const probeInfo = await probeVideoFile(f);
          if (maxSeconds && probeInfo.durationMs > maxSeconds * 1000) {
            throw new Error(`Keep this clip under ${maxSeconds} seconds.`);
          }
          setProbe(
            probeInfo.width
              ? {
                  width: probeInfo.width,
                  height: probeInfo.height,
                  durationMs: probeInfo.durationMs,
                  fps: null,
                  codec: f.type.includes("mp4") ? "h264" : "vp8",
                  hdr: false,
                  aspect: probeInfo.width >= probeInfo.height ? "landscape" : "portrait",
                  sourceLabel: probeInfo.height >= 2000 ? "4K" : probeInfo.height >= 1000 ? "1080p" : probeInfo.height >= 700 ? "720p" : `${probeInfo.height}p`,
                  bytes: f.size,
                }
              : null,
          );
          setRenditions([]);
          const up = new MediaUploader();
          uploaderRef.current?.dispose();
          uploaderRef.current = up;
          const off = up.onChange(setUploadSnap);
          const purpose =
            tab === "status" ? "status" : tab === "story" ? "story" : tab === "post" ? "post" : "video";
          const snap = await up.pick(f, {
            purpose,
            thumbUrl: probeInfo.thumbUrl,
            width: probeInfo.width || undefined,
            height: probeInfo.height || undefined,
            durationMs: probeInfo.durationMs || undefined,
          });
          off();
          up.onChange(setUploadSnap);
          if (snap.phase === "failed") throw new Error(snap.error || "Could not start upload.");
          if (snap.previewUrl) {
            setMedia((m) => {
              if (m.length >= 4) return m;
              return [...m, { kind: "video", url: snap.previewUrl!, thumbUrl: snap.thumbUrl ?? undefined }];
            });
          }
          if (purpose === "status") setStatusUploadId(snap.uploadId);
          setProgress(null);
          continue;
        }
        const c = await compressImage(f);
        setMedia((m) => [...m, { kind: c.kind, url: c.dataUrl }]);
      }
    } catch (e) {
      setProgress(null);
      toast.error(e instanceof Error ? e.message : "Could not add media.");
    }
  }

  function openPicker(input: HTMLInputElement | null) {
    if (postPicking.current) return;
    postPicking.current = true;
    triggerHaptic("light");
    input?.click();
    window.setTimeout(() => {
      postPicking.current = false;
    }, 700);
  }

  async function publishPost() {
    const hasVideo = media.some((m) => m.kind === "video");
    if (hasVideo && (!uploadSnap || (uploadSnap.phase !== "ready" && uploadSnap.phase !== "published"))) {
      if (uploadSnap?.phase === "failed") {
        toast.error(uploadSnap.error || "Video upload failed. Retry, or remove the video.");
        return;
      }
      setQueuedPublish("feed");
      toast.message("Video is still uploading. The post goes out when the file is on NYX.");
      return;
    }
    let usedServerVideo = false;
    const resolved = media.flatMap((m) => {
      if (m.kind !== "video") return [m];
      const localOnly = m.url.startsWith("blob:") || m.url.startsWith("data:");
      if (!localOnly) return [m];
      if (!uploadSnap?.mediaUrl || usedServerVideo) return [];
      usedServerVideo = true;
      return [{ ...m, url: uploadSnap.mediaUrl, thumbUrl: uploadSnap.thumbUrl ?? m.thumbUrl ?? null }];
    });
    if (hasVideo && !resolved.some((m) => m.kind === "video")) {
      toast.error("That video has not finished uploading.");
      return;
    }
    triggerHaptic();
    setBusy(true);
    setQueuedPublish(null);
    try {
      await createPost({
        data: {
          body,
          media: resolved,
          location: location || null,
          poll: usePoll ? { options: poll, hours: 24 } : null,
          scheduledAt: scheduleAt ? new Date(scheduleAt).toISOString() : null,
          threadItems: threadItems.filter((t) => t.trim()),
          quoteOfId,
        },
      });
      toast.success(scheduleAt ? "Scheduled" : quoteOfId ? "Quoted" : "Posted");
      if (scheduleAt) {
        const at = new Date(scheduleAt);
        if (at.getTime() > Date.now()) {
          void scheduleLocalNotification({
            id: Math.abs(Date.now() % 1_000_000_000),
            title: "Scheduled post",
            body: "Your NYX post is due to publish.",
            at,
            path: "/",
          });
        }
      }
      nav({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  }

  async function publishStory() {
    triggerHaptic();
    setBusy(true);
    try {
      await createStory({
        data: {
          mediaKind: storyKind === "photo" ? "photo" : "text",
          mediaUrl: media[0]?.url ?? null,
          textBody: body,
          background: storyBg,
          privacy: storyPrivacy,
        },
      });
      toast.success("Story is live for 24 hours");
      await qc.invalidateQueries({ queryKey: ["stories"] });
      nav({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post story.");
    } finally {
      setBusy(false);
    }
  }

  async function publishVideo(draft = false) {
    const snap = uploadSnap;
    const v = media.find((m) => m.kind === "video");
    if (!v && !snap?.previewUrl && !snap?.mediaUrl) return toast.error("Add a video first.");
    if (snap && snap.phase !== "ready" && snap.phase !== "published") {
      if (snap.phase === "failed") return toast.error(snap.error || "Video processing failed. Retry processing.");
      setQueuedPublish(draft ? "draft" : "post");
      toast.message("Video is still uploading. We'll publish when it's ready.");
      return;
    }
    const mediaUrl = snap?.mediaUrl ?? v?.url;
    if (!mediaUrl) return toast.error("Add a video first.");
    triggerHaptic();
    setBusy(true);
    setUploadSnap((s) => (s ? { ...s, phase: "publishing" } : s));
    try {
      let thumb = snap?.thumbUrl ?? v?.thumbUrl ?? null;
      if (videoRef.current) thumb = captureVideoThumb(videoRef.current) ?? thumb;
      const r = await uploadVideo({
        data: {
          caption: body,
          mediaUrl,
          uploadId: snap?.uploadId ?? null,
          thumbUrl: thumb,
          musicTitle: pickedSound?.title || music || null,
          speed,
          filterName: filter,
          sourceBytes: snap?.bytes ?? sourceBytes,
          downloadAllowed,
          width: snap?.width ?? probe?.width ?? null,
          height: snap?.height ?? probe?.height ?? null,
          sourceWidth: probe?.width ?? null,
          sourceHeight: probe?.height ?? null,
          sourceLabel: probe?.sourceLabel ?? null,
          fps: probe?.fps ?? undefined,
          codec: probe?.codec ?? "vp8",
          aspectRatio: probe?.aspect ?? null,
          hdr: false,
          soundId: pickedSound?.soundId ?? soundId,
          originalAudio: !(pickedSound?.soundId ?? soundId),
          allowOriginalAudio,
          isDraft: draft,
          remixOfId: typeof window !== "undefined" ? sessionStorage.getItem("nyx-remix-of") : null,
          durationMs: snap?.durationMs ?? probe?.durationMs ?? undefined,
        },
      });
      writePendingVideo(null);
      toast.success(draft ? "Draft saved" : "Video published");
      triggerHaptic();
      nav({ to: draft ? "/me" : "/watch" });
      void r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : uploadRecoveryMessage({ phase: "publishing" });
      setUploadSnap((s) => (s ? { ...s, phase: "ready", error: msg } : s));
      toast.error(msg);
    } finally {
      setBusy(false);
      setQueuedPublish(null);
    }
  }

  async function publishStatus() {
    triggerHaptic();
    setBusy(true);
    try {
      await createStatus({
        data: {
          mediaKind: storyKind === "photo" ? (media[0]?.kind === "video" ? "video" : "photo") : "text",
          mediaUrl: uploadSnap?.mediaUrl ?? media[0]?.url ?? null,
          uploadId: media[0]?.kind === "video" ? uploadSnap?.uploadId ?? statusUploadId : null,
          textBody: body,
          background: storyBg,
          audience,
          exceptUserIds: audience === "except" ? exceptIds : [],
          onlyUserIds: audience === "only" ? onlyIds : [],
          viewOnce: viewOnce && storyKind === "photo",
        },
      });
      toast.success("Status is live for 24 hours");
      await qc.invalidateQueries({ queryKey: ["statuses"] });
      nav({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kc-page px-4 py-4">
      <div className="flex gap-1 rounded-full bg-elevated p-1">
        {(["post", "story", "status", "video", "live"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-full py-2 text-sm font-medium capitalize",
              tab === t ? "bg-surface text-fg" : "text-muted",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "post" ? (
        <div className="mt-4 space-y-3">
          <MentionBox
            placeholder="What's happening? Use @ to mention someone"
            value={body}
            onChange={setBody}
            maxLength={4000}
          />
          <OmniCreateTools
            busy={busy}
            setBusy={setBusy}
            text={body}
            onText={setBody}
            kinds={["post", "caption", "rewrite", "calendar"]}
          />
          <HashtagChips text={body} onText={setBody} />
          <Button type="button" variant="ghost" size="sm" onClick={() => setUsePoll((v) => !v)}>
            Poll
          </Button>
          {usePoll ? (
            <div className="space-y-2">
              {poll.map((o, i) => (
                <Input
                  key={i}
                  value={o}
                  placeholder={`Option ${i + 1}`}
                  onChange={(e) =>
                    setPoll((p) => {
                      const n = [...p];
                      n[i] = e.target.value;
                      return n;
                    })
                  }
                />
              ))}
              {poll.length < 4 ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setPoll((p) => [...p, ""])}>
                  Add option
                </Button>
              ) : null}
            </div>
          ) : null}
          <input
            ref={postFileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,image/*,video/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const files = e.target.files;
              e.target.value = "";
              void addFiles(files);
            }}
          />
          <button
            type="button"
            className="kc-pay-glow inline-flex min-h-12 max-w-full items-center gap-2 rounded-full px-5 text-sm font-semibold !text-white hover:brightness-110 active:scale-[0.98]"
            onClick={() => openPicker(postFileRef.current)}
          >
            <Plus className="size-4" />
            Pic/Video
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void pickFromLibrary({ media: "any", limit: 4 })
                .then((items) => {
                  if (!items.length) return;
                  setMedia((m) => [...m, ...items.map((i) => ({ kind: i.kind, url: i.dataUrl, thumbUrl: null }))]);
                })
                .catch((e) => toast.error(e instanceof Error ? e.message : "Could not open the library."));
            }}
          >
            Photo library
          </Button>
          <Input placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
          <label className="block text-xs text-muted">
            Schedule
            <Input
              type="datetime-local"
              className="mt-1"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
          </label>
          {threadItems.map((t, i) => (
            <textarea
              key={i}
              value={t}
              onChange={(e) =>
                setThreadItems((cur) => {
                  const n = [...cur];
                  n[i] = e.target.value;
                  return n;
                })
              }
              placeholder={`Thread ${i + 2}`}
              className="min-h-16 w-full rounded-xl border border-border bg-transparent p-3 text-sm"
            />
          ))}
          {threadItems.length < 8 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setThreadItems((c) => [...c, ""])}>
              Add to thread
            </Button>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {media.map((m, i) => (
              <div key={`${m.url.slice(0, 24)}-${i}`} className="relative">
                {m.kind === "video" ? (
                  <video src={m.url} controls playsInline className="h-36 w-28 rounded-xl bg-black object-cover" />
                ) : (
                  <img src={m.url} alt="" className="h-36 w-28 rounded-xl object-cover" />
                )}
                <button
                  type="button"
                  className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-black/70 text-xs text-white"
                  aria-label={`Remove ${m.kind === "video" ? "video" : "photo"} ${i + 1}`}
                  onClick={() => setMedia((cur) => cur.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {media.some((m) => m.kind === "video") && uploadSnap ? (
            <UploadProgress
              phase={uploadSnap.phase}
              pct={uploadSnap.pct}
              speedLabel={uploadSnap.speedLabel}
              etaSec={uploadSnap.etaSec}
              error={uploadSnap.error}
              onRetry={() => void uploaderRef.current?.retry()}
              onCancel={() => {
                uploaderRef.current?.cancel();
                setMedia((cur) => cur.filter((m) => m.kind !== "video"));
                setUploadSnap(null);
              }}
            />
          ) : null}
          <Button className="w-full" disabled={busy} onClick={() => void publishPost()}>
            {scheduleAt ? "Schedule" : quoteOfId ? "Quote" : "Publish"}
          </Button>
          {quoteOfId ? <p className="text-xs text-muted">Quoting a post.</p> : null}
        </div>
      ) : null}

      {tab === "story" ? (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Button variant={storyKind === "text" ? "default" : "secondary"} size="sm" onClick={() => setStoryKind("text")}>
              Text
            </Button>
            <Button variant={storyKind === "photo" ? "default" : "secondary"} size="sm" onClick={() => setStoryKind("photo")}>
              Photo
            </Button>
          </div>
          <MentionBox placeholder="Add text" value={body} onChange={setBody} minHeightClass="min-h-24" />
          {storyKind === "photo" ? (
            <>
              <input
                ref={storyFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/*"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  const files = e.target.files;
                  e.target.value = "";
                  void addFiles(files);
                }}
              />
              <button
                type="button"
                className="kc-pay-glow inline-flex min-h-12 max-w-full items-center gap-2 rounded-full px-5 text-sm font-semibold !text-white hover:brightness-110 active:scale-[0.98]"
                onClick={() => openPicker(storyFileRef.current)}
              >
                <Plus className="size-4" />
                Photo
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              {["#121214", "#0f766e", "#1e1b4b", "#7f1d1d"].map((c) => (
                <button
                  key={c}
                  type="button"
                  className="size-8 rounded-full border border-border"
                  style={{ background: c }}
                  onClick={() => setStoryBg(c)}
                  aria-label={c}
                />
              ))}
            </div>
          )}
          {storyKind === "photo" && media[0] ? (
            <div className="relative w-fit">
              {media[0].kind === "video" ? (
                <video src={media[0].url} controls playsInline className="h-36 w-28 rounded-xl bg-black object-cover" />
              ) : (
                <img src={media[0].url} alt="" className="h-36 w-28 rounded-xl object-cover" />
              )}
              <button
                type="button"
                className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-black/70 text-xs text-white"
                aria-label="Remove photo"
                onClick={() => setMedia([])}
              >
                ×
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["everyone", "Everyone"],
                ["friends", "Friends"],
                ["close", "Close Friends"],
              ] as const
            ).map(([v, label]) => (
              <Button
                key={v}
                variant={storyPrivacy === v ? "default" : "secondary"}
                size="sm"
                onClick={() => setStoryPrivacy(v)}
              >
                {label}
              </Button>
            ))}
          </div>
          <Button className="w-full" disabled={busy} onClick={() => void publishStory()}>
            Share story
          </Button>
        </div>
      ) : null}

      {tab === "status" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted">
            Status is not a Story. Friends only by default — or except / only-share-with. Photos, text, or a video up to 2 minutes.
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["friends", "Friends"],
                ["except", "Friends except…"],
                ["only", "Only share with…"],
              ] as const
            ).map(([v, label]) => (
              <Button
                key={v}
                variant={audience === v ? "default" : "secondary"}
                size="sm"
                onClick={() => setAudience(v)}
              >
                {label}
              </Button>
            ))}
          </div>
          {audience === "except" ? (
            <FriendPicker selected={exceptIds} onChange={setExceptIds} label="Hide from these friends" />
          ) : null}
          {audience === "only" ? (
            <FriendPicker selected={onlyIds} onChange={setOnlyIds} label="Only these friends can see it" />
          ) : null}
          <div className="flex gap-2">
            <Button variant={storyKind === "text" ? "default" : "secondary"} size="sm" onClick={() => setStoryKind("text")}>
              Text
            </Button>
            <Button variant={storyKind === "photo" ? "default" : "secondary"} size="sm" onClick={() => setStoryKind("photo")}>
              Photo / video
            </Button>
          </div>
          <MentionBox placeholder="What's going on?" value={body} onChange={setBody} minHeightClass="min-h-24" />
          {storyKind === "photo" ? (
            <>
              <input
                ref={statusFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,image/*,video/*"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  const files = e.target.files;
                  const video = Boolean(files?.[0]?.type.startsWith("video"));
                  e.target.value = "";
                  void addFiles(files, video, 120);
                }}
              />
              <button
                type="button"
                className="kc-pay-glow inline-flex min-h-12 max-w-full items-center gap-2 rounded-full px-5 text-sm font-semibold !text-white hover:brightness-110 active:scale-[0.98]"
                onClick={() => openPicker(statusFileRef.current)}
              >
                <Plus className="size-4" />
                Pic/Video
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              {["#121214", "#0f766e", "#1e1b4b", "#7f1d1d"].map((c) => (
                <button
                  key={c}
                  type="button"
                  className="size-8 rounded-full border border-border"
                  style={{ background: c }}
                  onClick={() => setStoryBg(c)}
                  aria-label={c}
                />
              ))}
            </div>
          )}
          {media[0] ? (
            media[0].kind === "video" ? (
              <video src={mediaSrc(uploadSnap?.previewUrl ?? uploadSnap?.mediaUrl ?? media[0].url)} controls className="max-h-48 w-full rounded-2xl" />
            ) : (
              <img src={media[0].url} alt="" className="max-h-48 w-full rounded-2xl object-cover" />
            )
          ) : null}
          {media[0]?.kind === "video" && uploadSnap ? (
            <UploadProgress
              phase={uploadSnap.phase}
              pct={uploadSnap.pct}
              speedLabel={uploadSnap.speedLabel}
              etaSec={uploadSnap.etaSec}
              error={uploadSnap.error}
              onRetry={() => void uploaderRef.current?.retry()}
              onCancel={() => {
                uploaderRef.current?.cancel();
                setMedia([]);
                setUploadSnap(null);
                setStatusUploadId(null);
              }}
            />
          ) : null}
          {media[0] && storyKind === "photo" ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={viewOnce} onChange={(e) => setViewOnce(e.target.checked)} />
              View once — each friend can open it one time. This device cannot block screenshots.
            </label>
          ) : null}
          <Button className="w-full" disabled={busy} onClick={() => void publishStatus()}>
            Share status
          </Button>
        </div>
      ) : null}

      {tab === "video" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted">
            Pick a clip and we start uploading immediately — you can write the caption while it runs.
            Progress never jumps to 100% until the server has the whole file. If you leave, the draft comes back.
          </p>
          <input
            ref={replaceRef}
            type="file"
            accept="video/*"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => void addFiles(e.target.files, true)}
          />
          {!media[0] && !uploadSnap ? (
            <button
              type="button"
              className="kc-pay-glow inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold"
              onClick={() => replaceRef.current?.click()}
            >
              <Plus className="size-4" aria-hidden />
              Upload video
            </button>
          ) : null}
          {uploadSnap ? (
            <UploadProgress
              phase={uploadSnap.phase}
              pct={uploadSnap.pct}
              speedLabel={uploadSnap.speedLabel}
              etaSec={uploadSnap.etaSec}
              error={uploadSnap.error}
              onRetry={() => void uploaderRef.current?.retry()}
              onCancel={() => {
                uploaderRef.current?.cancel();
                setMedia([]);
                setUploadSnap(null);
                setProbe(null);
              }}
            />
          ) : progress ? (
            <p className="text-sm text-atlas">{progress}</p>
          ) : null}
          {probe ? (
            <p className="text-xs text-muted">
              Source {probe.sourceLabel} · {probe.width}×{probe.height}
              {probe.fps ? ` · ~${probe.fps} fps` : ""} · {probe.codec ?? "unknown codec"}
              {probe.hdr ? " · HDR detected (not kept after encode)" : ""}
              {renditions.length
                ? ` · posting ${renditions.map((r) => r.quality).join(" + ")}`
                : ""}
            </p>
          ) : null}
          {media[0]?.kind === "video" || uploadSnap?.previewUrl ? (
            <VideoReviewPlayer
              src={mediaSrc(uploadSnap?.previewUrl ?? uploadSnap?.mediaUrl ?? media[0]?.url ?? "")}
              onReady={() => {
                setPlaybackOk(true);
                setPlaybackError(null);
              }}
              onFail={(reason) => {
                setPlaybackOk(false);
                setPlaybackError(reason);
              }}
            />
          ) : null}
          <MentionBox
            placeholder="Caption, hashtags, @mentions — @NYXAI replies in comments"
            value={body}
            onChange={setBody}
            minHeightClass="min-h-24"
          />
          <OmniCreateTools busy={busy} setBusy={setBusy} text={body} onText={setBody} kinds={["caption"]} />
          <HashtagChips text={body} onText={setBody} />
          <Input placeholder="Original audio title (optional)" value={music} onChange={(e) => setMusic(e.target.value)} />
          <div className="space-y-2">
            <Button type="button" variant="secondary" onClick={() => setMusicOpen(true)}>
              Search licensed music
            </Button>
            {pickedSound ? (
              <p className="flex items-center gap-2 text-xs text-muted">
                <TrackPlayButton
                  track={{
                    id: pickedSound.id || pickedSound.soundId,
                    provider: pickedSound.provider || "itunes",
                    providerTrackId: pickedSound.providerTrackId || pickedSound.soundId,
                    title: pickedSound.title,
                    artist: pickedSound.artist,
                    album: pickedSound.album ?? null,
                    artworkUrl: pickedSound.artworkUrl,
                    audioUrl: pickedSound.audioUrl ?? pickedSound.previewUrl,
                    previewUrl: pickedSound.previewUrl,
                    downloadUrl: pickedSound.downloadUrl ?? null,
                    durationMs: pickedSound.durationMs ?? null,
                    genre: pickedSound.genre ?? null,
                    license: pickedSound.license,
                    previewAvailable: pickedSound.previewAvailable,
                    playback: pickedSound.playback ?? (pickedSound.previewAvailable ? "preview" : "none"),
                    downloadable: Boolean(pickedSound.downloadable),
                  }}
                />
                {pickedSound.title} · {pickedSound.artist}
                {pickedSound.playback === "full" ? " · full track" : pickedSound.previewAvailable ? " · preview" : ""}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setPickedSound(null);
                    setSoundId(null);
                  }}
                >
                  Remove
                </button>
              </p>
            ) : (
              <p className="text-xs text-subtle">
                Search the catalog. Full tracks play from the source file. Download saves the audio to this device when allowed.
              </p>
            )}
          </div>
          <MusicPicker
            open={musicOpen}
            onClose={() => setMusicOpen(false)}
            onPick={(s) => {
              setPickedSound(s);
              setSoundId(s.soundId);
              setMusic(s.title);
            }}
          />
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">Speed</span>
            {[0.5, 1, 1.5, 2].map((s) => (
              <button
                key={s}
                type="button"
                className={cn("rounded-full px-3 py-1", speed === s ? "bg-elevated text-fg" : "text-muted")}
                onClick={() => setSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">Filter</span>
            {["none", "dusk", "frost", "ember", "noir", "bloom"].map((f) => (
              <button
                key={f}
                type="button"
                className={cn("rounded-full px-3 py-1 capitalize", filter === f ? "bg-elevated text-fg" : "text-muted")}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={downloadAllowed}
              onChange={(e) => setDownloadAllowed(e.target.checked)}
            />
            Allow downloads (NYX watermark applied)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowOriginalAudio}
              onChange={(e) => setAllowOriginalAudio(e.target.checked)}
            />
            Allow others to use this original audio
          </label>
          {media[0]?.kind === "video" || uploadSnap?.uploadId ? (
            <div className="flex gap-2">
            <VideoReviewActions
              playable={uploadSnap?.phase === "ready" || uploadSnap?.phase === "published"}
              error={uploadSnap?.error ?? playbackError}
              busy={busy || uploadSnap?.phase === "uploading" || uploadSnap?.phase === "processing" || uploadSnap?.phase === "publishing"}
              onRetry={() => {
                if (uploadSnap?.phase === "failed" || uploadSnap?.error) {
                  void uploaderRef.current?.retry();
                  return;
                }
                void publishVideo(false);
              }}
              onReplace={() => {
                uploaderRef.current?.cancel();
                setMedia([]);
                setPlaybackOk(false);
                setPlaybackError(null);
                setProbe(null);
                setRenditions([]);
                setUploadSnap(null);
                writePendingVideo(null);
                replaceRef.current?.click();
              }}
              onDraft={() => void publishVideo(true)}
              onPublish={() => void publishVideo(false)}
            />
            </div>
          ) : (
            <p className="text-sm text-muted">Choose a video to preview it. Upload starts as soon as you pick a file.</p>
          )}
        </div>
      ) : null}

      {tab === "live" ? <LiveSetup /> : null}
    </div>
  );
}

const TOOL_LABEL: Record<string, string> = {
  post: "Write",
  caption: "Captions",
  hashtags: "Hashtags",
  rewrite: "Rewrite",
  calendar: "Calendar",
};

function OmniCreateTools({
  busy,
  setBusy,
  text,
  onText,
  kinds,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  text: string;
  onText: (v: string) => void;
  kinds: Array<"post" | "caption" | "hashtags" | "rewrite" | "calendar">;
}) {
  async function run(kind: (typeof kinds)[number]) {
    setBusy(true);
    try {
      const r = await omniFeedAssist({
        data: {
          kind,
          text: text || "Joining NYX today — first post energy.",
        },
      });
      if (r.ok) onText(r.text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "NYXAI could not help with that.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {kinds.map((k) => (
        <Button key={k} type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(k)}>
          {TOOL_LABEL[k]}
        </Button>
      ))}
    </div>
  );
}
