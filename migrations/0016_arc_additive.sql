-- ARC Admin is an additive role (is_arc), not a replacement verification badge.
-- Three global ARC seats.

alter table profiles add column if not exists is_arc boolean not null default false;

alter table mark_seats drop constraint if exists mark_seats_seat_chk;
alter table mark_seats add constraint mark_seats_seat_chk check (seat in (1, 2, 3));

-- Anyone already holding a seat is ARC, even if verify_kind was overwritten.
update profiles
set is_arc = true
where user_id in (select user_id from mark_seats where kind = 'arc')
   or verify_kind = 'arc';

-- Restore the identity badge that ARC redemption previously overwrote.
update profiles p
set
  verify_kind = b.previous_kind,
  is_verified = true
from (
  select distinct on (user_id) user_id, previous_kind
  from badge_events
  where action = 'grant'
    and badge = 'arc'
    and previous_kind in ('org', 'founder', 'developer')
  order by user_id, created_at desc
) b
where p.user_id = b.user_id
  and p.verify_kind = 'arc';

-- Remaining legacy ARC-in-verify_kind rows: keep ARC, clear the identity slot.
update profiles
set
  verify_kind = 'none',
  is_verified = true,
  role = 'super_admin',
  is_arc = true
where verify_kind = 'arc';

update profiles
set is_verified = true
where is_arc = true or verify_kind in ('org', 'founder', 'developer');
