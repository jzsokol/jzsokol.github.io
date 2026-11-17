/* Decrypts the /coins apps on the fly. Files are stored as <path>.enc (12-byte IV + AES-256-GCM ciphertext).
   The key is a non-extractable CryptoKey kept in IndexedDB by the unlock page; without it, requests pass
   through untouched and the plain stubs send the visitor back to the unlock page. */
const BASE = new URL("./", self.location).pathname;          // "/coins/"
const APPS = ["grader/", "finder/"];
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json", wasm: "application/wasm", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  svg: "image/svg+xml", css: "text/css; charset=utf-8", webp: "image/webp" };
let key = null;

function idb() {
  return new Promise((ok, no) => {
    const r = indexedDB.open("coins-lock", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("k");
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function loadKey() {
  try {
    const db = await idb();
    return await new Promise(ok => { const q = db.transaction("k").objectStore("k").get("key"); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); });
  } catch { return null; }
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("message", e => {
  const done = () => e.ports[0] && e.ports[0].postMessage("ok");
  if (e.data === "lock") { key = null; done(); }
  else if (e.data === "reload-key") loadKey().then(k => { key = k; done(); });
});

self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || e.request.method !== "GET") return;
  const rel = u.pathname.startsWith(BASE) ? u.pathname.slice(BASE.length) : null;
  if (rel === null || !APPS.some(a => rel === a.slice(0, -1) || rel.startsWith(a))) return;
  e.respondWith(serve(e.request, rel));
});

async function serve(req, rel) {
  if (!APPS.some(a => rel.startsWith(a))) return Response.redirect(BASE + rel + "/", 302);
  if (!key) key = await loadKey();
  if (!key) return fetch(req);
  let path = rel.endsWith("/") ? rel + "index.html" : rel;
  const r = await fetch(BASE + path + ".enc", { cache: "no-cache" });
  if (!r.ok) return new Response("Not found", { status: 404 });
  const buf = await r.arrayBuffer();
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(buf, 0, 12) }, key, new Uint8Array(buf, 12));
  } catch {
    key = null;   // wrong or outdated key: forget it and send the visitor to unlock again
    return Response.redirect(BASE + "?next=" + encodeURIComponent(rel.split("/")[0] + "/") + "&stale=1", 302);
  }
  const ext = path.split(".").pop().toLowerCase();
  return new Response(plain, { headers: { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" } });
}
