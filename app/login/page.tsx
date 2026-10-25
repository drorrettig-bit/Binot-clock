"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { BackIcon } from "@/components/Icons";
import { Logo } from "@/components/Logo";
import { APP_NAME } from "@/lib/config";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "sent">("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("link") === "expired")
      setError("הקישור מהמייל כבר לא תקף. בקשו קישור חדש.");
  }, []);

  // אם הקישור נפתח בלשונית אחרת של אותו דפדפן, החיבור משותף. ממשיכים אוטומטית.
  const checkSignedIn = useCallback(async () => {
    const { data } = await supabase().auth.getUser();
    if (data.user) {
      router.replace("/");
      router.refresh();
      return true;
    }
    return false;
  }, [router]);

  useEffect(() => {
    if (step !== "sent") return;
    const t = setInterval(checkSignedIn, 3000);
    const onVis = () => document.visibilityState === "visible" && checkSignedIn();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [step, checkSignedIn]);

  async function sendLink(e?: React.FormEvent) {
    e?.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setError("כתובת האימייל לא תקינה. בדקו שאין רווחים ושיש @.");
      return false;
    }
    setBusy(true);
    setError("");
    const { error } = await supabase().auth.signInWithOtp({
      email: clean,
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setError(friendlyError(error));
      return false;
    }
    setEmail(clean);
    setStep("sent");
    setInfo("");
    return true;
  }

  async function resend() {
    if (await sendLink()) setInfo("נשלח מייל חדש. הקישור הקודם בוטל.");
  }

  async function already() {
    setBusy(true);
    const ok = await checkSignedIn();
    setBusy(false);
    if (!ok) setInfo("עוד לא זוהתה כניסה. פתחו את הקישור מהמייל, ואם צריך חזרו לכאן.");
  }

  return (
    <main className="app">
      {step === "email" ? (
        <form className="section enter" style={{ gap: 18 }} onSubmit={sendLink} noValidate>
          <div className="auth-hero">
            <Logo height={150} className="auth-logo" />
            <h1>{APP_NAME}</h1>
            <p>כניסה והרשמה</p>
          </div>
          <label className="field" htmlFor="email">
            כתובת אימייל
            <input
              id="email"
              type="email"
              className="ltr"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!error}
            />
          </label>
          {error && <p className="err" role="alert">{error}</p>}
          <button className="primary-btn press" type="submit" disabled={busy}>
            {busy ? "שולח…" : "שלחו לי מייל לכניסה"}
          </button>
          <p className="fine">אין סיסמה לזכור. נכנסים פעם אחת דרך קישור במייל, והאפליקציה זוכרת אתכם במכשיר הזה.</p>
        </form>
      ) : (
        <div className="section enter" style={{ gap: 16, paddingTop: 24 }}>
          <button type="button" className="back" onClick={() => { setStep("email"); setError(""); setInfo(""); }}>
            <BackIcon width={16} height={16} /> שינוי כתובת
          </button>
          <h1 className="title">בדקו את המייל</h1>
          <p className="lead">
            שלחנו מייל אל <b className="ltr">{email}</b>. לחצו על הקישור שבמייל, והכניסה תושלם אוטומטית.
            אם המייל לא מופיע, כדאי לבדוק בתיקיית הספאם.
          </p>
          <p className="help">
            חשוב: לפתוח את הקישור באותו טלפון. ב-iPhone, אם האפליקציה כבר מותקנת במסך הבית, הקישור ייפתח ב-Safari.
            אחרי הכניסה שם, פותחים את האפליקציה מהאייקון.
          </p>
          {error && <p className="err" role="alert">{error}</p>}
          {info && <p className="help ok">{info}</p>}
          <button type="button" className="primary-btn press" onClick={already} disabled={busy}>
            {busy ? "בודק…" : "כבר לחצתי על הקישור"}
          </button>
          <button type="button" className="linkish" onClick={resend} disabled={busy}>
            לא הגיע? שליחה חוזרת
          </button>
        </div>
      )}
    </main>
  );
}
