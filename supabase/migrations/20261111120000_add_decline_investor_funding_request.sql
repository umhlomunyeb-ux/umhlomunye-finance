alter table public.investor_funding_requests
  add column if not exists decline_reason text,
  add column if not exists declined_by uuid references public.users(id),
  add column if not exists declined_at timestamptz;

create or replace function public.decline_investor_funding_request(
  p_request_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.investor_funding_requests%rowtype;
begin
  if not public.current_user_is_active_admin() then
    raise exception 'Only an active Administrator can decline a funding request.';
  end if;

  select * into v_request
  from public.investor_funding_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Funding request not found.';
  end if;

  if v_request.status <> 'REQUESTED'
     or v_request.borrowing_id is not null
     or v_request.received_at is not null then
    raise exception 'This funding request can no longer be declined.';
  end if;

  update public.investor_funding_requests
  set status = 'CANCELLED',
      decline_reason = nullif(trim(coalesce(p_reason, '')), ''),
      declined_by = auth.uid(),
      declined_at = now(),
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'status', 'CANCELLED'
  );
end;
$$;

revoke all on function public.decline_investor_funding_request(uuid,text) from public;
grant execute on function public.decline_investor_funding_request(uuid,text) to authenticated;
