-- Device push tokens for FCM / APNs. Distinct from web-push subscriptions.

create table if not exists device_push_tokens (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists device_push_tokens_user_idx on device_push_tokens (user_id, updated_at desc);
