-- Omnifeed: Flashes, Atlas, Memories, Score.

alter table profiles add column if not exists score integer not null default 0;
alter table profiles add column if not exists ghost_mode boolean not null default true;
alter table profiles add column if not exists last_lat double precision;
alter table profiles add column if not exists last_lng double precision;
alter table profiles add column if not exists last_geo_at timestamptz;

create table if not exists flashes (
  id text primary key,
  author_id text not null references profiles(user_id) on delete cascade,
  media_url text not null,
  media_kind text not null check (media_kind in ('photo','video')),
  caption text not null default '',
  filter_name text not null default 'none',
  duration_sec integer not null default 5,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists flashes_author_idx on flashes (author_id, created_at desc);

create table if not exists flash_sends (
  flash_id text not null references flashes(id) on delete cascade,
  recipient_id text not null references profiles(user_id) on delete cascade,
  conversation_id text,
  opened_at timestamptz,
  primary key (flash_id, recipient_id)
);
create index if not exists flash_sends_inbox_idx on flash_sends (recipient_id, opened_at);

create table if not exists memories (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  media_url text not null,
  media_kind text not null default 'photo',
  caption text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists memories_user_idx on memories (user_id, created_at desc);
