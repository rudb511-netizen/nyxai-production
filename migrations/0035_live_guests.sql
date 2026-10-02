alter table live_streams add column if not exists max_guests integer not null default 4;

alter table live_speakers drop constraint if exists live_speakers_role_check;
alter table live_speakers add constraint live_speakers_role_check
  check (role in ('host', 'cohost', 'speaker', 'listener', 'requested', 'invited'));
