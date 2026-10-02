-- ARC Admin must not automatically hold ordinary NYX Verified (green check).
-- Purchased premium_verify rows are left untouched. Safe to run more than once.

update entitlements
   set status = 'expired', ends_at = now(), updated_at = now()
 where kind = 'premium_verify'
   and source = 'arc_grant'
   and status in ('trial', 'active', 'grace', 'billing_retry', 'cancelled');

update profiles p
   set is_premium = exists (
         select 1 from entitlements e
          where e.user_id = p.user_id
            and e.kind = 'premium_verify'
            and e.status in ('trial', 'active', 'grace', 'billing_retry', 'cancelled')
            and (e.ends_at is null or e.ends_at > now())
       ),
       updated_at = now()
 where coalesce(p.is_arc, false) = true;

update profiles p
   set is_verified = (p.verify_kind in ('org', 'founder', 'developer') or coalesce(p.is_premium, false)),
       updated_at = now()
 where coalesce(p.is_arc, false) = true;

alter table messages add column if not exists view_once_state text;

alter table music_cache add column if not exists download_url text;
alter table music_cache add column if not exists downloadable boolean not null default false;
