-- Watch metadata, sounds, status privacy, view-once.

alter table videos add column if not exists width integer;
alter table videos add column if not exists height integer;
alter table videos add column if not exists fps integer;
alter table videos add column if not exists codec text;
alter table videos add column if not exists bitrate integer;
alter table videos add column if not exists hdr boolean not null default false;
alter table videos add column if not exists source_width integer;
alter table videos add column if not exists source_height integer;
alter table videos add column if not exists source_fps integer;
alter table videos add column if not exists source_label text;
alter table videos add column if not exists aspect_ratio text;
alter table videos add column if not exists share_count integer not null default 0;
alter table videos add column if not exists save_count integer not null default 0;
alter table videos add column if not exists watch_ms_total bigint not null default 0;
alter table videos add column if not exists sound_id text;
alter table videos add column if not exists original_audio boolean not null default true;
alter table videos add column if not exists allow_original_audio boolean not null default true;
alter table videos add column if not exists overlay_json jsonb;
alter table videos add column if not exists is_draft boolean not null default false;
alter table videos add column if not exists scheduled_at timestamptz;

create table if not exists video_renditions (
  video_id text not null references videos(id) on delete cascade,
  quality text not null,
  height integer not null,
  media_url text not null,
  bytes integer,
  primary key (video_id, quality)
);

create table if not exists video_views (
  video_id text not null references videos(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  watch_ms integer not null default 0,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

create table if not exists video_reposts (
  video_id text not null references videos(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

create table if not exists sounds (
  id text primary key,
  author_id text references profiles(user_id) on delete set null,
  title text not null,
  artist text,
  media_url text,
  duration_ms integer,
  use_count integer not null default 0,
  original boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists sounds_title_idx on sounds (lower(title));

create table if not exists sound_saves (
  sound_id text not null references sounds(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sound_id, user_id)
);

alter table video_comments add column if not exists parent_id text;
alter table video_comments add column if not exists like_count integer not null default 0;

create table if not exists video_comment_likes (
  comment_id text not null references video_comments(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  primary key (comment_id, user_id)
);

create table if not exists video_drafts (
  id text primary key,
  author_id text not null references profiles(user_id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table statuses add column if not exists audience text not null default 'friends';
alter table statuses add column if not exists view_once boolean not null default false;

create table if not exists status_audience (
  status_id text not null references statuses(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  mode text not null,
  primary key (status_id, user_id)
);

alter table profiles add column if not exists status_privacy text not null default 'friends';

alter table messages add column if not exists view_once boolean not null default false;
alter table messages add column if not exists opened_at timestamptz;

create table if not exists omni_mention_replies (
  id text primary key,
  source_kind text not null,
  source_id text not null,
  created_at timestamptz not null default now()
);
