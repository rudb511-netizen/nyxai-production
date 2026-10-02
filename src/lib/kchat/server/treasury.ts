import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import {
  BEP20_USDT_CONTRACT,
  BSC_CHAIN_ID,
  USDT_DECIMALS,
  type UsdtNetwork,
} from "../billing";
import { isArcFlag } from "../types";
import { ensureProfile, sqlClient, type ProfileRow } from "./helpers";
import { settleDueLedger } from "./billing";
import { getQuote, getUsdtPerUsd } from "./fx";

export function canAccessTreasury(p: ProfileRow): boolean {
  if (p.is_banned || p.is_suspended) return false;
  if (p.user_id === "omni_ai_system" || p.user_id === "omni_support_system") return false;
  return isArcFlag(p);
}

export function requireTreasury(p: ProfileRow): void {
  if (!canAccessTreasury(p)) throw new Error("Treasury access required.");
}

function custodyConfigured(): boolean {
  return Boolean(process.env.TREASURY_CUSTODY_ENDPOINT?.trim() && process.env.TREASURY_CUSTODY_KEY?.trim());
}

export type TreasuryPerms = {
  walletView: boolean;
  walletTransactionView: boolean;
  walletConversion: boolean;
  walletWithdrawalRequest: boolean;
  walletWithdrawalApproval: boolean;
  walletAdmin: boolean;
};

const VIEW_PERMS: TreasuryPerms = {
  walletView: true,
  walletTransactionView: true,
  walletConversion: true,
  walletWithdrawalRequest: true,
  walletWithdrawalApproval: false,
  walletAdmin: false,
};

async function loadTreasuryPerms(sql: Sql, userId: string): Promise<TreasuryPerms> {
  try {
    const rows = await sql<{
      wallet_view: boolean;
      wallet_transaction_view: boolean;
      wallet_conversion: boolean;
      wallet_withdrawal_request: boolean;
      wallet_withdrawal_approval: boolean;
      wallet_admin: boolean;
    }>`
      select wallet_view, wallet_transaction_view, wallet_conversion,
             wallet_withdrawal_request, wallet_withdrawal_approval, wallet_admin
      from treasury_permissions where user_id = ${userId} limit 1
    `;
    const r = rows[0];
    if (!r) return VIEW_PERMS;
    return {
      walletView: r.wallet_view,
      walletTransactionView: r.wallet_transaction_view,
      walletConversion: r.wallet_conversion,
      walletWithdrawalRequest: r.wallet_withdrawal_request,
      walletWithdrawalApproval: r.wallet_withdrawal_approval,
      walletAdmin: r.wallet_admin,
    };
  } catch {
    return VIEW_PERMS;
  }
}

function treasuryAddress(): string | null {
  const a = process.env.TREASURY_ADDRESS?.trim() ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) return null;
  if (a.toLowerCase() === BEP20_USDT_CONTRACT.toLowerCase()) return null;
  return a;
}

function hexToBigInt(hex: unknown): bigint | null {
  if (typeof hex !== "string" || !hex) return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

function formatBnb(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${frac} BNB`;
}

async function bscRpc(method: string, params: unknown[]): Promise<unknown> {
  const url = process.env.TREASURY_BSC_RPC?.trim();
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: unknown };
    return j.result ?? null;
  } catch {
    return null;
  }
}

async function readOnchain(address: string): Promise<{
  usdtMinor: number | null;
  bnbWei: string | null;
  bnbFormatted: string | null;
  synced: boolean;
  error: string | null;
}> {
  const rpc = process.env.TREASURY_BSC_RPC?.trim();
  if (!rpc) {
    return {
      usdtMinor: null,
      bnbWei: null,
      bnbFormatted: null,
      synced: false,
      error: "BNB Smart Chain RPC is not configured. On-chain balances stay unknown — not invented.",
    };
  }
  const padded = address.slice(2).toLowerCase().padStart(64, "0");
  const data = `0x70a08231${padded}`;
  const [usdtHex, bnbHex] = await Promise.all([
    bscRpc("eth_call", [{ to: BEP20_USDT_CONTRACT, data }, "latest"]),
    bscRpc("eth_getBalance", [address, "latest"]),
  ]);
  const usdtWei = hexToBigInt(usdtHex);
  const bnbWei = hexToBigInt(bnbHex);
  if (usdtWei == null && bnbWei == null) {
    return {
      usdtMinor: null,
      bnbWei: null,
      bnbFormatted: null,
      synced: false,
      error: "BNB Smart Chain RPC did not return a balance.",
    };
  }
  // BSC-USD (BEP-20) uses 18 decimals. NYX ledger uses 6. Convert 18 → 6.
  const usdtMinor = usdtWei != null ? Number(usdtWei / 10n ** 12n) : null;
  return {
    usdtMinor: usdtMinor != null && Number.isFinite(usdtMinor) ? usdtMinor : null,
    bnbWei: bnbWei != null ? bnbWei.toString() : null,
    bnbFormatted: bnbWei != null ? formatBnb(bnbWei) : null,
    synced: true,
    error: null,
  };
}

export const getTreasuryDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    const me = await ensureProfile(sql, { id: context.userId });
    requireTreasury(me);
    await settleDueLedger(sql).catch(() => {});
    const perms = await loadTreasuryPerms(sql, context.userId);
    if (!perms.walletView) throw new Error("Treasury view permission required.");

    const acct = await sql<{
      pending_usd_cents: number;
      settled_usd_cents: number;
      usdt_on_hand_minor: number;
      convertible_usd_cents: number | null;
      conversion_pending_usd_cents: number | null;
      onchain_usdt_minor: number | null;
      bnb_wei: string | null;
      treasury_address: string | null;
      chain_synced_at: string | null;
      updated_at: string;
    }>`
      select pending_usd_cents, settled_usd_cents, usdt_on_hand_minor,
             convertible_usd_cents, conversion_pending_usd_cents, onchain_usdt_minor,
             bnb_wei, treasury_address, chain_synced_at, updated_at
      from treasury_accounts where id = 'org_treasury'
    `.catch(async () => {
      const fallback = await sql<{
        pending_usd_cents: number;
        settled_usd_cents: number;
        usdt_on_hand_minor: number;
        updated_at: string;
      }>`select pending_usd_cents, settled_usd_cents, usdt_on_hand_minor, updated_at from treasury_accounts where id = 'org_treasury'`;
      const f = fallback[0] ?? { pending_usd_cents: 0, settled_usd_cents: 0, usdt_on_hand_minor: 0, updated_at: new Date().toISOString() };
      return [{
        ...f,
        convertible_usd_cents: f.settled_usd_cents,
        conversion_pending_usd_cents: 0,
        onchain_usdt_minor: 0,
        bnb_wei: null,
        treasury_address: null,
        chain_synced_at: null,
      }];
    });
    const a = acct[0] ?? {
      pending_usd_cents: 0,
      settled_usd_cents: 0,
      usdt_on_hand_minor: 0,
      convertible_usd_cents: 0,
      conversion_pending_usd_cents: 0,
      onchain_usdt_minor: 0,
      bnb_wei: null,
      treasury_address: null,
      chain_synced_at: null,
      updated_at: new Date().toISOString(),
    };

    const address = treasuryAddress();
    const chain = address
      ? await readOnchain(address)
      : {
          usdtMinor: null,
          bnbWei: null,
          bnbFormatted: null,
          synced: false,
          error: "Treasury address is not configured. On-chain USDT and BNB stay unknown — not invented.",
        };
    if (address && chain.synced) {
      await sql`
        update treasury_accounts set
          onchain_usdt_minor = ${chain.usdtMinor ?? 0},
          bnb_wei = ${chain.bnbWei},
          treasury_address = ${address},
          chain_synced_at = now(),
          updated_at = now()
        where id = 'org_treasury'
      `.catch(() => {});
    }

    const counts = await sql<{ product_id: string; n: number }>`
      select product_id, count(*)::int as n from subscriptions
      where status in ('active', 'grace', 'billing_retry', 'cancelled')
      group by product_id
    `;
    const purchases = await sql<{ n: number }>`
      select count(*)::int as n from ledger_entries where kind = 'store_gross'
    `;
    const refunds = await sql<{ n: number; usd: string | number }>`
      select count(*)::int as n, coalesce(sum(abs(usd_cents)),0)::text as usd
      from ledger_entries where kind = 'refund'
    `;
    const gross = await sql<{ usd: string | number; ngn: string | number }>`
      select coalesce(sum(usd_cents),0)::text as usd, coalesce(sum(amount_minor),0)::text as ngn
      from ledger_entries where kind = 'store_gross'
    `;
    const fees = await sql<{ usd: string | number }>`
      select coalesce(sum(abs(usd_cents)),0)::text as usd
      from ledger_entries where kind = 'platform_fee'
    `;
    const failed = await sql<{ n: number }>`
      select count(*)::int as n from withdrawals where status = 'failed'
    `;
    const ledger = await sql<{
      id: string;
      kind: string;
      currency: string;
      amount_minor: number;
      usd_cents: number;
      usdt_minor: number;
      status: string;
      available_at: string | null;
      settled_at: string | null;
      original_txn_id: string | null;
      note: string;
      created_at: string;
    }>`
      select id, kind, currency, amount_minor, usd_cents, usdt_minor, status, available_at, settled_at,
             original_txn_id, note, created_at
      from ledger_entries
      where account_id = 'org_treasury'
      order by created_at desc
      limit 40
    `;
    const withdrawals = await sql<{
      id: string;
      amount_usd_cents: number;
      amount_usdt_minor: number;
      network: string;
      address: string;
      network_fee_usdt_minor: number;
      status: string;
      tx_hash: string | null;
      fail_reason: string | null;
      created_at: string;
    }>`
      select id, amount_usd_cents, amount_usdt_minor, network, address, network_fee_usdt_minor,
             status, tx_hash, fail_reason, created_at
      from withdrawals
      order by created_at desc
      limit 30
    `;
    const usdt = await getUsdtPerUsd(sql);
    const ngn = await getQuote(sql, "NGN", "USD");
    const settledUsd = Number(a.settled_usd_cents) || 0;
    const usdtEquiv =
      usdt && usdt.rate > 0 ? Math.round((settledUsd / 100) * usdt.rate * 10 ** USDT_DECIMALS) : null;
    const revenue = await sql<{ today: string | number; month: string | number; life: string | number }>`
      select
        coalesce(sum(case when created_at >= date_trunc('day', now()) then usd_cents else 0 end), 0)::text as today,
        coalesce(sum(case when created_at >= date_trunc('month', now()) then usd_cents else 0 end), 0)::text as month,
        coalesce(sum(usd_cents), 0)::text as life
      from ledger_entries
      where account_id = 'org_treasury' and kind = 'store_gross'
    `.catch(() => [{ today: 0, month: 0, life: 0 }]);
    const conversions = await sql<{
      id: string;
      usd_cents: number;
      usdt_minor: number | null;
      fx_usdt_per_usd: string | number | null;
      fx_source: string | null;
      fx_at: string | null;
      status: string;
      tx_hash: string | null;
      fail_reason: string | null;
      created_at: string;
    }>`
      select id, usd_cents, usdt_minor, fx_usdt_per_usd, fx_source, fx_at, status, tx_hash, fail_reason, created_at
      from treasury_conversions
      order by created_at desc
      limit 20
    `.catch(() => []);
    const convertedUsd = await sql<{ n: string | number }>`
      select coalesce(sum(usd_cents), 0)::text as n from treasury_conversions where status in ('sent', 'confirmed')
    `.catch(() => [{ n: 0 }]);
    const withdrawnUsd = await sql<{ n: string | number }>`
      select coalesce(sum(amount_usd_cents), 0)::text as n from withdrawals where status in ('sent', 'confirmed')
    `.catch(() => [{ n: 0 }]);

    return {
      pendingUsdCents: Number(a.pending_usd_cents) || 0,
      settledUsdCents: settledUsd,
      convertibleUsdCents: Number(a.convertible_usd_cents ?? settledUsd) || 0,
      conversionPendingUsdCents: Number(a.conversion_pending_usd_cents) || 0,
      convertedUsdCents: Number(convertedUsd[0]?.n ?? 0) || 0,
      withdrawnUsdCents: Number(withdrawnUsd[0]?.n ?? 0) || 0,
      usdtOnHandMinor: Number(a.usdt_on_hand_minor) || 0,
      usdtEquivalentMinor: usdtEquiv,
      onchainUsdtMinor: chain.usdtMinor,
      onchainIsLive: chain.synced,
      bnbWei: chain.bnbWei,
      bnbFormatted: chain.bnbFormatted,
      chainError: chain.error,
      treasuryAddress: address,
      chainId: BSC_CHAIN_ID,
      network: "bep20" as const,
      usdtContract: BEP20_USDT_CONTRACT,
      usdtOnHandIsReal: Number(a.usdt_on_hand_minor) > 0 || Boolean(chain.synced && (chain.usdtMinor ?? 0) > 0),
      custodyReady: custodyConfigured(),
      chainConfigured: Boolean(process.env.TREASURY_BSC_RPC?.trim() && address),
      permissions: perms,
      fx: {
        usdPerNgn: ngn?.rate ?? null,
        usdtPerUsd: usdt?.rate ?? null,
        ngnSource: ngn?.source ?? null,
        usdtSource: usdt?.source ?? null,
        ngnAt: ngn?.fetchedAt ?? null,
        usdtAt: usdt?.fetchedAt ?? null,
      },
      totals: {
        purchases: purchases[0]?.n ?? 0,
        monthly: counts.find((c) => c.product_id === "nyx.verify.monthly")?.n ?? 0,
        yearly: counts.find((c) => c.product_id === "nyx.verify.yearly")?.n ?? 0,
        sixMonth: counts.find((c) => c.product_id === "nyx.verify.semiannual")?.n ?? 0,
        aiMonthly: counts.find((c) => c.product_id === "nyx.ai.monthly")?.n ?? 0,
        aiYearly: counts.find((c) => c.product_id === "nyx.ai.yearly")?.n ?? 0,
        grossUsdCents: Number(gross[0]?.usd ?? 0),
        grossNgnKobo: Number(gross[0]?.ngn ?? 0),
        platformFeeUsdCents: Number(fees[0]?.usd ?? 0),
        refundCount: refunds[0]?.n ?? 0,
        refundUsdCents: Number(refunds[0]?.usd ?? 0),
        failedWithdrawals: failed[0]?.n ?? 0,
        todayUsdCents: Number(revenue[0]?.today ?? 0),
        monthUsdCents: Number(revenue[0]?.month ?? 0),
        lifetimeUsdCents: Number(revenue[0]?.life ?? 0),
      },
      ledger,
      withdrawals,
      conversions,
      updatedAt: a.updated_at,
      chainSyncedAt: chain.synced ? new Date().toISOString() : a.chain_synced_at,
    };
  });

export const quoteUsdtWithdrawal = createServerFn({ method: "POST" })
  .validator((d: { usdCents: number; network: UsdtNetwork; address: string }) => d)
  .middleware([authMiddleware])
  .handler(async () => {
    throw new Error("Currency conversion and USDT withdrawal are not available.");
  });

export const requestUsdtWithdrawal = createServerFn({ method: "POST" })
  .validator(
    (d: {
      usdCents: number;
      network: UsdtNetwork;
      address: string;
      confirmAddress: string;
      totpCode?: string;
      confirmPhrase: string;
    }) => d,
  )
  .middleware([authMiddleware])
  .handler(async () => {
    throw new Error("USDT withdrawal is not available.");
  });

export const requestTreasuryConversion = createServerFn({ method: "POST" })
  .validator((d: { usdCents: number }) => d)
  .middleware([authMiddleware])
  .handler(async () => {
    throw new Error("Currency conversion is not available.");
  });
