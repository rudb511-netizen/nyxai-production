-- Founder one-time redemption, OmniSupport warnings, report priority.

create table if not exists mark_redemptions (
  kind text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  redeemed_at timestamptz not null default now()
);

create table if not exists user_warnings (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  actor_id text not null,
  category text not null,
  body text not null default '',
  evidence text not null default '',
  target_kind text not null default 'user',
  target_id text,
  report_id text,
  created_at timestamptz not null default now()
);
create index if not exists user_warnings_user_idx on user_warnings (user_id, created_at desc);

create table if not exists moderation_events (
  id text primary key,
  user_id text not null,
  target_kind text not null,
  target_id text not null,
  category text not null,
  evidence text not null default '',
  created_at timestamptz not null default now(),
  unique (target_kind, target_id)
);
create index if not exists moderation_events_user_idx on moderation_events (user_id, created_at desc);

alter table reports add column if not exists priority text not null default 'normal';
alter table reports add column if not exists source text not null default 'user';
alter table reports add column if not exists evidence_json jsonb;
