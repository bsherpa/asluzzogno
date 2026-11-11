// Legge calendario e risultati del girone dal sito CSI VCO e li restituisce in JSON.
// La risposta viene tenuta in cache dalla CDN di Netlify (30 min), così la funzione
// gira pochissime volte e non pesa sui crediti.

const BASE = "https://www.csivb.net/campionatiex?rq=";
const CAMP = { cid: "345", cssid: "19", cspid: "1" };   // Calcio a 7 OPEN A – girone A2, stagione 2026/27

const MESI = { gennaio:1,febbraio:2,marzo:3,aprile:4,maggio:5,giugno:6,luglio:7,agosto:8,settembre:9,ottobre:10,novembre:11,dicembre:12 };
const rq = o => BASE + Buffer.from(JSON.stringify(o)).toString("base64");

const urlCalendario = () => rq({ ctask: "101", cspid: CAMP.cspid, cssid: CAMP.cssid, cid: CAMP.cid, start: "0", end: "0", temp: "0" });
const urlRisultati  = ldn => rq({ ctask: "202", cssid: CAMP.cssid, cspid: CAMP.cspid, cid: CAMP.cid, inc: "0", ldn: String(ldn) });

export function htmlToLines(html) {
  const start = html.indexOf('id="wrapcontent"');
  const body = (start >= 0 ? html.slice(start) : html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"');
  return body.split("\n").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function parse(lines) {
  const G = []; let date = null, ora = null, campo = null;
  const num = s => /^\d+$/.test(s ?? "");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = l.match(/^(\d+)ª GIORNATA$/i))) { G.push({ n: +m[1], partite: [], riposa: null }); continue; }
    if (!G.length) continue;
    if ((m = l.match(/^\S+ (\d{1,2}) (\p{L}+) (\d{4})$/u)) && MESI[m[2].toLowerCase()]) {
      date = `${m[3]}-${String(MESI[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`; continue;
    }
    if ((m = l.match(/^Riposa:\s*(.+)$/i))) { G.at(-1).riposa = m[1].trim(); continue; }
    if (/^\d{1,2}[:.]\d{2}$/.test(l)) { ora = l.replace(".", ":"); campo = lines[i - 1]; continue; }
    if (lines[i + 1] === "-" && !num(l) && lines[i + 2]) {
      const p = { data: date, ora, campo, casa: l, ospite: lines[i + 2], gol_casa: null, gol_ospite: null };
      if (num(lines[i + 3]) && lines[i + 4] === "-" && num(lines[i + 5])) {
        p.gol_casa = +lines[i + 3]; p.gol_ospite = +lines[i + 5]; i += 5;
      } else i += 2;
      G.at(-1).partite.push(p); ora = null; campo = null;
    }
  }
  return G;
}

// Unisce i risultati (pagina risultati) nel calendario (pagina calendario, con orari e campi)
export function merge(cal, res) {
  const key = p => `${p.casa}|${p.ospite}`;
  const score = new Map();
  res.forEach(g => g.partite.forEach(p => p.gol_casa !== null && score.set(key(p), p)));
  cal.forEach(g => g.partite.forEach(p => {
    const r = score.get(key(p));
    if (r) { p.gol_casa = r.gol_casa; p.gol_ospite = r.gol_ospite; if (r.data) p.data = r.data; }
  }));
  return cal;
}

// Classifica calcolata dai risultati (3 punti vittoria, 1 pareggio).
// Spareggi come da regolamento CSI: media differenza reti, poi media reti fatte.
export function classifica(G) {
  const T = new Map();
  const row = s => T.get(s) ?? T.set(s, { squadra: s, punti: 0, giocate: 0, v: 0, n: 0, p: 0, gf: 0, gs: 0 }).get(s);
  let ultima = 0;
  G.forEach(g => {
    g.partite.forEach(x => {
      const a = row(x.casa), b = row(x.ospite);
      if (x.gol_casa === null) return;
      ultima = Math.max(ultima, g.n);
      a.giocate++; b.giocate++; a.gf += x.gol_casa; a.gs += x.gol_ospite; b.gf += x.gol_ospite; b.gs += x.gol_casa;
      if (x.gol_casa > x.gol_ospite) { a.v++; b.p++; a.punti += 3; }
      else if (x.gol_casa < x.gol_ospite) { b.v++; a.p++; b.punti += 3; }
      else { a.n++; b.n++; a.punti++; b.punti++; }
    });
    if (g.riposa) row(g.riposa);
  });
  const avg = (x, y) => (y ? x / y : 0);
  const righe = [...T.values()].sort((a, b) =>
    b.punti - a.punti ||
    avg(b.gf - b.gs, b.giocate) - avg(a.gf - a.gs, a.giocate) ||
    avg(b.gf, b.giocate) - avg(a.gf, a.giocate) ||
    a.squadra.localeCompare(b.squadra));
  return { aggiornata_alla_giornata: ultima, righe };
}

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (sito AS Luzzogno)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} su ${url}`);
  return r.text();
}

export default async () => {
  try {
    const cal = parse(htmlToLines(await getText(urlCalendario())));
    if (!cal.length) throw new Error("calendario vuoto");
    const today = new Date().toISOString().slice(0, 10);
    const ldn = Math.max(1, cal.filter(g => g.partite.some(p => p.data && p.data <= today)).length);
    const res = parse(htmlToLines(await getText(urlRisultati(ldn))));
    const giornate = merge(cal, res);
    const body = { aggiornato: new Date().toISOString(), giornate, classifica: classifica(giornate) };
    return new Response(JSON.stringify(body), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "Netlify-CDN-Cache-Control": "public, durable, s-maxage=1800, stale-while-revalidate=86400",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ errore: String(e.message || e) }), {
      status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
};

export const config = { path: "/api/csi" };
