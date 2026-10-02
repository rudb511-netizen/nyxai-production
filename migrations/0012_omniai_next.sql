-- OmniAI next: web-search preference + message ratings.

alter table omni_prefs add column if not exists search_pref text not null default 'auto';

create table if not exists omni_feedback (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  message_id text not null,
  rating text not null,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);
create index if not exists omni_feedback_user_idx on omni_feedback (user_id, created_at desc);
