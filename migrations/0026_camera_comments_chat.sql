-- Camera / comments / chat appearance. Additive and idempotent.

alter table conversations add column if not exists disappear_sec integer not null default 0;

alter table messages add column if not exists expires_at timestamptz;
create index if not exists messages_expires_idx on messages (expires_at) where expires_at is not null and deleted_at is null;

create table if not exists chat_customizations (
  conversation_id text not null references conversations(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  theme_id text not null default 'nyx',
  chat_color text not null default 'nyx-blue',
  wallpaper_type text not null default 'builtin',
  wallpaper_key text,
  wallpaper_url text,
  wallpaper_w integer,
  wallpaper_h integer,
  wallpaper_bytes integer,
  font_id text not null default 'outfit',
  disappearing_enabled boolean not null default false,
  disappearing_duration_sec integer not null default 0,
  reminders_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists chat_custom_user_idx on chat_customizations (user_id, conversation_id);

create table if not exists message_reminders (
  id text primary key,
  message_id text not null,
  conversation_id text not null,
  recipient_id text not null references profiles(user_id) on delete cascade,
  last_reminder_at timestamptz,
  reminder_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (message_id, recipient_id)
);
create index if not exists message_reminders_recipient_idx on message_reminders (recipient_id, last_reminder_at);

alter table videos add column if not exists pinned boolean not null default false;
alter table videos add column if not exists pinned_at timestamptz;
create index if not exists videos_author_pinned_idx on videos (author_id, pinned desc, created_at desc);

alter table video_comments add column if not exists media_url text;
alter table video_comments add column if not exists edited_at timestamptz;
create index if not exists video_comments_parent_idx on video_comments (parent_id, created_at);
create index if not exists video_comments_video_created_idx on video_comments (video_id, created_at desc);
create index if not exists video_comments_author_idx on video_comments (author_id, created_at desc);
create index if not exists video_comment_likes_comment_idx on video_comment_likes (comment_id);
create index if not exists video_comment_likes_user_idx on video_comment_likes (user_id, comment_id);

create index if not exists notifications_user_created_idx on notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on notifications (user_id, is_read, created_at desc);
create index if not exists messages_sender_idx on messages (sender_id, created_at desc);
