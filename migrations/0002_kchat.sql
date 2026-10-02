-- K-CHAT core schema. Idempotent. user_id is TEXT (Better Auth ids).

create table if not exists profiles (
  user_id text primary key,
  username text not null,
  username_lc text not null unique,
  display_name text not null,
  bio text not null default '',
  gender text check (gender is null or gender in ('male', 'female')),
  date_of_birth date,
  avatar_url text,
  cover_url text,
  is_private boolean not null default false,
  is_verified boolean not null default false,
  role text not null default 'user' check (role in ('user','moderator','admin','super_admin')),
  is_suspended boolean not null default false,
  suspended_reason text,
  is_banned boolean not null default false,
  banned_reason text,
  last_seen_at timestamptz,
  show_online boolean not null default true,
  show_last_seen boolean not null default true,
  read_receipts boolean not null default true,
  who_can_message text not null default 'everyone',
  who_can_friend text not null default 'everyone',
  who_can_follow text not null default 'everyone',
  story_visibility text not null default 'everyone',
  totp_enabled boolean not null default false,
  totp_secret text,
  totp_backup_hashes text,
  totp_pending boolean not null default false,
  theme text not null default 'system',
  notif_prefs jsonb not null default '{}'::jsonb,
  onboarded boolean not null default false,
  pinned_post_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_username_lc_idx on profiles (username_lc);
create index if not exists profiles_display_name_idx on profiles (display_name);

create table if not exists follows (
  follower_id text not null references profiles(user_id) on delete cascade,
  following_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id)
);
create index if not exists follows_following_idx on follows (following_id);

create table if not exists friend_requests (
  id text primary key,
  from_id text not null references profiles(user_id) on delete cascade,
  to_id text not null references profiles(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_id, to_id)
);
create index if not exists friend_requests_to_idx on friend_requests (to_id, status);

create table if not exists friendships (
  user_a text not null references profiles(user_id) on delete cascade,
  user_b text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create table if not exists blocks (
  blocker_id text not null references profiles(user_id) on delete cascade,
  blocked_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists close_friends (
  user_id text not null references profiles(user_id) on delete cascade,
  friend_id text not null references profiles(user_id) on delete cascade,
  primary key (user_id, friend_id)
);

create table if not exists posts (
  id text primary key,
  author_id text not null references profiles(user_id) on delete cascade,
  body text not null default '',
  kind text not null default 'post',
  quote_of_id text,
  repost_of_id text,
  location text,
  comments_disabled boolean not null default false,
  who_can_interact text not null default 'everyone',
  is_removed boolean not null default false,
  poll_json jsonb,
  poll_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists posts_author_idx on posts (author_id, created_at desc);
create index if not exists posts_created_idx on posts (created_at desc);

create table if not exists post_media (
  id text primary key,
  post_id text not null references posts(id) on delete cascade,
  kind text not null,
  url text not null,
  thumb_url text,
  width integer,
  height integer,
  sort_order integer not null default 0
);
create index if not exists post_media_post_idx on post_media (post_id, sort_order);

create table if not exists post_likes (
  post_id text not null references posts(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists comments (
  id text primary key,
  post_id text not null references posts(id) on delete cascade,
  author_id text not null references profiles(user_id) on delete cascade,
  parent_id text,
  body text not null,
  is_removed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on comments (post_id, created_at);

create table if not exists comment_likes (
  comment_id text not null references comments(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  primary key (comment_id, user_id)
);

create table if not exists bookmarks (
  user_id text not null references profiles(user_id) on delete cascade,
  post_id text not null references posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists post_tags (
  post_id text not null references posts(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  primary key (post_id, user_id)
);

create table if not exists hashtags (
  tag text primary key,
  use_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists post_hashtags (
  post_id text not null references posts(id) on delete cascade,
  tag text not null,
  primary key (post_id, tag)
);
create index if not exists post_hashtags_tag_idx on post_hashtags (tag);

create table if not exists poll_votes (
  post_id text not null references posts(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  option_id text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists stories (
  id text primary key,
  author_id text not null references profiles(user_id) on delete cascade,
  media_url text,
  media_kind text not null,
  text_body text,
  background text,
  privacy text not null default 'everyone',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists stories_author_idx on stories (author_id, created_at desc);
create index if not exists stories_expires_idx on stories (expires_at);

create table if not exists story_views (
  story_id text not null references stories(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create table if not exists story_replies (
  id text primary key,
  story_id text not null references stories(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists videos (
  id text primary key,
  author_id text not null references profiles(user_id) on delete cascade,
  caption text not null default '',
  media_url text not null,
  thumb_url text,
  duration_ms integer,
  music_title text,
  speed real not null default 1,
  filter_name text,
  like_count integer not null default 0,
  comment_count integer not null default 0,
  view_count integer not null default 0,
  is_removed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists videos_created_idx on videos (created_at desc);

create table if not exists video_likes (
  video_id text not null references videos(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  primary key (video_id, user_id)
);

create table if not exists video_comments (
  id text primary key,
  video_id text not null references videos(id) on delete cascade,
  author_id text not null references profiles(user_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists video_saves (
  video_id text not null references videos(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  primary key (video_id, user_id)
);

create table if not exists conversations (
  id text primary key,
  kind text not null check (kind in ('dm','group')),
  title text,
  image_url text,
  description text,
  created_by text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_message_body text
);

create table if not exists conversation_members (
  conversation_id text not null references conversations(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  role text not null default 'member',
  muted boolean not null default false,
  archived boolean not null default false,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on conversation_members (user_id);

create table if not exists messages (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  sender_id text not null references profiles(user_id) on delete cascade,
  kind text not null default 'text',
  body text not null default '',
  media_url text,
  reply_to_id text,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_convo_idx on messages (conversation_id, created_at);

create table if not exists message_reactions (
  message_id text not null references messages(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  emoji text not null,
  primary key (message_id, user_id, emoji)
);

create table if not exists pinned_messages (
  conversation_id text not null references conversations(id) on delete cascade,
  message_id text not null references messages(id) on delete cascade,
  primary key (conversation_id, message_id)
);

create table if not exists typing_state (
  conversation_id text not null,
  user_id text not null,
  expires_at timestamptz not null,
  primary key (conversation_id, user_id)
);

create table if not exists streaks (
  user_a text not null references profiles(user_id) on delete cascade,
  user_b text not null references profiles(user_id) on delete cascade,
  count integer not null default 0,
  icon text not null default 'flame',
  last_qualifying_at timestamptz,
  a_sent_at timestamptz,
  b_sent_at timestamptz,
  freeze_until timestamptz,
  freeze_month text,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create table if not exists communities (
  id text primary key,
  kind text not null check (kind in ('channel','community')),
  slug text not null unique,
  name text not null,
  description text not null default '',
  image_url text,
  is_private boolean not null default false,
  created_by text not null references profiles(user_id) on delete cascade,
  member_count integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists community_members (
  community_id text not null references communities(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table if not exists community_posts (
  id text primary key,
  community_id text not null references communities(id) on delete cascade,
  author_id text not null references profiles(user_id) on delete cascade,
  body text not null default '',
  media_url text,
  created_at timestamptz not null default now()
);
create index if not exists community_posts_idx on community_posts (community_id, created_at desc);

create table if not exists live_streams (
  id text primary key,
  host_id text not null references profiles(user_id) on delete cascade,
  title text not null,
  status text not null default 'live',
  viewer_peak integer not null default 0,
  room_code text not null unique,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists live_streams_status_idx on live_streams (status, started_at desc);

create table if not exists live_comments (
  id text primary key,
  stream_id text not null references live_streams(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists live_bans (
  stream_id text not null references live_streams(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  primary key (stream_id, user_id)
);

create table if not exists calls (
  id text primary key,
  room_code text not null unique,
  kind text not null check (kind in ('voice','video')),
  is_group boolean not null default false,
  created_by text not null references profiles(user_id) on delete cascade,
  status text not null default 'ringing',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists call_participants (
  call_id text not null references calls(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (call_id, user_id)
);

create table if not exists notifications (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  kind text not null,
  actor_id text,
  entity_id text,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

create table if not exists reports (
  id text primary key,
  reporter_id text not null references profiles(user_id) on delete cascade,
  target_kind text not null,
  target_id text not null,
  category text not null,
  details text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz,
  resolution text
);
create index if not exists reports_status_idx on reports (status, created_at desc);

create table if not exists kai_threads (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kai_threads_user_idx on kai_threads (user_id, updated_at desc);

create table if not exists kai_messages (
  id text primary key,
  thread_id text not null references kai_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists kai_messages_thread_idx on kai_messages (thread_id, created_at);

create table if not exists kai_usage (
  user_id text not null,
  window_start timestamptz not null,
  tokens integer not null default 0,
  calls integer not null default 0,
  primary key (user_id, window_start)
);

create table if not exists login_events (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists mod_actions (
  id text primary key,
  actor_id text not null,
  action text not null,
  target_kind text,
  target_id text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists video_views (
  video_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

create table if not exists twofa_ok (
  user_id text primary key,
  session_ok_until timestamptz not null
);
