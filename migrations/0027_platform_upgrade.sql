-- NYX platform upgrade: feed ranking, interests, drafts, events, challenges,
-- watch parties, collections, clips/remix, flags, analytics, modes.

alter table profiles add column if not exists safe_mode boolean not null default false;
alter table profiles add column if not exists focus_mode boolean not null default false;
alter table profiles add column if not exists interests_set boolean not null default false;

create table if not exists user_interests (
  user_id text not null references profiles(user_id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tag)
);
create index if not exists user_interests_tag_idx on user_interests (tag);

create table if not exists feed_hides (
  user_id text not null references profiles(user_id) on delete cascade,
  target_kind text not null check (target_kind in ('post', 'author', 'video')),
  target_id text not null,
  reason text not null default 'not_interested' check (reason in ('not_interested', 'mute', 'hide')),
  created_at timestamptz not null default now(),
  primary key (user_id, target_kind, target_id)
);
create index if not exists feed_hides_user_idx on feed_hides (user_id, created_at desc);

create table if not exists feed_signals (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  entity_kind text not null,
  entity_id text not null,
  kind text not null check (kind in ('impression', 'open', 'watch', 'complete', 'skip', 'hide')),
  value integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists feed_signals_user_idx on feed_signals (user_id, created_at desc);
create index if not exists feed_signals_entity_idx on feed_signals (entity_kind, entity_id, created_at desc);

create table if not exists bookmark_collections (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists bookmark_collections_user_idx on bookmark_collections (user_id, created_at desc);

alter table bookmarks add column if not exists collection_id text references bookmark_collections(id) on delete set null;
create index if not exists bookmarks_collection_idx on bookmarks (collection_id);

create table if not exists composition_drafts (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  kind text not null check (kind in ('post', 'story', 'status', 'video', 'comment', 'message')),
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists composition_drafts_user_idx on composition_drafts (user_id, updated_at desc);

create table if not exists nyx_events (
  id text primary key,
  host_id text not null references profiles(user_id) on delete cascade,
  community_id text,
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  is_online boolean not null default false,
  cover_url text,
  created_at timestamptz not null default now()
);
create index if not exists nyx_events_starts_idx on nyx_events (starts_at);
create index if not exists nyx_events_host_idx on nyx_events (host_id, starts_at desc);

create table if not exists event_rsvps (
  event_id text not null references nyx_events(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  status text not null check (status in ('going', 'interested', 'not_going')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_rsvps_user_idx on event_rsvps (user_id, created_at desc);

create table if not exists challenges (
  id text primary key,
  creator_id text not null references profiles(user_id) on delete cascade,
  title text not null,
  rules text not null default '',
  hashtag text not null,
  deadline timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists challenges_hashtag_idx on challenges (lower(hashtag));
create index if not exists challenges_deadline_idx on challenges (deadline);

create table if not exists challenge_entries (
  challenge_id text not null references challenges(id) on delete cascade,
  video_id text not null,
  user_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (challenge_id, video_id)
);
create index if not exists challenge_entries_user_idx on challenge_entries (user_id, created_at desc);
create index if not exists challenge_entries_challenge_idx on challenge_entries (challenge_id, created_at desc);

create table if not exists watch_parties (
  id text primary key,
  host_id text not null references profiles(user_id) on delete cascade,
  video_id text not null,
  conversation_id text,
  position_ms integer not null default 0,
  playing boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists watch_parties_host_idx on watch_parties (host_id, created_at desc);

create table if not exists watch_party_members (
  party_id text not null references watch_parties(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create table if not exists video_clips (
  id text primary key,
  video_id text not null,
  author_id text not null references profiles(user_id) on delete cascade,
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),
  caption text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists video_clips_video_idx on video_clips (video_id, created_at desc);
create index if not exists video_clips_author_idx on video_clips (author_id, created_at desc);

alter table videos add column if not exists remix_of_id text;
create index if not exists videos_remix_idx on videos (remix_of_id) where remix_of_id is not null;

create table if not exists feature_flags (
  key text primary key,
  enabled boolean not null default true,
  rollout integer not null default 100 check (rollout >= 0 and rollout <= 100),
  updated_at timestamptz not null default now()
);

insert into feature_flags (key, enabled, rollout) values
  ('feed_tabs', true, 100),
  ('challenges', true, 100),
  ('events', true, 100),
  ('watch_parties', true, 100),
  ('translate', true, 100),
  ('collections', true, 100),
  ('safe_mode', true, 100),
  ('remix', true, 100),
  ('clips', true, 100),
  ('drafts', true, 100)
on conflict (key) do nothing;

create table if not exists analytics_events (
  id text primary key,
  user_id text,
  name text not null,
  entity_kind text,
  entity_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_name_idx on analytics_events (name, created_at desc);
create index if not exists analytics_events_user_idx on analytics_events (user_id, created_at desc);

create table if not exists translations (
  source_hash text not null,
  lang text not null,
  text text not null,
  created_at timestamptz not null default now(),
  primary key (source_hash, lang)
);
