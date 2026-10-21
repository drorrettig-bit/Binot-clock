-- סודות לשימוש פונקציות השרת בלבד (למשל מפתח VAPID לשליחת התראות).
-- אין שום הרשאה למשתמשים: רק service_role, שקיים רק בשרת, יכול לקרוא.
-- הערכים עצמם לא נשמרים בקוד, הם הוכנסו ישירות לבסיס הנתונים.
create table public.app_secrets (
  name       text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated, public;
