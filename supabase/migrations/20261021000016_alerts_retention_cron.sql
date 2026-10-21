-- הפעלה יומית של המחיקה, ב-03:15 UTC (05:15 או 06:15 שעון ישראל)
create extension if not exists pg_cron;
select cron.schedule('purge-old-alerts', '15 3 * * *', 'select public.purge_old_spot_checks()');
