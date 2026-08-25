create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text,
  picture_url text,
  timezone text not null default 'Asia/Bangkok',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  sex text,
  birth_date date,
  height_cm numeric(6,2) check (height_cm is null or height_cm > 0),
  current_weight_kg numeric(7,3) check (current_weight_kg is null or current_weight_kg > 0),
  activity_level text,
  experience_level text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  goal_type text not null,
  target_weight_kg numeric(7,3) check (target_weight_kg is null or target_weight_kg > 0),
  target_calories integer check (target_calories is null or target_calories > 0),
  target_protein_g numeric(7,2) check (target_protein_g is null or target_protein_g >= 0),
  training_days_per_week smallint check (training_days_per_week is null or training_days_per_week between 0 and 7),
  active_from date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index goals_user_active_from_idx on public.goals(user_id, active_from desc);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan text not null,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end is null or current_period_start is null or current_period_end >= current_period_start)
);

create index subscriptions_user_idx on public.subscriptions(user_id);

create table public.quota_ledgers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  period text not null,
  units_granted integer not null default 0 check (units_granted >= 0),
  units_used integer not null default 0 check (units_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, period)
);

create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  measured_at timestamptz not null,
  weight_kg numeric(7,3) check (weight_kg is null or weight_kg > 0),
  waist_cm numeric(7,2) check (waist_cm is null or waist_cm > 0),
  body_fat_percent numeric(5,2) check (body_fat_percent is null or body_fat_percent between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index body_metrics_user_measured_at_idx on public.body_metrics(user_id, measured_at desc);

create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  captured_at timestamptz not null,
  storage_path text not null,
  pose text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index progress_photos_user_captured_at_idx on public.progress_photos(user_id, captured_at desc);

create table public.recovery_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  logged_for date not null,
  sleep_hours numeric(4,2) check (sleep_hours is null or sleep_hours between 0 and 24),
  sleep_quality smallint check (sleep_quality is null or sleep_quality between 1 and 5),
  fatigue smallint check (fatigue is null or fatigue between 1 and 5),
  soreness smallint check (soreness is null or soreness between 1 and 5),
  readiness smallint check (readiness is null or readiness between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, logged_for)
);

alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.subscriptions enable row level security;
alter table public.quota_ledgers enable row level security;
alter table public.body_metrics enable row level security;
alter table public.progress_photos enable row level security;
alter table public.recovery_logs enable row level security;

create policy users_select_own on public.users for select to authenticated using (id = auth.uid());
create policy users_update_own on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_own on public.profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy goals_own on public.goals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy body_metrics_own on public.body_metrics for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy progress_photos_own on public.progress_photos for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy recovery_logs_own on public.recovery_logs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy subscriptions_read_own on public.subscriptions for select to authenticated using (user_id = auth.uid());
create policy quota_ledgers_read_own on public.quota_ledgers for select to authenticated using (user_id = auth.uid());

grant select, update on public.users to authenticated;
grant select, insert, update, delete on public.profiles, public.goals, public.body_metrics, public.progress_photos, public.recovery_logs to authenticated;
grant select on public.subscriptions, public.quota_ledgers to authenticated;
grant all on public.users, public.profiles, public.goals, public.subscriptions, public.quota_ledgers, public.body_metrics, public.progress_photos, public.recovery_logs to service_role;
