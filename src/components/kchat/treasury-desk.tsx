import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatMinor } from "@/lib/kchat/billing";
import { getTreasuryDashboard } from "@/lib/kchat/server/treasury";
import { publishMarketPrices } from "@/lib/kchat/server/billing";
import { timeAgo } from "@/lib/utils";

function usd(cents: number) {
  return formatMinor(cents, "USD", "en-US");
}

function permList(p: {
  walletView: boolean;
  walletTransactionView: boolean;
  walletConversion: boolean;
  walletWithdrawalRequest: boolean;
  walletWithdrawalApproval: boolean;
  walletAdmin: boolean;
}) {
  const on = [
    p.walletView ? "view" : null,
    p.walletTransactionView ? "transactions" : null,
    p.walletConversion ? "conversion request" : null,
    p.walletWithdrawalRequest ? "withdrawal request" : null,
    p.walletWithdrawalApproval ? "withdrawal approval" : null,
    p.walletAdmin ? "admin" : null,
  ].filter(Boolean);
  return on.join(" · ") || "none";
}

function ledgerLabel(kind: string, status: string) {
  if (kind === "refund") return "REFUNDED";
  if (status === "reversed") return "REVERSED";
  if (kind === "withdrawal") return status === "settled" ? "WITHDRAWN" : "WITHDRAWN · pending";
  if (kind === "conversion") {
    if (status === "settled") return "CONVERTED";
    if (status === "pending") return "CONVERSION_PENDING";
    return status.toUpperCase();
  }
  if (kind === "net_proceeds" && status === "pending") return "PENDING";
  if (kind === "net_proceeds" && status === "settled") return "SETTLED · CONVERTIBLE";
  return `${kind} · ${status}`.toUpperCase();
}

export function TreasuryDesk() {
  const dash = useQuery({
    queryKey: ["treasury"],
    queryFn: () => getTreasuryDashboard(),
    refetchInterval: 8_000,
  });
  const d = dash.data;

  if (dash.isError) {
    return <p className="mt-6 text-sm text-muted">{(dash.error as Error).message}</p>;
  }
  if (!d) return <p className="mt-6 text-sm text-muted">Loading treasury…</p>;

  return (
    <section className="mt-10 space-y-4" data-testid="treasury-desk">
      <div>
        <h2 className="text-sm font-medium text-muted">ARC treasury</h2>
        <p className="mt-1 text-sm text-muted">
          Store revenue after verification. NYX Coins stay inside the app for gifts and boosts. Currency
          conversion and USDT withdrawal are not available.
        </p>
      </div>
      <p className="text-xs text-muted">Your permissions: {permList(d.permissions)}</p>
      <div className="grid grid-cols-2 gap-2">
        {[
          ["PENDING", usd(d.pendingUsdCents)],
          ["SETTLED", usd(d.settledUsdCents)],
          ["Today", usd(d.totals.todayUsdCents)],
          ["This month", usd(d.totals.monthUsdCents)],
          ["Lifetime gross", usd(d.totals.lifetimeUsdCents)],
          ["Purchases", String(d.totals.purchases)],
          ["Verified live", `${d.totals.monthly + (d.totals.sixMonth ?? 0) + d.totals.yearly}`],
          ["NYXAI+ live", `${(d.totals.aiMonthly ?? 0) + (d.totals.aiYearly ?? 0)}`],
          ["Refunds", `${d.totals.refundCount} · ${usd(d.totals.refundUsdCents)}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl bg-elevated p-3">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          void publishMarketPrices()
            .then((r) => toast.success(`Published ${r.published} listed prices.`))
            .catch((e) => toast.error(e instanceof Error ? e.message : "Could not publish prices."))
        }
      >
        Publish recommended market prices
      </Button>

      <h3 className="text-sm font-medium text-muted">Ledger</h3>
      <ul className="space-y-2">
        {d.ledger.filter((row) => row.kind !== "conversion" && row.kind !== "withdrawal").length === 0 ? (
          <li className="text-sm text-muted">No store proceeds yet.</li>
        ) : (
          d.ledger
            .filter((row) => row.kind !== "conversion" && row.kind !== "withdrawal")
            .map((row) => (
              <li key={row.id} className="rounded-xl bg-elevated px-3 py-2 text-xs">
                <span className="font-medium">{ledgerLabel(row.kind, row.status)}</span> · {row.currency}{" "}
                {row.amount_minor} · {usd(row.usd_cents)} · {timeAgo(row.created_at)}
                {row.original_txn_id ? ` · ${row.original_txn_id}` : ""}
              </li>
            ))
        )}
      </ul>
    </section>
  );
}
