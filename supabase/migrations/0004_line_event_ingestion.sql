create or replace function public.ingest_line_event_v1(
  p_provider_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_user_id uuid,
  p_task_type text,
  p_input_ref text
)
returns table (
  inserted boolean,
  webhook_event_id uuid,
  ai_job_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_webhook_event_id uuid;
  v_ai_job_id uuid;
begin
  insert into public.webhook_events (
    provider_event_id,
    event_type,
    payload_hash,
    status
  )
  values (
    p_provider_event_id,
    p_event_type,
    p_payload_hash,
    'queued'
  )
  on conflict (provider_event_id) do nothing
  returning id into v_webhook_event_id;

  if v_webhook_event_id is null then
    select id
      into v_webhook_event_id
      from public.webhook_events
     where provider_event_id = p_provider_event_id;

    return query
    select false, v_webhook_event_id, null::uuid;
    return;
  end if;

  insert into public.ai_jobs (
    user_id,
    task_type,
    provider,
    status,
    input_ref
  )
  values (
    p_user_id,
    p_task_type,
    'line',
    'queued',
    p_input_ref
  )
  returning id into v_ai_job_id;

  return query
  select true, v_webhook_event_id, v_ai_job_id;
end;
$$;

revoke all on function public.ingest_line_event_v1(text, text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_line_event_v1(text, text, text, uuid, text, text)
  to service_role;
