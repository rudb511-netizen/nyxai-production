import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminOverview,
  adminReports,
  applySanction,
  listAdministrators,
  listAppeals,
  listBadgeHistory,
  listModActions,
  manageAdministrator,
  resolveReport,
  reviewAppeal,
  reviewReport,
} from "@/lib/kchat/server/more";
import { omniUsageSummary, aiProviderStatus } from "@/lib/kchat/server/omni";
import { securityOverview } from "@/lib/kchat/server/security";
import type { RestrictCaps, RestrictKey } from "@/lib/kchat/restrict";
import { formatCount, timeAgo, cn } from "@/lib/utils";
import { useMeQuery } from "@/lib/kchat/hooks";
import { NameMark } from "@/components/kchat/verified-badge";
import { TreasuryDesk } from "@/components/kchat/treasury-desk";
import { verifyLabel } from "@/lib/kchat/types";

export const Route = createFileRoute("/_app/admin")({ component: Admin });

const CAP_LABELS: { key: RestrictKey; label: string }[] = [
  { key: "post", label: "Cannot post" },
  { key: "comment", label: "Cannot comment" },
  { key: "message", label: "Cannot message" },
  { key: "video", label: "Cannot upload video" },
  { key: "story", label: "Cannot post stories" },
  { key: "status", label: "Cannot post status" },
  { key: "call", label: "Cannot call" },
  { key: "react", label: "Cannot react" },
  { key: "friend", label: "Cannot send friend requests" },
];

function Admin() {
  const me = useMeQuery();
  const isArc = Boolean(me.data?.isArc);
  const showTreasury = isArc;
  const stats = useQuery({ queryKey: ["admin"], queryFn: () => adminOverview() });
  const reports = useQuery({ queryKey: ["reports"], queryFn: () => adminReports(), refetchInterval: 4000 });
  const appeals = useQuery({ queryKey: ["appeals"], queryFn: () => listAppeals() });
  const usage = useQuery({ queryKey: ["omni-usage-admin"], queryFn: () => omniUsageSummary() });
  const providers = useQuery({ queryKey: ["ai-providers"], queryFn: () => aiProviderStatus() });
  const mods = useQuery({ queryKey: ["mod-actions"], queryFn: () => listModActions() });
  const sec = useQuery({ queryKey: ["security-overview"], queryFn: () => securityOverview() });
  const [prefill, setPrefill] = useState("");
  const [tab, setTab] = useState<"new" | "pending" | "resolved">("new");
  if (stats.isError) return <p className="p-6 text-sm text-muted">{(stats.error as Error).message}</p>;
  const s = stats.data;
  const allReports = reports.data ?? [];
  const filtered = allReports.filter((r) => {
    if (tab === "new") return r.status === "open";
    if (tab === "pending") return r.status === "pending";
    return r.status === "resolved";
  });
  const counts = {
    new: allReports.filter((r) => r.status === "open").length,
    pending: allReports.filter((r) => r.status === "pending").length,
    resolved: allReports.filter((r) => r.status === "resolved").length,
  };
  return (
    <div className="kc-page-enter kc-page-wide px-4 py-4">
      <div className="kc-safety-hero">
        <h1 className="text-lg font-semibold">Safety</h1>
        <p className="mt-1 text-sm text-muted">
          {isArc
            ? "ARC Admin desk. You can manage ordinary administrators. ARC accounts cannot act on each other."
            : "Real reports from members and NYX Support. Ordinary administrators cannot sanction other administrators."}
        </p>
      </div>
      {providers.data ? (
        <section className="mt-4 rounded-2xl border border-border px-4 py-3">
          <h2 className="text-sm font-medium">AI providers</h2>
          <p className="mt-1 text-xs text-muted">Fallback: {providers.data.order.join(" → ")}</p>
          <ul className="mt-2 grid gap-1 text-sm">
            {Object.entries(providers.data.providers).map(([name, state]) => (
              <li key={name} className="flex justify-between gap-3">
                <span className="capitalize">{name}</span>
                <span className="text-muted">{state.replaceAll("_", " ")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {isArc ? (
        <Link
          to="/support"
          className="mt-3 flex items-center justify-between rounded-2xl border border-border bg-elevated px-4 py-3"
        >
          <span>
            <span className="block text-sm font-medium">NYX Support inbox</span>
            <span className="text-xs text-muted">Member tickets for both ARC Admins</span>
          </span>
          <span className="text-sm text-accent">Open</span>
        </Link>
      ) : null}
      {s ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            ["Users", s.users],
            ["Onboarded", s.onboarded],
            ["Posts", s.posts],
            ["Videos", s.videos],
            ["Messages", s.messages],
            ["Open reports", s.reportsOpen],
            ["Live", s.live],
            ["Suspended", s.suspended],
            ["Banned", s.banned],
            ["NYXAI messages", s.kai],
          ].map(([label, n]) => (
            <div key={String(label)} className="rounded-2xl bg-elevated p-3">
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatCount(Number(n))}</p>
            </div>
          ))}
        </div>
      ) : null}
      {sec.data ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-muted">Security</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[
              ["Failed sign-ins (24h)", sec.data.failedLogins24h],
              ["Lockouts (24h)", sec.data.lockouts24h],
              ["Active locks", sec.data.openLocks],
              ["Open sessions", sec.data.sessions],
            ].map(([label, n]) => (
              <div key={String(label)} className="rounded-2xl bg-elevated p-3">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatCount(Number(n))}</p>
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-2">
            {sec.data.events.slice(0, 12).map((e) => (
              <li key={e.id} className="text-xs text-muted">
                {e.kind} · {e.detail || "—"} · {timeAgo(e.created_at)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {showTreasury ? <TreasuryDesk /> : null}
      <h2 className="mt-8 text-sm font-medium text-muted">Report center</h2>
      <div className="mt-2 flex gap-1">
        {(
          [
            ["new", "New", counts.new],
            ["pending", "Pending", counts.pending],
            ["resolved", "Resolved", counts.resolved],
          ] as const
        ).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            className="kc-chip"
            onClick={() => setTab(id)}
          >
            {label} · {n}
          </button>
        ))}
      </div>
      <ul className="mt-3 space-y-3">
        {filtered.map((r) => (
          <li
            key={r.id}
            data-testid="report-row"
            className={cn(
              "kc-card-hover rounded-2xl border border-border p-3 text-sm",
              r.priority === "high" && r.status !== "resolved" && "kc-priority",
            )}
          >
            <p className="font-medium capitalize">
              {r.priority === "high" ? "Priority · " : ""}
              {r.category} · {r.targetKind.replace("_", " ")}
            </p>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-subtle">
              {r.source === "omnisupport" ? "NYX Support" : "Member report"} · {r.status}
            </p>
            {r.target ? (
              <p className="mt-1">
                Reported{" "}
                <Link to="/u/$username" params={{ username: r.target.username }} className="text-accent">
                  @{r.target.username}
                </Link>
              </p>
            ) : null}
            {r.snippet ? <p className="mt-1 text-muted">{r.snippet}</p> : null}
            {r.evidence ? (
              <p className="mt-2 rounded-xl bg-elevated px-2.5 py-2 font-mono text-xs text-fg">{r.evidence}</p>
            ) : null}
            {r.target?.isArc ? (
              <p className="mt-2 text-xs text-muted">ARC Admin accounts are review-only. Reports never apply a punishment.</p>
            ) : null}
            {r.warningCount > 0 ? (
              <p className="mt-1 text-xs text-warn">
                Warning {Math.min(r.warningCount, 3)} of 3 · {r.warningCount} recorded
              </p>
            ) : null}
            {(r.warnings ?? []).length > 0 ? (
              <ul className="mt-2 space-y-1 rounded-xl bg-surface/70 p-2 text-xs text-muted">
                {(r.warnings ?? []).slice(0, 4).map((w: { category: string; body: string }, i: number) => (
                  <li key={`${r.id}-w-${i}`}>
                    {w.category} · {w.body.slice(0, 120)}
                  </li>
                ))}
              </ul>
            ) : null}
            {(r.sanctions ?? []).length > 0 ? (
              <p className="mt-1 text-xs text-subtle">
                Prior sanctions: {(r.sanctions ?? []).map((s: { kind: string; status: string }) => `${s.kind} (${s.status})`).join(" · ")}
              </p>
            ) : null}
            {r.appealStatus ? (
              <p className="mt-1 text-xs text-warn">Appeal {r.appealStatus}</p>
            ) : null}
            <p className="mt-1 text-xs text-subtle">
              {r.reporter ? `From @${r.reporter.username}` : "Anonymous"} · {timeAgo(r.createdAt)}
            </p>
            {r.targetKind === "post" ? (
              <Link to="/p/$id" params={{ id: r.targetId }} className="mt-1 inline-block text-xs text-accent">
                Open post
              </Link>
            ) : null}
            {r.status === "open" || r.status === "pending" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {r.status === "open" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void reviewReport({ data: { id: r.id } })
                        .then(() => {
                          toast.success("Moved to pending");
                          void reports.refetch();
                        })
                        .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                    }
                  >
                    Review
                  </Button>
                ) : null}
                {r.target?.isArc
                  ? null
                  : (["dismiss", "remove", "warn", "suspend", "ban"] as const).map((a) => (
                  <Button
                    key={a}
                    size="sm"
                    variant={a === "ban" ? "danger" : "outline"}
                    onClick={() =>
                      void resolveReport({ data: { id: r.id, action: a } })
                        .then(() => {
                          toast.success(`Marked ${a}`);
                          void reports.refetch();
                          void stats.refetch();
                        })
                        .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                    }
                  >
                    {a}
                  </Button>
                ))}
                {r.target ? (
                  r.target.isArc ? null : (
                  <Button size="sm" variant="secondary" onClick={() => setPrefill(r.target!.username)}>
                    Sanction
                  </Button>
                  )
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {filtered.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          {tab === "new" ? "No new reports." : tab === "pending" ? "Nothing pending review." : "No resolved reports yet."}
        </p>
      ) : null}

      <h2 className="mt-8 text-sm font-medium text-muted">Appeals</h2>
      <ul className="mt-2 space-y-3">
        {(appeals.data ?? []).map((a) => (
          <li key={a.id} className="rounded-2xl border border-border p-3 text-sm">
            <p className="font-medium">
              {a.kind} · {a.user ? `@${a.user.username}` : "account"}
            </p>
            <p className="mt-1 text-muted">{a.reason}</p>
            <p className="mt-1">{a.body}</p>
            <p className="mt-1 text-xs text-subtle">
              {timeAgo(a.createdAt)} · {a.status}
            </p>
            {a.status === "open" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    void reviewAppeal({ data: { id: a.id, action: "approve" } })
                      .then(() => {
                        toast.success("Appeal approved — restriction lifted");
                        void appeals.refetch();
                        void stats.refetch();
                      })
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                  }
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void reviewAppeal({ data: { id: a.id, action: "reduce", days: 3 } })
                      .then(() => {
                        toast.success("Reduced to 3 days");
                        void appeals.refetch();
                      })
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                  }
                >
                  Reduce 3d
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void reviewAppeal({ data: { id: a.id, action: "reject" } })
                      .then(() => {
                        toast.success("Appeal rejected");
                        void appeals.refetch();
                      })
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                  }
                >
                  Reject
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {(appeals.data ?? []).length === 0 ? (
        <p className="mt-3 text-sm text-muted">No appeals yet.</p>
      ) : null}

      {isArc ? <ArcDesk onDone={() => void stats.refetch()} /> : null}

      <h2 className="mt-8 text-sm font-medium text-muted">Apply a sanction</h2>
      <SanctionForm
        username={prefill}
        onUsername={setPrefill}
        onDone={() => {
          void stats.refetch();
          void reports.refetch();
        }}
      />

      <h2 className="mt-8 text-sm font-medium text-muted">NYXAI usage (7 days)</h2>
      {usage.data ? (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted">
            {usage.data.connected ? "Live models connected" : "On-device fallback only"} · never shown: provider keys
          </p>
          {usage.data.keys?.length ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {usage.data.keys.map((key) => (
                <div key={key.id} className="rounded-2xl bg-elevated p-3">
                  <p className="text-xs text-muted">{key.provider}</p>
                  <p className="mt-1 font-medium tabular-nums">{key.mask}</p>
                  <p className="text-[11px] text-subtle">
                    {key.status} · {formatCount(key.requests)} requests · {formatCount(key.errors)} errors
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {(usage.data.rows.length ? usage.data.rows : [{ kind: "none", n: 0, tokens: 0 }]).map((r) => (
              <div key={r.kind} className="rounded-2xl bg-elevated p-3">
                <p className="text-xs text-muted">{r.kind}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatCount(r.n)}</p>
                <p className="text-[11px] text-subtle">{formatCount(r.tokens)} out chars</p>
              </div>
            ))}
          </div>
        </div>
      ) : usage.isError ? (
        <p className="mt-2 text-sm text-muted">Usage is limited to safety staff.</p>
      ) : null}

      <h2 className="mt-8 text-sm font-medium text-muted">Moderation log</h2>
      <ul className="mt-2 space-y-2">
        {(mods.data ?? []).slice(0, 20).map((m) => (
          <li key={m.id} className="rounded-2xl bg-elevated px-3 py-2 text-sm">
            <p className="font-medium">
              {m.action} · {m.target_kind}
            </p>
            {m.note ? <p className="text-muted">{m.note}</p> : null}
            <p className="text-xs text-subtle">{timeAgo(m.created_at)}</p>
          </li>
        ))}
      </ul>
      {(mods.data ?? []).length === 0 ? <p className="mt-2 text-sm text-muted">No moderation actions yet.</p> : null}
    </div>
  );
}

function SanctionForm({
  username,
  onUsername,
  onDone,
}: {
  username: string;
  onUsername: (v: string) => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<"warning" | "restriction" | "suspension" | "ban" | "close" | "lift">(
    "restriction",
  );
  const [days, setDays] = useState<number>(7);
  const [reason, setReason] = useState("");
  const [caps, setCaps] = useState<RestrictCaps>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await applySanction({
        data: {
          username: username.replace(/^@/, "").trim(),
          kind,
          reason: reason.trim() || (kind === "lift" ? "Restriction lifted" : "Community guidelines"),
          days: kind === "warning" || kind === "lift" || kind === "ban" || kind === "close" ? 0 : days,
          capabilities: kind === "restriction" ? caps : {},
        },
      });
      toast.success(kind === "lift" ? "Account restored" : `Applied ${kind}`);
      setReason("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-2xl border border-border p-3">
      <div className="space-y-1.5">
        <Label htmlFor="sanction-user">Username</Label>
        <Input
          id="sanction-user"
          value={username}
          onChange={(e) => onUsername(e.target.value)}
          placeholder="@username"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {(["warning", "restriction", "suspension", "ban", "close", "lift"] as const).map((k) => (
          <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>
            {k}
          </Button>
        ))}
      </div>
      {kind !== "warning" && kind !== "lift" && kind !== "ban" && kind !== "close" ? (
        <div className="flex flex-wrap gap-1">
          {[1, 3, 7, 14, 30, 90].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
              {d}d
            </Button>
          ))}
        </div>
      ) : null}
      {kind === "restriction" ? (
        <div className="grid grid-cols-1 gap-1">
          {CAP_LABELS.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(caps[c.key])}
                onChange={(e) => setCaps((cur) => ({ ...cur, [c.key]: e.target.checked }))}
              />
              {c.label}
            </label>
          ))}
        </div>
      ) : null}
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason shown to the account"
        maxLength={400}
      />
      <Button className="w-full" disabled={busy || !username.trim()} onClick={() => void submit()}>
        {busy ? "Saving…" : kind === "lift" ? "Restore account" : "Apply"}
      </Button>
    </div>
  );
}

function ArcDesk({ onDone }: { onDone: () => void }) {
  const admins = useQuery({ queryKey: ["administrators"], queryFn: () => listAdministrators(), refetchInterval: 4000 });
  const history = useQuery({ queryKey: ["badge-history"], queryFn: () => listBadgeHistory({ data: {} }) });
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState<number>(0);
  const [action, setAction] = useState<"demote" | "revoke_badge" | "restore">("demote");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await manageAdministrator({
        data: {
          username: username.replace(/^@/, "").trim(),
          action,
          badge: "all",
          days: days > 0 ? days : undefined,
          reason: reason.trim(),
        },
      });
      toast.success(action === "restore" ? "Administrator restored" : "Administrator updated");
      setReason("");
      void admins.refetch();
      void history.refetch();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8" data-testid="arc-admin-panel">
      <div className="kc-arc-hero">
        <h2 className="text-sm font-semibold tracking-wide">ARC Admin</h2>
        <p className="mt-1 text-sm">
          Manage ordinary administrators and marks. You cannot change another ARC Admin.
        </p>
      </div>
      <ul className="mt-3 space-y-2">
        {(admins.data ?? []).map((a) => (
          <li key={a.userId} data-testid="admin-row" className="rounded-2xl border border-border px-3 py-2">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-left"
              onClick={() => setUsername(a.username)}
            >
              <NameMark name={a.displayName} verifyKind={a.verifyKind} isArc={a.isArc} isPremium={a.isPremium} className="font-medium" />
              <span className="text-xs text-muted">@{a.username}</span>
            </button>
            <p className="mt-0.5 text-xs text-subtle">
              {a.isArc
                ? "Protected ARC account"
                : `${verifyLabel(a.verifyKind) ?? a.role}${a.restoreAt ? ` · restores ${new Date(a.restoreAt).toLocaleDateString()}` : ""}`}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-3 rounded-2xl border border-border p-3">
        <div className="space-y-1.5">
          <Label htmlFor="arc-manage-user">Administrator</Label>
          <Input
            id="arc-manage-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="@username"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(["demote", "revoke_badge", "restore"] as const).map((k) => (
            <Button key={k} size="sm" variant={action === k ? "default" : "outline"} onClick={() => setAction(k)}>
              {k === "demote" ? "Demote to member" : k === "revoke_badge" ? "Remove badge" : "Restore"}
            </Button>
          ))}
        </div>
        {action !== "restore" ? (
          <div className="flex flex-wrap gap-1">
            {([0, 1, 7, 30, 90] as const).map((d) => (
              <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
                {d === 0 ? "Permanent" : `${d}d`}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="arc-manage-reason">Reason</Label>
          <Textarea
            id="arc-manage-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Required — recorded in the audit log"
            maxLength={400}
          />
        </div>
        <Button
          id="arc-manage-submit"
          data-testid="arc-manage-submit"
          className="w-full"
          disabled={busy || !username.trim() || reason.trim().length < 8}
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : action === "demote" ? "Demote to member" : action === "revoke_badge" ? "Remove badge" : "Restore administrator"}
        </Button>
      </div>
      <h3 className="mt-4 text-sm font-medium text-muted">Badge history</h3>
      <ul className="mt-2 space-y-2">
        {(history.data ?? []).slice(0, 12).map((h) => (
          <li key={h.id} className="rounded-2xl bg-elevated px-3 py-2 text-xs">
            <p className="font-medium">
              {h.action} · {h.badge || "mark"} · {h.user ? `@${h.user.username}` : "account"}
            </p>
            <p className="mt-0.5 text-muted">{h.reason}</p>
            <p className="text-subtle">
              {h.actor ? `@${h.actor.username}` : "system"} · {timeAgo(h.createdAt)} · {h.status}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
