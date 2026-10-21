"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { useMe } from "@/lib/useMe";
import { ACTION_LABEL, ROLE_LABEL, STATUS_LABEL, dayKey, fmtDate, fmtTime, minutesLabel, startOfIsraelDay } from "@/lib/labels";
import { friendlyError } from "@/lib/errors";
import { useToast } from "@/components/Toast";
import { DownloadIcon, LogoIcon } from "@/components/Icons";
import type { AttendanceAction, DailyRow, MemberType, OrgSettings, Profile, SearchRow } from "@/lib/types";

type Tab = "log" | "hours" | "users" | "settings";
const TABS: [Tab, string][] = [
  ["log", "יומן נוכחות"],
  ["hours", "סיכום שעות"],
  ["users", "משתמשים"],
  ["settings", "הגדרות"],
];

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKey(d);
}

function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM כדי ש-Excel יזהה UTF-8 ויציג עברית תקין
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AdminPage() {
  const { profile, org, loading, reload } = useMe();
  const [tab, setTab] = useState<Tab>("log");
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
      rejected: rows.filter((r) => r.status !== "approved").length,
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
            <LogoIcon width={28} height={28} />
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
          <div className="card tile"><span className="k">ניסיונות שנדחו היום</span><span className="v num">{tiles.rejected}</span><span className="hint">{tiles.rejected ? "פירוט ביומן, בסינון \"נדחו\"" : "אין דחיות"}</span></div>
          <div className="card tile"><span className="k">משתמשים פעילים</span><span className="v num">{active}</span><span className="hint">{listed.length - active} מושבתים · {people.length - listed.length} באמצע הרשמה</span></div>
        </div>

        <div className="subtabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {tab === "log" && <LogTab people={listed} onChange={loadTiles} />}
        {tab === "hours" && <HoursTab />}
        {tab === "users" && <UsersTab people={people} me={profile!} onChange={loadPeople} />}
        {tab === "settings" && org && <SettingsTab org={org} onSaved={reload} />}
      </main>
    </>
  );
}

/* ---------------- log ---------------- */
function LogTab({ people, onChange }: { people: Profile[]; onChange: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<MemberType | "">("");
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(dayKey());
  const [status, setStatus] = useState<"approved" | "rejected" | "all">("approved");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const fetchRows = useCallback(
    async (limit: number) => {
      const { data, error } = await supabase().rpc("search_attendance", {
        p_query: q.trim() || null,
        p_member_type: role || null,
        p_from: from || null,
        p_to: to || null,
        p_status: status === "approved" ? "approved" : null,
        p_include_inactive: true,
        p_limit: limit,
        p_offset: 0,
      });
      if (error) throw error;
      let r = (data as SearchRow[]) ?? [];
      if (status === "rejected") r = r.filter((x) => x.status !== "approved");
      return r;
    },
    [q, role, from, to, status],
  );

  useEffect(() => {
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        setRows(await fetchRows(300));
      } catch (e) {
        toast(friendlyError(e));
      }
      setBusy(false);
    }, 250);
    return () => clearTimeout(t);
  }, [fetchRows, toast]);

  async function exportCsv() {
    try {
      const all = await fetchRows(1000);
      downloadCsv(`attendance_${from}_${to}.csv`, [
        ["תאריך", "שעה", "שם", "ת.ז", "תפקיד", "פעולה", "סטטוס", "מרחק (מ)", "מקור", "הערה"],
        ...all.map((r) => [
          fmtDate(r.recorded_at), fmtTime(r.recorded_at), r.full_name, r.national_id,
          r.member_type ? ROLE_LABEL[r.member_type] : "", ACTION_LABEL[r.action], STATUS_LABEL[r.status].text,
          r.distance_m != null ? Math.round(r.distance_m) : "", r.source === "admin_manual" ? "תיקון ידני" : "GPS", r.note,
        ]),
      ]);
      if (all.length === 1000) toast("יוצאו 1,000 השורות הראשונות. צמצם את טווח התאריכים לייצוא מלא.");
    } catch (e) {
      toast(friendlyError(e));
    }
  }

  return (
    <>
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
        <label>סטטוס
          <select id="fstatus" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="approved">מאושרים</option>
            <option value="rejected">נדחו</option>
            <option value="all">הכל</option>
          </select>
        </label>
        <button className="btn press" onClick={exportCsv}><DownloadIcon /> ייצוא CSV</button>
        <button className="btn press" onClick={() => setShowManual((v) => !v)}>תיקון ידני</button>
      </div>

      {showManual && (
        <ManualForm
          people={people}
          onDone={() => {
            setShowManual(false);
            onChange();
            fetchRows(300).then(setRows).catch(() => {});
          }}
        />
      )}

      <div className="card">
        <div className="tablebox">
          <table>
            <thead>
              <tr><th>תאריך</th><th>שעה</th><th>שם</th><th>ת.ז</th><th>תפקיד</th><th>פעולה</th><th>סטטוס</th><th>מרחק</th><th>מקור</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.log_id} className={r.is_active ? "" : "off"}>
                  <td className="num">{fmtDate(r.recorded_at)}</td>
                  <td className="num">{fmtTime(r.recorded_at)}</td>
                  <td><span className="who">{r.full_name}</span>{!r.is_active && <> <span className="pill neutral">מושבת</span></>}</td>
                  <td className="num mono">{r.national_id}</td>
                  <td>{r.member_type ? ROLE_LABEL[r.member_type] : "—"}</td>
                  <td>{ACTION_LABEL[r.action]}</td>
                  <td><span className={`pill ${STATUS_LABEL[r.status].tone}`}>{STATUS_LABEL[r.status].text}</span></td>
                  <td className="num">{r.distance_m != null ? `${Math.round(r.distance_m)} מ'` : "—"}</td>
                  <td>{r.source === "admin_manual" ? <span className="pill warn" title={r.note ?? ""}>תיקון ידני</span> : <span className="muted">GPS</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">{busy ? "טוען…" : "לא נמצאו רשומות לפי הסינון"}</div>}
        </div>
      </div>
      <div className="meta">
        <span>{rows.length ? `${rows[0]?.total_count ?? rows.length} רשומות${rows.length < (rows[0]?.total_count ?? 0) ? ` · מוצגות ${rows.length} האחרונות` : ""}` : ""}</span>
        <span>הייצוא כולל עד 1,000 שורות לפי הסינון</span>
      </div>
    </>
  );
}

function ManualForm({ people, onDone }: { people: Profile[]; onDone: () => void }) {
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState<AttendanceAction>("check_out");
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !when || !note.trim()) {
      setError("יש לבחור משתמש, זמן, ולכתוב סיבה.");
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
    <form className="card panel" style={{ marginBottom: 14 }} onSubmit={save} noValidate>
      <p className="eyebrow">תיקון ידני · נרשם כשורה חדשה עם שם המנהל, בלי לשנות דיווחים קיימים</p>
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
        <label className="grow">סיבה<input id="mnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="למשל: שכח לדווח יציאה" /></label>
        <button className="btn primary press" type="submit" disabled={busy}>{busy ? "שומר…" : "שמירה"}</button>
      </div>
      {error && <p className="err" style={{ marginTop: 10 }}>{error}</p>}
    </form>
  );
}

/* ---------------- hours ---------------- */
function HoursTab() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<MemberType | "">("");
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(dayKey());
  const [rows, setRows] = useState<DailyRow[]>([]);

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
  }, [q, role, from, to, toast]);

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
                  <td>{r.missing_checkout && <span className="pill warn">חסרה יציאה</span>}</td>
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
  });
  const [admins, setAdmins] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase().from("admin_emails").select("email").order("email").then(({ data }) => setAdmins((data ?? []).map((r: { email: string }) => r.email)));
  }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lat = Number(f.latitude), lng = Number(f.longitude), rad = Number(f.allowed_radius_m), acc = Number(f.max_gps_accuracy_m), gap = Number(f.min_seconds_between_reports);
    if (!f.name.trim() || !(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180) || !(rad >= 20 && rad <= 2000) || !(acc >= 5 && acc <= 1000) || !(gap >= 0 && gap <= 3600)) {
      toast("יש ערך לא תקין. רדיוס 20 עד 2000 מ', דיוק 5 עד 1000 מ'.");
      return;
    }
    setBusy(true);
    const { error } = await supabase()
      .from("organization_settings")
      .update({ name: f.name.trim(), latitude: lat, longitude: lng, allowed_radius_m: rad, max_gps_accuracy_m: acc, min_seconds_between_reports: gap })
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
