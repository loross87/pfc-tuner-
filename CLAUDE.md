# PFC Tuner — Contesto di Progetto

App web single-page (HTML/CSS/JS vanilla, no framework, no build step) per il
tuning di convertitori PFC trifase: loop di corrente, loop di tensione, PLL
SRF, con Bode plot, step response, analisi di robustezza, discretizzazione
z-domain e report PDF stampabile. Pensata per uso mobile (Android), gira
interamente lato client, offline-capable via Service Worker.

## Struttura file

- `index.html` — markup, un `<panel>` per tab, inline `<script>` per
  registrazione Service Worker
- `css/style.css` — tutte le variabili di tema (dark/light) e stili
- `js/core.js` — utility trasversali: tema, toast, tooltip, validazione,
  preset, persistenza localStorage, import/export JSON, export PDF,
  confronto preset, coerenza multi-loop, pannello diagnostico
- `js/render.js` — tutte le funzioni `draw*` che disegnano su `<canvas>`
- `js/app.js` — logica di dominio: calcoli di controllo, simulazioni,
  gestione tab, tutte le funzioni `update*`

Ordine di caricamento in `index.html`: `core.js` → `render.js` → `app.js`
(app.js dipende dalle altre due; render.js è indipendente; core.js è
indipendente). Le funzioni non sono moduli ES, sono tutte nello scope
globale — occhio ai conflitti di nome se si aggiunge codice.

## Build / distribuzione

Non c'è build step. Esistono due modi di consegnare l'app:

1. **Multifile** (questa cartella): apribile localmente aprendo `index.html`
   con un browser da file manager, oppure servibile da un server statico
   qualsiasi.
2. **Bundle singolo file** (`index_single.html`, già generato in questa
   cartella): CSS e JS inlineati dentro un unico HTML, usato per
   anteprima diretta in ambienti che renderizzano un solo file (es. Claude
   artifacts). **Va rigenerato manualmente ogni volta che si modifica
   `index.html`, `css/style.css`, o uno dei tre file JS** — non è un
   symlink, è una copia statica. Script di rigenerazione (Python):

```python
with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()
with open('css/style.css', 'r', encoding='utf-8') as f:
    css = f.read()
with open('js/core.js', 'r', encoding='utf-8') as f:
    core_js = f.read()
with open('js/render.js', 'r', encoding='utf-8') as f:
    render_js = f.read()
with open('js/app.js', 'r', encoding='utf-8') as f:
    app_js = f.read()

html = html.replace(
    '<link rel="stylesheet" href="css/style.css">',
    f'<style>\n{css}\n</style>'
)
html = html.replace(
    '<script src="js/core.js"></script>\n<script src="js/render.js"></script>\n<script src="js/app.js"></script>',
    f'<script>\n{core_js}\n</script>\n<script>\n{render_js}\n</script>\n<script>\n{app_js}\n</script>'
)
with open('index_single.html', 'w', encoding='utf-8') as f:
    f.write(html)
```

KaTeX (per il tab Equazioni) resta comunque caricato da CDN in entrambe le
versioni — non va inlineato (dimensione/licenza).

## Convenzioni obbligatorie da rispettare

Queste non sono preferenze stilistiche: derivano da bug reali già capitati
in produzione durante lo sviluppo. Deviare da queste regole reintroduce bug
già risolti.

### 1. Canvas: mai leggere `canvas.getAttribute('height')` dopo averlo scritto

`canvas.height` e l'attributo HTML `height` sono la stessa proprietà
riflessa bidirezionalmente. Scrivere `canvas.height = X` e poi rileggere
`canvas.getAttribute('height')` in una chiamata successiva restituisce `X`,
non il valore originale del markup — causa una crescita geometrica
dell'altezza ad ogni redraw (bug osservato: canvas che si "allargava" ad
ogni cambio tab, causato da esattamente questo). **Pattern corretto**, già
implementato in tutte le funzioni `draw*` di `render.js`:

```js
if (!canvas.dataset.baseHeight) {
  canvas.dataset.baseHeight = canvas.getAttribute('height') || '220';
}
const hCanvas = parseInt(canvas.dataset.baseHeight) || 220;
```

Qualsiasi nuova funzione `draw*` deve seguire questo stesso pattern, mai
`parseInt(canvas.getAttribute('height'))` diretto.

### 2. Canvas: mai disegnare se il container non è misurabile

`getCanvasWidth(canvasId)` in `render.js` restituisce `null` se il
container ha larghezza < 50px (tipicamente perché il suo `.panel` non è
ancora `display:block` — es. subito dopo uno `switchTab()`, prima che il
browser abbia committato il cambio di layout). Ogni funzione `draw*` deve
controllare `if (wCanvas === null) return;` subito dopo la chiamata, per
evitare di disegnare con dimensioni sballate (bug osservato: canvas rotto
con icona "immagine non disponibile" dopo cambio tab rapido).

`switchTab()` in `app.js` usa doppio `requestAnimationFrame()` prima di
richiamare `refreshCurrentTab()`, apposta per dare tempo al browser di
committare il layout — non rimuoverlo per "semplificare".

### 3. `parseFloat(...) || default` è quasi sempre sbagliato

`0` è falsy in JavaScript. Se un campo può legittimamente valere zero (es.
ritardo digitale nullo, tolleranza zero), `parseFloat(campo.value) || 50`
sostituisce silenziosamente lo zero inserito dall'utente con il default —
bug osservato: utente impostava un parametro parassita a 0 per renderlo
trascurabile, l'app lo trattava come "campo vuoto" e usava comunque il
default, producendo un margine di fase completamente sbagliato senza
alcun errore visibile. **Pattern corretto**:

```js
const v = parseFloat(el.value);
const result = isNaN(v) ? defaultValue : v;
```

Usare `|| default` SOLO per campi dove 0 non ha senso fisico (es. tensione
di rete, potenza nominale) — mai per delay, tolleranze, offset, o qualsiasi
campo dove zero è un valore operativo valido.

### 4. Mai `Math.max(...array)` / `Math.min(...array)` su array potenzialmente grandi

Lo spread operator passa ogni elemento come argomento di funzione separato;
supera il limite dell'engine JS con array di qualche decina di migliaia di
elementi in su (bug osservato: `Maximum call stack size exceeded` su un
array di simulazione step-response da 200k campioni). Usare un ciclo `for`
esplicito per qualsiasi array la cui dimensione non è garantita piccola
(sotto ~1000 elementi) a priori.

### 5. Fase nei Bode plot: normalizzare una volta sola, mai wrappare per-punto

Wrappare ogni singolo campione di fase indipendentemente dentro un range
fisso (es. `while (ph > 0) ph -= 360`) produce un artefatto a "dente di
sega" quando la fase reale (con parassiti/ritardi cumulativi) scende oltre
il range fisso — punti adiacenti finiscono a rappresentare lo stesso angolo
fisico con valori a 360° di distanza. **Pattern corretto**, già in
`drawBodeDual`: normalizzare il primo campione una sola volta dentro
`(-360, 0]`, poi lasciare che la serie prosegua senza ulteriori wrap
(`normalizePhaseSeries` in `render.js`). Il range dell'asse Y va calcolato
dinamicamente dai dati ma **clampato** a un floor ragionevole (attualmente
-450° per la fase, -120dB per la magnitudo) — senza clamp, un termine di
ritardo che cresce linearmente con la frequenza (es. ritardo digitale) può
produrre valori nell'ordine delle migliaia di gradi alle frequenze alte
dello sweep, schiacciando la parte utile della curva in una manciata di
pixel.

### 6. Step response: finestra temporale adattiva, non fissa

Le simulazioni step-response (`simulateStepResponse` in `app.js`) calcolano
il settling time reale (banda ±2%) invece di assumere che N costanti di
tempo nominali bastino — con margini di fase bassi il transitorio può
richiedere molto più tempo del previsto. Non tornare a una finestra fissa
tipo `tEnd = 5/bw`.

### 7. Trasformata di Park/dq0: usare sempre il θ stimato dal PLL, mai quello ideale

Quando si proiettano grandezze αβ in dq (tab PLL, sezione dq0/feedforward),
usare l'angolo effettivamente stimato dalla simulazione del PLL
(`theta_pll`, che include l'errore di tracking), non l'angolo di rete
ideale. È il punto di tutta l'analisi: mostrare l'effetto di un PLL non
perfettamente agganciato.

### 8. Vincolo Vdc minimo: è trifase, non monofase

`Vdc_min = √6 · V_ac(fase)` (tensione concatenata di picco), non
`√2 · V_ac` come in un boost monofase — bug storico già corretto. La
funzione `getVdcMinFactor()` in `core.js` è l'unico punto da cui leggere
questo fattore; non hardcodare `Math.sqrt(2)` da nessuna parte per questo
scopo.

### 9. Dopo qualsiasi modifica strutturale a `index.html`, rieseguire il controllo di coerenza ID

Diversi bug (`gm_i` mancante, `badge_worstcase` cancellato per errore
durante un inserimento di card) sono stati causati da modifiche HTML che
rimuovevano per errore elementi ancora referenziati dal JS. Prima di
consegnare qualsiasi modifica, eseguire:

```python
import re
with open('index.html', encoding='utf-8') as f:
    html = f.read()
html_ids = set(re.findall(r'id="([^"]+)"', html))
for jsfile in ['js/core.js', 'js/app.js', 'js/render.js']:
    with open(jsfile, encoding='utf-8') as f:
        js = f.read()
    refs = re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", js)
    for r in refs:
        if r not in html_ids and r != 'appToast':  # appToast è creato dinamicamente
            print(jsfile, '-> MISSING ID:', r)
```

E verificare il bilanciamento dei tag `<div>`:

```python
opens = len(re.findall(r'<div\b', html))
closes = len(re.findall(r'</div>', html))
assert opens == closes
```

## Palette colori (brand)

Definita in `css/style.css`, variabili CSS, tema dark e light:

| Ruolo | Nome | Hex |
|---|---|---|
| Sfondo scuro | Blu Navy Scuro | `#04264C` |
| Accento primario / Fase A | Giallo Oro | `#FECB00` |
| Accento secondario / Fase B | Azzurro Ciano | `#2DB2EA` |
| Danger / Fase C | Magenta Fucsia | `#E4007C` |
| Testo secondario | Grigio Ardesia | `#6C757D` |
| Sfondo chiaro | Grigio Chiaro | `#F4F5F7` |

Variabili RGB dedicate (`--success-rgb`, `--warning-rgb`, `--danger-rgb`)
esistono apposta per gli sfondi `rgba()` dei badge — non hardcodare mai
`rgba(numeri, alpha)` per un colore di stato, usare sempre
`rgba(var(--xxx-rgb), alpha)`. Se si aggiunge un nuovo colore di stato,
aggiungere anche la sua variante `-rgb`.

**Non ci sono più colori hardcoded del vecchio tema (arancione/blu/verde
Tailwind-style) in nessun file** — se qualche colore hex compare in una
ricerca tipo `#f97316|#38bdf8|#22c55e|#ef4444`, è una regressione, non
un'eccezione voluta. Questo include il manifest PWA e le icone,
codificati in base64 dentro `<link rel="manifest">` e
`<link rel="apple-touch-icon">` in `index.html` — vanno rigenerati con lo
stesso schema di colori se si tocca la palette (vedi commit history /
script di generazione se serve rifarlo).

## Funzionalità principali (per orientarsi)

- **Sistema**: parametri globali, preset rapidi, confronto preset,
  selettore topologia (boost 6-switch / Vienna rectifier), dimensionamento
  C_DC da ripple target, hold-up time
- **Corrente / Tensione**: tuning PI via cancellazione del polo, Bode con
  effetti parassiti (PWM delay, sensing pole, AAF pole, ritardo digitale),
  step response con metriche (settling time, overshoot, rise time),
  regolatore discreto z-domain (Tustin/Backward/Forward Euler) con
  confronto grafico, correzione Ki per ritardo digitale (solo Corrente)
- **PLL**: tuning SRF-PLL, dq0/Park transform con θ stimato, feedforward
  disaccoppiato, step di frequenza/fase configurabili, regolatore discreto
- **Rete / Potenza / Ripple**: forme d'onda trifase, vettore spaziale αβ,
  teoria p-q, ripple di corrente sull'induttore
- **Robustezza**: sweep parametrico, analisi worst-case (tolleranze
  componenti), robustezza al carico (sweep R_load), rumore di
  quantizzazione ADC
- **Equazioni**: formule LaTeX via KaTeX (CDN)
- **Riassunto**: tabella parametri finali, export JSON, export PDF
  (via `window.print()` e `@media print`, non generazione server-side)

## Cosa NON fare

- Non introdurre un build step / bundler senza che sia esplicitamente
  richiesto — l'app è pensata per restare apribile come file statico.
- Non sostituire il rendering canvas con una libreria grafica esterna
  senza discuterne prima — tutto il rendering è vanilla Canvas 2D per
  restare leggero su mobile.
- Non rimuovere il pannello diagnostico (5 tap sul titolo, `core.js` /
  `handleTitleTap`) senza sostituirlo con qualcos'altro — è stato
  decisivo per diagnosticare almeno due bug reali in produzione e non ha
  costo per l'utente finale (nascosto di default).
