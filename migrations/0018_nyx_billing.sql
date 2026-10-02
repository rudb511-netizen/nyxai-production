-- NYX: premium verification catalog, entitlements, 195-market prices, web checkout, ARC BEP-20 treasury.

alter table store_products drop constraint if exists store_products_period_check;
alter table store_products add column if not exists family text not null default 'verify';
alter table store_products add column if not exists trial_days_store integer not null default 7;
alter table store_products add column if not exists trial_days_web integer not null default 0;
alter table store_products add column if not exists grants_json jsonb not null default '["premium_verify","nyxai_plus"]'::jsonb;
alter table store_products add constraint store_products_period_chk
  check (period in ('month', 'six_month', 'year'));

update store_products set active = false where id like 'superomni.%';

insert into store_products (
  id, apple_sku, google_sku, period, price_ngn_kobo, title, active, family, trial_days_store, trial_days_web, grants_json
) values
  (
    'nyx.verify.monthly',
    'com.nyx.verify.monthly',
    'nyx_verify_monthly',
    'month',
    250000,
    'NYX Verification Monthly',
    true,
    'verify',
    7,
    0,
    '["premium_verify","nyxai_plus"]'::jsonb
  ),
  (
    'nyx.verify.semiannual',
    'com.nyx.verify.semiannual',
    'nyx_verify_semiannual',
    'six_month',
    1400000,
    'NYX Verification 6 Months',
    true,
    'verify',
    7,
    0,
    '["premium_verify","nyxai_plus"]'::jsonb
  ),
  (
    'nyx.verify.yearly',
    'com.nyx.verify.yearly',
    'nyx_verify_yearly',
    'year',
    2899900,
    'NYX Verification Yearly',
    true,
    'verify',
    7,
    0,
    '["premium_verify","nyxai_plus"]'::jsonb
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

alter table subscriptions drop constraint if exists subscriptions_store_check;
alter table subscriptions add constraint subscriptions_store_check
  check (store in ('apple', 'google', 'web'));
alter table subscriptions drop constraint if exists subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check
  check (status in (
    'trial', 'active', 'grace', 'billing_retry', 'cancelled', 'expired', 'refunded', 'revoked'
  ));
alter table subscriptions add column if not exists trial_end timestamptz;
alter table subscriptions add column if not exists country text;
alter table subscriptions add column if not exists currency text;
alter table subscriptions add column if not exists amount_minor bigint;

drop index if exists subscriptions_user_live_idx;
create unique index if not exists subscriptions_user_live_idx
  on subscriptions (user_id)
  where status in ('trial', 'active', 'grace', 'billing_retry');

alter table store_events drop constraint if exists store_events_store_check;
alter table store_events add constraint store_events_store_check
  check (store in ('apple', 'google', 'web'));

create table if not exists entitlements (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  kind text not null check (kind in ('premium_verify', 'nyxai_plus')),
  source text not null check (source in ('purchase', 'arc_grant')),
  status text not null check (status in (
    'trial', 'active', 'grace', 'billing_retry', 'cancelled', 'expired', 'refunded', 'revoked'
  )),
  product_id text,
  subscription_id text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists entitlements_user_idx on entitlements (user_id, kind, status);
create unique index if not exists entitlements_live_idx
  on entitlements (user_id, kind, source)
  where status in ('trial', 'active', 'grace', 'billing_retry');

create table if not exists product_benefits (
  id text primary key,
  family text not null,
  title text not null,
  body text not null,
  sort integer not null default 0
);
insert into product_benefits (id, family, title, body, sort) values
  ('premium_verify', 'verify', 'Premium verification', 'Glowing green check on your name while the plan is active.', 0),
  ('nyxai_plus', 'verify', 'NYXAI+', 'Longer memory, higher limits, multi-source research, bigger workspace.', 1),
  ('restore', 'verify', 'Restore purchases', 'The same plan returns after you restore a verified store receipt.', 2)
on conflict (id) do nothing;

create table if not exists billing_markets (
  iso text primary key,
  name text not null,
  currency text not null,
  locale text not null
);

create table if not exists market_prices (
  country text not null references billing_markets(iso),
  product_id text not null references store_products(id),
  currency text not null,
  amount_minor bigint not null check (amount_minor > 0),
  status text not null check (status in ('recommended', 'approved')),
  fx_base text,
  fx_rate numeric,
  fx_source text,
  updated_at timestamptz not null default now(),
  published_by text,
  primary key (country, product_id, status)
);

create table if not exists web_checkout_sessions (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  product_id text not null references store_products(id),
  provider text not null check (provider in ('stripe', 'paystack')),
  provider_ref text unique,
  country text not null,
  currency text not null,
  amount_minor bigint not null,
  trial_days integer not null default 0,
  price_status text not null default 'recommended',
  status text not null check (status in ('open', 'paid', 'failed', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists web_checkout_user_idx on web_checkout_sessions (user_id, created_at desc);

alter table profiles add column if not exists is_premium boolean not null default false;
alter table profiles add column if not exists billing_country text;

alter table withdrawals drop constraint if exists withdrawals_network_check;
alter table withdrawals add constraint withdrawals_network_check check (network in ('bep20'));

alter table treasury_accounts drop constraint if exists treasury_accounts_owner_kind_check;
alter table treasury_accounts add constraint treasury_accounts_owner_kind_check
  check (owner_kind in ('org', 'arc'));
update treasury_accounts set owner_kind = 'arc' where id = 'org_treasury';

-- System identities: keep ids, rename public handles.
update profiles
set username = 'nyxai', username_lc = 'nyxai', display_name = 'NYXAI',
    bio = 'NYXAI — mention me in chats and comments.'
where user_id = 'omni_ai_system';

update profiles
set username = 'nyxsupport', username_lc = 'nyxsupport', display_name = 'NYX Support',
    bio = 'NYX Support — official safety messages. Members cannot reply.'
where user_id = 'omni_support_system';

update "user" set name = 'NYXAI' where id = 'omni_ai_system';
update "user" set name = 'NYX Support' where id = 'omni_support_system';
