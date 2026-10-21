// שולח התראת Push לכל המכשירים הרשומים של קהל היעד של הודעה או ביקורת.
// רק מנהל יכול להפעיל: הבדיקה נעשית מול is_admin() עם האסימון של מי שקרא לפונקציה.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // 1. המפעיל חייב להיות מנהל
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: isAdmin, error: adminErr } = await asUser.rpc("is_admin");
  if (adminErr || isAdmin !== true) return json({ error: "forbidden" }, 403);

  let checkId: number;
  try {
    checkId = Number((await req.json()).check_id);
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (!Number.isFinite(checkId)) return json({ error: "bad request" }, 400);

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 2. ההודעה, קהל היעד והמכשירים שלו
  const { data: check, error: checkErr } = await db.from("spot_checks").select("*").eq("id", checkId).single();
  if (checkErr || !check) return json({ error: "not found" }, 404);

  let targetsQ = db.from("profiles").select("id").eq("is_active", true).eq("onboarding_completed", true);
  if (check.target_role) targetsQ = targetsQ.eq("member_type", check.target_role);
  if (check.target_user) targetsQ = targetsQ.eq("id", check.target_user);
  const { data: targets } = await targetsQ;
  const ids = (targets ?? []).map((t: { id: string }) => t.id);

  const { data: subs } = ids.length
    ? await db.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth").in("user_id", ids)
    : { data: [] };
  const devices = subs ?? [];

  // 3. מפתחות VAPID שמורים בטבלה הנעולה app_secrets
  const { data: secrets } = await db.from("app_secrets").select("name,value").in("name", ["vapid_public", "vapid_private"]);
  const pub = secrets?.find((s: { name: string }) => s.name === "vapid_public")?.value;
  const priv = secrets?.find((s: { name: string }) => s.name === "vapid_private")?.value;
  if (!pub || !priv) return json({ error: "push keys missing" }, 500);
  webpush.setVapidDetails("mailto:yebinot@gmail.com", pub, priv);

  const payload = JSON.stringify({
    title: check.title,
    body: check.body ?? (check.kind === "audit" ? "לחצו כדי לאשר נוכחות" : ""),
    url: check.kind === "audit" ? `/?check=${check.id}` : "/",
    tag: `check-${check.id}`,
    audit: check.kind === "audit",
  });

  // 4. שליחה. מכשיר שכבר לא קיים (404/410) נמחק מהרשימה.
  let sent = 0, failed = 0;
  const gone: number[] = [];
  const okIds: number[] = [];
  await Promise.all(
    devices.map(async (s: { id: number; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: check.kind === "audit" ? 60 * 60 : 24 * 60 * 60, urgency: "high" },
        );
        sent++;
        okIds.push(s.id);
      } catch (e) {
        failed++;
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.id);
      }
    }),
  );
  if (gone.length) await db.from("push_subscriptions").delete().in("id", gone);
  if (okIds.length) await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).in("id", okIds);

  const usersWithDevice = new Set(devices.map((d: { user_id: string }) => d.user_id)).size;
  await db.from("spot_checks").update({ device_count: devices.length, sent_count: sent, failed_count: failed }).eq("id", checkId);

  return json({ users: ids.length, users_with_device: usersWithDevice, devices: devices.length, sent, failed, removed: gone.length });
});
