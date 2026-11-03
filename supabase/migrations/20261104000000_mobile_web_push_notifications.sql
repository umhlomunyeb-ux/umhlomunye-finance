-- Add standards-based Web Push delivery to the existing mobile funding alerts.
-- In-app notification table and funding/top-up triggers are already created by
-- 20261103221000_mobile_funding_notifications.sql. This migration deliberately
-- reuses that notification function so alerts are not duplicated.

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
  -- In-app alerts remain available before the external push configuration is complete.
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

-- Existing funding/top-up triggers call this function. Extending it adds OS push
-- delivery without creating duplicate notification rows or duplicate triggers.
create or replace function public.enqueue_mobile_funding_notification(
  p_event_key text,
  p_notification_type text,
  p_title text,
  p_message text,
  p_data jsonb
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
    and coalesce(u.is_active,true)=true
    and coalesce(u.is_deleted,false)=false
  on conflict(user_id,event_key) do nothing;

  perform public.dispatch_admin_web_push(jsonb_build_object(
    'event_key',p_event_key,
    'title',p_title,
    'body',p_message,
    'url','/mobile/funding-requests',
    'data',coalesce(p_data,'{}'::jsonb)
  ));
end;
$$;
revoke all on function public.enqueue_mobile_funding_notification(text,text,text,text,jsonb) from public,authenticated;
