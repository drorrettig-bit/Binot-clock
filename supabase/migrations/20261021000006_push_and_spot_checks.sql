-- התראות Push וביקורות נוכחות
-- מנהל שולח הודעה או "ביקורת נוכחות". בביקורת, כל משתמש מאשר נוכחות עם מיקום,
-- והמנהל רואה מי בישיבה, מי לא, ומי לא הגיב.

create type public.spot_check_kind as enum ('message', 'audit');
create type public.spot_check_result as enum ('present', 'away', 'low_accuracy');

-- מכשירים שנרשמו לקבלת התראות
create table public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant update (p256dh, auth, user_agent) on public.push_subscriptions to authenticated;
create policy push_own_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy push_own_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy push_own_update on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_own_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- הודעות וביקורות שנשלחו
create table public.spot_checks (
  id            bigint generated always as identity primary key,
  kind          public.spot_check_kind not null,
  title         text not null check (char_length(btrim(title)) between 1 and 80),
  body          text check (body is null or char_length(body) <= 300),
  target_role   public.member_type,                 -- null = כולם
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,                        -- רק לביקורת
  target_count  integer not null default 0,
  device_count  integer,
  sent_count    integer,
  failed_count  integer,
  constraint audit_has_expiry check (kind <> 'audit' or expires_at is not null)
);
create index spot_checks_created on public.spot_checks (created_at desc);
create index spot_checks_created_by on public.spot_checks (created_by);

alter table public.spot_checks enable row level security;
revoke all on public.spot_checks from anon, authenticated;
grant select (id, kind, title, body, target_role, created_at, expires_at) on public.spot_checks to authenticated;
create policy spot_checks_select on public.spot_checks for select to authenticated
  using (
    (select public.is_admin())
    or (target_role is null or target_role = (select member_type from public.profiles where id = (select auth.uid())))
  );

-- תגובות לביקורת
create table public.spot_check_responses (
  check_id      bigint not null references public.spot_checks(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  responded_at  timestamptz not null default now(),
  result        public.spot_check_result not null,
  latitude      double precision,
  longitude     double precision,
  gps_accuracy_m real,
  distance_m    real,
  primary key (check_id, user_id)
);
create index spot_check_responses_user on public.spot_check_responses (user_id);

alter table public.spot_check_responses enable row level security;
revoke all on public.spot_check_responses from anon, authenticated;
grant select (check_id, user_id, responded_at, result) on public.spot_check_responses to authenticated;
create policy responses_select on public.spot_check_responses for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- יצירת הודעה או ביקורת (מנהל בלבד). השליחה עצמה נעשית בפונקציית השרת send-push.
create or replace function public.admin_create_spot_check(
  p_kind public.spot_check_kind, p_title text, p_body text default null,
  p_target_role public.member_type default null, p_minutes integer default 15)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_targets integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'חובה לכתוב כותרת' using errcode = '22023';
  end if;
  if p_kind = 'audit' and (p_minutes is null or p_minutes not between 1 and 240) then
    raise exception 'זמן התגובה צריך להיות בין דקה ל-4 שעות' using errcode = '22023';
  end if;
  select count(*) into v_targets from public.profiles
    where is_active and onboarding_completed and (p_target_role is null or member_type = p_target_role);
  insert into public.spot_checks (kind, title, body, target_role, created_by, expires_at, target_count)
  values (p_kind, btrim(p_title), nullif(btrim(p_body), ''), p_target_role, auth.uid(),
          case when p_kind = 'audit' then now() + make_interval(mins => p_minutes) end, v_targets)
  returning id into v_id;
  return v_id;
end;
$$;

-- אישור נוכחות בביקורת. מחזיר רק את התוצאה, בלי מרחק ורדיוס.
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
  if v_check.target_role is not null and v_check.target_role is distinct from v_profile.member_type then
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

  -- תגובה ראשונה נשמרת. אפשר לנסות שוב רק אם האות היה חלש.
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

-- דוח ביקורת למנהל: כל מי שהביקורת נשלחה אליו, ומה ענה
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
   and p.created_at <= c.created_at
  left join public.spot_check_responses r on r.check_id = c.id and r.user_id = p.id
  where c.id = p_check_id and public.is_admin()
    and (p.is_active or r.user_id is not null)
  order by (r.result is null) desc, r.result, p.full_name;
$$;

revoke execute on function
  public.admin_create_spot_check(public.spot_check_kind, text, text, public.member_type, integer),
  public.respond_spot_check(bigint, double precision, double precision, real),
  public.admin_spot_check_report(bigint)
from public, anon;
grant execute on function
  public.admin_create_spot_check(public.spot_check_kind, text, text, public.member_type, integer),
  public.respond_spot_check(bigint, double precision, double precision, real),
  public.admin_spot_check_report(bigint)
to authenticated;
