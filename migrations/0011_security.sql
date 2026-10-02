-- Security: login lockout, audit trail, session notes. No secrets stored here.

alter table login_events add column if not exists kind text not null default 'success';
alter table login_events add column if not exists ip_hash text;

create table if not exists login_attempts (
  attempt_key text primary key,
  fail_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  lock_until timestamptz
);

create table if not exists security_events (
  id text primary key,
  user_id text,
  actor_id text,
  kind text not null,
  detail text not null default '',
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists security_events_kind_idx on security_events (kind, created_at desc);
create index if not exists security_events_user_idx on security_events (user_id, created_at desc);
create index if not exists security_events_created_idx on security_events (created_at desc);

create table if not exists admin_audit (
  id text primary key,
  actor_id text not null,
  action text not null,
  target_id text,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on admin_audit (created_at desc);
