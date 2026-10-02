import { useNavigate } from "@tanstack/react-router";
import { useId, type MouseEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { firstUnviewedId, ringAriaLabel, ringDash, segmentOffset } from "@/lib/kchat/status-ring";
import { cn } from "@/lib/utils";

export type StatusRingSegment = { id: string; seen: boolean };

export function StatusAvatar({
  src,
  name,
  size = "md",
  statusId,
  seen,
  segments,
  online,
  onOpenChat,
  liveId,
  interactive = true,
}: {
  src?: string | null;
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  statusId?: string | null;
  seen?: boolean;
  segments?: StatusRingSegment[];
  online?: boolean;
  onOpenChat?: () => void;
  /** Real live-stream id. Ring only renders when this is set. */
  liveId?: string | null;
  interactive?: boolean;
}) {
  const nav = useNavigate();
  const gid = useId().replace(/:/g, "");
  const dim = size === "sm" ? "size-9" : size === "lg" ? "size-16" : size === "xl" ? "size-24" : "size-12";
  const ring = segments && segments.length > 0 ? segments : statusId ? [{ id: statusId, seen: Boolean(seen) }] : [];
  const live = ring.length > 0;
  const unviewed = ring.filter((s) => !s.seen).length;
  const dash = ringDash(ring.length);

  function openStatus(id: string, e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    nav({ to: "/status/$id", params: { id } });
  }

  function onAvatar(e: MouseEvent) {
    if (liveId) {
      e.preventDefault();
      e.stopPropagation();
      nav({ to: "/live/$id", params: { id: liveId } });
      return;
    }
    if (live) {
      const id = firstUnviewedId(ring);
      if (id) openStatus(id, e);
      return;
    }
    onOpenChat?.();
  }

  const label = liveId
    ? `${name}, live now`
    : live
      ? ringAriaLabel(name, ring.length, unviewed)
      : name;
  const face = <Avatar src={src} name={name} size={size} className="relative size-full border-2 border-bg" />;

  return (
    <div className={cn("relative shrink-0", dim)}>
      {liveId ? <span className="nyx-onair-ring" aria-hidden /> : null}
      {live && !liveId ? (
        <svg viewBox="0 0 36 36" className="absolute -inset-0.5 size-[calc(100%+4px)]" aria-hidden>
          <defs>
            <linearGradient id={`nyx-status-live-${gid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--kc-atlas)" />
              <stop offset="50%" stopColor="var(--kc-ai)" />
              <stop offset="100%" stopColor="var(--kc-capture)" />
            </linearGradient>
          </defs>
          {ring.map((seg, i) => (
            <circle
              key={seg.id}
              cx="18"
              cy="18"
              r={dash.radius}
              fill="none"
              stroke={seg.seen ? "color-mix(in oklab, var(--kc-fg) 28%, transparent)" : `url(#nyx-status-live-${gid})`}
              strokeWidth={size === "xl" ? 2.1 : 2.4}
              strokeLinecap="round"
              strokeDasharray={`${dash.dash} ${dash.circumference}`}
              strokeDashoffset={segmentOffset(i, dash)}
              transform="rotate(-90 18 18)"
              className="cursor-pointer"
              onClick={(e) => openStatus(seg.id, e)}
            />
          ))}
        </svg>
      ) : null}
      {interactive ? (
        <button type="button" className="relative size-full" onClick={onAvatar} aria-label={label}>
          {face}
        </button>
      ) : (
        <span className="relative block size-full" aria-hidden>
          {face}
        </span>
      )}
      {liveId ? (
        <>
          <span className="nyx-onair-dot" aria-hidden />
          <span className="sr-only">Live</span>
        </>
      ) : null}
      {online && !liveId ? (
        <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-ok ring-2 ring-bg" />
      ) : null}
    </div>
  );
}
