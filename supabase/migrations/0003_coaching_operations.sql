create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  direction text not null,
  channel text not null,
  message_type text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coach_messages_user_created_at_idx on public.coach_messages(user_id, created_at desc);

create table public.coach_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  report_type text not null,
  period_start date not null,
  period_end date not null,
  facts_json jsonb not null,
  report_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, report_type, period_start, period_end),
  check (period_end >= period_start)
);

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_type text not null,
  provider text not null,
  status text not null,
  attempts integer not null default 0 check (attempts >= 0),
  input_ref text,
  output_json jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_jobs_status_created_at_idx on public.ai_jobs(status, created_at);
create index ai_jobs_user_created_at_idx on public.ai_jobs(user_id, created_at desc);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,
  model text not null,
  task_type text not null,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost numeric(14,6) check (estimated_cost is null or estimated_cost >= 0),
  units integer not null default 0 check (units >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_usage_user_created_at_idx on public.ai_usage(user_id, created_at desc);

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  task_type text not null,
  version text not null,
  prompt_text text not null,
  schema_version text not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_type, version)
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  event_type text not null,
  payload_hash text not null,
  processed_at timestamptz,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index webhook_events_status_created_at_idx on public.webhook_events(status, created_at);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notifications_status_scheduled_for_idx on public.notifications(status, scheduled_for);
create index notifications_user_scheduled_for_idx on public.notifications(user_id, scheduled_for desc);

alter table public.coach_messages enable row level security;
alter table public.coach_reports enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.ai_usage enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.webhook_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

create policy coach_messages_read_own on public.coach_messages for select to authenticated using (user_id = auth.uid());
create policy coach_reports_read_own on public.coach_reports for select to authenticated using (user_id = auth.uid());
create policy ai_jobs_read_own on public.ai_jobs for select to authenticated using (user_id = auth.uid());
create policy ai_usage_read_own on public.ai_usage for select to authenticated using (user_id = auth.uid());
create policy notifications_read_own on public.notifications for select to authenticated using (user_id = auth.uid());

-- prompt_versions, webhook_events, and audit_logs intentionally have no authenticated policy.
-- They are private operational tables and are accessed by the service-role worker only.

grant select on public.coach_messages, public.coach_reports, public.ai_jobs, public.ai_usage, public.notifications to authenticated;
grant all on public.coach_messages, public.coach_reports, public.ai_jobs, public.ai_usage, public.prompt_versions, public.webhook_events, public.audit_logs, public.notifications to service_role;
