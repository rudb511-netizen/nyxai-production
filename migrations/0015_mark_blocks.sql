-- Re-redemption lock after ARC demotion / badge revoke (idempotent if 0014 already created it).

create table if not exists mark_blocks (
  user_id text not null references profiles(user_id) on delete cascade,
  kind text not null,
  actor_id text not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);
