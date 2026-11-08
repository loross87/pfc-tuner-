# Open Items — pfc-tuner-

Registro a mano, aggiornato ad ogni revisione periodica
(`doc/AI_Context/REPO_REVIEW.md`). Scopo: non perdere, con la
compattazione del contesto tra una sessione e l'altra, decisioni in
sospeso, cose mai provate, script usati di rado e trappole già incontrate
che non sono già in `CLAUDE.md`.

**Il codice vince sempre su questo registro se sono in disaccordo** — se
una riga qui sotto risulta falsa leggendo il codice attuale, il codice ha
ragione: correggi questo file, non il contrario.

Ultima revisione: 2026-11-08, commit `f18384e` (merge PR #8, tab DAB).

## Decisioni in attesa del proprietario

- **`index_single.html` non generato.** Deciso esplicitamente di non
  crearlo durante l'import iniziale del progetto (vedi storia PR #1) —
  `CLAUDE.md` lo descrive come "già generato in questa cartella" ma in
  questo checkout **non esiste**. Va generato con lo script Python in
  `CLAUDE.md` → sezione "Build / distribuzione" se/quando serve
  un'anteprima a file singolo (es. Claude artifacts). Nessuna scadenza,
  nessun rischio nel frattempo — l'app multi-file funziona regolarmente.
- **Tab Equazioni, card "🔋 Loop di Tensione": formula non aggiornata.**
  Mostra ancora `Kp = 0.8·C_DC·ωbw, Ki = 0.3·C_DC·ωbw²` (il metodo storico
  "scaling da BW"), anche se da PR #7 il metodo di **default** nel tab
  Tensione è "cancellazione del polo" (`Kp = C_DC·ωbw, Ki = ωbw/R_load`).
  Non toccato perché fuori scope delle PR che hanno introdotto il nuovo
  metodo — il proprietario non ha ancora detto se vuole che la card
  Equazioni rifletta il nuovo default, mostri entrambe le formule, o resti
  così (dato che è comunque un riferimento storico/didattico).
- **Robustezza (worst-case, sweep di carico) non estesa al DAB.**
  `runWorstCase()`/`runLoadRobustness()` in `js/app.js` restano sui tre
  loop PFC (Corrente/Tensione/PLL); il DAB ha solo il proprio sweep
  steady-state P(φ) (`dabPPhiPlot`). Flaggato esplicitamente come lavoro
  futuro nel piano della PR #8 — nessuna decisione presa su se/quando farlo.
- **DAB: un solo metodo di design (cancellazione del polo), niente
  doppio-metodo con confronto** come invece esiste per il loop di Tensione
  (`voltMethodCompareEnabled`/toggle "Confronta i due metodi"). Scelta
  esplicita per contenere lo scope della PR #8, non ancora rivalutata.

## Cose mai provate in questo repo

- **`index_single.html` non è mai stato generato né aperto** in nessuna
  sessione finora — lo script di rigenerazione in `CLAUDE.md` non è mai
  stato eseguito qui, quindi non è verificato che produca un file valido
  con l'attuale `index.html` (10 tab, DAB incluso).
- **Nessun test su device reale** (il progetto è esplicitamente "pensato
  per uso mobile Android", ma ogni verifica finora è stata fatta in
  browser headless Chromium su sandbox cloud).
- **Service Worker / funzionamento offline mai verificato end-to-end** —
  solo il codice di registrazione esiste, non è mai stato testato un
  caricamento realmente offline.
- **Rendering KaTeX mai verificato con CDN realmente raggiunto** — ogni
  sessione di sviluppo finora ha girato in un sandbox che blocca
  `cdnjs.cloudflare.com` (`ERR_TUNNEL_CONNECTION_FAILED`); si è verificato
  solo il fallback testuale (`el.textContent = el.dataset.latex`), mai il
  rendering matematico vero e proprio.
- **GitHub Pages non è mai stato abilitato con successo** su questa repo
  nelle sessioni fin qui — risultava `has_pages: false` l'ultima volta che
  è stato controllato (repo privata, piano Free: Pages su repo private
  richiede Pro/Team/Enterprise). Non riverificato da allora.

## Script/strumenti usati di rado (con comando)

| Cosa | Comando | Note |
|---|---|---|
| Snapshot oggettivo della repo | `bash scripts/repo_snapshot.sh` | Nuovo da questa revisione; sola lettura, nessuna rete. |
| Rigenerazione `index_single.html` | script Python in `CLAUDE.md` → "Build / distribuzione" | Mai eseguito in questo repo (vedi sopra). |
| Controllo coerenza ID (`id=` vs `getElementById`) | script Python in `CLAUDE.md` → convenzione #9 | Incluso anche in `repo_snapshot.sh`; eseguito manualmente ad ogni PR che tocca `index.html`. |
| Controllo bilanciamento `<div>` | script Python in `CLAUDE.md` → convenzione #9 | Idem, incluso in `repo_snapshot.sh`. |
| Verifica funzionale in browser headless | Playwright + Chromium (`/opt/pw-browsers/chromium`), server statico locale (`python3 -m http.server`) | Pattern usato per ogni PR di feature in questa sessione; nessuno script salvato nel repo, scritto ad-hoc ogni volta in `/tmp` — potrebbe valer la pena salvarne uno riusabile se ricorre ancora. |

## Trappole già incontrate

Le 9 convenzioni tecniche obbligatorie (bug canvas height, container non
misurabile, `parseFloat(...) || default`, `Math.max(...array)`, phase wrap
Bode, finestra step-response fissa, dq0 con θ ideale, Vdc_min monofase vs
trifase, ID mancanti dopo modifica HTML) sono **già documentate in
`CLAUDE.md`** — non ripetute qui per evitare che le due fonti divergano.
Leggi `CLAUDE.md` per il dettaglio tecnico di ciascuna.

Trappole aggiuntive, non di natura tecnica, incontrate in questa sessione:

- **Cache aggressiva su `htmlpreview.github.io`/CDN raw.githubusercontent.**
  Dopo un merge appena fatto, il link di test può mostrare ancora la
  versione precedente per alcuni minuti — sempre riprovare in **incognito**
  prima di concludere che una modifica non ha funzionato.
- **Repo privata + GitHub Pages**: su piano GitHub Free, Pages non è
  disponibile per repository private (serve Pro/Team/Enterprise). Se
  "sembra attivo ma mostra una versione vecchia", verificare prima se è
  davvero Pages o se si sta guardando una cache di un tentativo precedente.
- **PR già mergiata, nuovo lavoro richiesto sullo stesso branch**: se il
  branch designato ha già una PR mergiata, va **riavviato da
  `origin/main`** (`git fetch origin main && git checkout -B <branch>
  origin/main`) prima di nuovi commit — non impilare lavoro nuovo su
  storia già mergiata.
