-- Inbox: pin, favorite, unread mark, custom lists, starred messages, last kind.

alter table conversation_members add column if not exists pinned boolean not null default false;
alter table conversation_members add column if not exists favorite boolean not null default false;
alter table conversation_members add column if not exists marked_unread boolean not null default false;

alter table conversations add column if not exists last_message_kind text;

create table if not exists message_stars (
  message_id text not null references messages(id) on delete cascade,
  user_id text not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_stars_user_idx on message_stars (user_id, created_at desc);

create table if not exists inbox_lists (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);
create index if not exists inbox_lists_user_idx on inbox_lists (user_id);

create table if not exists inbox_list_chats (
  list_id text not null references inbox_lists(id) on delete cascade,
  conversation_id text not null references conversations(id) on delete cascade,
  primary key (list_id, conversation_id)
);
