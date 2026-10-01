"use strict";

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const taskTitle = typeof payload.title === "string" ? payload.title.trim() : "";
  event.waitUntil(self.registration.showNotification("LTM Todo reminder", {
    body: taskTitle || "Task reminder",
    icon: "/icons/ltm-todo-192-apple.png",
    badge: "/icons/ltm-todo-192-apple.png",
    tag: typeof payload.reminderId === "string" ? `ltm-reminder-${payload.reminderId}` : undefined,
    data: { url: "/" }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url === target);
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  }));
});
