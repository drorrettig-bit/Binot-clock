"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { BackIcon, LogoIcon } from "@/components/Icons";
import { APP_NAME } from "@/lib/config";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("link") === "expired")
      setError("הקישור מהמייל כבר לא תקף. בקשו קוד חדש.");
  }, []);
  const [info, setInfo] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setError("כתובת האימייל לא תקינה. בדקו שאין רווחים ושיש @.");
      return;
    }
    setBusy(true);
    setError("");
    const { error } = await supabase().auth.signInWithOtp({
      email: clean,
      // אם המשתמש לוחץ על הקישור במייל במקום להקליד את הקוד, הוא חוזר לאתר הזה
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setError(friendlyError(error));
      return;
    }
    setEmail(clean);
    setCode("");
    setStep("code");
    setInfo("");
    setTimeout(() => codeRef.current?.focus(), 50);
  }

  async function verify(value: string) {
    if (value.length !== 6) {
      setError("הקוד כולל 6 ספרות.");
      return;
    }
    setBusy(true);
    setError("");
    const { error } = await supabase().auth.verifyOtp({ email, token: value, type: "email" });
    if (error) {
      setBusy(false);
      setError(friendlyError(error));
      return;
    }
    // החיבור נשמר. ההפניה למסך הבית או להשלמת פרטים נעשית שם.
    router.replace("/");
    router.refresh();
  }

  async function resend() {
    await sendCode();
    setInfo("נשלח קוד חדש. הקוד הקודם בוטל.");
  }

  return (
    <main className="app">
      {step === "email" ? (
        <form className="section enter" style={{ gap: 18 }} onSubmit={sendCode} noValidate>
          <div className="auth-hero">
            <div className="auth-logo"><LogoIcon /></div>
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
            {busy ? "שולח…" : "שלחו לי קוד כניסה"}
          </button>
          <p className="fine">אין סיסמה לזכור. נכנסים פעם אחת עם קוד מהמייל, והאפליקציה זוכרת אתכם במכשיר הזה.</p>
        </form>
      ) : (
        <form
          className="section enter"
          style={{ gap: 16, paddingTop: 24 }}
          onSubmit={(e) => {
            e.preventDefault();
            verify(code);
          }}
          noValidate
        >
          <button type="button" className="back" onClick={() => { setStep("email"); setError(""); }}>
            <BackIcon width={16} height={16} /> שינוי כתובת
          </button>
          <h1 className="title">בדקו את המייל</h1>
          <p className="lead">
            שלחנו מייל אל <b className="ltr">{email}</b>. אפשר להקליד כאן את הקוד מהמייל, או ללחוץ על הקישור שבו. אם המייל לא מופיע, כדאי לבדוק בתיקיית הספאם.
          </p>
          <label className="field" htmlFor="otp">
            קוד כניסה
            <input
              id="otp"
              ref={codeRef}
              className="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                if (v.length === 6) verify(v);
              }}
              aria-invalid={!!error}
            />
          </label>
          {error && <p className="err" role="alert">{error}</p>}
          {info && <p className="help ok">{info}</p>}
          <button className="primary-btn press" type="submit" disabled={busy}>
            {busy ? "בודק…" : "כניסה"}
          </button>
          <button type="button" className="linkish" onClick={resend} disabled={busy}>
            לא הגיע? שליחה חוזרת
          </button>
        </form>
      )}
    </main>
  );
}
