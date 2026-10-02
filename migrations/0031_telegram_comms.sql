-- Telegram-style communication primitives. Additive. Existing rows stay valid.

alter table conversations add column if not exists is_broadcast boolean not null default false;
alter table conversations add column if not exists forum_enabled boolean not null default false;
alter table conversations add column if not exists username_lc text;
alter table conversations add column if not exists linked_discussion_id text;

create unique index if not exists conversations_username_lc_idx
  on conversations (username_lc) where username_lc is not null;

alter table conversation_members add column if not exists mute_until timestamptz;
alter table conversation_members add column if not exists restricted boolean not null default false;
alter table conversation_members add column if not exists banned_at timestamptz;

alter table messages add column if not exists silent boolean not null default false;
alter table messages add column if not exists client_id text;
alter table messages add column if not exists album_id text;
alter table messages add column if not exists extra_json jsonb;
alter table messages add column if not exists topic_id text;
alter table messages add column if not exists duration_ms integer;

create unique index if not exists messages_client_id_idx
  on messages (conversation_id, sender_id, client_id)
  where client_id is not null;

create index if not exists messages_album_idx
  on messages (conversation_id, album_id, created_at)
  where album_id is not null;

create index if not exists messages_topic_idx
  on messages (conversation_id, topic_id, created_at)
  where topic_id is not null;

create table if not exists conversation_drafts (
  conversation_id text not null references conversations(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  body text not null default '',
  extra_json jsonb,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_drafts_user_idx
  on conversation_drafts (user_id, updated_at desc);

create table if not exists scheduled_messages (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  sender_id text not null references profiles(user_id) on delete cascade,
  kind text not null default 'text',
  body text not null default '',
  media_url text,
  reply_to_id text,
  duration_ms integer,
  extra_json jsonb,
  silent boolean not null default false,
  album_id text,
  client_id text,
  topic_id text,
  send_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','cancelled')),
  sent_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scheduled_messages_due_idx
  on scheduled_messages (status, send_at);
create index if not exists scheduled_messages_convo_idx
  on scheduled_messages (conversation_id, sender_id, status, send_at);

create table if not exists recording_state (
  conversation_id text not null,
  user_id text not null,
  expires_at timestamptz not null,
  primary key (conversation_id, user_id)
);

create table if not exists chat_polls (
  id text primary key,
  message_id text,
  conversation_id text not null references conversations(id) on delete cascade,
  question text not null,
  options_json jsonb not null,
  anonymous boolean not null default false,
  multiple boolean not null default false,
  quiz boolean not null default false,
  correct_option_id text,
  closed_at timestamptz,
  created_by text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists chat_polls_convo_idx on chat_polls (conversation_id, created_at desc);

create table if not exists chat_poll_votes (
  poll_id text not null references chat_polls(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  option_id text not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id, option_id)
);
create index if not exists chat_poll_votes_poll_idx on chat_poll_votes (poll_id);

create table if not exists group_invite_links (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  token text not null unique,
  created_by text not null references profiles(user_id) on delete cascade,
  expires_at timestamptz,
  max_uses integer,
  use_count integer not null default 0,
  require_approval boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists group_invite_links_convo_idx
  on group_invite_links (conversation_id, created_at desc);

create table if not exists group_join_requests (
  conversation_id text not null references conversations(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  link_id text,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists conversation_topics (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  title text not null,
  icon text,
  created_by text not null references profiles(user_id) on delete cascade,
  closed boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists conversation_topics_convo_idx
  on conversation_topics (conversation_id, last_message_at desc nulls last);

create table if not exists sticker_packs (
  id text primary key,
  title text not null,
  author_name text not null default 'NYX',
  created_at timestamptz not null default now()
);

create table if not exists stickers (
  id text primary key,
  pack_id text not null references sticker_packs(id) on delete cascade,
  emoji text not null default '',
  svg text not null,
  sort_order integer not null default 0
);
create index if not exists stickers_pack_idx on stickers (pack_id, sort_order);

create table if not exists user_sticker_packs (
  user_id text not null references profiles(user_id) on delete cascade,
  pack_id text not null references sticker_packs(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, pack_id)
);

create table if not exists sticker_favorites (
  user_id text not null references profiles(user_id) on delete cascade,
  sticker_id text not null references stickers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sticker_id)
);

create table if not exists sticker_recent (
  user_id text not null references profiles(user_id) on delete cascade,
  sticker_id text not null references stickers(id) on delete cascade,
  used_at timestamptz not null default now(),
  primary key (user_id, sticker_id)
);

create table if not exists link_previews (
  url_hash text primary key,
  url text not null,
  title text,
  description text,
  image_url text,
  domain text,
  ok boolean not null default true,
  fetched_at timestamptz not null default now()
);

create table if not exists message_edits (
  id text primary key,
  message_id text not null references messages(id) on delete cascade,
  body text not null,
  edited_at timestamptz not null default now()
);
create index if not exists message_edits_msg_idx on message_edits (message_id, edited_at desc);

create table if not exists group_audit (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  actor_id text not null references profiles(user_id) on delete cascade,
  action text not null,
  target_id text,
  meta_json jsonb,
  created_at timestamptz not null default now()
);
create index if not exists group_audit_convo_idx on group_audit (conversation_id, created_at desc);

create table if not exists live_locations (
  message_id text primary key references messages(id) on delete cascade,
  conversation_id text not null references conversations(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  live_until timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists live_locations_convo_idx
  on live_locations (conversation_id, live_until);
