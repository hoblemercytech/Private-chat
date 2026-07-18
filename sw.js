self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    self.clients.claim()
  );
});

self.addEventListener("push", event => {
  if (!event.data) return;
  
  const data = event.data.json();
  
  event.waitUntil(
    self.registration.showNotification(
      data.title || "Threadline",
      {
        body: data.body || "New message",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: {
          url: data.url || "/"
        }
      }
    )
  );
});

self.addEventListener(
  "notificationclick",
  event => {
    event.notification.close();
    
    event.waitUntil(
      clients.matchAll({
        type: "window",
        includeUncontrolled: true
      }).then(clientList => {
        
        for (const client of clientList) {
          if ("focus" in client) {
            return client.focus();
          }
        }
        
        if (clients.openWindow) {
          return clients.openWindow(
            event.notification.data.url
          );
        }
        
      })
    );
  }
);