-- היסטוריית התראות וביקורות לא נשמרת לתמיד. ברירת מחדל: 30 יום, ניתן לשינוי בהגדרות.
-- נמחקות ההתראות ותשובות הביקורת (cascade). דיווחי הנוכחות לא נמחקים.
alter table public.organization_settings
  add column notification_retention_days integer not null default 30
  check (notification_retention_days between 1 and 365);

create or replace function public.purge_old_spot_checks()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_days integer; v_count integer;
begin
  select notification_retention_days into v_days from public.organization_settings where id = 1;
  delete from public.spot_checks where created_at < now() - make_interval(days => coalesce(v_days, 30));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.purge_old_spot_checks() from public, anon, authenticated;
