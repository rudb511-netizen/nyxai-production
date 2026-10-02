-- OmniAI studio: threads, memory, projects, prompts, usage.

alter table kai_threads add column if not exists model_id text not null default 'auto';
alter table kai_threads add column if not exists mode text not null default 'chat';
alter table kai_threads add column if not exists pinned boolean not null default false;
alter table kai_threads add column if not exists archived boolean not null default false;
alter table kai_threads add column if not exists folder text not null default '';
alter table kai_threads add column if not exists project_id text;
alter table kai_threads add column if not exists instructions text not null default '';
alter table kai_threads add column if not exists share_id text;

alter table kai_messages add column if not exists model_id text;
alter table kai_messages add column if not exists citations_json jsonb;
alter table kai_messages add column if not exists attachments_json jsonb;
alter table kai_messages add column if not exists meta_json jsonb;

create unique index if not exists kai_threads_share_idx on kai_threads (share_id) where share_id is not null;

create table if not exists omni_projects (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists omni_projects_user_idx on omni_projects (user_id, updated_at desc);

create table if not exists omni_project_files (
  id text primary key,
  project_id text not null references omni_projects(id) on delete cascade,
  name text not null,
  mime text not null default 'text/plain',
  kind text not null default 'text',
  text_extract text not null default '',
  data_url text,
  bytes integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists omni_project_files_idx on omni_project_files (project_id, created_at);

create table if not exists omni_memory (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  scope text not null default 'user',
  project_id text,
  key text not null,
  value text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists omni_memory_user_idx on omni_memory (user_id, updated_at desc);

create table if not exists omni_prompts (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  title text not null,
  body text not null,
  category text not null default 'Writing',
  favorite boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists omni_prompts_user_idx on omni_prompts (user_id, category);

create table if not exists omni_prefs (
  user_id text primary key references profiles(user_id) on delete cascade,
  display_name text not null default 'OmniAI',
  personality text not null default 'friendly',
  length_pref text not null default 'medium',
  language text not null default 'English',
  custom_instructions text not null default '',
  memory_enabled boolean not null default true,
  voice_id text not null default 'eve',
  voice_speed real not null default 1,
  default_model text not null default 'auto',
  updated_at timestamptz not null default now()
);

create table if not exists omni_usage (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  kind text not null,
  model_id text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  units integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists omni_usage_user_idx on omni_usage (user_id, created_at desc);
