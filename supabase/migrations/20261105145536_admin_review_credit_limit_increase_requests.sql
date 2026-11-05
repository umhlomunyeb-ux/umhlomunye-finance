grant select on table public.credit_limit_increase_requests to authenticated;
grant update (status, admin_notes, reviewed_by, reviewed_at, updated_at) on table public.credit_limit_increase_requests to authenticated;
drop policy if exists "Active admins can view credit limit increase requests" on public.credit_limit_increase_requests;
create policy "Active admins can view credit limit increase requests"
on public.credit_limit_increase_requests for select to authenticated
using (public.current_user_is_active_admin());
drop policy if exists "Active admins can update credit limit increase requests" on public.credit_limit_increase_requests;
create policy "Active admins can update credit limit increase requests"
on public.credit_limit_increase_requests for update to authenticated
using (public.current_user_is_active_admin())
with check (public.current_user_is_active_admin());

create or replace function public.review_credit_limit_increase_request(
  p_request_id uuid,
  p_approved boolean,
  p_admin_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_request public.credit_limit_increase_requests%rowtype;
begin
  if auth.uid() is null or not public.current_user_is_active_admin() then
    raise exception 'Only an active administrator can review credit-limit requests.';
  end if;
  select * into v_request from public.credit_limit_increase_requests where id = p_request_id for update;
  if not found then raise exception 'Credit-limit request not found.'; end if;
  if v_request.status <> 'PENDING' then raise exception 'This credit-limit request has already been reviewed.'; end if;
  if p_approved then
    if v_request.requested_credit_limit <= v_request.current_credit_limit or v_request.requested_credit_limit > 6000 then
      raise exception 'Requested credit limit is outside the permitted range.';
    end if;
    update public.customers set credit_limit = v_request.requested_credit_limit, updated_at = now()
    where id = v_request.customer_id;
  end if;
  update public.credit_limit_increase_requests
  set status = case when p_approved then 'APPROVED' else 'REJECTED' end,
      admin_notes = nullif(trim(coalesce(p_admin_notes,'')), ''),
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_request_id;
  return jsonb_build_object('success', true,
    'status', case when p_approved then 'APPROVED' else 'REJECTED' end,
    'customer_id', v_request.customer_id,
    'credit_limit', case when p_approved then v_request.requested_credit_limit else v_request.current_credit_limit end);
end;
$$;
revoke all on function public.review_credit_limit_increase_request(uuid,boolean,text) from public, anon;
grant execute on function public.review_credit_limit_increase_request(uuid,boolean,text) to authenticated;