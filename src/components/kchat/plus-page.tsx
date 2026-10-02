import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  checkoutInstruction,
  detectStore,
  formatMinor,
  nativeBilling,
  productById,
  type ProductFamily,
  type StoreKind,
} from "@/lib/kchat/billing";
import { SUPEROMNI_FEATURES } from "@/lib/kchat/superomni";
import {
  getBillingCatalog,
  getSuperOmniStatus,
  getWebCheckoutStatus,
  listMyPurchases,
  restoreSuperOmni,
  startSuperOmniCheckout,
  type FamilySlice,
} from "@/lib/kchat/server/billing";
import { getStoreProducts } from "@/lib/kchat/purchase-service";
import { useMeQuery } from "@/lib/kchat/hooks";
import { listMyRefunds, requestRefund } from "@/lib/kchat/server/refunds";
import { refundWindow } from "@/lib/kchat/refunds";
import { cn } from "@/lib/utils";

const VERIFY_ORDER = ["nyx.verify.monthly", "nyx.verify.semiannual", "nyx.verify.yearly"] as const;
const AI_ORDER = ["nyx.ai.monthly", "nyx.ai.semiannual", "nyx.ai.yearly"] as const;

type PayPhase =
  | "ready"
  | "preparing"
  | "opening"
  | "pending"
  | "success"
  | "failed"
  | "cancelled"
  | "already";

function sliceFor(family: ProductFamily, s: Awaited<ReturnType<typeof getSuperOmniStatus>> | undefined): FamilySlice | null {
  if (!s) return null;
  return family === "nyxai" ? s.plus : s.verify;
}

function periodWord(period: string | undefined) {
  if (period === "year") return "Year";
  if (period === "six_month") return "6 months";
  return "Month";
}

export function PlusPage() {
  return <ProductCheckout family="verify" />;
}

export function NyxaiPlusPage() {
  return <ProductCheckout family="nyxai" />;
}

function ProductCheckout({ family }: { family: ProductFamily }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMeQuery();
  const locale = typeof navigator === "undefined" ? "en-NG" : navigator.language || "en-NG";
  const timezone = typeof Intl === "undefined" ? null : Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const native = typeof window === "undefined" ? null : nativeBilling();
  const store = useMemo(() => detectStore(ua, native?.platform ?? null), [ua, native?.platform]);
  const catalog = useQuery({
    queryKey: ["billing-catalog", family, locale, timezone],
    queryFn: () => getBillingCatalog({ data: { locale, timezone: timezone ?? undefined, family } }),
  });
  const status = useQuery({
    queryKey: ["superomni-status"],
    queryFn: () => getSuperOmniStatus(),
    refetchInterval: 8_000,
  });
  const purchases = useQuery({
    queryKey: ["my-purchases"],
    queryFn: () => listMyPurchases(),
    refetchInterval: 12_000,
  });
  const defaultPlan = family === "nyxai" ? "nyx.ai.yearly" : "nyx.verify.yearly";
  const [plan, setPlan] = useState<string>(defaultPlan);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<PayPhase>("ready");
  const [note, setNote] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [storePrices, setStorePrices] = useState<Record<string, string>>({});
  const inflight = useRef(false);
  const isVerify = family === "verify";
  const order: readonly string[] = isVerify ? VERIFY_ORDER : AI_ORDER;

  const s = status.data;
  const slice = sliceFor(family, s);
  const plans = (catalog.data?.plans ?? []).filter((p) => p.family === family);
  const selected = plans.find((p) => p.id === plan) ?? plans.find((p) => p.id === defaultPlan) ?? plans[0];
  const trialDays = store === "web" ? 0 : (selected?.trialDaysStore ?? 7);
  const onNative = store === "apple" || store === "google";
  const isArc = Boolean(me.data?.isArc);
  const granted = Boolean(isArc && slice?.active && slice.source === "arc_grant");
  const purchaseActive = Boolean(slice?.active && slice.source === "purchase");
  const hidePay = granted;
  const alreadyActive = purchaseActive && phase !== "success";

  useEffect(() => {
    if (!onNative || !native) return;
    let stop = false;
    void getStoreProducts(order as unknown as string[], native.platform).then((products) => {
      if (stop) return;
      const next: Record<string, string> = {};
      for (const p of products) {
        const id = p.identifier || p.productIdentifier || "";
        if (id && p.priceString) next[id] = p.priceString;
      }
      setStorePrices(next);
    });
    return () => {
      stop = true;
    };
  }, [onNative, native, order]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("checkout");
    if (!id) return;
    setPhase("pending");
    setNote("Payment processing… the charge is confirmed only after the provider webhook.");
    let stop = false;
    const tick = async () => {
      try {
        const st = await getWebCheckoutStatus({ data: { sessionId: id } });
        if (stop) return;
        if (st.status === "paid") {
          setPhase("success");
          setNote(isVerify ? "Verification active." : "NYXAI+ is on.");
          void qc.invalidateQueries({ queryKey: ["superomni-status"] });
          void qc.invalidateQueries({ queryKey: ["me"] });
          void qc.invalidateQueries({ queryKey: ["my-purchases"] });
          return;
        }
        if (st.status === "expired" || st.status === "failed" || st.status === "cancelled") {
          setPhase(st.status === "cancelled" ? "cancelled" : "failed");
          setNote("Payment could not be completed.");
          return;
        }
        window.setTimeout(() => void tick(), 4000);
      } catch {
        if (!stop) window.setTimeout(() => void tick(), 6000);
      }
    };
    void tick();
    const kill = window.setTimeout(() => {
      stop = true;
    }, 120_000);
    return () => {
      stop = true;
      window.clearTimeout(kill);
    };
  }, [qc, isVerify]);

  useEffect(() => {
    if (granted) setPhase("already");
    else if (purchaseActive && phase === "ready") setPhase("already");
  }, [granted, purchaseActive, phase]);

  async function subscribe(productId?: string) {
    const target = plans.find((p) => p.id === (productId ?? selected?.id)) ?? selected;
    if (!target || inflight.current || hidePay) return;
    if (alreadyActive && phase === "already") return;
    inflight.current = true;
    setBusy(true);
    setPhase("preparing");
    setNote("Preparing secure checkout…");
    try {
      const session = await startSuperOmniCheckout({
        data: {
          productId: target.id,
          locale,
          timezone: timezone ?? undefined,
          userAgent: ua,
          nativePlatform: native?.platform ?? null,
          startWeb: store === "web",
        },
      });
      if (session.alreadyGranted) {
        setPhase("already");
        setNote(session.instruction);
        toast.message(session.instruction);
        return;
      }
      const bridge = nativeBilling();
      if (bridge && session.store !== "web") {
        setPhase("opening");
        setNote(session.store === "apple" ? "Opening App Store…" : "Opening Google Play…");
        try {
          const sku = session.store === "apple" ? session.appleSku : session.googleSku;
          const purchased = await bridge.purchase(sku);
          setPhase("pending");
          setNote("Verifying payment…");
          const restored = await restoreSuperOmni({
            data: {
              store: purchased.store,
              receipt: purchased.receipt,
              productId: purchased.productId,
            },
          });
          const on = family === "nyxai" ? restored.status.nyxaiPlus : restored.status.premiumVerify;
          if (!on) {
            setPhase("pending");
            toast.message("The store has the charge. Access turns on after the receipt is verified.");
            setNote("Your payment is pending confirmation.");
          } else {
            setPhase("success");
            setNote(isVerify ? "Verification active." : "NYXAI+ is on.");
            toast.success(isVerify ? "NYX Verified is on." : "NYXAI+ is on.");
          }
          void qc.invalidateQueries({ queryKey: ["superomni-status"] });
          void qc.invalidateQueries({ queryKey: ["me"] });
          void qc.invalidateQueries({ queryKey: ["my-purchases"] });
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Purchase cancelled";
          if (/cancel/i.test(msg)) {
            setPhase("cancelled");
            setNote("Purchase cancelled");
          } else {
            setPhase("failed");
            setNote("Payment could not be completed.");
          }
          toast.error(msg);
          return;
        }
      }
      if (session.checkoutUrl) {
        setPhase("opening");
        setNote("Opening secure checkout…");
        window.location.assign(session.checkoutUrl);
        return;
      }
      setPhase("failed");
      setNote(session.instruction);
      toast.message(session.instruction);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start checkout.";
      setPhase("failed");
      setNote(msg);
      toast.error(msg);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  async function restore() {
    if (!isVerify) return;
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      const bridge = nativeBilling();
      if (!bridge) {
        toast.message("Restore is for App Store and Google Play purchases on the NYX apps.");
        return;
      }
      setNote("Asking the store for purchases…");
      const bag = await bridge.restore();
      if (!bag.receipts.length) {
        toast.message("The store has no NYX Verified purchases for this account.");
        return;
      }
      let on = false;
      for (const r of bag.receipts) {
        const res = await restoreSuperOmni({
          data: { store: r.store as StoreKind, receipt: r.receipt, productId: r.productId },
        });
        if (res.status.premiumVerify) on = true;
      }
      toast.message(on ? "Purchases restored." : "The store replied. Access turns on only after a verified receipt.");
      void qc.invalidateQueries({ queryKey: ["superomni-status"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["my-purchases"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not restore.");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  const selectedSku = selected
    ? store === "apple"
      ? productById(selected.id)?.appleSku
      : productById(selected.id)?.googleSku
    : undefined;
  const storeReady = Object.keys(storePrices).length > 0;
  const priceLabel = onNative
    ? (selectedSku && storePrices[selectedSku]) || (storeReady ? "Unavailable" : "Store price")
    : selected?.display.formatted || "—";
  const cadence = selected?.cadence ?? "";
  const payText = payButtonLabel({
    phase: alreadyActive && phase === "ready" ? "already" : phase,
    onNative,
    trialDays,
    priceLabel,
    period: selected?.period,
    renewsAt: slice?.renewsAt ?? null,
    family,
  });

  return (
    <div className="kc-page-enter space-y-8 px-4 py-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-ai">NYX</p>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          {isVerify ? <BadgeCheck className="size-6 text-ok" /> : <Sparkles className="size-6 text-ai" />}
          {isVerify ? "NYX Verified" : "NYXAI+"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {isVerify
            ? "Get your official NYX verification badge — a glowing green check next to your name. This plan does not include NYXAI+."
            : "Advanced NYXAI capabilities. Everyday NYXAI stays free. This plan does not include the green verification check."}
        </p>
      </div>

      {granted ? (
        <div className="rounded-2xl bg-elevated p-4">
          <p className="text-sm font-medium">
            {isVerify ? "ARC Admin verified" : "NYXAI+ included with ARC Admin"}
          </p>
          <p className="mt-1 text-xs text-muted">
            {isVerify
              ? "Your rank automatically includes verification. There is nothing to pay."
              : "ARC Admin rank includes NYXAI+. That grant is not a payment."}
          </p>
        </div>
      ) : slice?.active ? (
        <div className="rounded-2xl bg-elevated p-4">
          <p className="text-sm font-medium">
            {isVerify ? "NYX Verified is on" : "NYXAI+ is on"}
            {slice.plan === "year" ? " · yearly" : slice.plan === "six_month" ? " · 6 months" : slice.plan === "month" ? " · monthly" : ""}
          </p>
          <p className="mt-1 text-xs text-muted">
            {slice.status === "trial" && slice.trialEndsAt
              ? `Trial until ${new Date(slice.trialEndsAt).toLocaleDateString()}. Then ${priceLabel} ${cadence.toLowerCase()} unless you cancel in the store.`
              : slice.renewsAt
                ? `Current period through ${new Date(slice.renewsAt).toLocaleDateString()}. ${slice.autoRenew ? "Renews automatically." : "Auto-renew is off."}`
                : "Active from a verified entitlement."}
          </p>
        </div>
      ) : null}

      {!hidePay ? (
        <>
          <div className="grid gap-2">
            {plans
              .slice()
              .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
              .map((p) => {
                const active = plan === p.id;
                const prod = productById(p.id);
                const sku = store === "apple" ? prod?.appleSku : prod?.googleSku;
                const fromStore = sku ? storePrices[sku] : undefined;
                const loaded = Object.keys(storePrices).length > 0;
                const price = fromStore || (onNative && loaded ? "Unavailable" : p.display.formatted);
                const unavailable = onNative && loaded && !fromStore;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={active}
                    disabled={unavailable || busy}
                    onClick={() => {
                      setPlan(p.id);
                      setReview(false);
                      if (phase === "failed" || phase === "cancelled") setPhase("ready");
                      if (onNative && !unavailable) void subscribe(p.id);
                    }}
                    className={cn("kc-pack rounded-3xl px-4 py-3 text-left", active && "ring-2 ring-ok")}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium">{p.title}</p>
                      <p className="text-sm tabular-nums">{price}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {p.cadence}
                      {unavailable ? " · unavailable in this store" : onNative ? "" : p.display.estimated ? " · listed price" : ""}
                    </p>
                  </button>
                );
              })}
          </div>

          <p className="text-xs leading-relaxed text-muted">
            {onNative
              ? "The price is the one Google Play or the App Store returns for this device. NYX does not convert it."
              : catalog.data
                ? `Web checkout uses the listed ${catalog.data.preferredCurrency} price for ${catalog.data.countryName}. Country comes from the store, account, or network — not a manual list.`
                : "Loading listed prices…"}
          </p>

          {onNative ? (
            <p className="text-sm leading-relaxed">
              {trialDays}-day free trial, then {priceLabel} {cadence.toLowerCase()} until you cancel in{" "}
              {store === "apple" ? "Settings → Apple ID → Subscriptions" : "Play → Payments & subscriptions"}.
            </p>
          ) : (
            <p className="text-sm leading-relaxed">
              Web checkout has no free trial. You pay {priceLabel} {cadence.toLowerCase()} now. Apple and
              Google remain the stores on their apps.
            </p>
          )}

          {review && selected ? (
            <div className="space-y-3 rounded-2xl border border-ok/40 bg-elevated p-4" data-testid="checkout-review">
              <p className="text-sm font-medium">Review checkout</p>
              <p className="text-sm leading-relaxed">
                {isVerify ? "NYX Verified" : "NYXAI+"} · {selected.title} · {priceLabel}
              </p>
              <p className="text-xs leading-relaxed text-muted">
                {catalog.data
                  ? `${catalog.data.countryName} · ${catalog.data.preferredCurrency} · ${
                      store === "apple" ? "App Store" : store === "google" ? "Google Play" : "Web signed checkout"
                    }. Amount is locked from the listed price, not typed in this browser.`
                  : "Loading listed price…"}
              </p>
              {onNative ? (
                <p className="text-xs text-muted">{trialDays}-day trial, then the listed price until you cancel in the store.</p>
              ) : (
                <p className="text-xs text-muted">No free trial on the web. Continue opens a signed checkout session.</p>
              )}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={busy || !selected || alreadyActive}
              onClick={() => {
                if (alreadyActive || !selected) return;
                if (onNative) {
                  void subscribe();
                  return;
                }
                if (!review) {
                  setReview(true);
                  setPhase("ready");
                  setNote("Confirm to open signed web checkout.");
                  return;
                }
                void subscribe();
              }}
              className={cn(
                "kc-pay-glow flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold",
                alreadyActive && "opacity-80",
              )}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : isVerify ? <BadgeCheck className="size-4" /> : <Sparkles className="size-4" />}
              {review && phase === "ready" && !alreadyActive
                ? onNative
                  ? store === "apple"
                    ? `Continue · App Store · ${priceLabel}`
                    : `Continue · Google Play · ${priceLabel}`
                  : `Continue · Pay ${priceLabel} / ${periodWord(selected?.period)}`
                : payText}
            </button>
            {review && !busy && !alreadyActive ? (
              <button
                type="button"
                className="h-11 text-sm text-muted underline"
                onClick={() => {
                  setReview(false);
                  setNote(null);
                }}
              >
                Back
              </button>
            ) : null}
            {isVerify ? (
              <Button variant="secondary" disabled={busy} onClick={() => void restore()} className="h-12">
                <RotateCcw className="size-4" />
                Restore NYX Verified
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      {!hidePay ? (
        <>
          {note ? <p className="text-sm leading-relaxed text-muted">{note}</p> : (
            <p className="text-sm leading-relaxed text-muted">{checkoutInstruction(store, trialDays, family)}</p>
          )}

          {store === "web" && !catalog.data?.webCheckout ? (
            <p className="text-xs leading-relaxed text-muted">
              This browser cannot open App Store or Google Play billing. Web checkout is not configured on
              this deployment, so tapping Pay starts a real session and then reports that honestly. Nothing
              unlocks until a signed receipt or provider webhook is verified.
            </p>
          ) : null}
        </>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">{isVerify ? "What you get" : "Included with NYXAI+"}</h2>
        <ul className="space-y-2">
          {isVerify ? (
            <li className="rounded-2xl bg-elevated px-4 py-3">
              <p className="text-sm font-medium">Glowing green verification check</p>
              <p className="mt-1 text-xs text-muted">
                Shows next to your name while NYX Verified is active. It does not replace organization,
                founder, developer, or ARC marks, and it does not unlock NYXAI+.
              </p>
            </li>
          ) : (
            SUPEROMNI_FEATURES.map((f) => (
              <li key={f.id} className="rounded-2xl bg-elevated px-4 py-3">
                <p className="text-sm font-medium">{f.title}</p>
                <p className="mt-1 text-xs text-muted">{f.body}</p>
              </li>
            ))
          )}
        </ul>
      </section>

      {isVerify ? (
        <section className="rounded-2xl border border-border p-4">
          <p className="text-sm font-medium">NYXAI+</p>
          <p className="mt-1 text-xs text-muted">Want advanced AI capabilities? That is a separate product.</p>
          <Button asChild variant="secondary" size="sm" className="mt-3">
            <Link to="/plus/ai">View NYXAI+</Link>
          </Button>
        </section>
      ) : (
        <section className="rounded-2xl border border-border p-4">
          <p className="text-sm font-medium">NYX Verified</p>
          <p className="mt-1 text-xs text-muted">The glowing green check is a separate plan. NYXAI+ does not include it.</p>
          <Button asChild variant="secondary" size="sm" className="mt-3">
            <Link to="/plus">Get verified</Link>
          </Button>
        </section>
      )}

      <PurchaseHistory family={family} data={purchases.data} />
      {isVerify ? <RefundHistory /> : null}

      <p className="text-xs text-muted">
        Cancel anytime in the store that billed you. Refunds and expirations remove only this product.
        The other product stays if it was purchased or granted separately.{" "}
        <button type="button" className="underline" onClick={() => void nav({ to: "/settings" })}>
          Settings
        </button>
      </p>
    </div>
  );
}

function payButtonLabel(opts: {
  phase: PayPhase;
  onNative: boolean;
  trialDays: number;
  priceLabel: string;
  period: string | undefined;
  renewsAt: string | null;
  family: ProductFamily;
}) {
  switch (opts.phase) {
    case "preparing":
      return "Preparing secure checkout…";
    case "opening":
      return "Opening payment…";
    case "pending":
      return "Payment processing…";
    case "success":
      return opts.family === "verify" ? "Verification active" : "NYXAI+ active";
    case "failed":
      return "Payment failed — Try again";
    case "cancelled":
      return "Purchase cancelled";
    case "already":
      return opts.renewsAt
        ? `Active until ${new Date(opts.renewsAt).toLocaleDateString()}`
        : "Already active";
    default:
      if (opts.onNative) return `Start ${opts.trialDays}-day trial · ${opts.priceLabel}`;
      return `Pay ${opts.priceLabel} / ${periodWord(opts.period)}`;
  }
}

function PurchaseHistory({
  family,
  data,
}: {
  family: ProductFamily;
  data: Awaited<ReturnType<typeof listMyPurchases>> | undefined;
}) {
  if (!data) return null;
  const subs = data.subscriptions.filter((s) => (s.family || productById(s.product_id)?.family) === family);
  const refs = data.refs.filter((r) => !r.product_id || productById(r.product_id)?.family === family);
  const checkouts = data.checkouts.filter((c) => productById(c.product_id)?.family === family);
  const events = data.events.filter((e) => !e.product_id || productById(e.product_id)?.family === family);
  const empty = !subs.length && !refs.length && !checkouts.length && !events.length;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted">Transaction history</h2>
      {empty ? (
        <p className="text-xs text-muted">No purchases recorded for this product yet.</p>
      ) : (
        <ul className="space-y-2">
          {refs.map((r) => (
            <li key={r.id} className="rounded-xl bg-elevated px-3 py-2 text-xs">
              <span className="font-medium">{r.id}</span>
              {" · "}
              {r.product_id ?? "plan"} · {r.store ?? "—"} ·{" "}
              {r.amount_minor != null && r.currency ? formatMinor(r.amount_minor, r.currency) : "amount pending"}
              {" · "}
              {r.status} · {new Date(r.created_at).toLocaleDateString()}
            </li>
          ))}
          {checkouts.map((c) => (
            <li key={c.id} className="rounded-xl bg-elevated px-3 py-2 text-xs">
              <p>
                Web {c.provider} · {productById(c.product_id)?.title ?? c.product_id} ·{" "}
                {formatMinor(c.amount_minor, c.currency)} · {c.status} · {new Date(c.created_at).toLocaleDateString()}
              </p>
              {c.status === "paid" && family === "verify" && !refundWindow(c.created_at).expired ? (
                <button
                  type="button"
                  className="mt-1 underline"
                  onClick={() =>
                    void requestRefund({ data: { checkoutId: c.id } })
                      .then((r) => toast.message(r.label))
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not request a refund."))
                  }
                >
                  Request refund
                </button>
              ) : c.status === "paid" && family === "verify" ? (
                <p className="mt-1 text-muted">Refund request period expired.</p>
              ) : null}
            </li>
          ))}
          {subs.map((s) => (
            <li key={s.id} className="rounded-xl bg-elevated px-3 py-2 text-xs">
              {productById(s.product_id)?.title ?? s.product_id} · {s.store} · {s.status}
              {s.period_end ? ` · through ${new Date(s.period_end).toLocaleDateString()}` : ""}
              {s.auto_renew ? " · renews" : " · auto-renew off"}
            </li>
          ))}
          {events.map((e) => (
            <li key={e.id} className="rounded-xl bg-elevated px-3 py-2 text-xs">
              {e.store} {e.event_type} · {e.matched ? "matched" : "unmatched"} ·{" "}
              {new Date(e.processed_at).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { PlusPage as SuperOmniPage };

function RefundHistory() {
  const q = useQuery({ queryKey: ["my-refunds"], queryFn: () => listMyRefunds(), refetchInterval: 12_000 });
  const rows = (q.data ?? []).filter((r) => r.family === "verify");
  if (!rows.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted">Refund requests</h2>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl bg-elevated px-3 py-2 text-xs">
            {r.status} · {r.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
