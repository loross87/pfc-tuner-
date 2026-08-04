# PFC Tuner

App web per il tuning di convertitori PFC (Power Factor Correction) trifase:
loop di corrente, loop di tensione, PLL SRF, con Bode plot, step response,
robustezza, discretizzazione digitale e report PDF.

**Nessuna installazione richiesta**: apri `index.html` in un browser (anche
da file locale). Nessuna dipendenza salvo KaTeX via CDN per il tab
Equazioni.

Per il contesto completo di progetto, decisioni prese, e convenzioni da
rispettare per non reintrodurre bug già risolti, vedi **`CLAUDE.md`**.

## Struttura

```
index.html          entry point, markup
css/style.css        stili e variabili di tema
js/core.js            utility (tema, storage, validazione, export PDF...)
js/render.js          funzioni di disegno canvas
js/app.js              logica di dominio e simulazioni
index_single.html    bundle a file singolo (CSS/JS inline), da rigenerare
                     manualmente dopo ogni modifica — vedi CLAUDE.md
```
