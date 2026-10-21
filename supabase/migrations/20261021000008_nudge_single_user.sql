-- נדנוד: ביקורת נוכחות שנשלחת למשתמש אחד בלבד
alter table public.spot_checks add column target_user uuid references public.profiles(id);
create index spot_checks_target_user on public.spot_checks (target_user) where target_user is not null;
grant select (target_user) on public.spot_checks to authenticated;

alter policy spot_checks_select on public.spot_checks
  using (
    (select public.is_admin())
    or (
      (target_user is null or target_user = (select auth.uid()))
      and (target_role is null or target_role = (select member_type from public.profiles where id = (select auth.uid())))
    )
  );

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
  values ('audit', coalesce(nullif(btrim(p_title), ''), 'תזכורת: נא לאשר נוכחות'), nullif(btrim(p_body), ''),
          p_user_id, auth.uid(), now() + make_interval(mins => p_minutes), 1)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.admin_create_nudge(uuid, text, text, integer) from public, anon;
grant execute on function public.admin_create_nudge(uuid, text, text, integer) to authenticated;

create or replace function public.respond_spot_check(
  p_check_id bigint, p_lat double precision, p_lng double precision, p_accuracy_m real default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_check public.spot_checks%rowtype;
  v_org public.organization_settings%rowtype;
  v_distance double precision;
  v_result public.spot_check_result;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  if not found or not v_profile.is_active or not v_profile.onboarding_completed then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_check from public.spot_checks where id = p_check_id;
  if not found or v_check.kind <> 'audit' then
    raise exception 'check not found' using errcode = 'PT404';
  end if;
  if (v_check.target_role is not null and v_check.target_role is distinct from v_profile.member_type)
     or (v_check.target_user is not null and v_check.target_user <> v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if now() > v_check.expires_at then
    raise exception 'check expired' using errcode = 'PT410';
  end if;

  select * into v_org from public.organization_settings where id = 1;
  v_distance := extensions.st_distance(
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
    extensions.st_setsrid(extensions.st_makepoint(v_org.longitude, v_org.latitude), 4326)::extensions.geography);

  v_result := case
    when p_accuracy_m is null or p_accuracy_m > v_org.max_gps_accuracy_m then 'low_accuracy'
    when v_distance <= v_org.allowed_radius_m then 'present'
    else 'away' end;

  insert into public.spot_check_responses (check_id, user_id, result, latitude, longitude, gps_accuracy_m, distance_m)
  values (p_check_id, v_uid, v_result, p_lat, p_lng, p_accuracy_m, round(v_distance::numeric, 1))
  on conflict (check_id, user_id) do update
    set result = excluded.result, latitude = excluded.latitude, longitude = excluded.longitude,
        gps_accuracy_m = excluded.gps_accuracy_m, distance_m = excluded.distance_m, responded_at = now()
    where public.spot_check_responses.result = 'low_accuracy';

  return jsonb_build_object('result',
    (select result from public.spot_check_responses where check_id = p_check_id and user_id = v_uid));
end;
$$;

create or replace function public.admin_spot_check_report(p_check_id bigint)
returns table (user_id uuid, full_name text, national_id text, member_type public.member_type,
               has_device boolean, responded_at timestamptz, result public.spot_check_result, distance_m real)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.national_id, p.member_type,
         exists (select 1 from public.push_subscriptions s where s.user_id = p.id),
         r.responded_at, r.result, r.distance_m
  from public.spot_checks c
  join public.profiles p
    on p.onboarding_completed
   and (c.target_role is null or p.member_type = c.target_role)
   and (c.target_user is null or p.id = c.target_user)
   and (p.created_at <= c.created_at or p.id = c.target_user)
  left join public.spot_check_responses r on r.check_id = c.id and r.user_id = p.id
  where c.id = p_check_id and public.is_admin()
    and (p.is_active or r.user_id is not null)
  order by (r.result is null) desc, r.result, p.full_name;
$$;
