alter table public.users
  add column auth_user_id uuid;

alter table public.users
  add constraint users_auth_user_id_key unique (auth_user_id);

alter table public.users
  add constraint users_auth_user_id_fkey
  foreign key (auth_user_id)
  references auth.users(id)
  on delete set null;

-- Authenticated clients may edit only non-identity presentation fields.
revoke update on public.users from authenticated;
grant update (display_name, picture_url, timezone) on public.users to authenticated;

-- Replace the old assumption public.users.id = auth.uid() with the approved bridge:
-- auth.uid() -> users.auth_user_id -> users.id -> child rows.
drop policy if exists users_select_own on public.users;
drop policy if exists users_update_own on public.users;
create policy users_select_own on public.users
for select to authenticated
using (auth_user_id = auth.uid());
create policy users_update_own on public.users
for update to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles
for all to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = profiles.user_id and u.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = profiles.user_id and u.auth_user_id = auth.uid()
  )
);

drop policy if exists goals_own on public.goals;
create policy goals_own on public.goals
for all to authenticated
using (
  exists (select 1 from public.users u where u.id = goals.user_id and u.auth_user_id = auth.uid())
)
with check (
  exists (select 1 from public.users u where u.id = goals.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists body_metrics_own on public.body_metrics;
create policy body_metrics_own on public.body_metrics
for all to authenticated
using (
  exists (select 1 from public.users u where u.id = body_metrics.user_id and u.auth_user_id = auth.uid())
)
with check (
  exists (select 1 from public.users u where u.id = body_metrics.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists progress_photos_own on public.progress_photos;
create policy progress_photos_own on public.progress_photos
for all to authenticated
using (
  exists (select 1 from public.users u where u.id = progress_photos.user_id and u.auth_user_id = auth.uid())
)
with check (
  exists (select 1 from public.users u where u.id = progress_photos.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists recovery_logs_own on public.recovery_logs;
create policy recovery_logs_own on public.recovery_logs
for all to authenticated
using (
  exists (select 1 from public.users u where u.id = recovery_logs.user_id and u.auth_user_id = auth.uid())
)
with check (
  exists (select 1 from public.users u where u.id = recovery_logs.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists subscriptions_read_own on public.subscriptions;
create policy subscriptions_read_own on public.subscriptions
for select to authenticated
using (
  exists (select 1 from public.users u where u.id = subscriptions.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists quota_ledgers_read_own on public.quota_ledgers;
create policy quota_ledgers_read_own on public.quota_ledgers
for select to authenticated
using (
  exists (select 1 from public.users u where u.id = quota_ledgers.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists food_logs_own on public.food_logs;
create policy food_logs_own on public.food_logs
for all to authenticated
using (
  exists (select 1 from public.users u where u.id = food_logs.user_id and u.auth_user_id = auth.uid())
)
with check (
  exists (select 1 from public.users u where u.id = food_logs.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists food_items_own on public.food_items;
create policy food_items_own on public.food_items
for all to authenticated
using (
  exists (
    select 1
    from public.food_logs fl
    join public.users u on u.id = fl.user_id
    where fl.id = food_items.food_log_id and u.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.food_logs fl
    join public.users u on u.id = fl.user_id
    where fl.id = food_items.food_log_id and u.auth_user_id = auth.uid()
  )
);

drop policy if exists food_estimates_read_own on public.food_estimates;
create policy food_estimates_read_own on public.food_estimates
for select to authenticated
using (
  exists (
    select 1
    from public.food_logs fl
    join public.users u on u.id = fl.user_id
    where fl.id = food_estimates.food_log_id and u.auth_user_id = auth.uid()
  )
);

drop policy if exists food_corrections_read_own on public.food_corrections;
create policy food_corrections_read_own on public.food_corrections
for select to authenticated
using (
  exists (
    select 1
    from public.food_logs fl
    join public.users u on u.id = fl.user_id
    where fl.id = food_corrections.food_log_id and u.auth_user_id = auth.uid()
  )
);

drop policy if exists workout_sessions_own on public.workout_sessions;
create policy workout_sessions_own on public.workout_sessions
for all to authenticated
using (
  exists (select 1 from public.users u where u.id = workout_sessions.user_id and u.auth_user_id = auth.uid())
)
with check (
  exists (select 1 from public.users u where u.id = workout_sessions.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists workout_exercises_own on public.workout_exercises;
create policy workout_exercises_own on public.workout_exercises
for all to authenticated
using (
  exists (
    select 1
    from public.workout_sessions ws
    join public.users u on u.id = ws.user_id
    where ws.id = workout_exercises.session_id and u.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workout_sessions ws
    join public.users u on u.id = ws.user_id
    where ws.id = workout_exercises.session_id and u.auth_user_id = auth.uid()
  )
);

drop policy if exists workout_sets_own on public.workout_sets;
create policy workout_sets_own on public.workout_sets
for all to authenticated
using (
  exists (
    select 1
    from public.workout_exercises we
    join public.workout_sessions ws on ws.id = we.session_id
    join public.users u on u.id = ws.user_id
    where we.id = workout_sets.exercise_entry_id and u.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workout_exercises we
    join public.workout_sessions ws on ws.id = we.session_id
    join public.users u on u.id = ws.user_id
    where we.id = workout_sets.exercise_entry_id and u.auth_user_id = auth.uid()
  )
);

drop policy if exists coach_messages_read_own on public.coach_messages;
create policy coach_messages_read_own on public.coach_messages
for select to authenticated
using (
  exists (select 1 from public.users u where u.id = coach_messages.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists coach_reports_read_own on public.coach_reports;
create policy coach_reports_read_own on public.coach_reports
for select to authenticated
using (
  exists (select 1 from public.users u where u.id = coach_reports.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists ai_jobs_read_own on public.ai_jobs;
create policy ai_jobs_read_own on public.ai_jobs
for select to authenticated
using (
  exists (select 1 from public.users u where u.id = ai_jobs.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists ai_usage_read_own on public.ai_usage;
create policy ai_usage_read_own on public.ai_usage
for select to authenticated
using (
  exists (select 1 from public.users u where u.id = ai_usage.user_id and u.auth_user_id = auth.uid())
);

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications
for select to authenticated
using (
  exists (select 1 from public.users u where u.id = notifications.user_id and u.auth_user_id = auth.uid())
);

-- Link only from the authenticated Supabase identity. The caller cannot provide a LINE subject.
create or replace function public.link_line_identity_v1()
returns table (
  user_id uuid,
  auth_user_id uuid,
  provider text,
  provider_id text,
  line_user_id text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_provider text;
  v_provider_id text;
  v_user public.users%rowtype;
  v_identity_count integer;
begin
  if v_auth_user_id is null then
    raise exception 'authenticated session required';
  end if;

  select count(*), min(i.provider), min(i.provider_id)
    into v_identity_count, v_provider, v_provider_id
    from auth.identities i
   where i.user_id = v_auth_user_id
     and i.provider = 'custom:line';

  if v_identity_count <> 1 or v_provider_id is null or length(v_provider_id) = 0 then
    raise exception 'trusted custom:line identity required';
  end if;

  select *
    into v_user
    from public.users u
   where u.line_user_id = v_provider_id
   for update;

  if not found then
    raise exception 'LINE subject is not mapped to an app user';
  end if;

  if v_user.auth_user_id is not null and v_user.auth_user_id <> v_auth_user_id then
    raise exception 'LINE subject is already linked to another auth user';
  end if;

  if exists (
    select 1
    from public.users u
    where u.auth_user_id = v_auth_user_id
      and u.id <> v_user.id
  ) then
    raise exception 'auth user is already linked to another LINE subject';
  end if;

  if v_user.auth_user_id is null then
    update public.users
       set auth_user_id = v_auth_user_id,
           updated_at = now()
     where id = v_user.id;
    v_user.auth_user_id := v_auth_user_id;
  end if;

  return query
  select v_user.id, v_user.auth_user_id, v_provider, v_provider_id, v_user.line_user_id;
end;
$$;

revoke all on function public.link_line_identity_v1() from public, anon;
grant execute on function public.link_line_identity_v1() to authenticated;

-- Persist onboarding only for the app user owned by the current authenticated session.
create or replace function public.save_onboarding_v1(
  p_confirmed boolean,
  p_sex text,
  p_birth_date date,
  p_height_cm numeric,
  p_current_weight_kg numeric,
  p_activity_level text,
  p_experience_level text,
  p_goal_type text,
  p_target_weight_kg numeric,
  p_target_calories integer,
  p_target_protein_g numeric,
  p_training_days_per_week smallint
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_user_id uuid;
begin
  if p_confirmed is distinct from true then
    raise exception 'explicit confirmation required';
  end if;

  select u.id
    into v_user_id
    from public.users u
   where u.auth_user_id = auth.uid();

  if v_user_id is null then
    raise exception 'authenticated app user required';
  end if;

  insert into public.profiles (
    user_id,
    sex,
    birth_date,
    height_cm,
    current_weight_kg,
    activity_level,
    experience_level
  )
  values (
    v_user_id,
    p_sex,
    p_birth_date,
    p_height_cm,
    p_current_weight_kg,
    p_activity_level,
    p_experience_level
  )
  on conflict (user_id) do update
  set sex = excluded.sex,
      birth_date = excluded.birth_date,
      height_cm = excluded.height_cm,
      current_weight_kg = excluded.current_weight_kg,
      activity_level = excluded.activity_level,
      experience_level = excluded.experience_level,
      updated_at = now();

  insert into public.goals (
    user_id,
    goal_type,
    target_weight_kg,
    target_calories,
    target_protein_g,
    training_days_per_week
  )
  values (
    v_user_id,
    p_goal_type,
    p_target_weight_kg,
    p_target_calories,
    p_target_protein_g,
    p_training_days_per_week
  );

  return v_user_id;
end;
$$;

revoke all on function public.save_onboarding_v1(boolean, text, date, numeric, numeric, text, text, text, numeric, integer, numeric, smallint)
  from public, anon;
grant execute on function public.save_onboarding_v1(boolean, text, date, numeric, numeric, text, text, text, numeric, integer, numeric, smallint)
  to authenticated;
