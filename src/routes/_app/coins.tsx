import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { detectStore, nativeBilling } from "@/lib/kchat/billing";
import { BOOST_PACKAGES, COIN_PRODUCTS } from "@/lib/kchat/coins";
import { getStoreProducts } from "@/lib/kchat/purchase-service";
import {
  confirmCoinPurchase,
  getCoinCatalog,
  getCoinWallet,
  listBoosts,
  listCoinLedger,
  startBoost,
  startCoinCheckout,
} from "@/lib/kchat/server/coins";
import { myVideoAnalytics } from "@/lib/kchat/server/videos";
import { getWebCheckoutStatus } from "@/lib/kchat/server/billing";
import { requestRefund } from "@/lib/kchat/server/refunds";
import { refundWindow } from "@/lib/kchat/refunds";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/coins")({ component: CoinsPage });

function clientLocale() {
  if (typeof navigator === "undefined") return "en-NG";
  return navigator.language || "en-NG";
}

function clientTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function CoinsPage() {
  const qc = useQueryClient();
  const locale = clientLocale();
  const timezone = clientTimezone();
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const native = typeof window === "undefined" ? null : nativeBilling();
  const store = useMemo(() => detectStore(ua, native?.platform ?? null), [ua, native?.platform]);
  const wallet = useQuery({ queryKey: ["coin-wallet"], queryFn: () => getCoinWallet(), refetchInterval: 8_000 });
  const catalog = useQuery({
    queryKey: ["coin-catalog", locale, timezone],
    queryFn: () => getCoinCatalog({ data: { locale, timezone: timezone ?? undefined } }),
  });
  const ledger = useQuery({ queryKey: ["coin-ledger"], queryFn: () => listCoinLedger() });
  const boosts = useQuery({ queryKey: ["coin-boosts"], queryFn: () => listBoosts() });
  const videos = useQuery({ queryKey: ["my-videos-boost"], queryFn: () => myVideoAnalytics() });
  const [busy, setBusy] = useState<string | null>(null);
  const [storePrices, setStorePrices] = useState<Record<string, string>>({});
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [boostVideo, setBoostVideo] = useState<string | null>(null);

  const checkoutId =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("checkout");
  const checkout = useQuery({
    queryKey: ["web-checkout", checkoutId],
    queryFn: () => getWebCheckoutStatus({ data: { sessionId: checkoutId! } }),
    enabled: Boolean(checkoutId),
    refetchInterval: 4_000,
  });

  useEffect(() => {
    if (!native || store === "web") return;
    let stop = false;
    void getStoreProducts(COIN_PRODUCTS.map((p) => p.id), native.platform).then((products) => {
      if (stop) return;
      const next: Record<string, string> = {};
      for (const p of products) {
        const id = p.identifier || p.productIdentifier || "";
        if (id && p.priceString) next[id] = p.priceString;
      }
      setStorePrices(next);
      setStoreLoaded(true);
    });
    return () => {
      stop = true;
    };
  }, [native, store]);

  async function buy(productId: string) {
    if (busy) return;
    setBusy(productId);
    try {
      const session = await startCoinCheckout({
        data: {
          productId,
          locale,
          timezone: timezone ?? undefined,
          nativePlatform: native?.platform ?? null,
          startWeb: store === "web",
        },
      });
      if (native && session.sku && session.store !== "web") {
        const purchased = await native.purchase(session.sku);
        const confirmed = await confirmCoinPurchase({
          data: {
            store: purchased.store,
            receipt: purchased.receipt,
            productId: purchased.productId || session.sku,
          },
        });
        if (confirmed.status === "pending") {
          toast.message("The store is still processing this payment. Coins are added only after it confirms.");
          return;
        }
        toast.success(
          confirmed.duplicate
            ? "This purchase was already on your account."
            : `${confirmed.coins.toLocaleString()} NYX Coins added.`,
        );
        void qc.invalidateQueries({ queryKey: ["coin-wallet"] });
        void qc.invalidateQueries({ queryKey: ["coin-ledger"] });
        return;
      }
      if (session.checkoutUrl) {
        window.location.assign(session.checkoutUrl);
        return;
      }
      toast.message(session.instruction);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete that purchase.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="kc-page space-y-6 px-4 pb-8 pt-4">
      <nav className="kc-hide-scrollbar flex gap-2 overflow-x-auto">
        {[
          ["/studio", "Studio"],
          ["/events", "Events"],
          ["/challenges", "Challenges"],
          ["/saved", "Saved"],
          ["/communities", "Spaces"],
          ["/live", "Live"],
          ["/card", "NYX card"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="shrink-0 rounded-full bg-elevated px-3 py-1.5 text-sm text-muted">
            {label}
          </a>
        ))}
      </nav>
      <header className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">NYX Coins</p>
        <p className="mt-2 text-sm text-muted">Current balance</p>
        <p className="mt-1 font-display text-4xl font-semibold tabular-nums">
          {wallet.data?.balance ?? "—"} <span className="text-lg font-medium text-muted">NYX Coins</span>
        </p>
        <p className="mt-2 text-xs text-subtle">{wallet.data?.valuation}</p>
        {catalog.data ? (
          <p className="mt-2 text-xs text-muted">
            {store === "web"
              ? `Web prices for ${catalog.data.countryName} · ${catalog.data.preferredCurrency}`
              : "Prices come from Google Play or the App Store for this device."}
          </p>
        ) : null}
      </header>

      {checkout.data ? (
        <div className="space-y-2 text-sm text-muted">
          <p>
            Checkout {checkout.data.status === "paid" ? "confirmed — coins are on the ledger." : checkout.data.status}.
          </p>
          {checkout.data.status === "paid" && checkoutId && !refundWindow(new Date().toISOString()).expired ? (
            <button
              type="button"
              className="underline"
              onClick={() =>
                void requestRefund({ data: { checkoutId } })
                  .then((r) => toast.message(r.label))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Could not request a refund."))
              }
            >
              Request refund
            </button>
          ) : null}
        </div>
      ) : null}

      <section>
        <h2 className="text-sm font-medium text-muted">Buy NYX Coins</h2>
        {catalog.isPending ? (
          <p className="mt-3 text-sm text-muted">Loading prices for your country…</p>
        ) : null}
        {catalog.isError ? (
          <p className="mt-3 text-sm text-muted">
            {catalog.error instanceof Error ? catalog.error.message : "Could not load coin prices."}
          </p>
        ) : null}
        <ul className="mt-3 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
          {(catalog.data?.packages ?? []).map((p) => {
            const sku = store === "apple" ? p.appleSku : p.googleSku;
            const storePrice = storePrices[sku] || storePrices[p.appleSku] || storePrices[p.googleSku];
            const unavailable = store !== "web" && storeLoaded && !storePrice;
            const price = store !== "web" ? storePrice || "Store price unavailable" : p.display.formatted;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={cn(
                    "kc-pack flex h-full w-full flex-col rounded-3xl bg-surface p-4 text-left",
                    busy === p.id && "opacity-80",
                  )}
                  onClick={() => void buy(p.id)}
                  disabled={Boolean(busy) || unavailable}
                  aria-busy={busy === p.id}
                >
                  <span className="text-lg font-semibold tabular-nums">{p.coins.toLocaleString()}</span>
                  <span className="text-xs text-muted">NYX Coins</span>
                  <span className="mt-3 text-sm font-medium text-accent">{price}</span>
                  <span className="mt-2 text-xs text-muted">
                    {busy === p.id ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" /> Opening the store…
                      </span>
                    ) : unavailable ? (
                      "Unavailable in this store"
                    ) : (
                      "Tap to buy"
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {store === "web" && catalog.data && !catalog.data.webCheckout ? (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Web checkout is not configured on this deployment. Tapping pay starts a real session and then reports that
            honestly. Nothing is added to your wallet until a signed receipt or webhook is verified.
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted">Boost a video</h2>
        <p className="mt-1 text-xs text-subtle">
          Promotes your video to people already on NYX. Does not create fake followers, views, likes, or comments.
        </p>
        <div className="mt-3 space-y-2">
          {(videos.data ?? []).slice(0, 6).map((v: { id: string; caption: string }) => (
            <button
              key={v.id}
              type="button"
              className={cn(
                "block w-full truncate rounded-xl border border-border px-3 py-2 text-left text-sm",
                boostVideo === v.id && "border-accent",
              )}
              onClick={() => setBoostVideo(v.id)}
            >
              {v.caption || "Untitled video"}
            </button>
          ))}
        </div>
        {boostVideo ? (
          <ul className="mt-3 space-y-2">
            {BOOST_PACKAGES.map((b) => (
              <li key={b.id}>
                <Button
                  variant="secondary"
                  className="h-auto w-full justify-between py-2"
                  onClick={() =>
                    void startBoost({ data: { videoId: boostVideo, packageId: b.id } })
                      .then((r) => {
                        toast.message(r.note);
                        void qc.invalidateQueries({ queryKey: ["coin-wallet"] });
                        void qc.invalidateQueries({ queryKey: ["coin-boosts"] });
                        void qc.invalidateQueries({ queryKey: ["coin-ledger"] });
                      })
                      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not start boost."))
                  }
                >
                  <span>{b.label}</span>
                  <span className="tabular-nums">{b.coins} coins</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="mt-4 space-y-2">
          {(boosts.data ?? []).map((b) => (
            <li key={b.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <p className="font-medium">{b.label}</p>
              <p className="mt-1 text-xs text-muted">
                {b.status} · {b.impressions} impressions · {b.views} views · {b.likes} likes · {b.comments} comments ·{" "}
                {b.followersGained} follows
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted">Ledger</h2>
        <ul className="mt-3 space-y-2">
          {(ledger.data ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-xl bg-surface px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-muted">{r.reason || r.kind}</span>
              <span className={cn("tabular-nums", r.direction === "in" ? "text-ok" : "text-fg")}>
                {r.direction === "in" ? "+" : "−"}
                {r.amount}
              </span>
            </li>
          ))}
          {(ledger.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">No coin movements yet.</p>
          ) : null}
        </ul>
      </section>
    </main>
  );
}
