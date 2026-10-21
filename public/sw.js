// Service worker: מאפשר התקנה למסך הבית ומציג התראות מהישיבה.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "שעון נוכחות", body: event.data && event.data.text() }; }
  const base = data.title || "שעון נוכחות";
  // ביקורת: עיגול אדום בכותרת, רטט חזק, וההתראה נשארת עד שלוחצים
  const title = data.audit && !base.startsWith("🔴") ? "🔴 " + base : base;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      vibrate: data.audit ? [400, 150, 400, 150, 400] : [120],
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      renotify: true,
      requireInteraction: !!data.audit,
      dir: "rtl",
      lang: "he",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin)) {
          return c.navigate(target).then((w) => (w || c).focus());
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
