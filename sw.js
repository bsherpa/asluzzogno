// Network-first: mostra sempre i dati aggiornati, usa la cache solo offline
const C='luzzogno-v2';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request)));
});

// Notifiche push (multe)
self.addEventListener('push',e=>{
  let d={};try{d=e.data?e.data.json():{};}catch{d={body:e.data&&e.data.text()};}
  e.waitUntil(self.registration.showNotification(d.title||'A.S. Luzzogno',{
    body:d.body||'',icon:'media/icon-192.png',badge:'media/icon-192.png',tag:d.tag,data:{url:d.url||'/'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=new URL(e.notification.data?.url||'/',self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    const c=cs.find(c=>'focus' in c);
    if(c){c.postMessage({type:'open',url});return c.focus();}
    return self.clients.openWindow(url);
  }));
});
