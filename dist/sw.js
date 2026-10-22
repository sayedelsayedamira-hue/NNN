/// <reference lib="webworker" />

// Service Worker for Web Push Notifications
// Handles push events and notification clicks for the Radiology Worklist app

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try {
      data = { body: event.data ? event.data.text() : "" };
    } catch {
      data = {};
    }
  }

  const title = data.title || "نظام الأشعة";
  const options = {
    body: data.body || "لديك إشعار جديد",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: data.tag || "radiology-notification",
    renotify: true,
    data: {
      url: data.url || "/",
      caseId: data.caseId || null,
    },
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Focus existing tab if one is open
      for (const client of allClients) {
        if (client.url.includes(self.location.origin)) {
          if ("focus" in client) {
            client.focus();
            if ("postMessage" in client) {
              client.postMessage({
                type: "NOTIFICATION_CLICK",
                caseId: event.notification.data?.caseId,
              });
            }
            return;
          }
        }
      }

      // Open new tab if no existing tab
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: await getVapidKey(),
      });
      // Notify the app about the new subscription
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        client.postMessage({
          type: "PUSH_SUBSCRIPTION_CHANGE",
          subscription: JSON.parse(JSON.stringify(subscription)),
        });
      }
    })()
  );
});

async function getVapidKey() {
  // Fetch public VAPID key from the app config endpoint
  try {
    const response = await fetch("/vapid-public-key.json");
    const data = await response.json();
    return urlBase64ToUint8Array(data.publicKey);
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
