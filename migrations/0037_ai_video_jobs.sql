create table if not exists nyx_video_jobs (
  id text primary key,
  user_id text not null,
  provider text not null,
  model text not null,
  prompt text not null,
  input_image text,
  task_id text,
  status text not null,
  output_url text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists nyx_video_jobs_user_idx on nyx_video_jobs (user_id, created_at desc);
