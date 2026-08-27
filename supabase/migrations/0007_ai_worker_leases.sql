alter table public.ai_jobs
  add column lease_token uuid,
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column next_attempt_at timestamptz,
  add column quota_counted_at timestamptz,
  add column finished_at timestamptz;

create index ai_jobs_claimable_idx
  on public.ai_jobs(status, next_attempt_at, lease_expires_at, created_at)
  where status in ('queued', 'retry_wait', 'processing');

create index ai_jobs_active_lease_idx
  on public.ai_jobs(user_id, lease_expires_at)
  where status = 'processing';

create index ai_jobs_quota_counted_idx
  on public.ai_jobs(user_id, quota_counted_at)
  where quota_counted_at is not null;

create or replace function public.claim_ai_job_v1(
  p_worker_id text,
  p_lease_seconds integer,
  p_daily_limit integer,
  p_concurrency_limit integer
)
returns table (
  job_id uuid,
  user_id uuid,
  task_type text,
  provider text,
  input_ref text,
  attempts integer,
  lease_token uuid,
  lease_expires_at timestamptz,
  quota_used integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.ai_jobs%rowtype;
  v_now timestamptz;
  v_token uuid;
  v_active_leases integer;
  v_quota_used integer;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker id is required';
  end if;
  if p_lease_seconds < 1 then
    raise exception 'lease seconds must be positive';
  end if;
  if p_daily_limit < 1 then
    raise exception 'daily limit must be positive';
  end if;
  if p_concurrency_limit < 1 then
    raise exception 'concurrency limit must be positive';
  end if;

  v_now := clock_timestamp();

  select j.*
    into v_job
    from public.ai_jobs as j
   where (
     (j.status in ('queued', 'retry_wait') and coalesce(j.next_attempt_at, j.created_at) <= v_now)
     or
     (j.status = 'processing' and j.lease_expires_at is not null and j.lease_expires_at <= v_now)
   )
   order by coalesce(j.next_attempt_at, j.created_at), j.created_at, j.id
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  -- Serialize claims for one application user. The job row lock prevents two
  -- workers from claiming the same job; this user-row lock also prevents two
  -- different jobs for the same user from bypassing concurrency/quota checks.
  perform 1
    from public.users as u
   where u.id = v_job.user_id
   for update;

  if not found then
    return;
  end if;

  v_now := clock_timestamp();

  select count(*)::integer
    into v_active_leases
    from public.ai_jobs as active_job
   where active_job.user_id = v_job.user_id
     and active_job.id <> v_job.id
     and active_job.status = 'processing'
     and active_job.lease_expires_at > v_now;

  if v_active_leases >= p_concurrency_limit then
    return;
  end if;

  select count(*)::integer
    into v_quota_used
    from public.ai_jobs as quota_job
   where quota_job.user_id = v_job.user_id
     and quota_job.quota_counted_at is not null
     and (quota_job.quota_counted_at at time zone 'Asia/Bangkok')::date =
         (v_now at time zone 'Asia/Bangkok')::date;

  if v_job.quota_counted_at is null then
    if v_quota_used >= p_daily_limit then
      return;
    end if;

    v_quota_used := v_quota_used + 1;
  end if;

  v_token := gen_random_uuid();

  update public.ai_jobs as claimed_job
     set status = 'processing',
         lease_token = v_token,
         lease_owner = p_worker_id,
         lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
         next_attempt_at = null,
         quota_counted_at = coalesce(claimed_job.quota_counted_at, v_now),
         updated_at = v_now
   where claimed_job.id = v_job.id;

  return query
  select claimed_job.id,
         claimed_job.user_id,
         claimed_job.task_type,
         claimed_job.provider,
         claimed_job.input_ref,
         claimed_job.attempts,
         claimed_job.lease_token,
         claimed_job.lease_expires_at,
         v_quota_used
    from public.ai_jobs as claimed_job
   where claimed_job.id = v_job.id;
end;
$$;

create or replace function public.complete_ai_job_v1(
  p_job_id uuid,
  p_lease_token uuid,
  p_output_json jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_updated integer;
begin
  update public.ai_jobs as job
     set status = 'completed',
         attempts = job.attempts + 1,
         output_json = p_output_json,
         error_code = null,
         lease_token = null,
         lease_owner = null,
         lease_expires_at = null,
         next_attempt_at = null,
         finished_at = v_now,
         updated_at = v_now
   where job.id = p_job_id
     and job.status = 'processing'
     and job.lease_token = p_lease_token
     and job.lease_expires_at > v_now;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.claim_ai_job_v1(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_ai_job_v1(text, integer, integer, integer)
  to service_role;

revoke all on function public.complete_ai_job_v1(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_ai_job_v1(uuid, uuid, jsonb)
  to service_role;
