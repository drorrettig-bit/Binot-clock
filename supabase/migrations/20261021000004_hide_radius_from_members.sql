-- הרדיוס, המרחק ונקודת הישיבה גלויים למנהלים בלבד.
-- משתמש רגיל מקבל רק אם הדיווח אושר או נדחה ולמה, בלי מספרים.

-- 1. הגדרות הישיבה: קריאה למנהלים בלבד
drop policy if exists org_select on public.organization_settings;
create policy org_select on public.organization_settings for select to authenticated
  using ((select public.is_admin()));

-- 2. יומן הנוכחות: משתמש רגיל לא יכול לקרוא עמודות מיקום, מרחק ורדיוס
revoke select on public.attendance_logs from authenticated;
grant select (id, user_id, action, status, source, recorded_at, note, created_by)
  on public.attendance_logs to authenticated;

-- 3. חיפוש היומן: רץ בהרשאות מוגברות כדי להחזיר מרחק למנהל.
--    משתמש רגיל מקבל רק את השורות שלו, בלי מרחק.
create or replace function public.search_attendance(
  p_query           text default null,
  p_member_type     public.member_type default null,
  p_from            date default null,
  p_to              date default null,
  p_status          public.attendance_status default 'approved',
  p_include_inactive boolean default true,
  p_limit           int default 100,
  p_offset          int default 0
)
returns table (
  log_id bigint, user_id uuid, national_id text, full_name text, member_type public.member_type,
  is_active boolean, action public.attendance_action, status public.attendance_status,
  source public.attendance_source, recorded_at timestamptz, distance_m real, note text, total_count bigint
)
language sql stable security definer set search_path = '' as $$
  with me as (select public.is_admin() as admin, auth.uid() as uid)
  select l.id, l.user_id, p.national_id, p.full_name, p.member_type, p.is_active,
         l.action, l.status, l.source, l.recorded_at,
         case when me.admin then l.distance_m end,
         l.note,
         count(*) over () as total_count
  from public.attendance_logs l
  join public.profiles p on p.id = l.user_id
  cross join me
  where (me.admin or l.user_id = me.uid)
    and me.uid is not null
    and (p_query is null or p_query = ''
         or p.national_id = p_query
         or p.full_name ilike '%' || p_query || '%')
    and (p_member_type is null or p.member_type = p_member_type)
    and (p_status is null or l.status = p_status)
    and (p_include_inactive or p.is_active)
    and (p_from is null or l.recorded_at >= (p_from::timestamp at time zone 'Asia/Jerusalem'))
    and (p_to   is null or l.recorded_at <  ((p_to + 1)::timestamp at time zone 'Asia/Jerusalem'))
  order by l.recorded_at desc
  limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0);
$$;

-- 4. הדיווח: מחזיר מרחק ורדיוס רק למנהל
create or replace function public.report_attendance(
  p_action      public.attendance_action,
  p_lat         double precision,
  p_lng         double precision,
  p_accuracy_m  real default null,
  p_user_agent  text default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_profile   public.profiles%rowtype;
  v_org       public.organization_settings%rowtype;
  v_last      public.attendance_logs%rowtype;
  v_last_any  timestamptz;
  v_today     date;
  v_last_today boolean;
  v_distance  double precision;
  v_status    public.attendance_status := 'approved';
  v_row       public.attendance_logs%rowtype;
  v_result    jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found or not v_profile.onboarding_completed then
    raise exception 'profile incomplete' using errcode = 'PT409';
  end if;

  select * into v_org from public.organization_settings where id = 1;
  if not found then
    raise exception 'organization not configured' using errcode = 'PT503';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select max(recorded_at) into v_last_any from public.attendance_logs where user_id = v_uid;
  if v_last_any is not null
     and v_last_any > now() - make_interval(secs => v_org.min_seconds_between_reports) then
    raise exception 'too many requests' using errcode = 'PT429';
  end if;

  v_distance := extensions.st_distance(
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
    extensions.st_setsrid(extensions.st_makepoint(v_org.longitude, v_org.latitude), 4326)::extensions.geography
  );

  v_today := (now() at time zone v_org.timezone)::date;
  select * into v_last from public.attendance_logs
    where user_id = v_uid and status = 'approved'
    order by recorded_at desc limit 1;
  v_last_today := v_last.id is not null
                  and (v_last.recorded_at at time zone v_org.timezone)::date = v_today;

  if not v_profile.is_active then
    v_status := 'rejected_inactive';
  elsif p_accuracy_m is null or p_accuracy_m > v_org.max_gps_accuracy_m then
    v_status := 'rejected_accuracy';
  elsif v_distance > v_org.allowed_radius_m then
    v_status := 'rejected_distance';
  elsif p_action = 'check_in' and v_last_today and v_last.action = 'check_in' then
    v_status := 'rejected_sequence';
  elsif p_action = 'check_out' and not (v_last_today and v_last.action = 'check_in') then
    v_status := 'rejected_sequence';
  end if;

  insert into public.attendance_logs (
    user_id, action, status, source, latitude, longitude,
    gps_accuracy_m, distance_m, allowed_radius_m, created_by, user_agent
  ) values (
    v_uid, p_action, v_status, 'gps', p_lat, p_lng,
    p_accuracy_m, round(v_distance::numeric, 1), v_org.allowed_radius_m, v_uid, left(p_user_agent, 300)
  )
  returning * into v_row;

  v_result := jsonb_build_object(
    'id',          v_row.id,
    'status',      v_row.status,
    'action',      v_row.action,
    'recorded_at', v_row.recorded_at
  );
  if v_profile.access_role = 'admin' then
    v_result := v_result || jsonb_build_object('distance_m', v_row.distance_m, 'allowed_radius_m', v_row.allowed_radius_m);
  end if;
  return v_result;
end;
$$;

-- 5. שם הישיבה בלבד, לכל משתמש מחובר (בלי מיקום ורדיוס)
create or replace function public.org_display_name()
returns text language sql stable security definer set search_path = '' as $$
  select name from public.organization_settings where id = 1;
$$;
revoke execute on function public.org_display_name() from public, anon;
grant execute on function public.org_display_name() to authenticated;
