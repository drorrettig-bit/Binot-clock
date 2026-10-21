"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useMe } from "@/lib/useMe";
import { isValidIsraeliId, normalizeIsraeliId } from "@/lib/israeli-id";
import { ROLE_LABEL } from "@/lib/labels";
import { friendlyError } from "@/lib/errors";
import { useToast } from "@/components/Toast";
import type { MemberType } from "@/lib/types";

export default function OnboardingPage() {
  const router = useRouter();
  const toast = useToast();
  const { profile, loading } = useMe();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [nid, setNid] = useState("");
  const [role, setRole] = useState<MemberType | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profile) return;
    if (profile.onboarding_completed) {
      router.replace("/");
      return;
    }
    setFirst(profile.first_name ?? "");
    setLast(profile.last_name ?? "");
    setNid(profile.national_id ?? "");
    setRole(profile.member_type);
  }, [profile, router]);

  const idLocked = !!profile?.national_id;
  const normalized = normalizeIsraeliId(nid);
  const idState: { tone: "" | "ok" | "bad"; text: string } = !nid
    ? { tone: "", text: "אם יש פחות מ-9 ספרות, נוסיף אפסים בהתחלה" }
    : nid.replace(/\D/g, "").length < 5
      ? { tone: "", text: "ממשיכים להקליד…" }
      : normalized && isValidIsraeliId(normalized)
        ? { tone: "ok", text: "מספר תקין" + (normalized !== nid ? ` (יישמר כ-${normalized})` : "") }
        : { tone: "bad", text: "ספרת הביקורת לא מתאימה. בדקו שהמספר הוקלד נכון." };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problems: string[] = [];
    if (!first.trim() || !last.trim()) problems.push("שם פרטי ושם משפחה");
    if (!normalized || !isValidIsraeliId(normalized)) problems.push("מספר תעודת זהות תקין");
    if (!role) problems.push("תפקיד");
    if (!consent) problems.push("אישור שליחת המיקום");
    if (problems.length) {
      setError("חסר: " + problems.join(", ") + ".");
      return;
    }
    if (!profile) return;
    setBusy(true);
    setError("");
    const update: Record<string, string> = { first_name: first.trim(), last_name: last.trim(), member_type: role! };
    if (!idLocked) update.national_id = normalized!;
    const { error } = await supabase().from("profiles").update(update).eq("id", profile.id);
    setBusy(false);
    if (error) {
      setError(friendlyError(error));
      return;
    }
    toast("ההרשמה הושלמה. תישאר מחובר במכשיר הזה");
    router.replace("/");
  }

  if (loading) return <div className="center"><div className="spinner" aria-label="טוען" /></div>;

  return (
    <main className="app">
      <form className="section enter" style={{ gap: 16, paddingTop: 24 }} onSubmit={submit} noValidate>
        <h1 className="title">עוד רגע בפנים</h1>
        <p className="lead">פרטים לזיהוי ברשימות הישיבה. ממלאים פעם אחת בלבד.</p>
        <div className="two">
          <label className="field" htmlFor="first">
            שם פרטי
            <input id="first" autoComplete="given-name" maxLength={50} value={first} onChange={(e) => setFirst(e.target.value)} />
          </label>
          <label className="field" htmlFor="last">
            שם משפחה
            <input id="last" autoComplete="family-name" maxLength={50} value={last} onChange={(e) => setLast(e.target.value)} />
          </label>
        </div>
        <label className="field" htmlFor="nid">
          מספר תעודת זהות
          <input
            id="nid"
            className="ltr num"
            inputMode="numeric"
            maxLength={9}
            autoComplete="off"
            placeholder="9 ספרות כולל ספרת ביקורת"
            value={nid}
            disabled={idLocked}
            onChange={(e) => setNid(e.target.value.replace(/\D/g, ""))}
            aria-invalid={idState.tone === "bad"}
          />
          <span className={`help ${idState.tone}`}>{idLocked ? "מספר הזהות נשמר. לתיקון יש לפנות למזכירות." : idState.text}</span>
        </label>
        <div className="field">
          <span>תפקיד בישיבה</span>
          <div className="roles" role="group" aria-label="תפקיד">
            {(Object.keys(ROLE_LABEL) as MemberType[]).map((k) => (
              <button key={k} type="button" className="press" aria-pressed={role === k} onClick={() => setRole(k)}>
                {ROLE_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <label className="consent" htmlFor="consent">
          <input id="consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          אני מאשר שמיקום הטלפון יישלח לשרת רק ברגע הדיווח, ולא במעקב רציף.
        </label>
        {error && <p className="err" role="alert">{error}</p>}
        <button className="primary-btn press" type="submit" disabled={busy}>
          {busy ? "שומר…" : "סיום הרשמה"}
        </button>
      </form>
    </main>
  );
}
