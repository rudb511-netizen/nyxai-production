alter table device_push_tokens add column if not exists app_version text;
alter table device_push_tokens add column if not exists last_seen_at timestamptz;
alter table device_push_tokens add column if not exists status text not null default 'active';
