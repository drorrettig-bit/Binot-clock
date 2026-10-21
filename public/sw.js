// Service worker מינימלי: נדרש כדי שהדפדפן יציע להתקין את האפליקציה.
// לא שומר תוכן במטמון, כך שכל פתיחה מקבלת את הגרסה העדכנית.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request));
});
