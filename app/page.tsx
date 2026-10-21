"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { signOut, useMe } from "@/lib/useMe";
import { ACTION_LABEL, ROLE_LABEL, STATUS_LABEL, fmtTime, minutesLabel, startOfIsraelDay } from "@/lib/labels";
import { friendlyError } from "@/lib/errors";
import { useToast } from "@/components/Toast";
import { ChartIcon, CheckIcon, InIcon, LogoutIcon, OutIcon, PinIcon, XIcon } from "@/components/Icons";
import type { AttendanceAction, AttendanceLog, ReportResult } from "@/lib/types";

type Result = { tone: "ok" | "bad" | "info"; title: string; text: string };

const REJECT_TEXT: Record<string, (r: ReportResult) => string> = {
  rejected_distance: () => "נראה שאתה לא בתחום הישיבה. דווח כשאתה בפנים.",
  rejected_accuracy: () => "אות ה-GPS חלש מדי כדי לדעת איפה אתה. צא לאזור פתוח או התקרב לחלון ונסה שוב.",
  rejected_sequence: (r) =>
    r.action === "check_in" ? "כבר רשומה לך כניסה פתוחה היום. כשתצא, דווח יציאה." : "אין כניסה פתוחה היום. קודם מדווחים כניסה.",
  rejected_inactive: () => "החשבון שלך מושבת. פנה למזכירות.",
};

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("no-geo"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}

function geoErrorText(err: unknown): string {
  const code = (err as GeolocationPositionError)?.code;
  if (code === 1)
    return "לא ניתנה הרשאת מיקום. בהגדרות הטלפון יש לאפשר לדפדפן (או לאפליקציה) גישה למיקום, ואז לנסות שוב.";
  if (code === 3) return "לקח יותר מדי זמן למצוא מיקום. נסה שוב, רצוי ליד חלון או בחוץ.";
  if ((err as Error)?.message === "no-geo") return "הדפדפן הזה לא תומך במיקום. נסה דפדפן אחר.";
  return "לא הצלחנו לקבל מיקום. בדוק שה-GPS פועל ונסה שוב.";
}

export default function HomePage() {
  const router = useRouter();
  const toast = useToast();
  const { profile, loading } = useMe();
  const [orgName, setOrgName] = useState("");
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [busy, setBusy] = useState<AttendanceAction | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (profile && !profile.onboarding_completed) router.replace("/onboarding");
  }, [profile, router]);

  const loadToday = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase()
      .from("attendance_logs")
      .select("id,user_id,action,status,source,recorded_at,note")
      .eq("user_id", profile.id)
      .gte("recorded_at", startOfIsraelDay())
      .order("recorded_at", { ascending: true });
    setLogs((data as AttendanceLog[]) ?? []);
  }, [profile]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  useEffect(() => {
    supabase().rpc("org_display_name").then(({ data }) => setOrgName(typeof data === "string" ? data : ""));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // הצעה להתקין במסך הבית: ב-iPhone זה מה ששומר על החיבור לאורך זמן
    try {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const dismissed = localStorage.getItem("install-hint-dismissed") === "1";
      setShowInstall(!standalone && !dismissed);
    } catch {
      setShowInstall(false);
    }
  }, []);

  async function report(action: AttendanceAction) {
    setBusy(action);
    setResult({ tone: "info", title: "מאתר מיקום…", text: "זה לוקח כמה שניות. השאר את המסך פתוח." });
    let pos: GeolocationPosition;
    try {
      pos = await getPosition();
    } catch (err) {
      setBusy(null);
      setResult({ tone: "bad", title: "אין מיקום", text: geoErrorText(err) });
      return;
    }
    const { data, error } = await supabase().rpc("report_attendance", {
      p_action: action,
      p_lat: pos.coords.latitude,
      p_lng: pos.coords.longitude,
      p_accuracy_m: Math.round(pos.coords.accuracy),
      p_user_agent: navigator.userAgent,
    });
    setBusy(null);
    if (error) {
      setResult({ tone: "bad", title: "הדיווח לא נשלח", text: friendlyError(error) });
      return;
    }
    const r = data as ReportResult;
    if (r.status === "approved") {
      setResult({
        tone: "ok",
        title: action === "check_in" ? "הכניסה נרשמה" : "היציאה נרשמה",
        // מנהל רואה גם את המרחק, לבדיקה. משתמש רגיל לא מקבל אותו מהשרת בכלל.
        text: `בשעה ${fmtTime(r.recorded_at)}.` + (r.distance_m != null ? ` מרחק: ${Math.round(r.distance_m)} מ' (מוצג למנהלים בלבד).` : ""),
      });
      if ("vibrate" in navigator) navigator.vibrate?.(30);
    } else {
      setResult({ tone: "bad", title: "הדיווח נדחה: " + STATUS_LABEL[r.status].text, text: REJECT_TEXT[r.status]?.(r) ?? "" });
    }
    loadToday();
  }

  async function doLogout() {
    await signOut();
    toast("התנתקת מהמכשיר הזה");
    router.replace("/login");
    router.refresh();
  }

  if (loading || !profile || !profile.onboarding_completed)
    return <div className="center"><div className="spinner" aria-label="טוען" /></div>;

  const approved = logs.filter((l) => l.status === "approved");
  const last = approved[approved.length - 1];
  let minutes = 0;
  approved.forEach((l, i) => {
    if (l.action !== "check_in") return;
    const next = approved[i + 1];
    const end = next && next.action === "check_out" ? new Date(next.recorded_at).getTime() : now;
    minutes += (end - new Date(l.recorded_at).getTime()) / 60000;
  });
  const inside = last?.action === "check_in";
  const hour = new Date().getHours();
  const greet = hour < 12 ? "בוקר טוב" : hour < 18 ? "צהריים טובים" : "ערב טוב";
  const ringOffset = 169.6 * (1 - Math.min(minutes / 480, 1));

  return (
    <main className="app">
      <div className="userbar enter">
        <div className="avatar" aria-hidden="true">{(profile.first_name ?? "?").charAt(0)}</div>
        <div className="who">
          <small>{greet}</small>
          <h1>{profile.full_name}</h1>
        </div>
        {profile.access_role === "admin" && (
          <Link className="iconbtn press" href="/admin" aria-label="ניהול" title="ניהול">
            <ChartIcon />
          </Link>
        )}
        {confirmLogout ? (
          <span className="confirm">
            <button className="btn small danger press" onClick={doLogout}>התנתקות</button>
            <button className="btn small press" onClick={() => setConfirmLogout(false)}>ביטול</button>
          </span>
        ) : (
          <button className="iconbtn press" aria-label="התנתקות" title="התנתקות" onClick={() => setConfirmLogout(true)}>
            <LogoutIcon />
          </button>
        )}
      </div>

      {showInstall && (
        <div className="install">
          <div>
            <b>כדאי להוסיף למסך הבית</b>
            ב-iPhone: כפתור השיתוף ואז &quot;הוסף למסך הבית&quot;. באנדרואיד: תפריט הדפדפן ואז &quot;התקן אפליקציה&quot;. כך תישאר מחובר תמיד.
          </div>
          <button
            aria-label="סגירה"
            onClick={() => {
              setShowInstall(false);
              try { localStorage.setItem("install-hint-dismissed", "1"); } catch {}
            }}
          >
            ×
          </button>
        </div>
      )}

      <div className="status-card">
        <div className="ring" aria-hidden="true">
          <svg viewBox="0 0 64 64">
            <circle className="trk" cx="32" cy="32" r="27" />
            <circle className="val" cx="32" cy="32" r="27" strokeDasharray="169.6" style={{ strokeDashoffset: ringOffset }} />
          </svg>
          <span className="num">{minutesLabel(minutes)}</span>
        </div>
        <div className="txt">
          {!profile.is_active ? (
            <><b>החשבון מושבת</b><small>לא ניתן לדווח. יש לפנות למזכירות.</small></>
          ) : inside ? (
            <><b>אתה בפנים</b><small>נכנסת ב-<span className="num">{fmtTime(last.recorded_at)}</span></small></>
          ) : last ? (
            <><b>יצאת</b><small>יציאה ב-<span className="num">{fmtTime(last.recorded_at)}</span></small></>
          ) : (
            <><b>עוד לא דיווחת היום</b><small>דווח כניסה כשאתה מגיע</small></>
          )}
        </div>
      </div>

      <div className="actions">
        <button className="big in press" onClick={() => report("check_in")} disabled={!!busy}>
          <InIcon /> {busy === "check_in" ? "מדווח…" : "כניסה"}
        </button>
        <button className="big out press" onClick={() => report("check_out")} disabled={!!busy}>
          <OutIcon /> {busy === "check_out" ? "מדווח…" : "יציאה"}
        </button>
      </div>

      {result && (
        <div className={`result enter ${result.tone}`} role="status" key={result.title + result.text}>
          <span className="ic">{result.tone === "ok" ? <CheckIcon /> : result.tone === "bad" ? <XIcon /> : <PinIcon />}</span>
          <div>
            <h3>{result.title}</h3>
            <p>{result.text}</p>
          </div>
        </div>
      )}

      <div className="section">
        <p className="eyebrow">הדיווחים שלי היום</p>
        <ul className="today">
          {logs.length === 0 ? (
            <li className="muted">אין דיווחים היום</li>
          ) : (
            [...logs].reverse().map((l) => (
              <li key={l.id}>
                <span>
                  {ACTION_LABEL[l.action]} · <span className="num">{fmtTime(l.recorded_at)}</span>
                  {l.source === "admin_manual" && <span className="muted"> (תיקון ידני)</span>}
                </span>
                <span className={`pill ${STATUS_LABEL[l.status].tone}`}>{STATUS_LABEL[l.status].text}</span>
              </li>
            ))
          )}
        </ul>
      </div>

      <p className="foot">
        <i aria-hidden="true" />
        <span>
          {profile.member_type ? ROLE_LABEL[profile.member_type] + " · " : ""}
          מחובר כ-<span className="ltr">{profile.email}</span>
          {orgName ? ` · ${orgName}` : ""}
        </span>
      </p>
    </main>
  );
}
