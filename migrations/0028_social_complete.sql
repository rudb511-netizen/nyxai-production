-- NYX social-complete: lists, mutes, highlights, hashtag follows, scheduled
-- posts, search history, deactivation, audio rooms, phone OTP, web push.
-- Additive only. Existing tables stay in place.

alter table profiles add column if not exists website text;
alter table profiles add column if not exists location_name text;
alter table profiles add column if not exists who_can_quote text not null default 'everyone';
alter table profiles add column if not exists who_can_mention text not null default 'everyone';
alter table profiles add column if not exists deactivated_at timestamptz;
alter table profiles add column if not exists phone_e164 text;
alter table profiles add column if not exists phone_verified_at timestamptz;
alter table profiles add column if not exists email_verify_sent_at timestamptz;

create unique index if not exists profiles_phone_e164_idx
  on profiles (phone_e164);

alter table posts add column if not exists published_at timestamptz;
alter table posts add column if not exists scheduled_at timestamptz;
alter table posts add column if not exists visibility text not null default 'everyone';
alter table posts add column if not exists thread_id text;
alter table posts add column if not exists thread_position integer not null default 0;
alter table posts add column if not exists pinned_comment_id text;
alter table posts add column if not exists reply_control text not null default 'everyone';

update posts set published_at = created_at where published_at is null;

create index if not exists posts_published_idx on posts (published_at desc);
create index if not exists posts_scheduled_idx on posts (scheduled_at);
create index if not exists posts_thread_idx on posts (thread_id, thread_position);

alter table comments add column if not exists edited_at timestamptz;
alter table comments add column if not exists is_pinned boolean not null default false;

create table if not exists mutes (
  user_id text not null references profiles(user_id) on delete cascade,
  muted_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_id),
  check (user_id <> muted_id)
);
create index if not exists mutes_muted_idx on mutes (muted_id);

create table if not exists restrictions (
  user_id text not null references profiles(user_id) on delete cascade,
  restricted_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, restricted_id),
  check (user_id <> restricted_id)
);

create table if not exists user_lists (
  id text primary key,
  owner_id text not null references profiles(user_id) on delete cascade,
  name text not null,
  description text not null default '',
  is_private boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_lists_owner_idx on user_lists (owner_id, updated_at desc);

create table if not exists user_list_members (
  list_id text not null references user_lists(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, user_id)
);
create index if not exists user_list_members_user_idx on user_list_members (user_id);

create table if not exists user_list_follows (
  list_id text not null references user_lists(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);
create index if not exists user_list_follows_user_idx on user_list_follows (user_id, created_at desc);

create table if not exists hashtag_follows (
  user_id text not null references profiles(user_id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tag)
);
create index if not exists hashtag_follows_tag_idx on hashtag_follows (tag);

create table if not exists story_highlights (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  name text not null,
  cover_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists story_highlights_user_idx on story_highlights (user_id, sort_order, created_at);

create table if not exists story_highlight_items (
  highlight_id text not null references story_highlights(id) on delete cascade,
  story_id text not null references stories(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (highlight_id, story_id)
);
create index if not exists story_highlight_items_story_idx on story_highlight_items (story_id);

create table if not exists search_history (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  query text not null,
  kind text not null default 'all',
  created_at timestamptz not null default now()
);
create index if not exists search_history_user_idx on search_history (user_id, created_at desc);

create table if not exists phone_otp_codes (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  phone_e164 text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists phone_otp_user_idx on phone_otp_codes (user_id, created_at desc);

create table if not exists email_verify_codes (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  email text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_verify_user_idx on email_verify_codes (user_id, created_at desc);

alter table live_streams add column if not exists kind text not null default 'video';
alter table live_streams add column if not exists description text not null default '';

create table if not exists live_speakers (
  stream_id text not null references live_streams(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  role text not null default 'listener' check (role in ('host', 'cohost', 'speaker', 'listener', 'requested')),
  muted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (stream_id, user_id)
);
create index if not exists live_speakers_stream_idx on live_speakers (stream_id, role);

create table if not exists web_push_subscriptions (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists web_push_user_idx on web_push_subscriptions (user_id, created_at desc);

create table if not exists playback_history (
  user_id text not null references profiles(user_id) on delete cascade,
  entity_kind text not null,
  entity_id text not null,
  position_ms integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, entity_kind, entity_id)
);

insert into feature_flags (key, enabled, rollout) values
  ('lists', true, 100),
  ('highlights', true, 100),
  ('hashtag_follow', true, 100),
  ('scheduled_posts', true, 100),
  ('audio_spaces', true, 100),
  ('account_export', true, 100),
  ('phone_otp', true, 100),
  ('web_push', true, 100),
  ('quote_composer', true, 100),
  ('threads', true, 100)
on conflict (key) do nothing;
