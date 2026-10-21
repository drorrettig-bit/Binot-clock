// הערכים האלה ציבוריים מטבעם: הם נשלחים לכל דפדפן שפותח את האפליקציה.
// ההגנה על הנתונים היא ב-RLS ובפונקציות בשרת, לא בהסתרת המפתח.
// אפשר לדרוס אותם במשתני סביבה (למשל ב-Vercel) בלי לשנות קוד.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qtivbwjlxyvdjuakhgvm.supabase.co";

export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_oO37zbH2hKohIUI-F9ryzw_-fPdFanm";

export const APP_NAME = "שעון נוכחות";

// מפתח ציבורי להתראות Push (VAPID). המפתח הפרטי שמור רק בשרת.
export const VAPID_PUBLIC_KEY = "BAl-VlkfXDKnF-wbfYIQBgdy2e0pmCpEznyWLtWxXNCT9Alz3gytcSjBLAdRtXd6gYYQmGVHii1TtnywxY_6ves";
