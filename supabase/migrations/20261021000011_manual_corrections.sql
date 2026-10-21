-- תיקונים ידניים: ביטול דיווח שגוי ואישור דיווח שנדחה. כל תיקון שומר מי, מתי ולמה.
alter table public.attendance_logs
  add column voided_at   timestamptz,
  add column voided_by   uuid references public.profiles(id),
  add column void_reason text,
  add column approves_log_id bigint references public.attendance_logs(id);
create index attendance_voided_by on public.attendance_logs (voided_by) where voided_by is not null;
create index attendance_approves on public.attendance_logs (approves_log_id) where approves_log_id is not null;

-- ביטול דיווח (מאושר או ידני). השורה נשארת, מסומנת "בוטל".
create or replace function public.admin_void_attendance(p_log_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'חובה לציין סיבה לביטול' using errcode = '22023';
  end if;
  update public.attendance_logs
     set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_log_id and status = 'approved';
  if not found then
    raise exception 'אפשר לבטל רק דיווח מאושר' using errcode = '22023';
  end if;
end;
$$;

-- אישור דיווח שנדחה: נוצרת שורה ידנית מאושרת באותה שעה, שמקושרת לניסיון המקורי.
create or replace function public.admin_approve_rejected(p_log_id bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_log public.attendance_logs%rowtype; v_id bigint;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'חובה לציין סיבה לאישור' using errcode = '22023';
  end if;
  select * into v_log from public.attendance_logs where id = p_log_id;
  if not found or v_log.status::text not like 'rejected_%' then
    raise exception 'אפשר לאשר רק דיווח שנדחה' using errcode = '22023';
  end if;
  if exists (select 1 from public.attendance_logs where approves_log_id = p_log_id and status = 'approved') then
    raise exception 'הדיווח הזה כבר אושר ידנית' using errcode = '22023';
  end if;
  insert into public.attendance_logs (user_id, action, status, source, recorded_at, created_by, note, approves_log_id)
  values (v_log.user_id, v_log.action, 'approved', 'admin_manual', v_log.recorded_at, auth.uid(),
          btrim(p_reason) || ' (אישור ידני לדיווח שנדחה)', p_log_id)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.admin_void_attendance(bigint, text), public.admin_approve_rejected(bigint, text) from public, anon;
grant execute on function public.admin_void_attendance(bigint, text), public.admin_approve_rejected(bigint, text) to authenticated;

-- החיפוש מחזיר בעמודת ההערה גם את סיבת הביטול
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
         case when l.status::text = 'voided' then 'בוטל: ' || coalesce(l.void_reason, '') else l.note end,
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
