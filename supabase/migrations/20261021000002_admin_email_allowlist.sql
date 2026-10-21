-- רשימת מיילים שמקבלים הרשאת מנהל אוטומטית בהרשמה
create table public.admin_emails (
  email    text primary key check (email = lower(btrim(email)) and email like '%@%'),
  added_at timestamptz not null default now()
);
alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;

grant select on public.admin_emails to authenticated;
create policy admin_emails_select on public.admin_emails for select to authenticated
  using ((select public.is_admin()));

insert into public.admin_emails (email) values
  ('yebinot@gmail.com'),
  ('dror.rettig@gmail.com'),
  ('rettigh@gmail.com');

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, access_role)
  values (
    new.id,
    new.email,
    case when exists (select 1 from public.admin_emails where email = lower(btrim(new.email)))
         then 'admin'::public.access_role else 'member'::public.access_role end
  );
  return new;
end;
$$;

update public.profiles p set access_role = 'admin'
where lower(p.email) in (select email from public.admin_emails);
