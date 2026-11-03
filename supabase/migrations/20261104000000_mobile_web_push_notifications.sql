-- Mobile admin in-app alerts and iPhone/iPad Web Push subscriptions.
-- The push sender URL and webhook secret are stored in Supabase Vault, not in source code.

create table if not exists public.mobile_admin_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null,
  event_key text not null,
  title text not null,
  message text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,event_key)
);
create index if not exists idx_mobile_admin_notifications_user_unread
  on public.mobile_admin_notifications(user_id,created_at desc) where read_at is null;
alter table public.mobile_admin_notifications enable row level security;
grant select,update on public.mobile_admin_notifications to authenticated;
drop policy if exists "Admins read own mobile notifications" on public.mobile_admin_notifications;
create policy "Admins read own mobile notifications" on public.mobile_admin_notifications
  for select to authenticated using (
    user_id=auth.uid() and exists (
      select 1 from public.users u where u.id=auth.uid()
        and lower(coalesce(u.role,''))='admin' and u.is_active=true and coalesce(u.is_deleted,false)=false
    )
  );
drop policy if exists "Admins update own mobile notifications" on public.mobile_admin_notifications;
create policy "Admins update own mobile notifications" on public.mobile_admin_notifications
  for update to authenticated using (
    user_id=auth.uid() and exists (
      select 1 from public.users u where u.id=auth.uid()
        and lower(coalesce(u.role,''))='admin' and u.is_active=true and coalesce(u.is_deleted,false)=false
    )
  ) with check (user_id=auth.uid());

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_web_push_subscriptions_user_active
  on public.web_push_subscriptions(user_id) where is_active=true;
alter table public.web_push_subscriptions enable row level security;
grant select,insert,update,delete on public.web_push_subscriptions to authenticated;
drop policy if exists "Admins manage own web push subscriptions" on public.web_push_subscriptions;
create policy "Admins manage own web push subscriptions" on public.web_push_subscriptions
  for all to authenticated using (
    user_id=auth.uid() and exists (
      select 1 from public.users u where u.id=auth.uid()
        and lower(coalesce(u.role,''))='admin' and u.is_active=true and coalesce(u.is_deleted,false)=false
    )
  ) with check (
    user_id=auth.uid() and exists (
      select 1 from public.users u where u.id=auth.uid()
        and lower(coalesce(u.role,''))='admin' and u.is_active=true and coalesce(u.is_deleted,false)=false
    )
  );

create or replace function public.dispatch_admin_web_push(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path=public,vault,net
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name='web_push_function_url' limit 1;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name='web_push_webhook_secret' limit 1;
  -- In-app alerts remain available even before external push secrets are configured.
  if coalesce(v_url,'')='' or coalesce(v_secret,'')='' then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-webhook-secret',v_secret
    ),
    body := p_payload,
    timeout_milliseconds := 5000
  );
exception when others then
  raise warning 'Unable to dispatch mobile web push: %',sqlerrm;
end;
$$;
revoke all on function public.dispatch_admin_web_push(jsonb) from public,authenticated;

create or replace function public.enqueue_mobile_admin_funding_alert(
  p_event_key text,p_notification_type text,p_title text,p_message text,p_data jsonb
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.mobile_admin_notifications(
    user_id,notification_type,event_key,title,message,data
  )
  select u.id,p_notification_type,p_event_key,p_title,p_message,coalesce(p_data,'{}'::jsonb)
  from public.users u
  where lower(coalesce(u.role,''))='admin'
    and u.is_active=true and coalesce(u.is_deleted,false)=false
  on conflict(user_id,event_key) do nothing;

  perform public.dispatch_admin_web_push(jsonb_build_object(
    'event_key',p_event_key,'title',p_title,'body',p_message,
    'url','/mobile/funding-requests','data',coalesce(p_data,'{}'::jsonb)
  ));
end;
$$;
revoke all on function public.enqueue_mobile_admin_funding_alert(text,text,text,text,jsonb) from public,authenticated;

create or replace function public.notify_investor_funding_request_admins()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_notify boolean := false;
begin
  if tg_op='INSERT' then
    v_notify := new.status='REQUESTED';
  else
    v_notify := new.status='REQUESTED' and old.status is distinct from new.status;
  end if;
  if v_notify then
    perform public.enqueue_mobile_admin_funding_alert(
      'investor-funding:'||new.id::text,
      'INVESTOR_FUNDING_REQUEST',
      'Investor funding required',
      'Application '||coalesce(new.application_number,'')||' requires investor funding of R'||to_char(coalesce(new.funding_shortfall,0),'FM999999990.00')||'.',
      jsonb_build_object(
        'request_id',new.id,'application_id',new.application_id,
        'application_number',new.application_number,
        'customer_name',new.customer_name,
        'funding_shortfall',new.funding_shortfall
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_investor_funding_request_admins on public.investor_funding_requests;
create trigger trg_notify_investor_funding_request_admins
after insert or update of status on public.investor_funding_requests
for each row execute function public.notify_investor_funding_request_admins();

create or replace function public.notify_top_up_funding_admins()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_notify boolean := false;
  v_loan_number text;
  v_customer_name text;
begin
  if tg_op='INSERT' then
    v_notify := new.status='WAITING_FOR_FUNDS';
  else
    v_notify := new.status='WAITING_FOR_FUNDS' and old.status is distinct from new.status;
  end if;
  if v_notify then
    select l.loan_number,trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))
      into v_loan_number,v_customer_name
    from public.loans l left join public.customers c on c.id=l.customer_id
    where l.id=new.loan_id;
    perform public.enqueue_mobile_admin_funding_alert(
      'top-up-funding:'||new.id::text,
      'LOAN_TOP_UP_FUNDING',
      'Approved top-up waiting for funds',
      'Loan '||coalesce(v_loan_number,new.loan_id::text)||' for '||coalesce(nullif(v_customer_name,''),'customer')
        ||' is approved and requires R'||to_char(new.requested_amount,'FM999999990.00')||' for disbursement.',
      jsonb_build_object('top_up_request_id',new.id,'loan_id',new.loan_id,
        'loan_number',v_loan_number,'customer_name',v_customer_name,
        'requested_amount',new.requested_amount)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_top_up_funding_admins on public.loan_top_up_requests;
create trigger trg_notify_top_up_funding_admins
after insert or update of status on public.loan_top_up_requests
for each row execute function public.notify_top_up_funding_admins();

do $$
begin
  alter publication supabase_realtime add table public.mobile_admin_notifications;
exception when duplicate_object then null;
when undefined_object then raise notice 'supabase_realtime publication is not available; in-app alerts will still load on refresh.';
end $$;
