-- =====================================================================
-- מערכת נוכחות לישיבה | מיגרציה 001: סכמה, RLS, RBAC, אימות מרחק
-- יעד: Supabase (PostgreSQL 15+). להריץ ב-SQL Editor או כ-migration.
-- =====================================================================

-- ---------- 0. הרחבות ----------
create extension if not exists postgis  with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- ---------- 1. טיפוסים ----------
create type public.member_type       as enum ('avrech', 'student', 'employee', 'rabbi');   -- תפקיד במוסד
create type public.access_role       as enum ('member', 'admin');                          -- הרשאת מערכת (RBAC)
create type public.attendance_action as enum ('check_in', 'check_out');
create type public.attendance_status as enum (
  'approved',
  'rejected_distance',   -- מחוץ לרדיוס
  'rejected_accuracy',   -- דיוק GPS גרוע מדי / חסר
  'rejected_sequence',   -- כניסה כפולה / יציאה בלי כניסה
  'rejected_inactive'    -- משתמש מושבת
);
create type public.attendance_source as enum ('gps', 'admin_manual');

-- ---------- 2. ולידציית ת.ז ישראלית (9 ספרות + ספרת ביקורת) ----------
-- הפרונט מרפד אפסים משמאל לפני השליחה (למשל 12345678 -> 012345678)
create or replace function public.is_valid_israeli_id(p_id text)
returns boolean
language plpgsql immutable strict
set search_path = ''
as $$
declare
  s int := 0;
  d int;
begin
  if p_id !~ '^\d{9}$' or p_id = '000000000' then
    return false;
  end if;
  for i in 1..9 loop
    d := substr(p_id, i, 1)::int * (case when i % 2 = 1 then 1 else 2 end);
    s := s + case when d > 9 then d - 9 else d end;
  end loop;
  return s % 10 = 0;
end;
$$;

-- ---------- 3. הגדרות ארגון (שורה יחידה) ----------
create table public.organization_settings (
  id                          smallint primary key default 1 check (id = 1),
  name                        text not null,
  latitude                    double precision not null check (latitude  between -90  and 90),
  longitude                   double precision not null check (longitude between -180 and 180),
  allowed_radius_m            integer not null default 150 check (allowed_radius_m between 20 and 2000),
  max_gps_accuracy_m          integer not null default 100 check (max_gps_accuracy_m between 5 and 1000),
  min_seconds_between_reports integer not null default 30  check (min_seconds_between_reports between 0 and 3600),
  timezone                    text not null default 'Asia/Jerusalem',
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references auth.users(id)
);

-- ---------- 4. פרופילים ----------
create table public.profiles (
  id                    uuid primary key references auth.users(id) on delete restrict, -- אין מחיקה קשה
  email                 text not null,
  first_name            text check (first_name is null or char_length(btrim(first_name)) between 1 and 50),
  last_name             text check (last_name  is null or char_length(btrim(last_name))  between 1 and 50),
  national_id           text unique
                        check (national_id is null or public.is_valid_israeli_id(national_id)),
  member_type           public.member_type,
  access_role           public.access_role not null default 'member',
  is_active             boolean not null default true,
  deactivated_at        timestamptz,
  deactivated_by        uuid references public.profiles(id),
  deactivation_reason   text,
  full_name             text generated always as
                        (btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) stored,
  onboarding_completed  boolean generated always as
                        (first_name is not null and last_name is not null
                         and national_id is not null and member_type is not null) stored,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint deactivation_consistency check (is_active or deactivated_at is not null)
);

create index profiles_full_name_trgm on public.profiles using gin (full_name extensions.gin_trgm_ops);
create index profiles_active_type    on public.profiles (member_type) where is_active;
-- national_id: מאונדקס דרך ה-UNIQUE

-- ---------- 5. לוג נוכחות (append-only) ----------
create table public.attendance_logs (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles(id) on delete restrict,
  action           public.attendance_action not null,
  status           public.attendance_status not null,
  source           public.attendance_source not null default 'gps',
  recorded_at      timestamptz not null default now(),          -- זמן שרת בלבד
  latitude         double precision check (latitude  between -90  and 90),
  longitude        double precision check (longitude between -180 and 180),
  gps_accuracy_m   real,
  distance_m       real,
  allowed_radius_m integer,                                     -- snapshot של הרדיוס בזמן הדיווח
  created_by       uuid not null references public.profiles(id),
  note             text,
  user_agent       text,
  constraint gps_has_coords check (source <> 'gps' or (latitude is not null and longitude is not null)),
  constraint manual_has_note check (source <> 'admin_manual' or note is not null)
);

create index attendance_user_time      on public.attendance_logs (user_id, recorded_at desc);
create index attendance_time_approved  on public.attendance_logs (recorded_at desc) where status = 'approved';

-- ---------- 6. טריגרים ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger org_updated_at before update on public.organization_settings
  for each row execute function public.set_updated_at();

-- יצירת פרופיל ריק אוטומטית בהרשמה (סיסמה או Magic Link)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 7. RBAC: פונקציית עזר ----------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and access_role = 'admin' and is_active
  );
$$;

-- ת.ז ננעלת אחרי שהוזנה (רק מנהל יכול לתקן)
create or replace function public.guard_profile_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and old.national_id is not null
     and new.national_id is distinct from old.national_id then
    raise exception 'לא ניתן לשנות מספר ת.ז לאחר הזנתו. יש לפנות למנהל.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- 8. הרשאות טבלה (שכבה 1) + RLS (שכבה 2) ----------
alter table public.profiles              enable row level security;
alter table public.attendance_logs       enable row level security;
alter table public.organization_settings enable row level security;

revoke all on public.profiles, public.attendance_logs, public.organization_settings from anon;
revoke all on public.profiles, public.attendance_logs, public.organization_settings from authenticated;

-- profiles: קריאה + עדכון שדות אישיים בלבד (role / is_active רק דרך RPC של מנהל)
grant select on public.profiles to authenticated;
grant update (first_name, last_name, national_id, member_type) on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using      (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- attendance_logs: קריאה בלבד. כתיבה אך ורק דרך RPC. אין UPDATE/DELETE לאף אחד.
grant select on public.attendance_logs to authenticated;
create policy attendance_select on public.attendance_logs for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- organization_settings: כולם קוראים, רק מנהל מעדכן
grant select, update on public.organization_settings to authenticated;
create policy org_select on public.organization_settings for select to authenticated using (true);
create policy org_update on public.organization_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- 9. אימות מרחק בצד השרת: RPC לדיווח ----------
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

  -- נעילה פר-משתמש: מונע race בין שתי לחיצות מקבילות
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  -- Rate limit על כל ניסיון (גם נדחה) — לא נרשם בלוג
  select max(recorded_at) into v_last_any from public.attendance_logs where user_id = v_uid;
  if v_last_any is not null
     and v_last_any > now() - make_interval(secs => v_org.min_seconds_between_reports) then
    raise exception 'too many requests' using errcode = 'PT429';
  end if;

  -- חישוב מרחק גאודזי (ספרואיד WGS84) במטרים
  v_distance := extensions.st_distance(
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
    extensions.st_setsrid(extensions.st_makepoint(v_org.longitude, v_org.latitude), 4326)::extensions.geography
  );

  -- רצף פעולות: נבדק מול הדיווח המאושר האחרון באותו יום מקומי
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

  return jsonb_build_object(
    'id',               v_row.id,
    'status',           v_row.status,
    'action',           v_row.action,
    'recorded_at',      v_row.recorded_at,
    'distance_m',       v_row.distance_m,
    'allowed_radius_m', v_row.allowed_radius_m
  );
end;
$$;

-- גיבוי ללא PostGIS: Haversine (רדיוס כדור 6,371,000 מ')
create or replace function public.haversine_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable strict set search_path = '' as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ---------- 10. RPC של מנהל ----------
create or replace function public.admin_set_user_active(p_user_id uuid, p_active boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and not p_active then
    raise exception 'מנהל אינו יכול להשבית את עצמו' using errcode = '42501';
  end if;
  update public.profiles set
    is_active           = p_active,
    deactivated_at      = case when p_active then null else now() end,
    deactivated_by      = case when p_active then null else auth.uid() end,
    deactivation_reason = case when p_active then null else p_reason end
  where id = p_user_id;
  if not found then
    raise exception 'user not found' using errcode = 'PT404';
  end if;
end;
$$;

create or replace function public.admin_set_access_role(p_user_id uuid, p_role public.access_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'מנהל אינו יכול להוריד לעצמו הרשאה' using errcode = '42501';
  end if;
  update public.profiles set access_role = p_role where id = p_user_id;
  if not found then
    raise exception 'user not found' using errcode = 'PT404';
  end if;
end;
$$;

-- תיקון ידני (שכח לדווח יציאה וכו'): שורה חדשה עם הערת מנהל, לא עריכת היסטוריה
create or replace function public.admin_add_manual_attendance(
  p_user_id uuid, p_action public.attendance_action, p_recorded_at timestamptz, p_note text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_recorded_at > now() then
    raise exception 'לא ניתן להזין זמן עתידי' using errcode = '22023';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'חובה לציין סיבה לתיקון ידני' using errcode = '22023';
  end if;
  insert into public.attendance_logs (user_id, action, status, source, recorded_at, created_by, note)
  values (p_user_id, p_action, 'approved', 'admin_manual', p_recorded_at, auth.uid(), p_note)
  returning id into v_id;
  return v_id;
end;
$$;

-- חיפוש היסטוריה לדשבורד (SECURITY INVOKER: נשען על RLS — מנהל רואה הכל, משתמש רק את עצמו)
create or replace function public.search_attendance(
  p_query           text default null,          -- ת.ז מלאה או חלק משם
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
language sql stable security invoker set search_path = '' as $$
  select l.id, l.user_id, p.national_id, p.full_name, p.member_type, p.is_active,
         l.action, l.status, l.source, l.recorded_at, l.distance_m, l.note,
         count(*) over () as total_count
  from public.attendance_logs l
  join public.profiles p on p.id = l.user_id
  where (p_query is null or p_query = ''
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

-- ---------- 11. View לדוחות: סיכום יומי (שעות נוכחות) ----------
create or replace view public.v_daily_presence with (security_invoker = true) as
with ordered as (
  select l.user_id, l.action, l.recorded_at,
         (l.recorded_at at time zone 'Asia/Jerusalem')::date as work_date,
         lead(l.action)      over w as next_action,
         lead(l.recorded_at) over w as next_at
  from public.attendance_logs l
  where l.status = 'approved'
  window w as (partition by l.user_id, (l.recorded_at at time zone 'Asia/Jerusalem')::date
               order by l.recorded_at)
)
select o.user_id, p.national_id, p.first_name, p.last_name, p.member_type, p.is_active, o.work_date,
       min(o.recorded_at) filter (where o.action = 'check_in')  as first_in,
       max(o.recorded_at) filter (where o.action = 'check_out') as last_out,
       coalesce(round(sum(extract(epoch from (o.next_at - o.recorded_at)) / 60)
         filter (where o.action = 'check_in' and o.next_action = 'check_out'))::int, 0) as total_minutes,
       bool_or(o.action = 'check_in' and o.next_action is null) as missing_checkout
from ordered o
join public.profiles p on p.id = o.user_id
group by o.user_id, p.national_id, p.first_name, p.last_name, p.member_type, p.is_active, o.work_date;

grant select on public.v_daily_presence to authenticated;

-- ---------- 12. הרשאות הרצה לפונקציות ----------
revoke execute on function
  public.report_attendance(public.attendance_action, double precision, double precision, real, text),
  public.admin_set_user_active(uuid, boolean, text),
  public.admin_set_access_role(uuid, public.access_role),
  public.admin_add_manual_attendance(uuid, public.attendance_action, timestamptz, text),
  public.search_attendance(text, public.member_type, date, date, public.attendance_status, boolean, int, int),
  public.is_admin(),
  public.handle_new_user(),
  public.guard_profile_update()
from public, anon;

grant execute on function
  public.report_attendance(public.attendance_action, double precision, double precision, real, text),
  public.admin_set_user_active(uuid, boolean, text),
  public.admin_set_access_role(uuid, public.access_role),
  public.admin_add_manual_attendance(uuid, public.attendance_action, timestamptz, text),
  public.search_attendance(text, public.member_type, date, date, public.attendance_status, boolean, int, int),
  public.is_admin()
to authenticated;

revoke execute on function public.handle_new_user() from authenticated;

-- ---------- 13. Seed ----------
-- נקודת הישיבה. אפשר לשנות מאוחר יותר ממסך ההגדרות בדשבורד.
insert into public.organization_settings (id, name, latitude, longitude, allowed_radius_m)
values (1, 'הישיבה', 32.1894, 34.8812, 150);

-- מנהל ראשון: להירשם דרך האפליקציה, ואז להריץ ב-SQL Editor:
-- update public.profiles set access_role = 'admin' where email = 'admin@example.com';
