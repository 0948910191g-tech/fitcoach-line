-- Task 5 architecture decision:
-- LINE Web Login uses Supabase Custom OAuth2 provider `custom:line-oauth`.
-- Keep the existing auth.uid() -> public.users.auth_user_id bridge.
-- Only trust the provider identity written by Supabase Auth; callers cannot
-- provide or override the LINE subject.

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
     and i.provider = 'custom:line-oauth';

  if v_identity_count <> 1
     or v_provider_id is null
     or length(v_provider_id) = 0 then
    raise exception 'trusted custom:line-oauth identity required';
  end if;

  select *
    into v_user
    from public.users u
   where u.line_user_id = v_provider_id
   for update;

  if not found then
    raise exception 'LINE subject is not mapped to an app user';
  end if;

  if v_user.auth_user_id is not null
     and v_user.auth_user_id <> v_auth_user_id then
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
  select
    v_user.id,
    v_user.auth_user_id,
    v_provider,
    v_provider_id,
    v_user.line_user_id;
end;
$$;

revoke all on function public.link_line_identity_v1() from public, anon;
grant execute on function public.link_line_identity_v1() to authenticated;
