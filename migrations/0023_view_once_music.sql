-- View Once state machine (per-recipient opens) + licensed music cache.

alter table messages add column if not exists view_once_state text;
alter table messages add column if not exists view_once_token_hash text;
alter table messages add column if not exists view_once_expires_at timestamptz;
alter table messages add column if not exists view_once_revoked_at timestamptz;

update messages
   set view_once_state = case
     when view_once and opened_at is not null then 'OPENED'
     when view_once then 'UNOPENED'
     else view_once_state
   end
 where view_once = true and view_once_state is null;

create table if not exists view_once_opens (
  message_id text not null references messages(id) on delete cascade,
  user_id text not null,
  opened_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table sounds add column if not exists provider text;
alter table sounds add column if not exists provider_track_id text;
alter table sounds add column if not exists artwork_url text;
alter table sounds add column if not exists license_note text;
alter table sounds add column if not exists preview_available boolean not null default false;

create unique index if not exists sounds_provider_track_idx
  on sounds (provider, provider_track_id)
  where provider is not null and provider_track_id is not null;

create table if not exists music_cache (
  id text primary key,
  provider text not null,
  provider_track_id text not null,
  title text not null,
  artist text,
  album text,
  artwork_url text,
  preview_url text,
  duration_ms integer,
  genre text,
  license_note text not null default '30-second licensed preview',
  section text,
  cached_at timestamptz not null default now(),
  unique (provider, provider_track_id)
);

create table if not exists music_recent (
  user_id text not null references profiles(user_id) on delete cascade,
  track_key text not null,
  used_at timestamptz not null default now(),
  primary key (user_id, track_key)
);
