-- Calls, messaging, status, video, and moderation upgrades.

alter table messages add column if not exists duration_ms integer;
alter table messages add column if not exists forwarded_from_id text;
alter table messages add column if not exists forwarded_label text;

create table if not exists message_hides (
  message_id text not null references messages(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table call_participants add column if not exists outcome text not null default 'ringing';
alter table calls add column if not exists answered_at timestamptz;

create table if not exists statuses (
  id text primary key,
  author_id text not null references profiles(user_id) on delete cascade,
  media_url text,
  media_kind text not null check (media_kind in ('photo','video','text')),
  text_body text,
  background text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists statuses_author_idx on statuses (author_id, created_at desc);
create index if not exists statuses_expires_idx on statuses (expires_at);

create table if not exists status_views (
  status_id text not null references statuses(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (status_id, user_id)
);

create table if not exists status_reactions (
  status_id text not null references statuses(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (status_id, user_id)
);

create table if not exists story_reactions (
  story_id text not null references stories(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create table if not exists video_hashtags (
  video_id text not null references videos(id) on delete cascade,
  tag text not null,
  primary key (video_id, tag)
);
create index if not exists video_hashtags_tag_idx on video_hashtags (tag);

alter table videos add column if not exists download_allowed boolean not null default true;

create table if not exists sanctions (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  actor_id text not null,
  kind text not null,
  capabilities jsonb not null default '{}'::jsonb,
  reason text not null default '',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create index if not exists sanctions_user_idx on sanctions (user_id, status, created_at desc);

create table if not exists appeals (
  id text primary key,
  sanction_id text not null references sanctions(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  body text not null,
  status text not null default 'open',
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists appeals_status_idx on appeals (status, created_at desc);

alter table profiles add column if not exists who_can_call text not null default 'friends';
alter table profiles add column if not exists restrict_json jsonb not null default '{}'::jsonb;
alter table profiles add column if not exists sanction_until timestamptz;
