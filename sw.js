const VERSION='lexora-orbit-v2-cloud';
const ASSETS=['./','./index.html','./styles.css','./app.js','./cloud-config.js','./data/vocabulary.js','./assets/icon.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET'||new URL(req.url).pathname.startsWith('/api/'))return;event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{if(res.ok&&new URL(req.url).origin===self.location.origin){const c=res.clone();caches.open(VERSION).then(cache=>cache.put(req,c))}return res}).catch(()=>cached)))});
