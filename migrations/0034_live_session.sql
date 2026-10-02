create index if not exists live_comments_stream_idx on live_comments (stream_id, created_at desc);

create table if not exists live_presence (
  stream_id text not null references live_streams(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  last_seen timestamptz not null default now(),
  primary key (stream_id, user_id)
);
create index if not exists live_presence_seen_idx on live_presence (stream_id, last_seen desc);

create table if not exists live_reaction_totals (
  stream_id text not null references live_streams(id) on delete cascade,
  kind text not null default 'heart',
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (stream_id, kind)
);

create table if not exists live_invites (
  id text primary key,
  stream_id text not null references live_streams(id) on delete cascade,
  from_user_id text not null references profiles(user_id) on delete cascade,
  to_user_id text not null references profiles(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (stream_id, to_user_id)
);
create index if not exists live_invites_to_idx on live_invites (to_user_id, status, created_at desc);

alter table live_streams add column if not exists like_count integer not null default 0;
alter table live_streams add column if not exists fail_reason text;
