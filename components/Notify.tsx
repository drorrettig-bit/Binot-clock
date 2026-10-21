"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { enablePush, pushState, refreshPush, type PushState } from "@/lib/push";
import { friendlyError } from "@/lib/errors";
import { fmtTime } from "@/lib/labels";
import { CheckIcon, PinIcon, XIcon } from "@/components/Icons";

/* ---------- כרטיס "הפעלת התראות" ---------- */

const DISMISS_KEY = "push-card-dismissed-v1";

export function NotifyCard({ userId, onNeedInstall }: { userId: string; onNeedInstall: () => void }) {
  const [state, setState] = useState<PushState>("unsupported");
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const s = pushState();
    setState(s);
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === "1"; } catch {}
    setHidden(s === "granted" || s === "unsupported" || dismissed);
    if (s === "granted") refreshPush(userId);
  }, [userId]);

  if (hidden) return null;

  async function enable() {
    setBusy(true);
    setError("");
    try {
      const s = await enablePush(userId);
      setState(s);
      if (s === "granted") setHidden(true);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
    setHidden(true);
  }

  return (
    <div className="notice enter">
      <div className="notice-body">
        <b>התראות מהישיבה</b>
        {state === "needs-install" && <span>ב-iPhone התראות מגיעות רק לאפליקציה שהותקנה במסך הבית. קודם מוסיפים אותה, ואז מפעילים כאן התראות.</span>}
        {state === "default" && <span>כדי לקבל הודעות וביקורות נוכחות ישירות לטלפון.</span>}
        {state === "denied" && <span>ההתראות חסומות בטלפון. כדי לפתוח: הגדרות הטלפון ← האפליקציה או הדפדפן ← התראות ← לאפשר.</span>}
        {error && <span className="help bad">{error}</span>}
      </div>
      <div className="notice-actions">
        {state === "needs-install" && <button className="btn small primary press" onClick={onNeedInstall}>הוספה למסך הבית</button>}
        {state === "default" && <button className="btn small primary press" onClick={enable} disabled={busy}>{busy ? "מפעיל…" : "הפעלת התראות"}</button>}
        <button className="btn small press" onClick={dismiss}>לא עכשיו</button>
      </div>
    </div>
  );
}

/* ---------- ביקורת נוכחות פעילה ---------- */

type Check = { id: number; title: string; body: string | null; expires_at: string };
type Result = "present" | "away" | "low_accuracy";

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }),
  );
}

export function AuditCards({ highlightId }: { highlightId: number | null }) {
  const [checks, setChecks] = useState<Check[]>([]);
  const [answered, setAnswered] = useState<Record<number, Result>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const sb = supabase();
    const { data: c } = await sb
      .from("spot_checks")
      .select("id,title,body,expires_at")
      .eq("kind", "audit")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    const list = (c as Check[]) ?? [];
    setChecks(list);
    if (list.length) {
      const { data: r } = await sb.from("spot_check_responses").select("check_id,result").in("check_id", list.map((x) => x.id));
      const map: Record<number, Result> = {};
      (r ?? []).forEach((x: { check_id: number; result: Result }) => (map[x.check_id] = x.result));
      setAnswered(map);
    }
  }, []);

  useEffect(() => {
    load();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(load, 60000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
    };
  }, [load]);

  async function respond(id: number) {
    setBusy(id);
    setMsg((m) => ({ ...m, [id]: "" }));
    try {
      const pos = await getPosition();
      const { data, error } = await supabase().rpc("respond_spot_check", {
        p_check_id: id, p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_accuracy_m: Math.round(pos.coords.accuracy),
      });
      if (error) {
        const expired = (error as { code?: string }).code === "PT410" || error.message.includes("expired");
        setMsg((m) => ({ ...m, [id]: expired ? "זמן הביקורת הסתיים." : friendlyError(error) }));
      } else {
        setAnswered((a) => ({ ...a, [id]: (data as { result: Result }).result }));
      }
    } catch (e) {
      const code = (e as GeolocationPositionError)?.code;
      setMsg((m) => ({
        ...m,
        [id]: code === 1 ? "לא ניתנה הרשאת מיקום. צריך לאפשר מיקום בהגדרות הטלפון ולנסות שוב." : "לא הצלחנו לקבל מיקום. נסו שוב, רצוי ליד חלון.",
      }));
    }
    setBusy(null);
  }

  const open = checks.filter((c) => answered[c.id] !== "present" && answered[c.id] !== "away");
  const done = checks.filter((c) => answered[c.id] === "present" || answered[c.id] === "away");
  if (!checks.length) return null;

  return (
    <>
      {open.map((c) => (
        <div key={c.id} className={`audit enter${highlightId === c.id ? " hl" : ""}`} role="alert">
          <div className="audit-head">
            <span className="audit-badge">ביקורת נוכחות</span>
            <span className="muted">עד <span className="num">{fmtTime(c.expires_at)}</span></span>
          </div>
          <h3>{c.title}</h3>
          {c.body && <p>{c.body}</p>}
          {answered[c.id] === "low_accuracy" && <p className="help bad">אות ה-GPS היה חלש. נסו שוב, רצוי ליד חלון.</p>}
          {msg[c.id] && <p className="help bad">{msg[c.id]}</p>}
          <button className="primary-btn press" onClick={() => respond(c.id)} disabled={busy === c.id}>
            {busy === c.id ? "מאתר מיקום…" : "אישור נוכחות"}
          </button>
        </div>
      ))}
      {done.map((c) => (
        <div key={c.id} className={`result enter ${answered[c.id] === "present" ? "ok" : "bad"}`}>
          <span className="ic">{answered[c.id] === "present" ? <CheckIcon /> : answered[c.id] === "away" ? <XIcon /> : <PinIcon />}</span>
          <div>
            <h3>{answered[c.id] === "present" ? "נוכחותך בביקורת אושרה" : "התגובה נרשמה: מחוץ לתחום הישיבה"}</h3>
            <p>{c.title}</p>
          </div>
        </div>
      ))}
    </>
  );
}
