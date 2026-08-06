// ===================== CORE: theme, toast, storage, validation, presets =====================

const STORAGE_KEY = 'pfc_tuner_params_v1';

// ---------- Temporary diagnostic panel (tap title 5x to reveal) ----------
let _titleTapCount = 0;
let _titleTapTimer = null;
function handleTitleTap() {
  _titleTapCount++;
  clearTimeout(_titleTapTimer);
  _titleTapTimer = setTimeout(() => { _titleTapCount = 0; }, 2000);
  if (_titleTapCount >= 5) {
    _titleTapCount = 0;
    const panel = document.getElementById('debugPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if (panel.style.display === 'block') {
      window._debugBode = debugLog;
      debugLog('Debug panel enabled', {});
    } else {
      window._debugBode = null;
    }
  }
}

function debugLog(label, data) {
  const content = document.getElementById('debugLogContent');
  if (!content) return;
  const time = new Date().toISOString().substr(11, 12);
  let line = `[${time}] ${label}\n`;
  Object.entries(data).forEach(([k, v]) => { line += `    ${k}: ${v}\n`; });
  content.textContent += line;
  const panel = document.getElementById('debugPanel');
  if (panel) panel.scrollTop = panel.scrollHeight;
}

// ---------- Toast ----------
function showToast(msg, type = 'success', duration = 2200) {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ---------- Theme ----------
function initTheme() {
  const saved = localStorage.getItem('pfc_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('pfc_theme', next);
  updateThemeIcon(next);
  // Redraw charts with new theme colors on the active tab
  if (typeof refreshCurrentTab === 'function') refreshCurrentTab();
}
function updateThemeIcon(theme) {
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ---------- Equations tab (KaTeX rendering) ----------
let _equationsRendered = false;

function renderEquations(retryCount) {
  retryCount = retryCount || 0;
  if (typeof katex === 'undefined') {
    // KaTeX is loaded with `defer`, so on a fast tab switch right after page
    // load it might not be registered yet. Retry a few times before giving up.
    if (retryCount < 20) {
      setTimeout(() => renderEquations(retryCount + 1), 150);
    } else {
      document.querySelectorAll('#panel-equations .eq-block').forEach(el => {
        if (!el.textContent) el.textContent = el.dataset.latex || '';
      });
    }
    return;
  }
  document.querySelectorAll('#panel-equations .eq-block').forEach(el => {
    const tex = el.dataset.latex;
    if (!tex) return;
    try {
      katex.render(tex, el, { throwOnError: false, displayMode: true });
    } catch (e) {
      el.textContent = tex;
      console.warn('Errore rendering KaTeX:', e);
    }
  });
  _equationsRendered = true;
}
function toggleTooltip(id, event) {
  if (event) event.stopPropagation();
  document.querySelectorAll('.tooltip-box.show').forEach(t => {
    if (t.id !== 'tt-' + id) t.classList.remove('show');
  });
  const box = document.getElementById('tt-' + id);
  if (box) box.classList.toggle('show');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.tooltip-trigger') && !e.target.closest('.tooltip-box')) {
    document.querySelectorAll('.tooltip-box.show').forEach(t => t.classList.remove('show'));
  }
});

// ---------- Topology-aware Vdc minimum ----------
// Both supported three-phase topologies (6-switch boost and Vienna rectifier)
// share the same minimum bus voltage constraint: it must exceed the peak
// line-to-line voltage, not the peak phase voltage as in a single-phase boost.
// Vdc_min = sqrt(2) * V_LL(rms) = sqrt(2) * sqrt(3) * V_phase(rms) = sqrt(6) * V_phase
function getVdcMinFactor() {
  // Currently identical for both topologies; kept as a lookup so a future
  // topology with a different constraint (e.g. a true multilevel NPC with
  // different modulation limits) can override it in one place.
  const topology = document.getElementById('topology')?.value || 'boost6';
  const factors = { boost6: Math.sqrt(6), vienna: Math.sqrt(6) };
  return factors[topology] || Math.sqrt(6);
}

function onTopologyChanged() {
  const topology = document.getElementById('topology').value;
  const formulaEl = document.getElementById('topologyFormula');
  const noteEl = document.getElementById('topologyNote');
  if (topology === 'vienna') {
    formulaEl.innerHTML = 'V<sub>DC min</sub> = √6 · V<sub>AC(fase)</sub> ≈ 2.449 · V<sub>AC</sub> &nbsp;(tensione concatenata di picco)';
    noteEl.innerHTML = 'Vienna Rectifier a 3 livelli: stesso vincolo minimo sul bus totale del boost a 6 switch, ma ogni switch vede solo V<sub>DC</sub>/2 — utile per ridurre lo stress di tensione sui semiconduttori o abilitare f<sub>sw</sub> più alte a parità di dispositivo.';
  } else {
    formulaEl.innerHTML = 'V<sub>DC min</sub> = √6 · V<sub>AC(fase)</sub> ≈ 2.449 · V<sub>AC</sub> &nbsp;(tensione concatenata di picco)';
    noteEl.innerHTML = 'Boost trifase classico a 6 switch: il vincolo di tensione minima è sulla concatenata di picco, non sulla tensione di fase — un errore comune è usare la formula monofase (√2·V<sub>ac</sub>), che sottostima significativamente il V<sub>DC</sub> minimo richiesto.';
  }
  applyValidationUI();
  computeSystem();
  saveToStorage();
  if (typeof refreshCurrentTab === 'function') refreshCurrentTab();
}

// ---------- All input field IDs used across the app ----------
const ALL_PARAM_IDS = [
  'v_ac', 'f_line', 'p_out', 'v_dc', 'L', 'R_l', 'C_dc', 'f_sw', 'R_load',
  'td_pwm', 'f_sense', 'f_aaf', 'td_dig'
];

// ---------- Validation rules ----------
// Each rule: fn(values) -> null | { field, message, severity: 'error'|'warn' }
function getFormValues() {
  const v = {};
  ALL_PARAM_IDS.forEach(id => {
    const el = document.getElementById(id);
    v[id] = el ? parseFloat(el.value) : NaN;
  });
  return v;
}

function validateAll() {
  const v = getFormValues();
  const issues = [];

  // Basic NaN / range checks
  ALL_PARAM_IDS.forEach(id => {
    if (isNaN(v[id])) {
      issues.push({ field: id, message: 'Valore non valido', severity: 'error' });
    } else if (v[id] <= 0 && id !== 'td_dig') {
      // td_dig could theoretically be 0, but not negative; others must be > 0
      if (v[id] < 0) issues.push({ field: id, message: 'Il valore non può essere negativo', severity: 'error' });
      else if (v[id] === 0 && !['td_pwm','td_dig'].includes(id)) issues.push({ field: id, message: 'Il valore deve essere maggiore di zero', severity: 'error' });
    }
  });

  // Domain-specific: three-phase converter requires V_DC > peak line-to-line voltage
  if (!isNaN(v.v_dc) && !isNaN(v.v_ac)) {
    const vdcMinFactor = getVdcMinFactor();
    const vpk = v.v_ac * vdcMinFactor;
    if (v.v_dc <= vpk) {
      issues.push({
        field: 'v_dc',
        message: `V_DC deve essere > √6·V_AC (${vpk.toFixed(0)} V) per un convertitore trifase`,
        severity: 'error'
      });
    } else if (v.v_dc < vpk * 1.05) {
      issues.push({
        field: 'v_dc',
        message: `V_DC molto vicino al minimo trifase: duty max si avvicina a 0, ripple elevato`,
        severity: 'warn'
      });
    }
  }

  // Switching frequency vs line frequency
  if (!isNaN(v.f_sw) && !isNaN(v.f_line)) {
    if (v.f_sw * 1000 < v.f_line * 20) {
      issues.push({ field: 'f_sw', message: 'f_sw troppo bassa rispetto a f_linea', severity: 'warn' });
    }
  }

  return issues;
}

function applyValidationUI() {
  const issues = validateAll();
  // Clear all
  ALL_PARAM_IDS.forEach(id => {
    const el = document.getElementById(id);
    const err = document.getElementById('err-' + id);
    if (el) el.classList.remove('invalid');
    if (err) { err.classList.remove('show'); err.textContent = ''; }
  });
  // Apply
  const byField = {};
  issues.forEach(iss => {
    if (!byField[iss.field] || iss.severity === 'error') byField[iss.field] = iss;
  });
  Object.keys(byField).forEach(field => {
    const iss = byField[field];
    const el = document.getElementById(field);
    const err = document.getElementById('err-' + field);
    if (el && iss.severity === 'error') el.classList.add('invalid');
    if (err) {
      err.textContent = (iss.severity === 'error' ? '⚠ ' : 'ℹ ') + iss.message;
      err.classList.add('show');
      err.style.color = iss.severity === 'error' ? 'var(--danger)' : 'var(--warning)';
    }
  });
  return issues.filter(i => i.severity === 'error').length === 0;
}

// ---------- Presets ----------
const PRESETS = {
  small: {
    label: '3kW / 650V / 20kHz',
    values: { v_ac: 230, f_line: 50, p_out: 3000, v_dc: 650, L: 2.5, R_l: 0.1, C_dc: 1000, f_sw: 20, R_load: 141 }
  },
  medium: {
    label: '10kW / 1100V / 20kHz',
    values: { v_ac: 400, f_line: 50, p_out: 10000, v_dc: 1100, L: 1.2, R_l: 0.05, C_dc: 2200, f_sw: 20, R_load: 121 }
  },
  large: {
    label: '50kW / 1150V / 16kHz',
    values: { v_ac: 400, f_line: 50, p_out: 50000, v_dc: 1150, L: 0.4, R_l: 0.01, C_dc: 6800, f_sw: 16, R_load: 26.5 }
  },
  us: {
    label: '5kW / 800V / 50kHz (60Hz)',
    values: { v_ac: 277, f_line: 60, p_out: 5000, v_dc: 800, L: 0.8, R_l: 0.03, C_dc: 1500, f_sw: 50, R_load: 128 }
  }
};

function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  Object.entries(preset.values).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  applyValidationUI();
  computeSystem();
  saveToStorage();
  showToast(`Preset "${preset.label}" applicato`, 'success');
}

// ---------- Side-by-side preset comparison ----------
const PRESET_COMPARE_ROWS = [
  { key: 'v_ac', label: 'V_AC (fase)', unit: 'V' },
  { key: 'f_line', label: 'f_linea', unit: 'Hz' },
  { key: 'p_out', label: 'P_out', unit: 'W' },
  { key: 'v_dc', label: 'V_DC ref', unit: 'V' },
  { key: 'L', label: 'L', unit: 'mH' },
  { key: 'R_l', label: 'R_L', unit: 'Ω' },
  { key: 'C_dc', label: 'C_DC', unit: 'μF' },
  { key: 'f_sw', label: 'f_sw', unit: 'kHz' },
  { key: 'R_load', label: 'R_load', unit: 'Ω' }
];

function updatePresetComparison() {
  const keyA = document.getElementById('compare_preset_a')?.value;
  const keyB = document.getElementById('compare_preset_b')?.value;
  const presetA = PRESETS[keyA];
  const presetB = PRESETS[keyB];
  if (!presetA || !presetB) return;

  document.getElementById('compareHeadA').textContent = presetA.label;
  document.getElementById('compareHeadB').textContent = presetB.label;

  const tbody = document.getElementById('presetCompareBody');
  tbody.innerHTML = PRESET_COMPARE_ROWS.map(row => {
    const valA = presetA.values[row.key];
    const valB = presetB.values[row.key];
    const diffClass = valA === valB ? '' : (valA > valB ? '' : '');
    return `<tr><td>${row.label} (${row.unit})</td><td>${valA}</td><td>${valB}</td></tr>`;
  }).join('');

  // Derived comparison: computed peak current and Vdc headroom for each,
  // useful context beyond the raw input parameters.
  const derivedA = computePresetDerived(presetA.values);
  const derivedB = computePresetDerived(presetB.values);
  tbody.innerHTML += `
    <tr><td><strong>I_pk (calcolata)</strong></td><td>${derivedA.iPk.toFixed(2)} A</td><td>${derivedB.iPk.toFixed(2)} A</td></tr>
    <tr><td><strong>Margine V_DC su minimo</strong></td><td>${derivedA.headroom.toFixed(0)}%</td><td>${derivedB.headroom.toFixed(0)}%</td></tr>
  `;
}

function computePresetDerived(values) {
  const iPk = Math.sqrt(2) * values.p_out / (3 * values.v_ac);
  const vdcMin = Math.sqrt(6) * values.v_ac;
  const headroom = ((values.v_dc - vdcMin) / vdcMin) * 100;
  return { iPk, headroom };
}

function applyPresetFromCompare(which) {
  const key = document.getElementById('compare_preset_' + which)?.value;
  if (key) applyPreset(key);
}

// ---------- LocalStorage persistence ----------
function collectAllParams() {
  const data = { system: {}, parasitics: {}, loops: {} };
  ['v_ac','f_line','p_out','v_dc','L','R_l','C_dc','f_sw','R_load','topology','ripple_target_pct','holdup_vmin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) data.system[id] = el.value;
  });
  ['td_pwm','f_sense','f_aaf','td_dig'].forEach(id => {
    const el = document.getElementById(id);
    if (el) data.parasitics[id] = el.value;
  });
  ['bw_i_slider','bw_v_slider','bw_pll_slider','zeta_pll_slider','disc_method_i','disc_fs_i','disc_method_v','disc_fs_v','ki_corr_tcalc','load_rmin_pct','load_rmax_pct','disc_method_pll','disc_fs_pll','adc_loop','adc_bits','adc_fullscale','pll_step_freq_delta','pll_step_phase_delta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) data.loops[id] = el.value;
  });
  return data;
}

function saveToStorage() {
  try {
    const data = collectAllParams();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Impossibile salvare in localStorage', e);
  }
}

function loadFromStorageIfPresent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    applyLoadedData(data);
    return true;
  } catch (e) {
    console.warn('Impossibile caricare da localStorage', e);
    return false;
  }
}

function applyLoadedData(data) {
  if (!data) return;
  if (data.system) Object.entries(data.system).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  if (data.parasitics) Object.entries(data.parasitics).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  if (data.loops) Object.entries(data.loops).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  // Refresh topology-dependent formula/note text if a topology was restored
  if (data.system && 'topology' in data.system && typeof onTopologyChanged === 'function') {
    const topoSelect = document.getElementById('topology');
    if (topoSelect) {
      const formulaEl = document.getElementById('topologyFormula');
      const noteEl = document.getElementById('topologyNote');
      if (topoSelect.value === 'vienna' && formulaEl && noteEl) {
        noteEl.innerHTML = 'Vienna Rectifier a 3 livelli: stesso vincolo minimo sul bus totale del boost a 6 switch, ma ogni switch vede solo V<sub>DC</sub>/2 — utile per ridurre lo stress di tensione sui semiconduttori o abilitare f<sub>sw</sub> più alte a parità di dispositivo.';
      }
    }
  }
}

// ---------- Import / Export JSON ----------
function exportFullConfig() {
  const data = collectAllParams();
  data.exportedAt = new Date().toISOString();
  data.version = 1;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pfc_tuning_config.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Configurazione esportata', 'success');
}

function triggerImportDialog() {
  document.getElementById('importFileInput').click();
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.system && !data.loops) {
        showToast('File JSON non riconosciuto', 'error');
        return;
      }
      applyLoadedData(data);
      applyValidationUI();
      computeSystem();
      saveToStorage();
      if (typeof refreshCurrentTab === 'function') refreshCurrentTab();
      showToast('Configurazione importata correttamente', 'success');
    } catch (err) {
      showToast('Errore nel parsing del file JSON', 'error');
      console.error(err);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ---------- PDF report export (client-side, via window.print()) ----------
// This app is a fully offline-capable PWA with no backend, so PDF generation
// is done client-side using the browser's native print-to-PDF, driven by a
// dedicated print stylesheet (@media print) and a hidden DOM tree built here.
// Canvases are captured as static images via toDataURL so the printed report
// isn't dependent on canvas re-render timing.
function captureCanvasAsImg(canvasId, altText) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || canvas.width === 0) return '';
  try {
    const dataUrl = canvas.toDataURL('image/png');
    return `<img class="print-chart" src="${dataUrl}" alt="${altText}">`;
  } catch (e) {
    console.warn('Impossibile catturare canvas ' + canvasId, e);
    return '';
  }
}

function exportPDFReport() {
  // IMPORTANT: refreshCurrentTab() reads the `currentTab` variable but the
  // actual chart containers only get real (non-zero) dimensions when their
  // parent .panel element has the 'active' class (display:block via CSS).
  // Previously this function only changed `currentTab` and called
  // refreshCurrentTab() without touching the DOM's active panel, so canvases
  // for tabs other than the one currently open were drawn into a
  // display:none container with 0x0 layout size — leaving them blank/broken
  // until the user manually revisited that tab. We now genuinely activate
  // each panel (moved off-screen so the user doesn't see the flicker),
  // render into it, then restore the original active panel exactly as it was.
  const panelsToCapture = ['current', 'voltage', 'pll', 'robustness'];
  const originalActivePanel = document.querySelector('.panel.active');
  const originalActiveTab = document.querySelector('.tab.active');
  const savedTab = currentTab;

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

  panelsToCapture.forEach(tab => {
    const panel = document.getElementById('panel-' + tab);
    if (!panel) return;
    panel.classList.add('active');
    currentTab = tab;
    refreshCurrentTab();
    panel.classList.remove('active');
  });

  // Restore exactly what was active before, both the JS state and the DOM classes.
  currentTab = savedTab;
  if (originalActivePanel) originalActivePanel.classList.add('active');
  refreshCurrentTab();

  const now = new Date();
  const dateStr = now.toLocaleDateString('it-IT') + ' ' + now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  const topology = document.getElementById('topology')?.value === 'vienna' ? 'Vienna Rectifier (3 livelli)' : 'Boost trifase 6-switch';

  const sysRows = [
    ['V_AC (fase, RMS)', document.getElementById('v_ac').value, 'V'],
    ['f_linea', document.getElementById('f_line').value, 'Hz'],
    ['P_out', document.getElementById('p_out').value, 'W'],
    ['V_DC ref', document.getElementById('v_dc').value, 'V'],
    ['L', document.getElementById('L').value, 'mH'],
    ['R_L', document.getElementById('R_l').value, 'Ω'],
    ['C_DC', document.getElementById('C_dc').value, 'μF'],
    ['f_sw', document.getElementById('f_sw').value, 'kHz'],
    ['R_load', document.getElementById('R_load').value, 'Ω']
  ];

  const loopRows = [
    ['K_p (corrente)', document.getElementById('kp_i')?.textContent || '--', 'Ω'],
    ['K_i (corrente)', document.getElementById('ki_i')?.textContent || '--', 'Ω/s'],
    ['PM ideale (corrente)', document.getElementById('pm_i')?.textContent || '--', '°'],
    ['PM reale (corrente)', document.getElementById('pm_i_real')?.textContent || '--', '°'],
    ['K_p (tensione)', document.getElementById('kp_v')?.textContent || '--', 'A/V'],
    ['K_i (tensione)', document.getElementById('ki_v')?.textContent || '--', 'A/(V·s)'],
    ['PM (tensione)', document.getElementById('pm_v')?.textContent || '--', '°'],
    ['K_p (PLL)', document.getElementById('kp_pll')?.textContent || '--', 'rad/s'],
    ['K_i (PLL)', document.getElementById('ki_pll')?.textContent || '--', 'rad/s²'],
    ['PM (PLL)', document.getElementById('pm_pll')?.textContent || '--', '°']
  ];

  const coherenceItems = checkLoopCoherence();
  const coherenceHTML = coherenceItems.map(it =>
    `<span class="print-badge" style="border-color:${it.status === 'ok' ? '#1a8bb8' : it.status === 'warn' ? '#d9a900' : '#E4007C'}">${it.label}: ${it.detail}</span>`
  ).join(' ');

  const discRows = [
    ['Corrente', document.getElementById('disc_method_i')?.value || '--', document.getElementById('disc_fs_i')?.value || '--', document.getElementById('disc_i_b0')?.textContent || '--', document.getElementById('disc_i_b1')?.textContent || '--'],
    ['Tensione', document.getElementById('disc_method_v')?.value || '--', document.getElementById('disc_fs_v')?.value || '--', document.getElementById('disc_v_b0')?.textContent || '--', document.getElementById('disc_v_b1')?.textContent || '--'],
    ['PLL', document.getElementById('disc_method_pll')?.value || '--', document.getElementById('disc_fs_pll')?.value || '--', document.getElementById('disc_pll_b0')?.textContent || '--', document.getElementById('disc_pll_b1')?.textContent || '--']
  ];

  const root = document.getElementById('printReportRoot');
  root.innerHTML = `
    <h1>⚡ PFC Tuner — Report di Tuning</h1>
    <div class="print-meta">Generato il ${dateStr} &nbsp;|&nbsp; Topologia: ${topology}</div>

    <div class="print-section">
      <h2>Parametri del Sistema</h2>
      <table>
        <thead><tr><th>Parametro</th><th>Valore</th><th>Unità</th></tr></thead>
        <tbody>${sysRows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody>
      </table>
    </div>

    <div class="print-section">
      <h2>Guadagni e Margini dei Loop</h2>
      <table>
        <thead><tr><th>Parametro</th><th>Valore</th><th>Unità</th></tr></thead>
        <tbody>${loopRows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody>
      </table>
    </div>

    <div class="print-section">
      <h2>Coerenza Multi-Loop</h2>
      <div>${coherenceHTML}</div>
    </div>

    <div class="print-section">
      <h2>Bode Loop di Corrente</h2>
      ${captureCanvasAsImg('bodeI', 'Bode loop corrente')}
    </div>

    <div class="print-section">
      <h2>Bode Loop di Tensione</h2>
      ${captureCanvasAsImg('bodeV', 'Bode loop tensione')}
    </div>

    <div class="print-section">
      <h2>Bode PLL</h2>
      ${captureCanvasAsImg('bodePLL', 'Bode PLL')}
    </div>

    <div class="print-section">
      <h2>Regolatori Discreti (z-domain)</h2>
      <table>
        <thead><tr><th>Loop</th><th>Metodo</th><th>f_camp (kHz)</th><th>b0</th><th>b1</th></tr></thead>
        <tbody>${discRows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')}</tbody>
      </table>
      <p style="font-size:0.8rem;color:#555;">Forma incrementale: u[n] = u[n-1] + b0·e[n] + b1·e[n-1]</p>
    </div>

    <div class="print-section">
      <h2>Correzione K<sub>i</sub> per Ritardo Digitale (Corrente)</h2>
      <table>
        <thead><tr><th>Parametro</th><th>Valore</th></tr></thead>
        <tbody>
          <tr><td>T_d totale</td><td>${document.getElementById('ki_corr_td')?.textContent || '--'} μs</td></tr>
          <tr><td>K_i originale</td><td>${document.getElementById('ki_corr_ki_orig')?.textContent || '--'}</td></tr>
          <tr><td>K_i corretto</td><td>${document.getElementById('ki_corr_ki_new')?.textContent || '--'}</td></tr>
          <tr><td>Riduzione</td><td>${document.getElementById('ki_corr_pct')?.textContent || '--'}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="print-section">
      <h2>Analisi Worst-Case</h2>
      ${document.getElementById('worstCaseBody') ? document.getElementById('worstCaseBody').closest('table').outerHTML : '<p>Non calcolato in questa sessione.</p>'}
    </div>

    <div class="print-section">
      <h2>Robustezza al Carico</h2>
      ${captureCanvasAsImg('loadPMPlot', 'PM vs Rload')}
      <table>
        <thead><tr><th>Parametro</th><th>Valore</th></tr></thead>
        <tbody>
          <tr><td>PM minimo nel range</td><td>${document.getElementById('load_pm_min')?.textContent || '--'}°</td></tr>
          <tr><td>PM a pieno carico</td><td>${document.getElementById('load_pm_at_rmin')?.textContent || '--'}°</td></tr>
          <tr><td>PM a carico leggero</td><td>${document.getElementById('load_pm_at_rmax')?.textContent || '--'}°</td></tr>
          <tr><td>PM al nominale</td><td>${document.getElementById('load_pm_nominal')?.textContent || '--'}°</td></tr>
        </tbody>
      </table>
    </div>

    <div class="print-section">
      <h2>Rumore di Quantizzazione ADC</h2>
      <table>
        <thead><tr><th>Parametro</th><th>Valore</th></tr></thead>
        <tbody>
          <tr><td>Risoluzione</td><td>${document.getElementById('adc_bits')?.value || '--'} bit</td></tr>
          <tr><td>1 LSB</td><td>${document.getElementById('adc_lsb')?.textContent || '--'}</td></tr>
          <tr><td>σ_q (rumore RMS)</td><td>${document.getElementById('adc_sigma')?.textContent || '--'}</td></tr>
          <tr><td>SNR quantizzazione</td><td>${document.getElementById('adc_snr')?.textContent || '--'} dB</td></tr>
        </tbody>
      </table>
    </div>
  `;

  showToast('Apertura anteprima di stampa…', 'success', 1500);
  setTimeout(() => window.print(), 300);
}
function checkLoopCoherence() {
  const bwI = parseFloat(document.getElementById('bw_i_slider')?.value) || 0;
  const bwV = parseFloat(document.getElementById('bw_v_slider')?.value) || 0;
  const bwPLL = parseFloat(document.getElementById('bw_pll_slider')?.value) || 0;
  const fSw = (parseFloat(document.getElementById('f_sw')?.value) || 20) * 1000;
  const fLine = parseFloat(document.getElementById('f_line')?.value) || 50;

  const items = [];

  // Current loop BW vs switching freq
  const ratioSwI = fSw / bwI;
  items.push({
    label: `BW corrente vs f_sw`,
    detail: `${bwI} Hz vs ${fSw} Hz (rapporto ${ratioSwI.toFixed(1)}x)`,
    status: ratioSwI >= 10 ? 'ok' : (ratioSwI >= 5 ? 'warn' : 'bad')
  });

  // Voltage loop BW vs Current loop BW
  const ratioIV = bwI / bwV;
  items.push({
    label: `BW corrente vs BW tensione`,
    detail: `${bwI} Hz vs ${bwV} Hz (rapporto ${ratioIV.toFixed(1)}x)`,
    status: ratioIV >= 10 ? 'ok' : (ratioIV >= 5 ? 'warn' : 'bad')
  });

  // PLL BW vs Voltage loop BW
  const ratioVPLL = bwV / bwPLL;
  items.push({
    label: `BW tensione vs BW PLL`,
    detail: `${bwV} Hz vs ${bwPLL} Hz (rapporto ${ratioVPLL.toFixed(1)}x)`,
    status: ratioVPLL >= 2 ? 'ok' : (ratioVPLL >= 1 ? 'warn' : 'bad')
  });

  // PLL BW vs line frequency (100Hz rejection)
  const ratioLinePLL = (fLine / 10) / bwPLL;
  items.push({
    label: `BW PLL vs f_linea/10`,
    detail: `${bwPLL} Hz vs limite ${(fLine/10).toFixed(1)} Hz`,
    status: bwPLL <= fLine / 10 ? 'ok' : (bwPLL <= fLine / 6 ? 'warn' : 'bad')
  });

  return items;
}

function renderCoherenceList() {
  const container = document.getElementById('coherenceList');
  if (!container) return;
  const items = checkLoopCoherence();
  container.innerHTML = items.map(it => `
    <div class="coherence-item">
      <div class="dot ${it.status}"></div>
      <div><strong>${it.label}</strong><br><span style="color:var(--text-2);font-size:0.78rem;">${it.detail}</span></div>
    </div>
  `).join('');
}
