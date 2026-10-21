-- כותרת הנדנוד זהה לכותרת הביקורת: "🔴 ביקורת" (העיגול האדום מתווסף בטלפון)
create or replace function public.admin_create_nudge(
  p_user_id uuid, p_title text default null, p_body text default null, p_minutes integer default 15)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_user public.profiles%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_user from public.profiles where id = p_user_id;
  if not found or not v_user.is_active or not v_user.onboarding_completed then
    raise exception 'המשתמש לא פעיל או לא השלים הרשמה' using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes not between 1 and 240 then
    raise exception 'זמן התגובה צריך להיות בין דקה ל-4 שעות' using errcode = '22023';
  end if;
  insert into public.spot_checks (kind, title, body, target_user, created_by, expires_at, target_count)
  values ('audit', coalesce(nullif(btrim(p_title), ''), 'ביקורת'), coalesce(nullif(btrim(p_body), ''), 'לחצו עכשיו לאישור נוכחות'),
          p_user_id, auth.uid(), now() + make_interval(mins => p_minutes), 1)
  returning id into v_id;
  return v_id;
end;
$$;
