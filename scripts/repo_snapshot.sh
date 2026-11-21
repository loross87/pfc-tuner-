#!/usr/bin/env bash
# scripts/repo_snapshot.sh
#
# Scatto oggettivo e di sola lettura dello stato della repo pfc-tuner-.
# Nessun comando scrive sul repo, nessun fetch/push, nessuna chiamata di
# rete: usa solo quello che git ha già in locale. Pensato per essere
# eseguibile a inizio sessione, dopo una compattazione del contesto, o
# ogni ~5 PR mergiate (vedi doc/AI_Context/REPO_REVIEW.md).
#
# Uso: bash scripts/repo_snapshot.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

hr() { printf '%s\n' "----------------------------------------"; }

echo "=== pfc-tuner- — repo snapshot ($(date -u +%Y-%m-%dT%H:%MZ)) ==="
hr

echo "## Git: branch e stato"
git branch --show-current
git status --short --branch
hr

echo "## Git: ultimi 10 commit"
git log --oneline -10
hr

echo "## Git: ultime PR mergiate (merge commit su questo branch)"
git log --oneline --merges -8
hr

echo "## Confronto con origin/main (dati già noti a git, non viene eseguito alcun fetch)"
if git rev-parse --verify origin/main >/dev/null 2>&1; then
  AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '?')
  BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')
  echo "HEAD è $AHEAD commit avanti e $BEHIND commit indietro rispetto a origin/main (ricordati 'git fetch origin main' prima se vuoi un dato aggiornato)."
else
  echo "origin/main non è noto localmente — esegui 'git fetch origin main' per poterlo confrontare."
fi
hr

echo "## index_single.html (bundle singolo file, CLAUDE.md sezione 'Build/distribuzione')"
if [ -f index_single.html ]; then
  echo "Presente. Verifica a mano che sia stato rigenerato dopo l'ultima modifica a index.html/css/js."
else
  echo "ASSENTE in questo checkout, nonostante CLAUDE.md lo descriva come 'già generato in questa cartella'."
  echo "Gap noto, tracciato in doc/AI_Context/OPEN_ITEMS.md — non è un bug di questo script."
fi
hr

echo "## Coerenza documentazione vs codice (CLAUDE.md più vecchio dell'ultimo commit su index.html/js/*)"
CLAUDE_COMMIT_DATE=$(git log -1 --format=%ct -- CLAUDE.md 2>/dev/null || echo 0)
CODE_COMMIT_DATE=$(git log -1 --format=%ct -- index.html js/ 2>/dev/null || echo 0)
if [ "${CODE_COMMIT_DATE:-0}" -gt "${CLAUDE_COMMIT_DATE:-0}" ]; then
  echo "⚠️  index.html/js/ sono stati toccati più di recente di CLAUDE.md — controlla se CLAUDE.md va aggiornato (nuovi tab, nuove convenzioni, nuove funzionalità principali)."
else
  echo "OK — CLAUDE.md non risulta più vecchio dell'ultima modifica a index.html/js/."
fi
hr

echo "## Coerenza ID: getElementById(...) nei tre JS vs id=\"...\" in index.html"
python3 - <<'PYEOF'
import re
missing = []
with open('index.html', encoding='utf-8') as f:
    html = f.read()
html_ids = set(re.findall(r'id="([^"]+)"', html))
for jsfile in ['js/core.js', 'js/app.js', 'js/render.js']:
    with open(jsfile, encoding='utf-8') as f:
        js = f.read()
    refs = re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", js)
    for r in refs:
        if r not in html_ids and r != 'appToast':
            missing.append((jsfile, r))
if missing:
    print("⚠️  ID referenziati da JS ma assenti in index.html:")
    for jsfile, r in missing:
        print(f"   {jsfile} -> {r}")
else:
    print("OK — nessun ID mancante.")
PYEOF
hr

echo "## Bilanciamento tag <div> in index.html"
python3 - <<'PYEOF'
import re
with open('index.html', encoding='utf-8') as f:
    html = f.read()
opens = len(re.findall(r'<div\b', html))
closes = len(re.findall(r'</div>', html))
print(f"apertura: {opens}  chiusura: {closes}  ->", "OK, bilanciati" if opens == closes else "⚠️  SBILANCIATI")
PYEOF
hr

echo "## Colori legacy Tailwind-style (regressione palette, CLAUDE.md sezione Palette colori)"
if grep -rEq "#f97316|#38bdf8|#22c55e|#ef4444" index.html css/style.css js/*.js 2>/dev/null; then
  echo "⚠️  Trovati colori hex del vecchio tema — vedi CLAUDE.md, non sono mai un'eccezione voluta."
else
  echo "OK — nessun colore legacy trovato."
fi
hr

echo "## Sintassi JS (node --check)"
for f in js/core.js js/app.js js/render.js; do
  if node --check "$f" 2>/tmp/repo_snapshot_jscheck.err; then
    echo "OK — $f"
  else
    echo "⚠️  ERRORE DI SINTASSI in $f:"
    cat /tmp/repo_snapshot_jscheck.err
  fi
done
rm -f /tmp/repo_snapshot_jscheck.err
hr

echo "## doc/AI_Context/OPEN_ITEMS.md — promemoria"
if [ -f doc/AI_Context/OPEN_ITEMS.md ]; then
  LAST_LINE=$(grep -m1 "Ultima revisione" doc/AI_Context/OPEN_ITEMS.md || echo "(riga 'Ultima revisione' non trovata)")
  echo "Leggilo per intero prima di dichiarare concluso un lavoro. $LAST_LINE"
else
  echo "Non trovato — qualcosa non va, dovrebbe esistere insieme a questo script."
fi
hr

echo "=== Fine snapshot. Nessuna modifica è stata fatta al repo. ==="
