# Revisione periodica della repo — pfc-tuner-

Meccanismo adottato per non perdere, con la compattazione del contesto tra
una sessione e l'altra, decisioni in sospeso, cose mai provate, script
usati di rado e trappole già incontrate. Adattato dal meccanismo
equivalente nel progetto STM32DPOW (PR #89), con le parti specifiche
all'hardware sostituite da equivalenti web/repo.

## Quando farla

- **A inizio sessione**, se non è ovvio dal contesto immediato cosa sia
  cambiato dall'ultima volta.
- **Subito dopo una compattazione del contesto** — è esattamente il
  momento in cui si perdono i dettagli che questo meccanismo serve a
  preservare.
- **Ogni ~5 PR mergiate** (guarda `git log --oneline --merges` o
  l'output di `scripts/repo_snapshot.sh`).
- **Prima di dire che un lavoro è concluso**, se tocca aree coperte da
  `doc/AI_Context/OPEN_ITEMS.md` (es. Equazioni, Robustezza, DAB,
  `index_single.html`).

## Come farla (~10 minuti, sola lettura)

Questa revisione **non fa nulla sul repo**: nessun commit, nessun push,
nessuna PR aperta automaticamente, nessun comando che modifica file.
Se emerge qualcosa da correggere, si propone all'utente o si apre una
piccola PR di sola documentazione separata (vedi "Risultato" sotto) — non
si mescola con il lavoro di feature in corso.

1. Esegui `bash scripts/repo_snapshot.sh` dalla root del repo. Riporta
   fatti oggettivi (stato git, presenza/assenza di `index_single.html`,
   coerenza ID, bilanciamento `<div>`, sintassi JS, colori legacy,
   staleness di `CLAUDE.md` rispetto al codice) — leggilo per intero.
2. Leggi `doc/AI_Context/OPEN_ITEMS.md` per intero (decisioni in sospeso,
   cose mai provate, script di rado, trappole non tecniche). Ricorda: il
   codice vince se c'è disaccordo — se qualcosa lì risulta falso, è
   quel file ad essere da correggere.
3. Confronta a occhio `CLAUDE.md` → sezione "Funzionalità principali" con
   i tab realmente presenti in `index.html` (`grep "switchTab(" index.html`
   sulla barra tab) — un tab nuovo senza riga corrispondente è un segnale
   che `CLAUDE.md` va aggiornato nella prossima PR che tocca quell'area.
4. Se la sessione corrente sta per chiudere un lavoro su una delle aree
   elencate in "Decisioni in attesa" di `OPEN_ITEMS.md`, aggiorna quella
   voce (risolta, ancora aperta, o cambiata) invece di lasciarla stantia.

## Risultato

- Se la revisione non trova nulla da correggere: non serve nessuna azione,
  nessuna PR, nessun messaggio speciale all'utente — si prosegue col
  lavoro per cui si era aperta la sessione.
- Se trova discrepanze (es. `OPEN_ITEMS.md` disallineato dal codice,
  `CLAUDE.md` da aggiornare, uno script rotto): raccogli le correzioni in
  **una piccola PR di sola documentazione** (stesso flusso delle altre PR
  di questo repo: branch riavviato da `origin/main`, commit, push, PR —
  la unisce il proprietario) e poi **riassumi all'utente in poche righe**
  cosa è stato trovato e corretto, senza ripetere l'intero contenuto dei
  file.
- Questa revisione **non estende alcuna autorizzazione**: se qualcosa
  richiede una decisione del proprietario (es. le voci in "Decisioni in
  attesa del proprietario"), si chiede, non si decide al posto suo.
