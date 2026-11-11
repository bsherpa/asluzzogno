# Sito A.S. Luzzogno

Calendario, risultati e classifica si aggiornano **da soli** dal sito CSI VCO
(funzione `netlify/functions/csi.mjs`, raggiungibile su `/api/csi`, cache 30 minuti).
Se il sito CSI non risponde, la pagina usa i dati salvati in `data.json`.

## Pubblicazione (una volta sola)
Le funzioni NON funzionano con il trascinamento su Netlify Drop: serve GitHub.

1. Crea un repository su GitHub (es. `asluzzogno-sito`) e carica il contenuto di questa cartella
   (da browser: "Add file → Upload files", trascinando tutti i file e le cartelle, compresa `netlify/`).
2. Su Netlify: **Add new project → Import an existing project → GitHub** → scegli il repo.
   Lascia vuoti build command e publish directory (sono già in `netlify.toml`) → **Deploy**.
3. **Project configuration → Change project name** → `asluzzogno`.
4. Se avevi già creato il sito con Drop, puoi eliminarlo (Project configuration → Delete project)
   e poi usare il nome `asluzzogno` per quello nuovo.

Verifica: apri `https://asluzzogno.netlify.app/api/csi` → deve mostrare il JSON con giornate e classifica.

## Cosa modificare a mano (in `data.json`, direttamente su GitHub con la matita ✏️)
Ogni modifica salvata su GitHub ripubblica il sito da sola (15 crediti su 300 al mese).

- **Rosa** — numeri e ruoli facoltativi:
  `{"numero": 10, "nome": "Simone Piazza", "ruolo": "Attaccante", "note": "Capitano"}`
  Ruoli: Portiere, Difensore, Centrocampista, Attaccante, Allenatore, Dirigente.
- **Instagram** — `"instagram": "https://www.instagram.com/nomeprofilo/"`
- **Logo** — sostituisci `media/logo.png` e le icone `media/icon-*.png`.

## Stagione prossima / altro girone
In `netlify/functions/csi.mjs`, riga `const CAMP = { cid: "345", cssid: "19", cspid: "1" }`:
apri sul sito CSI la pagina del nuovo calendario, copia la parte dopo `rq=`,
decodificala (es. su base64decode.org) e copia i nuovi `cid` e `cssid`.
