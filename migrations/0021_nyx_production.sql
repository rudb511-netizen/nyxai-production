-- NYX production: coins, gifts, boosts, refunds, password reset, biometrics, call contacts.

alter table profiles add column if not exists sound_prefs jsonb not null default '{
  "messages": true,
  "typing": true,
  "calls": true,
  "notifications": true,
  "vibration": true
}'::jsonb;
alter table profiles add column if not exists biometric_enabled boolean not null default false;
alter table profiles add column if not exists voice_enhance text not null default 'auto';

create table if not exists coin_wallets (
  user_id text primary key references profiles(user_id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists coin_ledger (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  kind text not null check (kind in (
    'purchase', 'gift_sent', 'gift_received', 'boost_spend',
    'refund', 'reversal', 'admin_adjust', 'platform_fee'
  )),
  direction text not null check (direction in ('in', 'out')),
  amount integer not null check (amount > 0),
  balance_before integer not null,
  balance_after integer not null,
  reason text,
  related_id text,
  product_id text,
  created_at timestamptz not null default now()
);
create index if not exists coin_ledger_user_idx on coin_ledger (user_id, created_at desc);
create unique index if not exists coin_ledger_related_kind_idx
  on coin_ledger (user_id, kind, related_id)
  where related_id is not null;

create table if not exists coin_gifts (
  id text primary key,
  sender_id text not null references profiles(user_id) on delete cascade,
  recipient_id text not null references profiles(user_id) on delete cascade,
  gift_key text not null,
  coins integer not null check (coins > 0),
  net_coins integer not null check (net_coins >= 0),
  conversation_id text,
  live_id text,
  created_at timestamptz not null default now()
);
create index if not exists coin_gifts_live_idx on coin_gifts (live_id, created_at desc);
create index if not exists coin_gifts_convo_idx on coin_gifts (conversation_id, created_at desc);

create table if not exists boost_campaigns (
  id text primary key,
  owner_id text not null references profiles(user_id) on delete cascade,
  video_id text not null,
  objective text not null check (objective in ('followers', 'views', 'engagement')),
  package_id text not null,
  coin_budget integer not null check (coin_budget > 0),
  remaining_budget integer not null check (remaining_budget >= 0),
  target_label text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'refunded', 'cancelled')),
  impressions integer not null default 0,
  views integer not null default 0,
  followers_gained integer not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  start_at timestamptz not null default now(),
  end_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists boost_campaigns_video_idx on boost_campaigns (video_id, status);
create index if not exists boost_campaigns_owner_idx on boost_campaigns (owner_id, created_at desc);

create table if not exists boost_events (
  id text primary key,
  campaign_id text not null references boost_campaigns(id) on delete cascade,
  viewer_id text not null references profiles(user_id) on delete cascade,
  kind text not null check (kind in ('impression', 'view', 'follow', 'like', 'comment')),
  created_at timestamptz not null default now(),
  unique (campaign_id, viewer_id, kind)
);

create table if not exists refund_requests (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  family text not null,
  product_id text,
  subscription_id text,
  checkout_id text,
  amount_minor integer,
  currency text,
  status text not null default 'pending' check (status in (
    'pending', 'submitted', 'confirmed', 'denied', 'expired', 'cancelled'
  )),
  reason text,
  deadline timestamptz not null,
  provider_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists refund_requests_user_idx on refund_requests (user_id, created_at desc);

create table if not exists password_reset_otps (
  id text primary key,
  email_lc text not null,
  user_id text,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_otps_email_idx on password_reset_otps (email_lc, created_at desc);

create table if not exists biometric_credentials (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists biometric_credentials_user_idx on biometric_credentials (user_id);

insert into coin_wallets (user_id, balance)
select user_id, 0 from profiles
on conflict (user_id) do nothing;
