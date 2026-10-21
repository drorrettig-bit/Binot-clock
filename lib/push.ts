"use client";

import { supabase } from "@/lib/supabase/client";
import { VAPID_PUBLIC_KEY } from "@/lib/config";

export type PushState = "unsupported" | "needs-install" | "default" | "denied" | "granted";

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushState(): PushState {
  if (typeof window === "undefined") return "unsupported";
  const hasApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // ב-iPhone התראות זמינות רק לאפליקציה שהותקנה למסך הבית
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!hasApi) return "unsupported";
  return Notification.permission as PushState;
}

function urlB64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** שומר את המנוי של המכשיר הזה בשרת. נקרא אחרי שניתנה הרשאה. */
async function saveSubscription(userId: string, sub: PushSubscription) {
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const sb = supabase();
  const { data: existing } = await sb.from("push_subscriptions").select("id").eq("endpoint", j.endpoint).maybeSingle();
  if (existing) {
    await sb.from("push_subscriptions").update({ p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 300) }).eq("id", existing.id);
    return;
  }
  const { error } = await sb.from("push_subscriptions").insert({
    user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
}

/** מבקש הרשאה (אם צריך), נרשם ושומר. מחזיר את מצב ההרשאה אחרי הניסיון. */
export async function enablePush(userId: string): Promise<PushState> {
  const state = pushState();
  if (state === "unsupported" || state === "needs-install" || state === "denied") return state;
  const perm = state === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") return perm as PushState;
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) });
  }
  await saveSubscription(userId, sub);
  return "granted";
}

/** אם כבר ניתנה הרשאה, מוודא בשקט שהמנוי שמור (למשל אחרי שהדפדפן חידש אותו). */
export async function refreshPush(userId: string) {
  if (pushState() !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js") ?? (await navigator.serviceWorker.register("/sw.js"));
    const sub = (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) }));
    await saveSubscription(userId, sub);
  } catch {
    /* לא קריטי */
  }
}

/** בהתנתקות: המכשיר מפסיק לקבל התראות של המשתמש הזה */
export async function disablePushOnThisDevice() {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  } catch {
    /* לא קריטי */
  }
}
