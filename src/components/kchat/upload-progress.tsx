import { formatEta, phaseLabel, type UploadPhase } from "@/lib/kchat/media-pipeline";
import { cn } from "@/lib/utils";

export function UploadProgress({
  phase,
  pct,
  speedLabel,
  etaSec,
  error,
  onRetry,
  onCancel,
}: {
  phase: UploadPhase;
  pct: number;
  speedLabel?: string;
  etaSec?: number | null;
  error?: string | null;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  const showBar = phase === "preparing" || phase === "uploading" || phase === "processing" || phase === "finalizing" || phase === "publishing";
  return (
    <div className="rounded-2xl border border-border bg-elevated px-3 py-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{phaseLabel(phase)}</span>
        <span className="tabular-nums text-muted">
          {phase === "ready" || phase === "published" ? 100 : Math.min(pct, 99)}%
        </span>
      </div>
      {showBar ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${Math.min(phase === "processing" || phase === "finalizing" ? 99 : pct, 99)}%` }}
          />
        </div>
      ) : null}
      {speedLabel || etaSec ? (
        <p className="mt-1 text-xs text-muted">
          {[speedLabel, formatEta(etaSec ?? null)].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      {phase === "failed" || error ? (
        <div className="mt-2 flex gap-2">
          {onRetry ? (
            <button type="button" className="rounded-full bg-accent px-3 py-1.5 text-sm text-accent-fg" onClick={onRetry}>
              Retry
            </button>
          ) : null}
          {onCancel ? (
            <button type="button" className="rounded-full px-3 py-1.5 text-sm text-muted" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
      {phase === "uploading" && onCancel ? (
        <button type="button" className={cn("mt-2 text-xs text-muted")} onClick={onCancel}>
          Cancel upload
        </button>
      ) : null}
    </div>
  );
}
