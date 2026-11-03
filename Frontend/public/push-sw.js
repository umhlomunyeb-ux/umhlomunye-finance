/* Loaded by the generated Workbox service worker. */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text?.() || "A funding request needs your attention." };
  }
  const title = payload.title || "Umhlomunye Finance";
  const options = {
    body: payload.body || "A new funding request needs your attention.",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: payload.event_key || payload.id || "umhlomunye-funding-alert",
    renotify: false,
    data: { url: payload.url || "/mobile/funding-requests" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/mobile/funding-requests", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        await client.focus();
        if ("navigate" in client && client.url !== target) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
