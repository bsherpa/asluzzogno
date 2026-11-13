// Area staff: rosa e tabellini salvati su Netlify Blobs.
//   GET  /api/staff                 -> dati pubblici (rosa + tabellini), in cache CDN 60 s
//   POST /api/staff  (Authorization: Bearer <password>)
//        {action:"login"}                                  -> verifica password
//        {action:"load"}                                   -> dati freschi (senza cache)
//        {action:"saveRosa", rosa:[...], renames:[[old,new]], base}
//        {action:"saveTabellino", g:3, tabellino:{...}|null, risultato?, base}
//        {action:"saveRisultato", risultato:{casa, ospite, gol_casa, gol_ospite}, base}   (gol null = cancella)
//        {action:"saveLogo", squadra, image:"data:image/png;base64,...", base}
//        {action:"deleteLogo", squadra, base}
// I risultati inseriti dallo staff hanno la precedenza su quelli del CSI.
// I loghi sono serviti da /api/logo/<id> (funzione logo.mjs).
// La password si imposta su Netlify: Project configuration -> Environment variables -> STAFF_PASSWORD.
// "base" = rosa/tabellini di data.json, usati solo al primo salvataggio (quando l'archivio è vuoto).

import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const logoId = squadra => createHash("sha1").update(String(squadra).trim().toUpperCase()).digest("hex").slice(0, 16);
const MAX_LOGO = 400_000; // byte, dopo la decodifica

// accetta solo PNG / JPEG / WebP veri (controllo sui primi byte, non sul tipo dichiarato)
function imageType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function cleanRisultato(r) {
  if (!r || typeof r !== "object") return null;
  const casa = str(r.casa, 80), ospite = str(r.ospite, 80);
  if (!casa || !ospite) return null;
  return { key: `${casa}|${ospite}`, gc: int(r.gol_casa, 0, 99), go: int(r.gol_ospite, 0, 99) };
}
function applyRisultato(cur, r) {
  if (!r) return;
  if (r.gc !== null && r.go !== null) cur.risultati[r.key] = { gol_casa: r.gc, gol_ospite: r.go };
  else delete cur.risultati[r.key];
}

const KEY = "squadra";
const RUOLI = ["Portiere", "Difensore", "Centrocampista", "Attaccante", "Allenatore", "Dirigente"];

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

const sha = s => createHash("sha256").update(String(s)).digest();
function passwordOk(pwd) {
  const exp = process.env.STAFF_PASSWORD;
  if (!exp || !pwd) return false;
  return timingSafeEqual(sha(pwd), sha(exp));
}

const str = (s, max) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const int = (n, min, max) => { if (n === "" || n == null) return null; n = Number(n); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

function cleanRosa(a) {
  if (!Array.isArray(a)) return [];
  const out = [], seen = new Set();
  for (const p of a.slice(0, 80)) {
    const nome = str(p?.nome, 60);
    if (!nome || seen.has(nome.toLowerCase())) continue;
    seen.add(nome.toLowerCase());
    const r = { nome };
    const n = int(p.numero, 0, 999); if (n !== null) r.numero = n;
    if (RUOLI.includes(p.ruolo)) r.ruolo = p.ruolo;
    const note = str(p.note, 80); if (note) r.note = note;
    out.push(r);
  }
  return out;
}

// accetta sia ["Nome", ...] sia [{nome, gol}, ...]
function cleanList(a, field, keepZero = false) {
  return (Array.isArray(a) ? a : (a ? [a] : [])).slice(0, 40).map(x => {
    const nome = str(typeof x === "string" ? x : x?.nome, 60);
    if (!nome) return null;
    const v = typeof x === "string" ? (keepZero ? null : 1) : int(x?.[field] ?? x?.n ?? (keepZero ? null : 1), 0, 99);
    if (!keepZero && !v) return null;
    return { nome, [field]: v };
  }).filter(Boolean);
}

function cleanTab(t) {
  if (!t || typeof t !== "object") return null;
  const o = {};
  const marc = cleanList(t.marcatori, "gol"); if (marc.length) o.marcatori = marc;
  const ass = cleanList(t.assist, "n"); if (ass.length) o.assist = ass;
  const port = cleanList(t.portieri ?? t.portiere, "subiti", true); if (port.length) o.portieri = port;
  const pres = [...new Set((Array.isArray(t.presenti) ? t.presenti : []).map(s => str(s, 60)).filter(Boolean))].slice(0, 40);
  if (pres.length) o.presenti = pres;
  const note = str(t.note, 300); if (note) o.note = note;
  const gc = int(t.gol_casa, 0, 99), go = int(t.gol_ospite, 0, 99);
  if (gc !== null && go !== null) { o.gol_casa = gc; o.gol_ospite = go; }
  return Object.keys(o).length ? o : null;
}

function cleanTabs(obj) {
  const out = {};
  if (obj && typeof obj === "object")
    for (const [k, v] of Object.entries(obj)) if (/^\d{1,2}$/.test(k)) { const c = cleanTab(v); if (c) out[k] = c; }
  return out;
}

function applyRenames(tabs, renames) {
  const map = new Map((Array.isArray(renames) ? renames : [])
    .filter(r => Array.isArray(r) && str(r[0], 60) && str(r[1], 60))
    .map(r => [str(r[0], 60).toLowerCase(), str(r[1], 60)]));
  if (!map.size) return;
  const rn = n => map.get(n.toLowerCase()) ?? n;
  for (const t of Object.values(tabs)) {
    for (const k of ["marcatori", "assist", "portieri"]) t[k]?.forEach(x => (x.nome = rn(x.nome)));
    if (t.presenti) t.presenti = [...new Set(t.presenti.map(rn))];
  }
}

export default async req => {
  const store = getStore({ name: "luzzogno", consistency: "strong" });
  const read = async () => (await store.get(KEY, { type: "json" })) || null;

  if (req.method === "GET") {
    const data = (await read()) || {};
    return json(data, 200, {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=60, stale-while-revalidate=300",
    });
  }
  if (req.method !== "POST") return json({ errore: "Metodo non consentito" }, 405);

  if (!process.env.STAFF_PASSWORD) return json({ errore: "Password staff non configurata su Netlify (STAFF_PASSWORD)" }, 503);
  const pwd = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!passwordOk(pwd)) {
    await new Promise(r => setTimeout(r, 1200)); // rallenta i tentativi a caso
    return json({ errore: "Password errata" }, 401);
  }

  const raw = await req.text();
  if (raw.length > 700_000) return json({ errore: "Richiesta troppo grande" }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ errore: "JSON non valido" }, 400); }

  if (body.action === "login") return json({ ok: true });
  if (body.action === "load") return json({ ok: true, data: (await read()) || {} });

  const cur = (await read()) || { rosa: cleanRosa(body.base?.rosa), tabellini: cleanTabs(body.base?.tabellini) };
  cur.tabellini ??= {}; cur.rosa ??= []; cur.risultati ??= {}; cur.loghi ??= {};

  if (body.action === "saveRisultato") {
    const r = cleanRisultato(body.risultato);
    if (!r) return json({ errore: "Partita non valida" }, 400);
    applyRisultato(cur, r);
  } else if (body.action === "saveLogo" || body.action === "deleteLogo") {
    const squadra = str(body.squadra, 80).toUpperCase();
    if (!squadra) return json({ errore: "Squadra mancante" }, 400);
    const id = logoId(squadra);
    const logos = getStore({ name: "luzzogno-loghi", consistency: "strong" });
    if (body.action === "deleteLogo") {
      await logos.delete(id);
      delete cur.loghi[squadra];
    } else {
      const m = /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ""));
      if (!m) return json({ errore: "Immagine non valida" }, 400);
      const buf = Buffer.from(m[1], "base64");
      const type = imageType(buf);
      if (!type) return json({ errore: "Formato non supportato (usa PNG, JPG o WebP)" }, 400);
      if (buf.length > MAX_LOGO) return json({ errore: "Immagine troppo grande" }, 413);
      await logos.set(id, buf, { metadata: { type } });
      cur.loghi[squadra] = `/api/logo/${id}?v=${Date.now().toString(36)}`;
    }
  } else if (body.action === "saveRosa") {
    if (!Array.isArray(body.rosa)) return json({ errore: "Rosa mancante" }, 400);
    cur.rosa = cleanRosa(body.rosa);
    applyRenames(cur.tabellini, body.renames);
  } else if (body.action === "saveTabellino") {
    const g = int(body.g, 1, 99);
    if (g === null) return json({ errore: "Giornata non valida" }, 400);
    const t = cleanTab(body.tabellino);
    if (t) cur.tabellini[g] = t; else delete cur.tabellini[g];
    if (body.risultato) applyRisultato(cur, cleanRisultato(body.risultato));
  } else return json({ errore: "Azione sconosciuta" }, 400);

  cur.aggiornato = new Date().toISOString();
  await store.setJSON(KEY, cur);
  return json({ ok: true, data: cur });
};

export const config = { path: "/api/staff" };
