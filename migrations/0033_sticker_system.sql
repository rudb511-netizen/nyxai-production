-- Sticker catalog metadata, custom stickers, comments/live sticker refs.
-- Existing sticker_packs / stickers / favorites / recents are preserved.

alter table sticker_packs add column if not exists slug text;
alter table sticker_packs add column if not exists description text not null default '';
alter table sticker_packs add column if not exists category text not null default 'official';
alter table sticker_packs add column if not exists cover_url text;
alter table sticker_packs add column if not exists kind text not null default 'official';
alter table sticker_packs add column if not exists published boolean not null default true;
alter table sticker_packs add column if not exists creator_id text;
alter table sticker_packs add column if not exists sticker_count integer not null default 0;
alter table sticker_packs add column if not exists animated boolean not null default false;

alter table stickers add column if not exists name text not null default '';
alter table stickers add column if not exists tags text not null default '';
alter table stickers add column if not exists animated boolean not null default false;
alter table stickers add column if not exists media_url text;
alter table stickers add column if not exists thumb_url text;
alter table stickers add column if not exists media_kind text not null default 'svg';
alter table stickers add column if not exists created_by text;
alter table stickers add column if not exists is_removed boolean not null default false;
alter table stickers add column if not exists is_official boolean not null default true;
alter table stickers add column if not exists width integer;
alter table stickers add column if not exists height integer;
alter table stickers add column if not exists duration_ms integer;

create index if not exists stickers_name_idx on stickers (lower(name));
create index if not exists stickers_tags_idx on stickers (tags);
create index if not exists stickers_pack_live_idx on stickers (pack_id, sort_order) where is_removed = false;
create index if not exists sticker_packs_kind_idx on sticker_packs (kind, published);
create index if not exists sticker_packs_creator_idx on sticker_packs (creator_id, created_at desc);

create table if not exists sticker_reports (
  id text primary key,
  sticker_id text not null references stickers(id) on delete cascade,
  reporter_id text not null references profiles(user_id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists sticker_reports_sticker_idx on sticker_reports (sticker_id, created_at desc);

alter table comments add column if not exists sticker_id text;
alter table live_comments add column if not exists sticker_id text;
alter table live_comments add column if not exists extra_json jsonb;
alter table video_comments add column if not exists sticker_id text;
