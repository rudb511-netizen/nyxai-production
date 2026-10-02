-- Post views, status reshare permission, support inbox reads, media-index unique fix.

alter table posts add column if not exists view_count integer not null default 0;

create table if not exists post_views (
  post_id text not null references posts(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_views_post_idx on post_views (post_id, created_at desc);

alter table profiles add column if not exists allow_status_reshare boolean not null default true;

alter table statuses add column if not exists reshare_of_id text;
alter table statuses add column if not exists original_author_id text;
create index if not exists statuses_reshare_idx on statuses (reshare_of_id) where reshare_of_id is not null;

alter table message_media_index add column if not exists url_hash text not null default '';
drop index if exists message_media_unique_idx;
create unique index if not exists message_media_unique_v2_idx
  on message_media_index (message_id, kind, url_hash);

create table if not exists support_reads (
  conversation_id text not null,
  admin_id text not null references profiles(user_id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, admin_id)
);
create index if not exists support_reads_admin_idx on support_reads (admin_id, last_read_at desc);

create index if not exists messages_convo_kind_created_idx
  on messages (conversation_id, kind, created_at desc)
  where deleted_at is null;

create index if not exists post_views_user_idx on post_views (user_id);
create index if not exists statuses_original_author_idx
  on statuses (original_author_id) where original_author_id is not null;
