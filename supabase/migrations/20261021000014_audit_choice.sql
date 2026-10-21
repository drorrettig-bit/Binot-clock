-- תשובה לביקורת עם בחירה: present (נבדק מיקום) / on_the_way (מיקום אם יש) / absent (בלי מיקום).
-- אפשר לעדכן תשובה שהייתה "אות חלש", "בדרך" או "לא נוכח". "בישיבה" ו"טען נוכח אבל בחוץ" ננעלות.
create or replace function public.respond_spot_check_choice(
  p_check_id bigint, p_choice text,
  p_lat double precision default null, p_lng double precision default null, p_accuracy_m real default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_check public.spot_checks%rowtype;
  v_org public.organization_settings%rowtype;
  v_prev public.spot_check_result;
  v_distance double precision;
  v_result public.spot_check_result;
  v_has_pos boolean := p_lat is not null and p_lng is not null;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_choice not in ('present', 'on_the_way', 'absent') then
    raise exception 'invalid choice' using errcode = '22023';
  end if;
  if v_has_pos and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  if p_choice = 'present' and not v_has_pos then
    raise exception 'location required' using errcode = '22023';
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

  select result into v_prev from public.spot_check_responses where check_id = p_check_id and user_id = v_uid;
  if v_prev in ('present', 'away') then
    return jsonb_build_object('result', v_prev, 'locked', true);
  end if;

  select * into v_org from public.organization_settings where id = 1;
  if v_has_pos then
    v_distance := extensions.st_distance(
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
      extensions.st_setsrid(extensions.st_makepoint(v_org.longitude, v_org.latitude), 4326)::extensions.geography);
  end if;

  v_result := case p_choice
    when 'absent' then 'absent'
    when 'on_the_way' then 'on_the_way'
    else case
      when p_accuracy_m is null or p_accuracy_m > v_org.max_gps_accuracy_m then 'low_accuracy'
      when v_distance <= v_org.allowed_radius_m then 'present'
      else 'away' end
  end::public.spot_check_result;

  insert into public.spot_check_responses (check_id, user_id, result, latitude, longitude, gps_accuracy_m, distance_m)
  values (p_check_id, v_uid, v_result, p_lat, p_lng, p_accuracy_m, case when v_has_pos then round(v_distance::numeric, 1) end)
  on conflict (check_id, user_id) do update
    set result = excluded.result, latitude = excluded.latitude, longitude = excluded.longitude,
        gps_accuracy_m = excluded.gps_accuracy_m, distance_m = excluded.distance_m, responded_at = now();

  return jsonb_build_object('result', v_result, 'locked', false);
end;
$$;
revoke execute on function public.respond_spot_check_choice(bigint, text, double precision, double precision, real) from public, anon;
grant execute on function public.respond_spot_check_choice(bigint, text, double precision, double precision, real) to authenticated;
