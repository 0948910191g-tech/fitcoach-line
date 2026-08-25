create table public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  eaten_at timestamptz not null,
  meal_type text,
  source text not null,
  status text not null,
  totals jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index food_logs_user_eaten_at_idx on public.food_logs(user_id, eaten_at desc);
create index food_logs_user_status_idx on public.food_logs(user_id, status);

create table public.food_items (
  id uuid primary key default gen_random_uuid(),
  food_log_id uuid not null references public.food_logs(id) on delete cascade,
  name text not null,
  quantity numeric(10,3) check (quantity is null or quantity > 0),
  unit text,
  calories numeric(10,2) check (calories is null or calories >= 0),
  protein_g numeric(10,2) check (protein_g is null or protein_g >= 0),
  carbs_g numeric(10,2) check (carbs_g is null or carbs_g >= 0),
  fat_g numeric(10,2) check (fat_g is null or fat_g >= 0),
  sugar_g numeric(10,2) check (sugar_g is null or sugar_g >= 0),
  sodium_mg numeric(12,2) check (sodium_mg is null or sodium_mg >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index food_items_food_log_idx on public.food_items(food_log_id);

create table public.food_estimates (
  id uuid primary key default gen_random_uuid(),
  food_log_id uuid not null references public.food_logs(id) on delete cascade,
  raw_ai_output jsonb not null,
  assumptions jsonb not null default '[]'::jsonb,
  prompt_version text not null,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index food_estimates_food_log_idx on public.food_estimates(food_log_id);

create table public.food_corrections (
  id uuid primary key default gen_random_uuid(),
  food_log_id uuid not null references public.food_logs(id) on delete cascade,
  before_json jsonb not null,
  after_json jsonb not null,
  corrected_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index food_corrections_food_log_idx on public.food_corrections(food_log_id, created_at desc);

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  workout_type text not null,
  effort smallint check (effort is null or effort between 1 and 10),
  estimated_kcal numeric(10,2) check (estimated_kcal is null or estimated_kcal >= 0),
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create index workout_sessions_user_started_at_idx on public.workout_sessions(user_id, started_at desc);
create index workout_sessions_user_status_idx on public.workout_sessions(user_id, status);

create table public.exercise_library (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  aliases text[] not null default '{}',
  movement_pattern text,
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_id uuid not null references public.exercise_library(id),
  order_index integer not null check (order_index >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, order_index)
);

create index workout_exercises_session_idx on public.workout_exercises(session_id);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  exercise_entry_id uuid not null references public.workout_exercises(id) on delete cascade,
  set_number integer not null check (set_number > 0),
  reps integer check (reps is null or reps > 0),
  weight numeric(10,3) check (weight is null or weight >= 0),
  weight_unit text,
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  distance_m numeric(12,3) check (distance_m is null or distance_m > 0),
  rpe numeric(3,1) check (rpe is null or rpe between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exercise_entry_id, set_number)
);

alter table public.food_logs enable row level security;
alter table public.food_items enable row level security;
alter table public.food_estimates enable row level security;
alter table public.food_corrections enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.exercise_library enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;

create policy food_logs_own on public.food_logs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy food_items_own on public.food_items for all to authenticated
using (exists (select 1 from public.food_logs where food_logs.id = food_items.food_log_id and food_logs.user_id = auth.uid()))
with check (exists (select 1 from public.food_logs where food_logs.id = food_items.food_log_id and food_logs.user_id = auth.uid()));

create policy food_estimates_read_own on public.food_estimates for select to authenticated
using (exists (select 1 from public.food_logs where food_logs.id = food_estimates.food_log_id and food_logs.user_id = auth.uid()));

create policy food_corrections_read_own on public.food_corrections for select to authenticated
using (exists (select 1 from public.food_logs where food_logs.id = food_corrections.food_log_id and food_logs.user_id = auth.uid()));

create policy workout_sessions_own on public.workout_sessions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy exercise_library_read on public.exercise_library for select to authenticated using (true);

create policy workout_exercises_own on public.workout_exercises for all to authenticated
using (exists (select 1 from public.workout_sessions where workout_sessions.id = workout_exercises.session_id and workout_sessions.user_id = auth.uid()))
with check (exists (select 1 from public.workout_sessions where workout_sessions.id = workout_exercises.session_id and workout_sessions.user_id = auth.uid()));

create policy workout_sets_own on public.workout_sets for all to authenticated
using (
  exists (
    select 1
    from public.workout_exercises
    join public.workout_sessions on workout_sessions.id = workout_exercises.session_id
    where workout_exercises.id = workout_sets.exercise_entry_id
      and workout_sessions.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workout_exercises
    join public.workout_sessions on workout_sessions.id = workout_exercises.session_id
    where workout_exercises.id = workout_sets.exercise_entry_id
      and workout_sessions.user_id = auth.uid()
  )
);

grant select, insert, update, delete on public.food_logs, public.food_items, public.workout_sessions, public.workout_exercises, public.workout_sets to authenticated;
grant select on public.food_estimates, public.food_corrections, public.exercise_library to authenticated;
grant all on public.food_logs, public.food_items, public.food_estimates, public.food_corrections, public.workout_sessions, public.exercise_library, public.workout_exercises, public.workout_sets to service_role;
