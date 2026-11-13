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

## Area staff (rosa, tabellini, risultati dal sito)
Pulsante **Area staff** in alto. Lo staff entra con una password comune e può:
- modificare la rosa (numeri, nomi, ruoli, note);
- toccare una partita → **Modifica tabellino**: risultato, presenti, marcatori, assist, portieri, note;
- in **Tutto il girone** toccare qualsiasi partita per inserire o correggere il risultato;
- in **Classifica → Gestisci loghi** caricare/cambiare/rimuovere i loghi delle altre squadre.

**I risultati inseriti dallo staff hanno sempre la precedenza su quelli del CSI.**
Per tornare al risultato del CSI basta svuotare i due campi e salvare.
Se lo staff cambia o aggiunge risultati, la classifica viene ricalcolata dai risultati
(3 punti vittoria, 1 pareggio; eventuali penalità del CSI non sono incluse).
I risultati del CSI continuano ad arrivare in automatico per le partite non toccate dallo staff.

I dati vengono salvati su Netlify Blobs (funzione `netlify/functions/staff.mjs`, `/api/staff`),
quindi non serve ripubblicare il sito e non si consumano crediti di deploy.
I visitatori vedono le modifiche entro circa 1 minuto.

**Impostare la password (una volta sola):** Netlify → il progetto → **Project configuration →
Environment variables → Add a variable** → chiave `STAFF_PASSWORD`, valore = la password
(lunga, es. 4 parole a caso) → poi **Deploys → Trigger deploy → Deploy project**.
Per cambiarla: modifica la variabile e rifai il deploy; chi era dentro dovrà rientrare.

⚠️ Dal primo salvataggio dall'area staff, **rosa e tabellini di `data.json` vengono ignorati**
(fanno fede quelli salvati online). `data.json` resta per tutto il resto.

Statistiche **Giocatori** (presenze, gol, assist, gol subiti, capocannoniere ecc.)
sono calcolate in automatico dai tabellini.

## Cosa modificare a mano (in `data.json`, direttamente su GitHub con la matita ✏️)
Ogni modifica salvata su GitHub ripubblica il sito da sola (15 crediti su 300 al mese).

- **Rosa** — (solo finché non si usa l'area staff) numeri e ruoli facoltativi:
  `{"numero": 10, "nome": "Simone Piazza", "ruolo": "Attaccante", "note": "Capitano"}`
  Ruoli: Portiere, Difensore, Centrocampista, Attaccante, Allenatore, Dirigente.
- **Instagram** — `"instagram": "https://www.instagram.com/nomeprofilo/"`
- **Logo** — sostituisci `media/logo.png` e le icone `media/icon-*.png`.
- **Loghi avversari** — meglio dall'area staff. A mano: carica l'immagine in `media/loghi/` (PNG o JPG, meglio quadrata)
  e scrivi il percorso accanto al nome della squadra in `"loghi"`:
  `"G.S. PREMIA": "media/loghi/premia.png"`. Il nome deve essere identico a quello del CSI.
  Se manca il logo vengono mostrate le iniziali (es. "FV").
- **Tabellino** — meglio dall'area staff. A mano: in `"tabellini"`, una voce per giornata (il numero tra virgolette):
  ```json
  "tabellini": {
    "1": {
      "marcatori": ["Simone Piazza", "Luca Carbone x2"],
      "assist": ["Marco Ciocca"],
      "portiere": "Matteo Femia",
      "presenti": ["Simone Piazza", "Luca Carbone", "Marco Ciocca", "Matteo Femia"],
      "note": "facoltativo"
    }
  }
  ```
  I nomi devono essere scritti come nella rosa (così compare anche il numero di maglia).
  Gol subiti: calcolati da soli dal risultato. Con due portieri:
  `"portiere": [{"nome": "Matteo Femia", "subiti": 1}, {"nome": "Ugo Piana", "subiti": 2}]`.
  Il tabellino si apre cliccando una partita giocata; da lì c'è il pulsante **Locandina risultato**
  (immagine PNG 1080×1350 da scaricare o condividere).

## Stagione prossima / altro girone
In `netlify/functions/csi.mjs`, riga `const CAMP = { cid: "345", cssid: "19", cspid: "1" }`:
apri sul sito CSI la pagina del nuovo calendario, copia la parte dopo `rq=`,
decodificala (es. su base64decode.org) e copia i nuovi `cid` e `cssid`.
