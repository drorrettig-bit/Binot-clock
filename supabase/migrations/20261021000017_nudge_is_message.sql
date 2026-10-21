-- נדנוד הוא הודעה רגילה לאדם אחד, לא ביקורת: בלי צורך באישור ובלי זמן תפוגה.
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
  insert into public.spot_checks (kind, title, body, target_user, created_by, target_count)
  values ('message', coalesce(nullif(btrim(p_title), ''), 'תזכורת מהישיבה'),
          coalesce(nullif(btrim(p_body), ''), 'נא לדווח נוכחות באפליקציה'),
          p_user_id, auth.uid(), 1)
  returning id into v_id;
  return v_id;
end;
$$;
