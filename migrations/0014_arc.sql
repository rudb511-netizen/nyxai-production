-- ARC Admin seats (max 2), badge ledger, timed restorations, unauthorized founder sweep.

create table if not exists mark_seats (
  kind text not null,
  seat smallint not null,
  user_id text not null references profiles(user_id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (kind, seat),
  constraint mark_seats_seat_chk check (seat in (1, 2))
);
create unique index if not exists mark_seats_user_idx on mark_seats (kind, user_id);

create table if not exists badge_events (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  actor_id text not null,
  action text not null,
  badge text not null default '',
  previous_kind text not null default 'none',
  previous_role text not null default 'user',
  new_kind text not null default 'none',
  new_role text not null default 'user',
  reason text not null default '',
  duration_days int,
  ends_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create index if not exists badge_events_user_idx on badge_events (user_id, created_at desc);
create index if not exists badge_events_actor_idx on badge_events (actor_id, created_at desc);

create table if not exists pending_restorations (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  restore_kind text not null,
  restore_role text not null,
  restore_verified boolean not null default true,
  ends_at timestamptz not null,
  reason text not null default '',
  actor_id text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists pending_restorations_due_idx on pending_restorations (status, ends_at);

-- Blocks re-redemption after a permanent or timed demotion until ARC restores.
create table if not exists mark_blocks (
  user_id text not null references profiles(user_id) on delete cascade,
  kind text not null,
  actor_id text not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);

-- Strip Founder from anyone who did not redeem the one-time Founder seat.
update profiles
set
  verify_kind = 'none',
  is_verified = false,
  role = 'user',
  updated_at = now()
where verify_kind = 'founder'
  and user_id not in (select user_id from mark_redemptions where kind = 'founder');

-- Strip ARC from anyone not holding a seat.
update profiles
set
  verify_kind = 'none',
  is_verified = false,
  role = 'user',
  updated_at = now()
where verify_kind = 'arc'
  and user_id not in (select user_id from mark_seats where kind = 'arc');
