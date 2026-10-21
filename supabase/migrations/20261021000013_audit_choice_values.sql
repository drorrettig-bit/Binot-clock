-- תשובות נוספות בביקורת: "לא נוכח" ו"בדרך"
alter type public.spot_check_result add value if not exists 'absent';
alter type public.spot_check_result add value if not exists 'on_the_way';
