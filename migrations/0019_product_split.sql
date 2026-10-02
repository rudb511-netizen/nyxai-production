-- Independent NYX Verified vs NYXAI+ products. One live sub per family, not per user.
-- ARC grants both entitlements. Verify purchases never include NYXAI+.

update store_products
set grants_json = '["premium_verify"]'::jsonb,
    family = 'verify',
    title = case
      when id = 'nyx.verify.monthly' then 'NYX Verified Monthly'
      when id = 'nyx.verify.semiannual' then 'NYX Verified 6 Months'
      when id = 'nyx.verify.yearly' then 'NYX Verified Yearly'
      else title
    end
where id like 'nyx.verify.%';

insert into store_products (
  id, apple_sku, google_sku, period, price_ngn_kobo, title, active, family, trial_days_store, trial_days_web, grants_json
) values
  (
    'nyx.ai.monthly',
    'com.nyx.ai.monthly',
    'nyx_ai_monthly',
    'month',
    100000,
    'NYXAI+ Monthly',
    true,
    'nyxai',
    7,
    0,
    '["nyxai_plus"]'::jsonb
  ),
  (
    'nyx.ai.semiannual',
    'com.nyx.ai.semiannual',
    'nyx_ai_semiannual',
    'six_month',
    550000,
    'NYXAI+ 6 Months',
    true,
    'nyxai',
    7,
    0,
    '["nyxai_plus"]'::jsonb
  ),
  (
    'nyx.ai.yearly',
    'com.nyx.ai.yearly',
    'nyx_ai_yearly',
    'year',
    1200000,
    'NYXAI+ Yearly',
    true,
    'nyxai',
    7,
    0,
    '["nyxai_plus"]'::jsonb
  )
on conflict (id) do update set
  apple_sku = excluded.apple_sku,
  google_sku = excluded.google_sku,
  period = excluded.period,
  price_ngn_kobo = excluded.price_ngn_kobo,
  title = excluded.title,
  active = true,
  family = excluded.family,
  trial_days_store = excluded.trial_days_store,
  trial_days_web = excluded.trial_days_web,
  grants_json = excluded.grants_json;

update store_products set family = 'nyxai', grants_json = '["nyxai_plus"]'::jsonb
where id like 'superomni.%';

alter table subscriptions add column if not exists family text not null default 'verify';
update subscriptions s
set family = coalesce((select p.family from store_products p where p.id = s.product_id), 'verify');

drop index if exists subscriptions_user_live_idx;
create unique index if not exists subscriptions_user_family_live_idx
  on subscriptions (user_id, family)
  where status in ('trial', 'active', 'grace', 'billing_retry');

insert into product_benefits (id, family, title, body, sort) values
  ('verify_check', 'verify', 'Glowing green check', 'Shows next to your name while NYX Verified is active. It does not replace organization, founder, developer, or ARC marks.', 0),
  ('ai_reasoning', 'nyxai', 'Advanced reasoning', 'Harder math, planning, and multi-step problems with a higher reasoning floor.', 0),
  ('ai_memory', 'nyxai', 'Longer conversation memory', 'More of this thread stays in context so follow-ups stay on the actual subject.', 1),
  ('ai_research', 'nyxai', 'Multi-source research', 'Live lookup across more than one source, with citations — never invented links.', 2),
  ('ai_code', 'nyxai', 'Advanced coding', 'Larger drafts, interpreter tools, and a bigger workspace for project files.', 3)
on conflict (id) do nothing;

update product_benefits set family = 'nyxai',
  title = 'NYXAI+',
  body = 'Longer memory, higher limits, multi-source research, bigger workspace. Not included with NYX Verified.'
where id = 'nyxai_plus';

create table if not exists payment_refs (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  product_id text,
  store text,
  amount_minor bigint,
  currency text,
  status text not null default 'recorded',
  store_event_id text,
  subscription_id text,
  created_at timestamptz not null default now()
);
create index if not exists payment_refs_user_idx on payment_refs (user_id, created_at desc);

alter table treasury_accounts add column if not exists convertible_usd_cents bigint not null default 0;
alter table treasury_accounts add column if not exists conversion_pending_usd_cents bigint not null default 0;
alter table treasury_accounts add column if not exists onchain_usdt_minor bigint not null default 0;
alter table treasury_accounts add column if not exists bnb_wei text;
alter table treasury_accounts add column if not exists treasury_address text;
alter table treasury_accounts add column if not exists chain_synced_at timestamptz;

create table if not exists treasury_conversions (
  id text primary key,
  requested_by text not null references profiles(user_id),
  usd_cents bigint not null check (usd_cents > 0),
  usdt_minor bigint,
  fx_usdt_per_usd numeric,
  fx_source text,
  fx_at timestamptz,
  status text not null check (status in ('pending', 'sent', 'confirmed', 'failed')),
  tx_hash text,
  fail_reason text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table if not exists treasury_permissions (
  user_id text primary key references profiles(user_id) on delete cascade,
  wallet_view boolean not null default true,
  wallet_transaction_view boolean not null default true,
  wallet_conversion boolean not null default true,
  wallet_withdrawal_request boolean not null default true,
  wallet_withdrawal_approval boolean not null default false,
  wallet_admin boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table ledger_entries drop constraint if exists ledger_entries_kind_check;
alter table ledger_entries add constraint ledger_entries_kind_check
  check (kind in (
    'store_gross', 'platform_fee', 'tax', 'net_proceeds', 'refund', 'settlement',
    'fx_mark', 'usdt_credit', 'withdrawal', 'withdrawal_fee', 'reversal', 'conversion'
  ));
