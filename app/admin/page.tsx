"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useMe } from "@/lib/useMe";
import { ACTION_LABEL, FIX_REASONS, ROLE_LABEL, STATUS_LABEL, dayKey, fmtDate, fmtTime, minutesLabel, startOfIsraelDay } from "@/lib/labels";
import { friendlyError } from "@/lib/errors";
import { useToast } from "@/components/Toast";
import { DownloadIcon } from "@/components/Icons";
import { Logo } from "@/components/Logo";
import { downloadCsv } from "@/lib/csv";
import { AlertsTab, sendNudge } from "@/components/admin/AlertsTab";
import type { AttendanceAction, DailyRow, MemberType, OrgSettings, Profile, SearchRow } from "@/lib/types";

type Tab = "log" | "hours" | "alerts" | "users" | "settings";
const TABS: [Tab, string][] = [
  ["log", "יומן נוכחות"],
  ["hours", "סיכום שעות"],
  ["alerts", "התראות וביקורות"],
  ["users", "משתמשים"],
  ["settings", "הגדרות"],
];

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKey(d);
}

export default function AdminPage() {
  const { profile, org, loading, reload } = useMe();
  const [tab, setTab] = useState<Tab>("log");
  const [logPreset, setLogPreset] = useState<Preset>("approved");
  const [logKey, setLogKey] = useState(0);
  const openLog = (p: Preset) => { setLogPreset(p); setLogKey((k) => k + 1); setTab("log"); };
  const [people, setPeople] = useState<Profile[]>([]);
  const [tiles, setTiles] = useState({ inside: 0, checkins: 0, rejected: 0 });

  const loadPeople = useCallback(async () => {
    const { data } = await supabase().from("profiles").select("*").order("created_at", { ascending: false });
    setPeople((data as Profile[]) ?? []);
  }, []);

  const loadTiles = useCallback(async () => {
    const { data } = await supabase()
      .from("attendance_logs")
      .select("user_id,action,status,recorded_at")
      .gte("recorded_at", startOfIsraelDay())
      .order("recorded_at", { ascending: true });
    const rows = (data as { user_id: string; action: AttendanceAction; status: string }[]) ?? [];
    const last = new Map<string, AttendanceAction>();
    rows.filter((r) => r.status === "approved").forEach((r) => last.set(r.user_id, r.action));
    setTiles({
      inside: [...last.values()].filter((a) => a === "check_in").length,
      checkins: rows.filter((r) => r.status === "approved" && r.action === "check_in").length,
      rejected: rows.filter((r) => r.status.startsWith("rejected")).length,
    });
  }, []);

  const isAdmin = profile?.access_role === "admin" && profile.is_active;

  useEffect(() => {
    if (!isAdmin) return;
    loadPeople();
    loadTiles();
  }, [isAdmin, loadPeople, loadTiles]);

  if (loading) return <div className="center"><div className="spinner" aria-label="טוען" /></div>;

  if (!isAdmin)
    return (
      <main className="app">
        <div className="center">
          <div style={{ textAlign: "center" }}>
            <h1 className="title">אין הרשאת ניהול</h1>
            <p className="lead">המסך הזה פתוח רק למנהלים.</p>
            <p><Link className="btn" href="/">חזרה לדיווח</Link></p>
          </div>
        </div>
      </main>
    );

  const listed = people.filter((p) => p.onboarding_completed);
  const active = listed.filter((p) => p.is_active).length;

  return (
    <>
      <header className="head">
        <div className="wrap top">
          <div className="brand">
            <Logo height={46} />
            <span className="sep" aria-hidden="true" />
            <div>
              <h1>ניהול נוכחות</h1>
              <p>{org?.name ?? ""} · רדיוס <span className="num">{org?.allowed_radius_m ?? "—"}</span> מ&apos;</p>
            </div>
          </div>
          <Link className="btn press" href="/">למסך הדיווח</Link>
        </div>
      </header>

      <main className="wrap admin-main">
        <div className="tiles">
          <div className="card tile"><span className="k">בפנים כרגע</span><span className="v num">{tiles.inside}</span><span className="hint">מתוך {active} פעילים</span></div>
          <div className="card tile"><span className="k">כניסות היום</span><span className="v num">{tiles.checkins}</span><span className="hint">דיווחים מאושרים</span></div>
          <button type="button" className="card tile tile-link press" onClick={() => openLog("rejected")}>
            <span className="k">ניסיונות שנדחו היום</span><span className="v num">{tiles.rejected}</span>
            <span className="hint">{tiles.rejected ? "לחיצה מציגה מי נדחה ולמה" : "אין דחיות"}</span>
          </button>
          <div className="card tile"><span className="k">משתמשים פעילים</span><span className="v num">{active}</span><span className="hint">{listed.length - active} מושבתים · {people.length - listed.length} באמצע הרשמה</span></div>
        </div>

        <div className="subtabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {tab === "log" && <LogTab key={logKey} people={listed} onChange={loadTiles} initialPreset={logPreset} />}
        {tab === "hours" && <HoursTab people={listed} />}
        {tab === "alerts" && <AlertsTab people={listed} />}
        {tab === "users" && <UsersTab people={people} me={profile!} onChange={loadPeople} />}
        {tab === "settings" && org && <SettingsTab org={org} onSaved={reload} />}
      </main>
    </>
  );
}

/* ---------------- log ---------------- */
type Preset = "all" | "approved" | "rejected" | "rejected_distance" | "rejected_accuracy" | "rejected_sequence" | "rejected_inactive" | "manual" | "voided";
const PRESETS: { key: Preset; label: string; file: string }[] = [
  { key: "all", label: "כל הדיווחים", file: "all" },
  { key: "approved", label: "מאושרים", file: "approved" },
  { key: "rejected", label: "כל מי שנדחה", file: "rejected" },
  { key: "rejected_distance", label: "נדחו: מחוץ לרדיוס", file: "rejected_distance" },
  { key: "rejected_accuracy", label: "נדחו: GPS לא מדויק", file: "rejected_gps" },
  { key: "rejected_sequence", label: "נדחו: רצף שגוי", file: "rejected_sequence" },
  { key: "rejected_inactive", label: "נדחו: משתמש מושבת", file: "rejected_inactive" },
  { key: "manual", label: "תיקונים ידניים", file: "manual" },
  { key: "voided", label: "בוטלו", file: "voided" },
];

type PersonRow = {
  user_id: string; full_name: string; national_id: string | null; member_type: MemberType | null; is_active: boolean;
  approved: number; rejected: number; topReason: string; last: string;
};

function byPerson(rows: SearchRow[]): PersonRow[] {
  const m = new Map<string, PersonRow & { reasons: Map<string, number> }>();
  for (const r of rows) {
    let p = m.get(r.user_id);
    if (!p) {
      p = { user_id: r.user_id, full_name: r.full_name, national_id: r.national_id, member_type: r.member_type, is_active: r.is_active,
            approved: 0, rejected: 0, topReason: "", last: r.recorded_at, reasons: new Map() };
      m.set(r.user_id, p);
    }
    if (r.status === "voided") continue;
    if (r.status === "approved") p.approved++;
    else { p.rejected++; p.reasons.set(r.status, (p.reasons.get(r.status) ?? 0) + 1); }
    if (r.recorded_at > p.last) p.last = r.recorded_at;
  }
  return [...m.values()].map(({ reasons, ...p }) => {
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
    return { ...p, topReason: top ? STATUS_LABEL[top[0] as keyof typeof STATUS_LABEL].text : "" };
  });
}

function LogTab({ people, onChange, initialPreset }: { people: Profile[]; onChange: () => void; initialPreset: Preset }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<MemberType | "">("");
  const [from, setFrom] = useState(initialPreset === "approved" ? daysAgo(6) : dayKey());
  const [to, setTo] = useState(dayKey());
  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [view, setView] = useState<"rows" | "people">("rows");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [fixing, setFixing] = useState<number | null>(null);

  const fetchRows = useCallback(async () => {
    const serverStatus = preset === "approved" || preset === "voided" || preset.startsWith("rejected_") ? preset : null;
    const { data, error } = await supabase().rpc("search_attendance", {
      p_query: q.trim() || null,
      p_member_type: role || null,
      p_from: from || null,
      p_to: to || null,
      p_status: serverStatus,
      p_include_inactive: true,
      p_limit: 1000,
      p_offset: 0,
    });
    if (error) throw error;
    let r = (data as SearchRow[]) ?? [];
    if (preset === "rejected") r = r.filter((x) => x.status.startsWith("rejected"));
    if (preset === "manual") r = r.filter((x) => x.source === "admin_manual");
    return r;
  }, [q, role, from, to, preset]);

  useEffect(() => {
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        setRows(await fetchRows());
      } catch (e) {
        toast(friendlyError(e));
      }
      setBusy(false);
    }, 250);
    return () => clearTimeout(t);
  }, [fetchRows, toast]);

  const people_ = useMemo(() => {
    const list = byPerson(rows);
    return preset === "approved" ? list.sort((a, b) => a.full_name.localeCompare(b.full_name, "he"))
                                 : list.sort((a, b) => b.rejected - a.rejected || a.full_name.localeCompare(b.full_name, "he"));
  }, [rows, preset]);

  const presetInfo = PRESETS.find((p) => p.key === preset)!;
  const truncated = rows.length >= 1000;

  function exportCsv() {
    const base = `attendance_${presetInfo.file}_${from}_${to}`;
    if (view === "people") {
      downloadCsv(`${base}_by_person.csv`, [
        ["שם", "ת.ז", "תפקיד", "פעיל", "דיווחים מאושרים", "ניסיונות שנדחו", "סיבה עיקרית לדחייה", "דיווח אחרון"],
        ...people_.map((p) => [p.full_name, p.national_id, p.member_type ? ROLE_LABEL[p.member_type] : "", p.is_active ? "כן" : "לא",
          p.approved, p.rejected, p.topReason, `${fmtDate(p.last)} ${fmtTime(p.last)}`]),
      ]);
    } else {
      downloadCsv(`${base}.csv`, [
        ["תאריך", "שעה", "שם", "ת.ז", "תפקיד", "פעולה", "סטטוס", "מרחק (מ)", "מקור", "הערה"],
        ...rows.map((r) => [
          fmtDate(r.recorded_at), fmtTime(r.recorded_at), r.full_name, r.national_id,
          r.member_type ? ROLE_LABEL[r.member_type] : "", ACTION_LABEL[r.action], STATUS_LABEL[r.status].text,
          r.distance_m != null ? Math.round(r.distance_m) : "", r.source === "admin_manual" ? "תיקון ידני" : "GPS", r.note,
        ]),
      ]);
    }
    if (truncated) toast("יוצאו 1,000 הרשומות האחרונות. לייצוא מלא צריך לצמצם את טווח התאריכים.");
  }

  return (
    <>
      <div className="chips" role="group" aria-label="איזו רשימה להציג" style={{ marginBottom: 12 }}>
        {PRESETS.map((p) => (
          <button key={p.key} type="button" className="chip press" aria-pressed={preset === p.key} onClick={() => setPreset(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="filters">
        <label className="grow">חיפוש לפי שם או ת.ז<input type="search" id="fq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ת.ז מלאה או חלק מהשם" /></label>
        <label>תפקיד
          <select id="frole" value={role} onChange={(e) => setRole(e.target.value as MemberType | "")}>
            <option value="">הכל</option>
            {(Object.keys(ROLE_LABEL) as MemberType[]).map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}
          </select>
        </label>
        <label>מתאריך<input type="date" id="ffrom" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>עד תאריך<input type="date" id="fto" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>תצוגה
          <select id="fview" value={view} onChange={(e) => setView(e.target.value as typeof view)}>
            <option value="rows">כל דיווח בשורה</option>
            <option value="people">סיכום לפי אדם</option>
          </select>
        </label>
        <button className="btn press" onClick={exportCsv} disabled={!rows.length}><DownloadIcon /> ייצוא הרשימה</button>
        <button className="btn press" onClick={() => setShowManual((v) => !v)}>תיקון ידני</button>
      </div>

      {showManual && (
        <ManualForm
          people={people}
          onDone={() => {
            setShowManual(false);
            onChange();
            fetchRows().then(setRows).catch(() => {});
          }}
        />
      )}

      <div className="card">
        <div className="tablebox">
          {view === "rows" ? (
            <table>
              <thead>
                <tr><th>תאריך</th><th>שעה</th><th>שם</th><th>ת.ז</th><th>תפקיד</th><th>פעולה</th><th>סטטוס</th><th>מרחק</th><th>מקור</th><th>הערה</th><th></th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((r) => (
                  <Fragment key={r.log_id}>
                  <tr className={r.is_active && r.status !== "voided" ? "" : "off"}>
                    <td className="num">{fmtDate(r.recorded_at)}</td>
                    <td className="num">{fmtTime(r.recorded_at)}</td>
                    <td><span className="who">{r.full_name}</span>{!r.is_active && <> <span className="pill neutral">מושבת</span></>}</td>
                    <td className="num mono">{r.national_id}</td>
                    <td>{r.member_type ? ROLE_LABEL[r.member_type] : "—"}</td>
                    <td>{ACTION_LABEL[r.action]}</td>
                    <td><span className={`pill ${STATUS_LABEL[r.status].tone}`}>{STATUS_LABEL[r.status].text}</span></td>
                    <td className="num">{r.distance_m != null ? `${Math.round(r.distance_m)} מ'` : "—"}</td>
                    <td>{r.source === "admin_manual" ? <span className="pill warn plain">תיקון ידני</span> : <span className="muted">GPS</span>}</td>
                    <td className="note-cell" title={r.note ?? ""}>{r.note ?? ""}</td>
                    <td>
                      {(r.status === "approved" || r.status.startsWith("rejected")) && (
                        <button className="btn small press" onClick={() => setFixing(fixing === r.log_id ? null : r.log_id)} aria-expanded={fixing === r.log_id}>
                          תיקון
                        </button>
                      )}
                    </td>
                  </tr>
                  {fixing === r.log_id && (
                    <tr className="fix-row">
                      <td colSpan={11}>
                        <FixRow
                          row={r}
                          onCancel={() => setFixing(null)}
                          onDone={() => {
                            setFixing(null);
                            onChange();
                            fetchRows().then(setRows).catch(() => {});
                          }}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr><th>שם</th><th>ת.ז</th><th>תפקיד</th><th>מאושרים</th><th>נדחו</th><th>סיבה עיקרית לדחייה</th><th>דיווח אחרון</th></tr>
              </thead>
              <tbody>
                {people_.map((p) => (
                  <tr key={p.user_id} className={p.is_active ? "" : "off"}>
                    <td><span className="who">{p.full_name}</span>{!p.is_active && <> <span className="pill neutral">מושבת</span></>}</td>
                    <td className="num mono">{p.national_id}</td>
                    <td>{p.member_type ? ROLE_LABEL[p.member_type] : "—"}</td>
                    <td className="num">{p.approved}</td>
                    <td className="num">{p.rejected ? <b style={{ color: "var(--bad)" }}>{p.rejected}</b> : 0}</td>
                    <td>{p.topReason || <span className="muted">—</span>}</td>
                    <td className="num">{fmtDate(p.last)} {fmtTime(p.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!rows.length && <div className="empty">{busy ? "טוען…" : "אין רשומות ברשימה הזו בטווח שנבחר"}</div>}
        </div>
      </div>
      <div className="meta">
        <span>
          {view === "rows"
            ? `${rows.length}${truncated ? "+" : ""} רשומות${rows.length > 300 ? " · מוצגות 300 האחרונות, הייצוא כולל את כולן" : ""}`
            : `${people_.length} אנשים · ${rows.length}${truncated ? "+" : ""} רשומות`}
        </span>
        <span>{presetInfo.label} · <span className="num">{from.split("-").reverse().join("/")}</span> עד <span className="num">{to.split("-").reverse().join("/")}</span></span>
      </div>
    </>
  );
}

function ReasonPicker({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <div className="reason">
      <div className="chips">
        {FIX_REASONS.map((r) => (
          <button key={r} type="button" className="chip press" aria-pressed={value === r} onClick={() => onChange(r)}>{r}</button>
        ))}
      </div>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="או לכתוב סיבה אחרת" maxLength={200} />
    </div>
  );
}

/** תיקון של שורה קיימת ביומן: אישור דיווח שנדחה, או ביטול דיווח שאושר */
function FixRow({ row, onCancel, onDone }: { row: SearchRow; onCancel: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const approving = row.status.startsWith("rejected");

  async function save() {
    if (!reason.trim()) {
      toast("חובה לבחור או לכתוב סיבה");
      return;
    }
    setBusy(true);
    const { error } = approving
      ? await supabase().rpc("admin_approve_rejected", { p_log_id: row.log_id, p_reason: reason.trim() })
      : await supabase().rpc("admin_void_attendance", { p_log_id: row.log_id, p_reason: reason.trim() });
    setBusy(false);
    if (error) {
      toast(friendlyError(error));
      return;
    }
    toast(approving ? "הדיווח אושר ידנית" : "הדיווח בוטל. הוא נשאר ביומן מסומן כמבוטל");
    onDone();
  }

  return (
    <div className="fix">
      <p className="eyebrow" style={{ margin: 0 }}>
        {approving
          ? `אישור ידני: ${ACTION_LABEL[row.action]} של ${row.full_name} ב-${fmtTime(row.recorded_at)} ייחשב כמאושר`
          : `ביטול: ${ACTION_LABEL[row.action]} של ${row.full_name} ב-${fmtTime(row.recorded_at)} לא ייספר בשעות`}
      </p>
      <ReasonPicker value={reason} onChange={setReason} id={`fix-${row.log_id}`} />
      <div className="confirm">
        <button className={`btn small press ${approving ? "primary" : "danger"}`} onClick={save} disabled={busy}>
          {busy ? "שומר…" : approving ? "אישור הדיווח" : "ביטול הדיווח"}
        </button>
        <button className="btn small press" onClick={onCancel}>סגירה</button>
      </div>
    </div>
  );
}

export type ManualPrefill = { userId: string; action: AttendanceAction; when: string };

function ManualForm({ people, onDone, prefill, onCancel }: { people: Profile[]; onDone: () => void; prefill?: ManualPrefill; onCancel?: () => void }) {
  const toast = useToast();
  const [userId, setUserId] = useState(prefill?.userId ?? "");
  const [action, setAction] = useState<AttendanceAction>(prefill?.action ?? "check_out");
  const [when, setWhen] = useState(prefill?.when ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !when || !note.trim()) {
      setError("יש לבחור משתמש, זמן, וסיבה.");
      return;
    }
    setBusy(true);
    const { error } = await supabase().rpc("admin_add_manual_attendance", {
      p_user_id: userId,
      p_action: action,
      p_recorded_at: new Date(when).toISOString(),
      p_note: note.trim(),
    });
    setBusy(false);
    if (error) {
      setError(friendlyError(error));
      return;
    }
    toast("התיקון נשמר ביומן");
    onDone();
  }

  return (
    <form className="card panel" style={{ marginBottom: 14, display: "grid", gap: 12 }} onSubmit={save} noValidate>
      <p className="eyebrow" style={{ margin: 0 }}>הוספת דיווח ידני · נרשם כשורה חדשה עם שם המנהל והסיבה</p>
      <div className="filters" style={{ marginBottom: 0 }}>
        <label className="grow">משתמש
          <select id="muser" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">בחירה…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.national_id}</option>)}
          </select>
        </label>
        <label>פעולה
          <select id="maction" value={action} onChange={(e) => setAction(e.target.value as AttendanceAction)}>
            <option value="check_in">כניסה</option>
            <option value="check_out">יציאה</option>
          </select>
        </label>
        <label>מתי<input type="datetime-local" id="mwhen" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
      </div>
      <div className="field" style={{ fontSize: ".78rem", color: "var(--muted)" }}>
        סיבה (חובה)
        <ReasonPicker value={note} onChange={setNote} id="mnote" />
      </div>
      {error && <p className="err">{error}</p>}
      <div className="confirm">
        <button className="btn primary press" type="submit" disabled={busy}>{busy ? "שומר…" : "שמירת התיקון"}</button>
        {onCancel && <button className="btn press" type="button" onClick={onCancel}>ביטול</button>}
      </div>
    </form>
  );
}

/* ---------------- hours ---------------- */
function HoursTab({ people }: { people: Profile[] }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<MemberType | "">("");
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(dayKey());
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [prefill, setPrefill] = useState<ManualPrefill | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(async () => {
      let query = supabase().from("v_daily_presence").select("*").order("work_date", { ascending: false }).limit(1000);
      if (from) query = query.gte("work_date", from);
      if (to) query = query.lte("work_date", to);
      if (role) query = query.eq("member_type", role);
      const s = q.trim().replace(/[,()%*]/g, "");
      if (s) query = /^\d+$/.test(s) ? query.like("national_id", `%${s}%`) : query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%`);
      const { data, error } = await query;
      if (error) toast(friendlyError(error));
      setRows((data as DailyRow[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [q, role, from, to, toast, reloadKey]);

  const total = rows.reduce((s, r) => s + (r.total_minutes ?? 0), 0);
  const name = (r: DailyRow) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();

  return (
    <>
      <div className="filters">
        <label className="grow">חיפוש לפי שם או ת.ז<input type="search" id="hq" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label>תפקיד
          <select id="hrole" value={role} onChange={(e) => setRole(e.target.value as MemberType | "")}>
            <option value="">הכל</option>
            {(Object.keys(ROLE_LABEL) as MemberType[]).map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}
          </select>
        </label>
        <label>מתאריך<input type="date" id="hfrom" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>עד תאריך<input type="date" id="hto" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button
          className="btn press"
          onClick={() =>
            downloadCsv(`hours_${from}_${to}.csv`, [
              ["תאריך", "שם", "ת.ז", "תפקיד", "כניסה ראשונה", "יציאה אחרונה", "שעות", "חסרה יציאה"],
              ...rows.map((r) => [
                r.work_date.split("-").reverse().join("/"), name(r), r.national_id, r.member_type ? ROLE_LABEL[r.member_type] : "",
                r.first_in ? fmtTime(r.first_in) : "", r.last_out ? fmtTime(r.last_out) : "", (r.total_minutes / 60).toFixed(2), r.missing_checkout ? "כן" : "",
              ]),
            ])
          }
        >
          <DownloadIcon /> ייצוא CSV
        </button>
      </div>
      {prefill && (
        <ManualForm
          key={prefill.userId + prefill.when}
          people={people}
          prefill={prefill}
          onCancel={() => setPrefill(null)}
          onDone={() => {
            setPrefill(null);
            setReloadKey((x) => x + 1);
          }}
        />
      )}
      <div className="card">
        <div className="tablebox">
          <table>
            <thead><tr><th>תאריך</th><th>שם</th><th>ת.ז</th><th>תפקיד</th><th>כניסה ראשונה</th><th>יציאה אחרונה</th><th>שעות</th><th>הערה</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id + r.work_date} className={r.is_active ? "" : "off"}>
                  <td className="num">{r.work_date.split("-").reverse().join("/")}</td>
                  <td><span className="who">{name(r)}</span></td>
                  <td className="num mono">{r.national_id}</td>
                  <td>{r.member_type ? ROLE_LABEL[r.member_type] : "—"}</td>
                  <td className="num">{r.first_in ? fmtTime(r.first_in) : "—"}</td>
                  <td className="num">{r.last_out ? fmtTime(r.last_out) : "—"}</td>
                  <td className="num"><b>{minutesLabel(r.total_minutes)}</b></td>
                  <td>
                    {r.missing_checkout && (
                      <span className="confirm">
                        <span className="pill warn">חסרה יציאה</span>
                        <button className="btn small press" onClick={() => setPrefill({ userId: r.user_id, action: "check_out", when: `${r.work_date}T18:00` })}>הוספת יציאה</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">אין נתונים בטווח</div>}
        </div>
      </div>
      <div className="meta"><span>{rows.length} ימי נוכחות · סה&quot;כ <span className="num">{minutesLabel(total)}</span> שעות</span></div>
    </>
  );
}

/* ---------------- users ---------------- */
function UsersTab({ people, me, onChange }: { people: Profile[]; me: Profile; onChange: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [showOff, setShowOff] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return people.filter(
      (p) =>
        (showOff || p.is_active) &&
        (!s || p.full_name.includes(s) || (p.national_id ?? "").includes(s) || p.email.toLowerCase().includes(s)),
    );
  }, [people, q, showOff]);

  async function run(fn: string, args: Record<string, unknown>, done: string) {
    const { error } = await supabase().rpc(fn, args);
    if (error) {
      toast(friendlyError(error));
      return;
    }
    toast(done);
    setPending(null);
    setReason("");
    onChange();
  }

  return (
    <>
      <div className="filters">
        <label className="grow">חיפוש משתמש<input type="search" id="uq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם, ת.ז או מייל" /></label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" id="uoff" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> להציג מושבתים
        </label>
      </div>
      <div className="card">
        <div className="tablebox">
          <table>
            <thead><tr><th>שם</th><th>ת.ז</th><th>אימייל</th><th>תפקיד</th><th>הרשאה</th><th>סטטוס</th><th>פעולות</th></tr></thead>
            <tbody>
              {list.map((p) => {
                const self = p.id === me.id;
                return (
                  <tr key={p.id} className={p.is_active ? "" : "off"}>
                    <td>
                      <span className="who">{p.full_name || "—"}</span>
                      {self && <small className="muted"> (אתה)</small>}
                      {!p.onboarding_completed && <> <span className="pill neutral plain">לא השלים הרשמה</span></>}
                    </td>
                    <td className="num mono">{p.national_id ?? "—"}</td>
                    <td className="ltr">{p.email}</td>
                    <td>{p.member_type ? ROLE_LABEL[p.member_type] : "—"}</td>
                    <td>{p.access_role === "admin" ? <span className="pill ok plain">מנהל</span> : <span className="muted">משתמש</span>}</td>
                    <td>
                      {p.is_active ? <span className="pill ok">פעיל</span> : <><span className="pill bad">מושבת</span> <small className="muted">{p.deactivation_reason}</small></>}
                    </td>
                    <td>
                      {pending === p.id ? (
                        <span className="confirm">
                          <input id={`reason-${p.id}`} placeholder="סיבת השבתה" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                          <button className="btn small danger press" onClick={() => run("admin_set_user_active", { p_user_id: p.id, p_active: false, p_reason: reason.trim() || null }, `${p.full_name || p.email} הושבת. ההיסטוריה נשמרה`)}>אישור</button>
                          <button className="btn small press" onClick={() => setPending(null)}>ביטול</button>
                        </span>
                      ) : p.is_active ? (
                        <span className="confirm">
                          {!self && p.onboarding_completed && (
                            <button className="btn small press" onClick={() => sendNudge(p.id, toast)} title="שולח לו התראה לאשר נוכחות">נדנוד</button>
                          )}
                          <button className="btn small danger press" disabled={self} title={self ? "מנהל אינו יכול להשבית את עצמו" : ""} onClick={() => { setPending(p.id); setReason(""); }}>השבתה</button>
                          {p.access_role === "admin" ? (
                            !self && <button className="btn small press" onClick={() => run("admin_set_access_role", { p_user_id: p.id, p_role: "member" }, "הרשאת הניהול הוסרה")}>הסרת ניהול</button>
                          ) : (
                            <button className="btn small press" onClick={() => run("admin_set_access_role", { p_user_id: p.id, p_role: "admin" }, "הרשאת ניהול ניתנה")}>הפוך למנהל</button>
                          )}
                        </span>
                      ) : (
                        <button className="btn small press" onClick={() => run("admin_set_user_active", { p_user_id: p.id, p_active: true, p_reason: null }, "המשתמש הופעל מחדש")}>הפעלה מחדש</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!list.length && <div className="empty">אין משתמשים להצגה</div>}
        </div>
      </div>
      <div className="meta"><span>השבתה לא מוחקת היסטוריה. המשתמש לא יכול לדווח ולא נספר בין הפעילים.</span></div>
    </>
  );
}

/* ---------------- settings ---------------- */
function SettingsTab({ org, onSaved }: { org: OrgSettings; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: org.name,
    latitude: String(org.latitude),
    longitude: String(org.longitude),
    allowed_radius_m: String(org.allowed_radius_m),
    max_gps_accuracy_m: String(org.max_gps_accuracy_m),
    min_seconds_between_reports: String(org.min_seconds_between_reports),
    notification_retention_days: String(org.notification_retention_days ?? 30),
  });
  const hasRetention = org.notification_retention_days !== undefined;
  const [admins, setAdmins] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase().from("admin_emails").select("email").order("email").then(({ data }) => setAdmins((data ?? []).map((r: { email: string }) => r.email)));
  }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lat = Number(f.latitude), lng = Number(f.longitude), rad = Number(f.allowed_radius_m), acc = Number(f.max_gps_accuracy_m), gap = Number(f.min_seconds_between_reports);
    const keep = Number(f.notification_retention_days);
    if (!f.name.trim() || !(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180) || !(rad >= 20 && rad <= 2000) || !(acc >= 5 && acc <= 1000) || !(gap >= 0 && gap <= 3600) || (hasRetention && !(keep >= 1 && keep <= 365))) {
      toast("יש ערך לא תקין. רדיוס 20 עד 2000 מ', דיוק 5 עד 1000 מ', שמירת התראות 1 עד 365 ימים.");
      return;
    }
    setBusy(true);
    const { error } = await supabase()
      .from("organization_settings")
      .update({ name: f.name.trim(), latitude: lat, longitude: lng, allowed_radius_m: rad, max_gps_accuracy_m: acc, min_seconds_between_reports: gap, ...(hasRetention ? { notification_retention_days: keep } : {}) })
      .eq("id", 1);
    setBusy(false);
    if (error) {
      toast(friendlyError(error));
      return;
    }
    toast("ההגדרות נשמרו");
    onSaved();
  }

  return (
    <form className="card panel" onSubmit={save} noValidate style={{ display: "grid", gap: 18, maxWidth: 720 }}>
      <div className="form-grid">
        <label className="field">שם הישיבה<input id="sname" value={f.name} onChange={set("name")} /></label>
        <label className="field">קו רוחב (Latitude)<input id="slat" className="ltr num" inputMode="decimal" value={f.latitude} onChange={set("latitude")} /></label>
        <label className="field">קו אורך (Longitude)<input id="slng" className="ltr num" inputMode="decimal" value={f.longitude} onChange={set("longitude")} /></label>
        <label className="field">רדיוס מותר (מטר)<input id="srad" className="ltr num" inputMode="numeric" value={f.allowed_radius_m} onChange={set("allowed_radius_m")} /></label>
        <label className="field">דיוק GPS מקסימלי (מטר)<input id="sacc" className="ltr num" inputMode="numeric" value={f.max_gps_accuracy_m} onChange={set("max_gps_accuracy_m")} /></label>
        <label className="field">המתנה בין דיווחים (שניות)<input id="sgap" className="ltr num" inputMode="numeric" value={f.min_seconds_between_reports} onChange={set("min_seconds_between_reports")} /></label>
        {hasRetention && (
          <label className="field">מחיקת היסטוריית התראות אחרי (ימים)<input id="skeep" className="ltr num" inputMode="numeric" value={f.notification_retention_days} onChange={set("notification_retention_days")} /></label>
        )}
      </div>
      <p className="help">
        לבדיקת הנקודה:{" "}
        <a href={`https://www.google.com/maps?q=${f.latitude},${f.longitude}`} target="_blank" rel="noreferrer">פתיחה ב-Google Maps</a>.
        הרדיוס נשמר עם כל דיווח, כך ששינוי לא משפיע על דיווחים קודמים.
      </p>
      <div>
        <button className="btn primary press" type="submit" disabled={busy}>{busy ? "שומר…" : "שמירת הגדרות"}</button>
      </div>
      <div>
        <p className="eyebrow">מיילים שמקבלים הרשאת ניהול אוטומטית בהרשמה</p>
        <p className="ltr" style={{ margin: 0 }}>{admins.join(" · ") || "—"}</p>
      </div>
    </form>
  );
}
