-- סטטוס חדש: דיווח שמנהל ביטל. נשאר ביומן, לא נספר בשעות.
alter type public.attendance_status add value if not exists 'voided';
