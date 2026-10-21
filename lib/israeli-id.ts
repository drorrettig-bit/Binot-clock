/** בדיקת ספרת ביקורת של תעודת זהות ישראלית. מקבלת מחרוזת של עד 9 ספרות. */
export function normalizeIsraeliId(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 9) return null;
  return digits.padStart(9, "0");
}

export function isValidIsraeliId(id: string): boolean {
  if (!/^\d{9}$/.test(id) || id === "000000000") return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const v = Number(id[i]) * (i % 2 === 0 ? 1 : 2);
    sum += v > 9 ? v - 9 : v;
  }
  return sum % 10 === 0;
}
