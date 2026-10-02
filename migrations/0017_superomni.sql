-- SuperOmni subscriptions, store webhooks, FX cache, org treasury ledger.
-- Source of truth is server-verified store events. Clients cannot write these tables.

create table if not exists store_products (
  id text primary key,
  apple_sku text not null unique,
  google_sku text not null unique,
  period text not null check (period in ('month', 'year')),
  price_ngn_kobo integer not null check (price_ngn_kobo > 0),
  title text not null,
  active boolean not null default true
);

insert into store_products (id, apple_sku, google_sku, period, price_ngn_kobo, title)
values
  ('superomni.monthly', 'com.omnifeed.superomni.monthly', 'superomni_monthly', 'month', 100000, 'SuperOmni Monthly'),
  ('superomni.yearly', 'com.omnifeed.superomni.yearly', 'superomni_yearly', 'year', 1200000, 'SuperOmni Yearly')
on conflict (id) do nothing;

create table if not exists subscriptions (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  product_id text not null references store_products(id),
  store text not null check (store in ('apple', 'google')),
  original_txn_id text not null,
  latest_txn_id text not null,
  status text not null check (status in (
    'active', 'grace', 'billing_retry', 'cancelled', 'expired', 'refunded', 'revoked'
  )),
  auto_renew boolean not null default true,
  environment text not null default 'production' check (environment in ('sandbox', 'production')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  grace_until timestamptz,
  app_account_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (original_txn_id)
);
create index if not exists subscriptions_user_idx on subscriptions (user_id, updated_at desc);
create unique index if not exists subscriptions_user_live_idx
  on subscriptions (user_id)
  where status in ('active', 'grace', 'billing_retry');

create table if not exists store_events (
  id text primary key,
  store text not null check (store in ('apple', 'google')),
  event_type text not null,
  original_txn_id text,
  txn_id text,
  payload_hash text not null unique,
  product_id text,
  user_id text,
  matched boolean not null default false,
  payload_json jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now()
);
create index if not exists store_events_txn_idx on store_events (original_txn_id, processed_at desc);

create table if not exists fx_snapshots (
  base text not null,
  quote text not null,
  rate numeric not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (base, quote)
);

create table if not exists treasury_accounts (
  id text primary key,
  owner_kind text not null check (owner_kind in ('org')),
  pending_usd_cents bigint not null default 0,
  settled_usd_cents bigint not null default 0,
  usdt_on_hand_minor bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into treasury_accounts (id, owner_kind)
values ('org_treasury', 'org')
on conflict (id) do nothing;

create table if not exists ledger_entries (
  id text primary key,
  account_id text not null references treasury_accounts(id),
  kind text not null check (kind in (
    'store_gross', 'platform_fee', 'tax', 'net_proceeds', 'refund', 'settlement',
    'fx_mark', 'usdt_credit', 'withdrawal', 'withdrawal_fee', 'reversal'
  )),
  currency text not null,
  amount_minor bigint not null,
  usd_cents bigint not null default 0,
  usdt_minor bigint not null default 0,
  fx_usd_per_unit numeric,
  usdt_per_usd numeric,
  status text not null check (status in ('pending', 'settled', 'reversed', 'failed')),
  available_at timestamptz,
  settled_at timestamptz,
  subscription_id text,
  store_event_id text,
  withdrawal_id text,
  original_txn_id text,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ledger_entries_status_idx on ledger_entries (status, available_at);
create index if not exists ledger_entries_txn_idx on ledger_entries (original_txn_id);

create table if not exists withdrawals (
  id text primary key,
  requested_by text not null references profiles(user_id),
  amount_usd_cents bigint not null check (amount_usd_cents > 0),
  amount_usdt_minor bigint not null check (amount_usdt_minor > 0),
  network text not null check (network in ('trc20', 'erc20', 'bep20', 'sol')),
  address text not null,
  network_fee_usdt_minor bigint not null default 0,
  usdt_per_usd numeric,
  status text not null check (status in (
    'pending_auth', 'pending_send', 'sent', 'failed', 'rejected', 'cancelled'
  )),
  tx_hash text,
  custody_ref text,
  fail_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);
create index if not exists withdrawals_status_idx on withdrawals (status, created_at desc);

create table if not exists billing_audit (
  id text primary key,
  actor_id text,
  action text not null,
  target text,
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists billing_audit_idx on billing_audit (created_at desc);
