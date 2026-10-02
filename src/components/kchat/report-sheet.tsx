import { Flag, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import { REPORT_CATEGORIES, type ReportCategory } from "@/lib/kchat/privacy";
import { fileReport } from "@/lib/kchat/server/more";
import type { ReportTargetKind } from "@/lib/kchat/safety";

const TITLES: Record<ReportTargetKind, string> = {
  user: "Report this account",
  post: "Report this post",
  comment: "Report this comment",
  video: "Report this video",
  video_comment: "Report this comment",
  story: "Report this story",
  status: "Report this status",
  flash: "Report this Flash",
};

export function ReportSheet({
  targetKind,
  targetId,
  onClose,
}: {
  targetKind: ReportTargetKind;
  targetId: string;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<ReportCategory>("harassment");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await fileReport({
        data: { targetKind, targetId, category, details: details.trim() },
      });
      toast.success(
        r.already
          ? "You already sent a report about this."
          : "Report sent to admins and official handles.",
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-fg/40 p-0 sm:place-items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-surface shadow-(--shadow-border-hover) sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-0">
          <div>
            <p id="report-title" className="flex items-center gap-2 text-base font-semibold">
              <Flag className="size-4 text-danger" />
              {TITLES[targetKind]}
            </p>
            <p className="mt-1 text-sm text-muted">
              Safety reviews this. Admins and official NYX handles are notified — the other
              person is not.
            </p>
          </div>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full hover:bg-elevated"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <fieldset className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto px-5">
          <legend className="mb-2 text-sm font-medium">What happened?</legend>
          {REPORT_CATEGORIES.map((c) => (
            <label
              key={c.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-elevated"
            >
              <input
                type="radio"
                name="report-cat"
                className="size-4 accent-accent"
                checked={category === c.id}
                onChange={() => setCategory(c.id)}
              />
              <span className="text-sm">{c.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="mt-4 space-y-2 px-5">
          <Label htmlFor="report-details">Details (optional)</Label>
          <Textarea
            id="report-details"
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, 500))}
            placeholder="Anything safety should know"
            className="min-h-20"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={() => void submit()} disabled={busy}>
            {busy ? "Sending…" : "Send report"}
          </Button>
        </div>
      </div>
    </div>
  );
}
