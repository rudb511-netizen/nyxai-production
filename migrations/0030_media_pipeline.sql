-- Resumable media uploads + conversation media index.
-- Chunks live in Postgres (no local disk on Vercel). Assembled blobs are served from /api/media/:id.

create table if not exists media_uploads (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  purpose text not null check (purpose in ('video', 'status', 'post', 'chat', 'story')),
  mime text not null,
  filename text,
  total_bytes bigint not null,
  chunk_size int not null,
  chunk_count int not null,
  received_count int not null default 0,
  checksum text,
  status text not null default 'uploading'
    check (status in (
      'uploading', 'upload_complete', 'processing', 'ready',
      'publishing', 'published', 'failed', 'cancelled'
    )),
  fail_reason text,
  blob_b64 text,
  media_url text,
  thumb_url text,
  width int,
  height int,
  duration_ms int,
  file_size bigint,
  idempotency_key text,
  published_id text,
  conversation_id text,
  extra jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists media_uploads_idem_idx
  on media_uploads (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists media_uploads_user_idx on media_uploads (user_id, created_at desc);
create index if not exists media_uploads_status_idx on media_uploads (status, updated_at desc);

create table if not exists media_upload_chunks (
  upload_id text not null references media_uploads(id) on delete cascade,
  idx int not null,
  data text not null,
  bytes int not null,
  checksum text not null,
  created_at timestamptz not null default now(),
  primary key (upload_id, idx)
);

create table if not exists message_media_index (
  id text primary key,
  message_id text not null,
  conversation_id text not null,
  sender_id text not null,
  kind text not null check (kind in ('image', 'video', 'file', 'link')),
  media_url text,
  thumb_url text,
  filename text,
  mime text,
  bytes int,
  title text,
  domain text,
  created_at timestamptz not null default now()
);
create index if not exists message_media_convo_kind_idx
  on message_media_index (conversation_id, kind, created_at desc);
create unique index if not exists message_media_unique_idx
  on message_media_index (message_id, kind, media_url);

alter table videos add column if not exists upload_id text;
alter table videos add column if not exists publish_state text;
create unique index if not exists videos_upload_id_idx on videos (upload_id) where upload_id is not null;

alter table statuses add column if not exists upload_id text;
create unique index if not exists statuses_upload_id_idx on statuses (upload_id) where upload_id is not null;
