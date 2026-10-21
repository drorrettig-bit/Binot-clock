-- אינדקסים למפתחות זרים (המלצת סורק הביצועים של Supabase)
create index if not exists attendance_created_by on public.attendance_logs (created_by);
create index if not exists profiles_deactivated_by on public.profiles (deactivated_by) where deactivated_by is not null;
create index if not exists org_updated_by on public.organization_settings (updated_by);
