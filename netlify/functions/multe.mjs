// Multe della squadra: visibili SOLO con password, mai in cache.
//   POST /api/multe  (Authorization: Bearer <password>)
//   Password giocatori (GIOCATORI_PASSWORD) -> sola lettura + notifiche
//   Password staff     (STAFF_PASSWORD)     -> tutto
//
//   {action:"load"}                                         -> {ruolo, catalogo, multe, vapid}
//   {action:"subscribe", sub:{endpoint,keys}, giocatore|null} -> attiva notifiche (null = tutte le multe)
//   {action:"unsubscribe", endpoint}
//   solo staff:
//   {action:"saveCatalogo", catalogo:[{id?, nome, importo}]}
//   {action:"addMulta", giocatore, voce:<id catalogo>, importo?, data?, nota?}   -> invia anche la notifica push
//   {action:"setPagata", id, pagata:true|false}
//   {action:"deleteMulta", id}
//
// Le chiavi VAPID per le notifiche vengono generate da sole al primo uso e salvate su Blobs.
// Nome e importo della voce vengono copiati nella multa: cambiare il catalogo non modifica le multe già date.

import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual, generateKeyPairSync, randomBytes } from "node:crypto";
import webpush from "web-push";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, private" } });

const sha = s => createHash("sha256").update(String(s)).digest();
const same = (a, b) => !!a && !!b && timingSafeEqual(sha(a), sha(b));
const str = (s, max) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const newId = () => randomBytes(6).toString("base64url");
// importo in euro, max 2 decimali (accetta anche "2,50")
const euro = v => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) / 100 : null;
};
const day = s => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : null);
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
const fmtEuro = n => n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });

function cleanCatalogo(a) {
  if (!Array.isArray(a)) return null;
  const out = [], ids = new Set();
  for (const v of a.slice(0, 100)) {
    const nome = str(v?.nome, 60), importo = euro(v?.importo);
    if (!nome || importo === null) continue;
    let id = typeof v?.id === "string" && /^[A-Za-z0-9_-]{4,16}$/.test(v.id) ? v.id : newId();
    if (ids.has(id)) id = newId();
    ids.add(id);
    out.push({ id, nome, importo });
  }
  return out;
}

async function vapidKeys(store) {
  let k = await store.get("vapid", { type: "json" });
  if (k?.publicKey && k?.privateKey) return k;
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  k = {
    publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url"),
    privateKey: jwk.d,
  };
  await store.setJSON("vapid", k);
  return (await store.get("vapid", { type: "json" })) || k; // se due richieste arrivano insieme vince quella salvata
}

const subKey = endpoint => createHash("sha1").update(endpoint).digest("hex").slice(0, 20);

// invia a tutti gli iscritti interessati; rimuove gli abbonamenti scaduti (404/410)
async function notify(store, subs, req, payload, giocatore) {
  const targets = Object.entries(subs).filter(([, s]) => !s.giocatore || !giocatore || s.giocatore.toLowerCase() === giocatore.toLowerCase());
  if (!targets.length) return 0;
  const k = await vapidKeys(store);
  const site = process.env.URL || new URL(req.url).origin; // il "subject" VAPID deve essere https: (in locale è http)
  const vapidDetails = { subject: site.startsWith("https:") ? site : "https://asluzzogno.netlify.app", publicKey: k.publicKey, privateKey: k.privateKey };
  let dead = false, sent = 0;
  await Promise.allSettled(targets.map(async ([id, s]) => {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { vapidDetails, TTL: 3 * 86400, timeout: 6000 }); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { delete subs[id]; dead = true; } }
  }));
  if (dead) await store.setJSON("push", subs);
  return sent;
}

export default async req => {
  if (req.method !== "POST") return json({ errore: "Metodo non consentito" }, 405);
  const staffPwd = process.env.STAFF_PASSWORD, playerPwd = process.env.GIOCATORI_PASSWORD;
  if (!staffPwd && !playerPwd) return json({ errore: "Password non configurate su Netlify" }, 503);

  const pwd = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const ruolo = same(pwd, staffPwd) ? "staff" : same(pwd, playerPwd) ? "giocatore" : null;
  if (!ruolo) {
    await new Promise(r => setTimeout(r, 1200));
    return json({ errore: "Password errata" }, 401);
  }

  const raw = await req.text();
  if (raw.length > 60_000) return json({ errore: "Richiesta troppo grande" }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ errore: "JSON non valido" }, 400); }

  const store = getStore({ name: "luzzogno-multe", consistency: "strong" });
  const cur = (await store.get("multe", { type: "json" })) || {};
  cur.catalogo ??= []; cur.multe ??= [];
  const out = async (extra = {}) => json({ ok: true, ruolo, catalogo: cur.catalogo, multe: cur.multe, aggiornato: cur.aggiornato || null, ...extra });

  if (body.action === "load") return out({ vapid: (await vapidKeys(store)).publicKey });

  if (body.action === "subscribe" || body.action === "unsubscribe") {
    const subs = (await store.get("push", { type: "json" })) || {};
    const endpoint = str(body.sub?.endpoint ?? body.endpoint, 1000);
    if (!/^https:\/\//.test(endpoint)) return json({ errore: "Iscrizione non valida" }, 400);
    const id = subKey(endpoint);
    if (body.action === "unsubscribe") { delete subs[id]; await store.setJSON("push", subs); return json({ ok: true }); }
    const p256dh = str(body.sub?.keys?.p256dh, 200), auth = str(body.sub?.keys?.auth, 100);
    if (!p256dh || !auth) return json({ errore: "Iscrizione non valida" }, 400);
    if (!subs[id] && Object.keys(subs).length >= 300) return json({ errore: "Troppi dispositivi iscritti" }, 400);
    const giocatore = str(body.giocatore, 60) || null;
    subs[id] = { sub: { endpoint, keys: { p256dh, auth } }, giocatore, creato: new Date().toISOString() };
    await store.setJSON("push", subs);
    await notify(store, { [id]: subs[id] }, req, {
      title: "Notifiche multe attive 🔔",
      body: giocatore ? `Riceverai un avviso quando arriva una multa a ${giocatore}.` : "Riceverai un avviso per ogni nuova multa.",
      url: "/#multe", tag: "multe-test",
    });
    return json({ ok: true });
  }

  if (ruolo !== "staff") return json({ errore: "Solo lo staff può modificare le multe" }, 403);

  let push = null;
  if (body.action === "saveCatalogo") {
    const c = cleanCatalogo(body.catalogo);
    if (!c) return json({ errore: "Elenco non valido" }, 400);
    cur.catalogo = c;
  } else if (body.action === "addMulta") {
    const giocatore = str(body.giocatore, 60);
    const voce = cur.catalogo.find(v => v.id === body.voce);
    if (!giocatore) return json({ errore: "Scegli il giocatore" }, 400);
    if (!voce) return json({ errore: "Scegli la multa dall'elenco" }, 400);
    const importo = body.importo === undefined || body.importo === "" ? voce.importo : euro(body.importo);
    if (importo === null) return json({ errore: "Importo non valido" }, 400);
    if (cur.multe.length >= 3000) return json({ errore: "Archivio multe pieno" }, 400);
    const m = { id: newId(), giocatore, voce: voce.nome, importo, data: day(body.data) || today(), pagata: false, creata: new Date().toISOString() };
    const nota = str(body.nota, 140); if (nota) m.nota = nota;
    cur.multe.push(m);
    push = { giocatore, payload: { title: `Nuova multa: ${giocatore}`, body: `${voce.nome} · ${fmtEuro(importo)}${nota ? " — " + nota : ""}`, url: "/#multe", tag: "multa-" + m.id } };
  } else if (body.action === "setPagata" || body.action === "deleteMulta") {
    const i = cur.multe.findIndex(m => m.id === body.id);
    if (i < 0) return json({ errore: "Multa non trovata (forse già eliminata)" }, 404);
    if (body.action === "deleteMulta") cur.multe.splice(i, 1);
    else { cur.multe[i].pagata = !!body.pagata; if (cur.multe[i].pagata) cur.multe[i].pagataIl = today(); else delete cur.multe[i].pagataIl; }
  } else return json({ errore: "Azione sconosciuta" }, 400);

  cur.aggiornato = new Date().toISOString();
  await store.setJSON("multe", cur);

  let inviate;
  if (push) {
    try { inviate = await notify(store, (await store.get("push", { type: "json" })) || {}, req, push.payload, push.giocatore); }
    catch { inviate = 0; } // la multa è comunque salvata
  }
  return out(inviate !== undefined ? { notifiche: inviate } : {});
};

export const config = { path: "/api/multe" };
