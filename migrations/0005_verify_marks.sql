-- Account marks: official org vs developer. Codes live only in server code.

alter table profiles add column if not exists verify_kind text not null default 'none';

update profiles set is_verified = true where verify_kind in ('org', 'founder') and is_verified = false;
