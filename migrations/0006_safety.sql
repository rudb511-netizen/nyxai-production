-- Soft-remove video comments so authors and staff can delete them.

alter table video_comments add column if not exists is_removed boolean not null default false;
