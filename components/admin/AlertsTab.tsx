"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { ROLE_LABEL, fmtDate, fmtTime } from "@/lib/labels";
import { friendlyError } from "@/lib/errors";
import { downloadCsv } from "@/lib/csv";
import { useToast } from "@/components/Toast";
import { DownloadIcon } from "@/components/Icons";
import type { MemberType, Profile } from "@/lib/types";

type Kind = "audit" | "message";
type SendResult = { users: number; users_with_device: number; devices: number; sent: number; failed: number };
type CheckRow = {
  id: number; kind: Kind; title: string; body: string | null; target_role: MemberType | null; target_user: string | null;
  created_at: string; expires_at: string | null; target_count: number; device_count: number | null; sent_count: number | null; failed_count: number | null;
};
type ReportRow = {
  user_id: string; full_name: string; national_id: string | null; member_type: MemberType | null;
  has_device: boolean; responded_at: string | null; result: "present" | "away" | "low_accuracy" | null; distance_m: number | null;
};

const RESULT_LABEL: Record<string, { text: string; tone: string }> = {
  present: { text: "בישיבה", tone: "ok" },
  away: { text: "מחוץ לישיבה", tone: "bad" },
  low_accuracy: { text: "אות GPS חלש", tone: "warn" },
  none: { text: "לא הגיב", tone: "neutral" },
};

async function invokeSend(checkId: number): Promise<SendResult> {
  const { data, error } = await supabase().functions.invoke("send-push", { body: { check_id: checkId } });
  if (error) throw error;
  return data as SendResult;
}

function summary(r: SendResult): string {
  if (!r.users) return "אין משתמשים פעילים בקהל היעד.";
  if (!r.devices) return `נשמר, אבל לאף אחד מ-${r.users} המשתמשים אין עדיין מכשיר שהפעיל התראות.`;
  return `נשלח ל-${r.sent} מכשירים של ${r.users_with_device} מתוך ${r.users} משתמשים` + (r.failed ? ` · ${r.failed} נכשלו` : "");
}

/** נדנוד למשתמש אחד: ביקורת נוכחות אישית ל-15 דקות */
export async function sendNudge(userId: string, toast: (m: string) => void) {
  const { data: id, error } = await supabase().rpc("admin_create_nudge", { p_user_id: userId });
  if (error) {
    toast(friendlyError(error));
    return;
  }
  try {
    const r = await invokeSend(id as number);
    toast(r.devices ? "הנדנוד נשלח לטלפון" : "הנדנוד נשמר, אבל למשתמש אין מכשיר שהפעיל התראות. הוא יראה אותו כשיפתח את האפליקציה.");
  } catch (e) {
    toast("הנדנוד נשמר, אבל השליחה לטלפון נכשלה: " + friendlyError(e));
  }
}

export function AlertsTab({ people }: { people: Profile[] }) {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("audit");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [role, setRole] = useState<MemberType | "">("");
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<CheckRow[]>([]);
  const [deviceUsers, setDeviceUsers] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);

  const names = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p.full_name])), [people]);

  const load = useCallback(async () => {
    const sb = supabase();
    const [{ data: h }, { data: subs }] = await Promise.all([
      sb.from("spot_checks").select("*").order("created_at", { ascending: false }).limit(40),
      sb.from("push_subscriptions").select("user_id"),
    ]);
    setHistory((h as CheckRow[]) ?? []);
    setDeviceUsers(new Set((subs ?? []).map((s: { user_id: string }) => s.user_id)).size);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pickKind = (k: Kind) => setKind(k);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    // ביקורת היא התראה אדומה קבועה, בלי טקסט. בהודעה כותבים כותרת וטקסט.
    const t = kind === "audit" ? "ביקורת" : title.trim();
    const b = kind === "audit" ? "לחצו עכשיו לאישור נוכחות" : body.trim() || null;
    if (!t) {
      toast("חסרה כותרת להודעה");
      return;
    }
    setBusy(true);
    const { data: id, error } = await supabase().rpc("admin_create_spot_check", {
      p_kind: kind, p_title: t, p_body: b, p_target_role: role || null, p_minutes: minutes,
    });
    if (error) {
      setBusy(false);
      toast(friendlyError(error));
      return;
    }
    try {
      toast(summary(await invokeSend(id as number)));
    } catch (err) {
      toast("נשמר, אבל השליחה לטלפונים נכשלה: " + friendlyError(err));
    }
    setBusy(false);
    await load();
    if (kind === "audit") setOpenId(id as number);
  }

  const active = people.filter((p) => p.is_active).length;
  const target = (c: CheckRow) =>
    c.target_user ? `נדנוד: ${names[c.target_user] ?? "משתמש"}` : c.target_role ? ROLE_LABEL[c.target_role] : "כולם";

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <form className="card panel" onSubmit={send} noValidate style={{ display: "grid", gap: 14 }}>
        <div className="meta" style={{ margin: 0 }}>
          <b style={{ color: "var(--ink)", fontSize: "1.05rem" }}>שליחת התראה לטלפונים</b>
          <span><span className="num">{deviceUsers}</span> מתוך <span className="num">{active}</span> משתמשים פעילים הפעילו התראות</span>
        </div>
        <div className="chips" role="group" aria-label="סוג">
          <button type="button" className="chip chip-red press" aria-pressed={kind === "audit"} onClick={() => pickKind("audit")}>🔴 התראת ביקורת</button>
          <button type="button" className="chip press" aria-pressed={kind === "message"} onClick={() => pickKind("message")}>הודעה עם טקסט</button>
        </div>
        <div className="form-grid">
          {kind === "message" && (
            <>
              <label className="field">כותרת<input id="atitle" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="למשל: שינוי בסדר היום" /></label>
              <label className="field">טקסט<input id="abody" maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} placeholder="מה רוצים לומר" /></label>
            </>
          )}
          <label className="field">למי
            <select id="arole" value={role} onChange={(e) => setRole(e.target.value as MemberType | "")}>
              <option value="">כולם</option>
              {(Object.keys(ROLE_LABEL) as MemberType[]).map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}
            </select>
          </label>
          {kind === "audit" && (
            <label className="field">זמן לאישור
              <select id="amin" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} דקות</option>)}
              </select>
            </label>
          )}
        </div>
        <p className="help" style={{ margin: 0 }}>
          {kind === "audit"
            ? "התראה אדומה: \"🔴 ביקורת\". היא נשארת על המסך עד שלוחצים עליה, ובאנדרואיד מגיעה עם רטט חזק. מי שלוחץ מאשר נוכחות עם מיקום, ואתה רואה בדוח מי בישיבה, מי מחוץ לה ומי לא הגיב."
            : "הודעה רגילה עם הכותרת והטקסט שכתבת, בלי צורך באישור."}{" "}
          נדנוד לאדם מסוים שולחים מלשונית המשתמשים, או מתוך דוח ביקורת.
        </p>
        <div><button className={`btn press ${kind === "audit" ? "danger-fill" : "primary"}`} type="submit" disabled={busy}>{busy ? "שולח…" : kind === "audit" ? "🔴 שליחת התראת ביקורת" : "שליחת הודעה"}</button></div>
      </form>

      {openId && <AuditReport checkId={openId} check={history.find((h) => h.id === openId)} onClose={() => setOpenId(null)} />}

      <div className="card">
        <div className="tablebox">
          <table>
            <thead><tr><th>מתי</th><th>סוג</th><th>כותרת</th><th>למי</th><th>נשלח למכשירים</th><th></th></tr></thead>
            <tbody>
              {history.map((c) => (
                <tr key={c.id}>
                  <td className="num">{fmtDate(c.created_at)} {fmtTime(c.created_at)}</td>
                  <td>{c.kind === "audit" ? <span className="pill warn plain">ביקורת</span> : <span className="pill neutral plain">הודעה</span>}</td>
                  <td><span className="who">{c.title}</span></td>
                  <td>{target(c)}</td>
                  <td className="num">{c.sent_count ?? "—"}{c.failed_count ? <span className="muted"> ({c.failed_count} נכשלו)</span> : ""}</td>
                  <td>{c.kind === "audit" && <button className="btn small press" onClick={() => setOpenId(c.id)}>דוח</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!history.length && <div className="empty">עוד לא נשלחו התראות</div>}
        </div>
      </div>
    </div>
  );
}

function AuditReport({ checkId, check, onClose }: { checkId: number; check?: CheckRow; onClose: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc("admin_spot_check_report", { p_check_id: checkId });
    if (error) toast(friendlyError(error));
    setRows((data as ReportRow[]) ?? []);
    setLoading(false);
  }, [checkId, toast]);

  useEffect(() => {
    load();
    const live = check?.expires_at && new Date(check.expires_at).getTime() > Date.now();
    if (!live) return;
    const t = setInterval(load, 15000); // בזמן שהביקורת פתוחה, הדוח מתעדכן לבד
    return () => clearInterval(t);
  }, [load, check?.expires_at]);

  const count = (k: string) => rows.filter((r) => (r.result ?? "none") === k).length;
  const open = check?.expires_at ? new Date(check.expires_at).getTime() > Date.now() : false;

  return (
    <div className="card panel" style={{ display: "grid", gap: 12 }}>
      <div className="meta" style={{ margin: 0 }}>
        <b style={{ color: "var(--ink)", fontSize: "1.05rem" }}>
          דוח ביקורת: {check?.title ?? ""} {check && <span className="muted num" style={{ fontWeight: 500 }}>· {fmtDate(check.created_at)} {fmtTime(check.created_at)}</span>}
        </b>
        <span style={{ display: "flex", gap: 6 }}>
          <button
            className="btn small press"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(`audit_${checkId}.csv`, [
                ["שם", "ת.ז", "תפקיד", "תוצאה", "שעת תגובה", "מרחק (מ)", "מכשיר עם התראות"],
                ...rows.map((r) => [r.full_name, r.national_id, r.member_type ? ROLE_LABEL[r.member_type] : "", RESULT_LABEL[r.result ?? "none"].text,
                  r.responded_at ? fmtTime(r.responded_at) : "", r.distance_m != null ? Math.round(r.distance_m) : "", r.has_device ? "כן" : "לא"]),
              ])
            }
          >
            <DownloadIcon /> ייצוא
          </button>
          <button className="btn small press" onClick={onClose}>סגירה</button>
        </span>
      </div>
      <div className="chips">
        <span className="pill ok">בישיבה {count("present")}</span>
        <span className="pill bad">מחוץ לישיבה {count("away")}</span>
        <span className="pill warn">אות חלש {count("low_accuracy")}</span>
        <span className="pill neutral">לא הגיבו {count("none")}</span>
        <span className="muted" style={{ fontSize: ".84rem", alignSelf: "center" }}>
          {open ? `פתוחה עד ${fmtTime(check!.expires_at!)} · מתעדכן לבד` : "הביקורת נסגרה"}
        </span>
      </div>
      <div className="tablebox">
        <table>
          <thead><tr><th>שם</th><th>ת.ז</th><th>תפקיד</th><th>תוצאה</th><th>שעה</th><th>מרחק</th><th>התראות</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const res = RESULT_LABEL[r.result ?? "none"];
              return (
                <tr key={r.user_id}>
                  <td><span className="who">{r.full_name}</span></td>
                  <td className="num mono">{r.national_id}</td>
                  <td>{r.member_type ? ROLE_LABEL[r.member_type] : "—"}</td>
                  <td><span className={`pill ${res.tone}`}>{res.text}</span></td>
                  <td className="num">{r.responded_at ? fmtTime(r.responded_at) : "—"}</td>
                  <td className="num">{r.distance_m != null ? `${Math.round(r.distance_m)} מ'` : "—"}</td>
                  <td>{r.has_device ? <span className="muted">פעיל</span> : <span className="pill neutral plain">לא הופעל</span>}</td>
                  <td>{r.result !== "present" && <button className="btn small press" onClick={() => sendNudge(r.user_id, toast)}>נדנוד</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="empty">{loading ? "טוען…" : "אין נמענים"}</div>}
      </div>
    </div>
  );
}
