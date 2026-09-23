const SHELL_CACHE = "excavatorium-static-v2-lantern";
const SHELL_URLS = [
  "/",
  "/offline.html",
  "/lantern.webmanifest",
  "/lantern-favicon.ico",
  "/lantern-icon-192.png",
  "/lantern-icon-512.png",
  "/lantern-icon-192-maskable.png",
  "/lantern-icon-512-maskable.png",
  "/lantern-apple-touch-icon.png",
];

const PRIVATE_PATH_PREFIXES = [
  "/api/",
  "/auth/",
  "/functions/",
  "/graphql",
  "/openai/",
  "/rest/",
  "/rpc/",
  "/storage/",
  "/supabase/",
];

function isPrivateRequest(request, url) {
  if (url.origin !== self.location.origin) return true;
  if (request.method !== "GET") return true;
  if (request.headers.has("authorization")) return true;
  return PRIVATE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isStaticAsset(request, url) {
  if (request.destination === "manifest") return true;
  if (!["font", "image", "script", "style"].includes(request.destination)) {
    return false;
  }
  // Vite's hashed client assets are public static shell resources. Keep the
  // allowlist narrow so an image or file endpoint cannot become a data cache.
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/_build/") ||
    [
      "/lantern-apple-touch-icon.png",
      "/lantern-favicon.ico",
      "/lantern-icon-192-maskable.png",
      "/lantern-icon-192.png",
      "/lantern-icon-512-maskable.png",
      "/lantern-icon-512.png",
    ].includes(url.pathname)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("excavatorium-") && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Supabase, OpenAI, API, auth, REST, and every cross-origin request remain
  // network-only. The worker never caches authenticated/private data.
  if (isPrivateRequest(request, url)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  if (!isStaticAsset(request, url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const cacheControl = response.headers.get("cache-control") ?? "";
        if (
          !response.ok ||
          response.type !== "basic" ||
          /\b(private|no-store)\b/i.test(cacheControl)
        ) {
          return response;
        }
        const copy = response.clone();
        void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
