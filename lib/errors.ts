// הופך שגיאות מהשרת להודעות בעברית שאומרות מה לעשות.
export function friendlyError(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? "";
  const code = e?.code ?? "";

  if (code === "PT429" || msg.includes("too many requests"))
    return "דיווחת לפני רגע. המתן חצי דקה ונסה שוב.";
  if (code === "PT409" || msg.includes("profile incomplete"))
    return "צריך להשלים את פרטי ההרשמה לפני הדיווח.";
  if (msg.includes("organization not configured"))
    return "מיקום הישיבה עוד לא הוגדר. פנה למנהל.";
  if (code === "23505" && msg.includes("national_id"))
    return "מספר הזהות הזה כבר רשום במערכת. אם זה אתה, פנה למזכירות.";
  if (msg.includes("national_id_check"))
    return "מספר הזהות לא תקין. בדוק את הספרות.";
  if (code === "42501" || msg.includes("forbidden") || msg.includes("permission denied"))
    return msg && /[א-ת]/.test(msg) ? msg : "אין לך הרשאה לפעולה הזו.";
  if (msg.toLowerCase().includes("token has expired") || msg.toLowerCase().includes("invalid"))
    return "הקישור לא תקף או שפג תוקפו. בקשו מייל חדש.";
  if (msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("security purposes"))
    return "נשלחו יותר מדי מיילים. המתינו דקה ונסו שוב.";
  if (msg.toLowerCase().includes("not authorized") && msg.toLowerCase().includes("email"))
    return "שרת המייל עוד לא מוגדר לשליחה לכתובת הזו. פנה למנהל המערכת.";
  if (msg.toLowerCase().includes("sending") && msg.toLowerCase().includes("email") || code === "unexpected_failure")
    return "לא הצלחנו לשלוח את מייל הכניסה. נסו שוב בעוד דקה, ואם זה חוזר, פנו למנהל המערכת.";
  if (msg.toLowerCase().includes("failed to fetch"))
    return "אין חיבור לאינטרנט. בדוק את החיבור ונסה שוב.";
  return msg && /[א-ת]/.test(msg) ? msg : "משהו השתבש. נסה שוב בעוד רגע.";
}
