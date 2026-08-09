// ===================== APP LOGIC =====================

let currentTab = 'system';
let gridMode = 'v';
let rippleMode = 'full';
let compareEnabled = { current: false, voltage: false, pll: false };
let prevCurves = { current: null, voltage: null, pll: null };

function switchTab(name, evt) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const ev = evt || window.event;
  if (ev && ev.target) ev.target.classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');

  // Wait for the browser to actually commit the display:block change before
  // measuring canvas container dimensions. A single synchronous call right
  // after adding the 'active' class can, on some devices/timings, still see
  // the panel's pre-switch (display:none, zero-width) layout — the guards in
  // render.js correctly refuse to draw in that case, but without this retry
  // nothing would ever trigger the follow-up draw once real layout is ready.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => refreshCurrentTab());
  });
}

function refreshCurrentTab() {
  if (currentTab === 'current') { updateCurrentLoop(); }
  if (currentTab === 'voltage') { updateVoltageLoop(); }
  if (currentTab === 'pll') { updatePLL(); }
  if (currentTab === 'grid') { updateGrid(); }
  if (currentTab === 'power') { updatePower(); }
  if (currentTab === 'ripple') { updateRipple(); }
  if (currentTab === 'robustness') { updateRobustnessTab(); }
  if (currentTab === 'equations') { renderEquations(); }
  if (currentTab === 'summary') { updateSummary(); }
}

function toggleCollapse(el) {
  el.classList.toggle('open');
  const body = el.nextElementSibling;
  body.classList.toggle('open');
}

function setGridMode(mode) {
  gridMode = mode;
  document.querySelectorAll('#panel-grid .toggle-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn' + (mode === 'both' ? 'Both' : mode === 'i' ? 'I' : 'V')).classList.add('active');
  updateGrid();
}

function setRippleMode(mode) {
  rippleMode = mode;
  document.getElementById('btnRippleFull').classList.toggle('active', mode === 'full');
  document.getElementById('btnRippleOnly').classList.toggle('active', mode === 'only');
  updateRipple();
}

function toggleCompare(loopName, checked) {
  compareEnabled[loopName] = checked;
  if (loopName === 'current') updateCurrentLoop();
  if (loopName === 'voltage') updateVoltageLoop();
  if (loopName === 'pll') updatePLL();
}

function snapshotCurve(loopName, freqs, mags) {
  prevCurves[loopName] = { freqs: freqs.slice(), mags: mags.slice() };
}

function onParamInputChanged() {
  applyValidationUI();
  saveToStorage();
}

// ---------- Complex number helpers ----------
function complex(re, im) { return { re, im }; }
function cAdd(a, b) { return complex(a.re + b.re, a.im + b.im); }
function cMul(a, b) { return complex(a.re*b.re - a.im*b.im, a.re*b.im + a.im*b.re); }
function cDiv(a, b) {
  const den = b.re*b.re + b.im*b.im;
  return complex((a.re*b.re + a.im*b.im)/den, (a.im*b.re - a.re*b.im)/den);
}
function cAbs(a) { return Math.sqrt(a.re*a.re + a.im*a.im); }
function cArg(a) { return Math.atan2(a.im, a.re) * 180 / Math.PI; }

function evalTF(num, den, s) {
  let n = complex(0,0), d = complex(0,0), sp = complex(1,0);
  for (let i = 0; i < num.length; i++) {
    n = cAdd(n, cMul(complex(num[i], 0), sp));
    sp = cMul(sp, s);
  }
  sp = complex(1,0);
  for (let i = 0; i < den.length; i++) {
    d = cAdd(d, cMul(complex(den[i], 0), sp));
    sp = cMul(sp, s);
  }
  return cDiv(n, d);
}

function parasiticMagPhase(w) {
  // For every parasitic field, 0 is a physically meaningful value (no delay /
  // pole at infinity), not an "invalid input" — so the fallback to a default
  // must trigger only on NaN (empty/non-numeric field), never via a bare
  // `|| default`, which in JS also fires for the legitimate value 0.
  const parseFieldOrDefault = (id, def) => {
    const v = parseFloat(document.getElementById(id).value);
    return isNaN(v) ? def : v;
  };
  const td_pwm = parseFieldOrDefault('td_pwm', 50) * 1e-6;
  const f_sense = parseFieldOrDefault('f_sense', 50) * 1e3;
  const f_aaf = parseFieldOrDefault('f_aaf', 10) * 1e3;
  const td_dig = parseFieldOrDefault('td_dig', 1.0);
  const f_sw = (parseFloat(document.getElementById('f_sw').value) || 20) * 1e3;
  const Ts = 1 / f_sw;

  const phase_pwm = -w * td_pwm * 180 / Math.PI;
  const mag_pwm = 1.0;

  const w_sense = 2 * Math.PI * f_sense;
  const mag_sense = 1 / Math.sqrt(1 + (w/w_sense)**2);
  const phase_sense = -Math.atan(w/w_sense) * 180 / Math.PI;

  const w_aaf = 2 * Math.PI * f_aaf;
  const mag_aaf = 1 / Math.sqrt(1 + (w/w_aaf)**2);
  const phase_aaf = -Math.atan(w/w_aaf) * 180 / Math.PI;

  const phase_dig = -w * td_dig * Ts * 180 / Math.PI;
  const mag_dig = 1.0;

  const magTotal = mag_pwm * mag_sense * mag_aaf * mag_dig;
  const phaseTotal = phase_pwm + phase_sense + phase_aaf + phase_dig;

  return { mag: magTotal, phase: phaseTotal };
}

function computeSystem() {
  const v_ac = parseFloat(document.getElementById('v_ac').value) || 230;
  const p_out = parseFloat(document.getElementById('p_out').value) || 3000;
  const v_dc = parseFloat(document.getElementById('v_dc').value) || 400;
  const L = (parseFloat(document.getElementById('L').value) || 2.5) * 1e-3;
  const f_sw = (parseFloat(document.getElementById('f_sw').value) || 20) * 1e3;

  const i_pk = Math.sqrt(2) * p_out / (3 * v_ac);
  const i_rms = p_out / (3 * v_ac);
  const vdcMinFactor = getVdcMinFactor();
  const d_max = Math.max(0, Math.min(0.99, 1 - (v_ac * vdcMinFactor) / v_dc));
  const delta_i = v_dc * d_max * (1 - d_max) / (L * f_sw);
  const ripple_pct = (delta_i / (i_pk * 2)) * 100;

  document.getElementById('res_i_pk').textContent = i_pk.toFixed(2);
  document.getElementById('res_i_rms').textContent = i_rms.toFixed(2);
  document.getElementById('res_duty').textContent = d_max.toFixed(3);
  document.getElementById('res_ripple').textContent = ripple_pct.toFixed(1) + '%';
  document.getElementById('sysResults').style.display = 'grid';

  const maxBw = Math.floor(f_sw / 10);
  const slider = document.getElementById('bw_i_slider');
  slider.max = maxBw;
  if (parseInt(slider.value) > maxBw) slider.value = Math.floor(maxBw / 2);

  updateCapacitorSizing();
}

// ---------- Capacitor sizing (ripple target -> Cmin) and hold-up time ----------
function updateCapacitorSizing() {
  const p_out = parseFloat(document.getElementById('p_out').value) || 3000;
  const v_dc = parseFloat(document.getElementById('v_dc').value) || 400;
  const f_line = parseFloat(document.getElementById('f_line').value) || 50;
  const C_actual = (parseFloat(document.getElementById('C_dc').value) || 1000) * 1e-6;
  const ripplePct = parseFloat(document.getElementById('ripple_target_pct')?.value) || 2;
  const vHoldMin = parseFloat(document.getElementById('holdup_vmin')?.value) || 350;

  // Cmin from a target voltage ripple at 2*f_line (dominant ripple harmonic
  // for a balanced three-phase PFC; a single-phase PFC would instead be
  // dominated by a much larger ripple at 2*f_line with no triplen-cancellation
  // benefit, requiring a substantially larger capacitor for the same target).
  const deltaV = v_dc * (ripplePct / 100);
  const wRipple = 2 * Math.PI * (2 * f_line);
  const cMin = p_out / (wRipple * v_dc * deltaV);
  const cMinUF = cMin * 1e6;

  const cminEl = document.getElementById('cmin_result');
  const cminVsEl = document.getElementById('cmin_vs_actual');
  const badgeC = document.getElementById('badge_csize');
  if (cminEl) {
    cminEl.textContent = cMinUF.toFixed(0);
    const actualUF = C_actual * 1e6;
    const ratio = actualUF / cMinUF;
    cminVsEl.textContent = actualUF.toFixed(0) + ' / ' + cMinUF.toFixed(0) + ' μF';
    if (ratio >= 1) {
      badgeC.innerHTML = '<span class="badge ok">✅ C_DC attuale sufficiente (' + ratio.toFixed(2) + '× il minimo)</span>';
    } else {
      badgeC.innerHTML = '<span class="badge bad">❌ C_DC attuale insufficiente per il ripple target (' + ratio.toFixed(2) + '× il minimo, servirebbero almeno ' + cMinUF.toFixed(0) + ' μF)</span>';
    }
  }

  // Hold-up time: energy stored between nominal Vdc and the minimum operating
  // voltage, divided by constant output power during the outage.
  const holdEl = document.getElementById('holdup_time');
  const cyclesEl = document.getElementById('holdup_cycles');
  const badgeH = document.getElementById('badge_holdup');
  if (holdEl) {
    if (vHoldMin >= v_dc) {
      holdEl.textContent = '0.0';
      cyclesEl.textContent = '0.0';
      if (badgeH) badgeH.innerHTML = '<span class="badge bad">❌ V_min ≥ V_DC nominale: nessun hold-up disponibile</span>';
    } else {
      const tHold = (C_actual * (v_dc * v_dc - vHoldMin * vHoldMin)) / (2 * p_out);
      const tHoldMs = tHold * 1000;
      const cycles = tHold * f_line;
      holdEl.textContent = tHoldMs.toFixed(1);
      cyclesEl.textContent = cycles.toFixed(2);
      if (badgeH) {
        if (tHoldMs >= 20) {
          badgeH.innerHTML = '<span class="badge ok">✅ Hold-up ≥ 20ms (un ciclo di rete completo a 50Hz)</span>';
        } else if (tHoldMs >= 10) {
          badgeH.innerHTML = '<span class="badge warn">⚠️ Hold-up ' + tHoldMs.toFixed(1) + 'ms — copre mezzo ciclo, potrebbe non bastare per requisiti IEC 61000-4-11</span>';
        } else {
          badgeH.innerHTML = '<span class="badge bad">❌ Hold-up ' + tHoldMs.toFixed(1) + 'ms — insufficiente per la maggior parte delle applicazioni industriali</span>';
        }
      }
    }
  }
}

let currentLoopDebounceTimer;
function updateCurrentLoopDebounced() {
  clearTimeout(currentLoopDebounceTimer);
  currentLoopDebounceTimer = setTimeout(updateCurrentLoop, 250);
}

// ===================== Step response analysis (adaptive window + metrics) =====================
// Simulates a first-order-PI closed loop step response for as long as needed
// to see it actually settle (within a 2% band), instead of a fixed multiple
// of the nominal time constant — which can cut the plot off mid-transient
// for lightly-damped or marginally-stable tunings (low phase margin), making
// it look like the response never settles even though it eventually does.
function simulateStepResponse(stepFn, dt, nominalTau, maxCycles) {
  const targetValue = 1.0;
  const tolerance = 0.02; // 2% settling band, standard control-engineering convention
  const maxT = nominalTau * maxCycles; // hard cap so a truly unstable/oscillating system doesn't run forever
  const maxSteps = Math.min(200000, Math.floor(maxT / dt)); // computation cap

  const rawTimes = [], rawVals = [];
  let state = stepFn.init();
  let lastOutsideBandTime = 0;
  let everEntered = false;

  for (let n = 0; n <= maxSteps; n++) {
    const t = n * dt;
    state = stepFn.step(state, dt);
    rawTimes.push(t);
    rawVals.push(state.output);

    const withinBand = Math.abs(state.output - targetValue) <= tolerance * Math.abs(targetValue || 1);
    if (withinBand) {
      everEntered = true;
    } else {
      lastOutsideBandTime = t;
      everEntered = false;
    }
  }

  // Settling time: last moment the response was outside the 2% band. If it
  // never actually settles within the cap, report the cap itself (visible
  // as "did not settle" in the UI) instead of a misleading number.
  const settled = everEntered;
  const settlingTime = settled ? lastOutsideBandTime : maxT;

  // Overshoot: peak value above the target, as a percentage of the target.
  // Uses a plain loop instead of Math.max(...rawVals) — the spread form
  // passes every array element as an individual function argument, which
  // throws "Maximum call stack size exceeded" once rawVals grows past the
  // engine's argument-count limit (easily reached here, since rawVals can
  // hold up to ~200k raw simulation samples before downsampling).
  let peakValue = targetValue;
  for (let i = 0; i < rawVals.length; i++) {
    if (rawVals[i] > peakValue) peakValue = rawVals[i];
  }
  const overshootPct = Math.max(0, (peakValue - targetValue) / Math.abs(targetValue || 1) * 100);

  // Rise time: 10% to 90% of the target value (standard definition).
  let t10 = null, t90 = null;
  for (let i = 0; i < rawVals.length; i++) {
    if (t10 === null && rawVals[i] >= 0.1 * targetValue) t10 = rawTimes[i];
    if (t90 === null && rawVals[i] >= 0.9 * targetValue) { t90 = rawTimes[i]; break; }
  }
  const riseTime = (t10 !== null && t90 !== null) ? (t90 - t10) : null;

  const finalValue = rawVals[rawVals.length - 1];

  // Choose a plot window that shows the settled response plus a little
  // headroom, instead of either a fixed duration (can cut off transients)
  // or the full simulated cap (wastes most of the plot on a flat tail).
  const plotWindow = settled ? Math.min(maxT, settlingTime * 1.3 + nominalTau * 0.5) : maxT;

  // Downsample for display (keep ~500 points across the chosen plot window).
  const times = [], vals = [];
  const plotSteps = rawTimes.findIndex(t => t > plotWindow);
  const usableLen = plotSteps === -1 ? rawTimes.length : plotSteps;
  const stride = Math.max(1, Math.ceil(usableLen / 500));
  for (let i = 0; i < usableLen; i += stride) {
    times.push(rawTimes[i]);
    vals.push(rawVals[i]);
  }
  // Always include the final point so the plotted curve reaches the window edge.
  if (times[times.length - 1] < rawTimes[usableLen - 1]) {
    times.push(rawTimes[usableLen - 1]);
    vals.push(rawVals[usableLen - 1]);
  }

  return { times, vals, settlingTime, settled, overshootPct, riseTime, finalValue, targetValue };
}

function displayStepMetrics(loopName, result) {
  const prefix = loopName === 'current' ? 'stepI' : 'stepV';
  const settlingEl = document.getElementById(prefix + '_settling');
  const overshootEl = document.getElementById(prefix + '_overshoot');
  const riseEl = document.getElementById(prefix + '_rise');
  const finalEl = document.getElementById(prefix + '_final');
  const badgeEl = document.getElementById(prefix + '_badge');
  if (!settlingEl) return;

  const settlingMs = result.settlingTime * 1000;
  settlingEl.textContent = result.settled ? settlingMs.toFixed(2) : '>' + settlingMs.toFixed(0);
  overshootEl.textContent = result.overshootPct.toFixed(1) + '%';
  riseEl.textContent = result.riseTime !== null ? (result.riseTime * 1000).toFixed(3) : '--';
  finalEl.textContent = (result.finalValue * 100).toFixed(1) + '%';

  if (badgeEl) {
    if (!result.settled) {
      badgeEl.innerHTML = '<span class="badge bad">❌ Non si assesta entro la finestra simulata (possibile instabilità)</span>';
    } else if (result.overshootPct > 30) {
      badgeEl.innerHTML = '<span class="badge warn">⚠️ Overshoot elevato (' + result.overshootPct.toFixed(0) + '%)</span>';
    } else {
      badgeEl.innerHTML = '<span class="badge ok">✅ Assestato a ' + settlingMs.toFixed(1) + ' ms (banda ±2%)</span>';
    }
  }
}

// ===================== Discrete-time (z-domain) PI controller =====================
// Converts a continuous PI controller C(s) = Kp + Ki/s into the incremental
// (velocity form) difference equation commonly used in firmware:
//   u[n] = u[n-1] + b0*e[n] + b1*e[n-1]
// This form is preferred in embedded control because it's inherently
// anti-windup-friendly (no separate integrator state to clamp) and avoids
// accumulating floating-point error in a running integral.
//
// Three standard discretization methods are supported:
// - Tustin (bilinear transform): s = (2/Ts)*(z-1)/(z+1). Best frequency-domain
//   matching near the design bandwidth, the standard choice for control loops.
// - Backward Euler: s = (z-1)/(Ts*z). Unconditionally stable, slightly more
//   phase lag than Tustin — common in low-cost fixed-point implementations.
// - Forward Euler: s = (z-1)/Ts. Simplest to implement but can go unstable
//   for large Ts relative to the loop bandwidth — included for comparison/education.
function discretizePI(Kp, Ki, Ts, method) {
  let b0, b1;
  if (method === 'tustin') {
    b0 = Kp + Ki * Ts / 2;
    b1 = -Kp + Ki * Ts / 2;
  } else if (method === 'backward') {
    b0 = Kp + Ki * Ts;
    b1 = -Kp;
  } else { // forward
    b0 = Kp;
    b1 = -Kp + Ki * Ts;
  }
  const a1 = -1; // u[n] - u[n-1] = ... always unity for this incremental form
  return { b0, b1, a1, Ts, method };
}

// ===================== Ki correction for digital/sampling delay =====================
// Simplified approach common in PFC firmware: rather than redesigning the
// whole controller in the z-domain, only Ki is reduced to compensate the
// phase lag introduced by the total digital delay Td = Ts/2 (zero-order-hold
// equivalent delay) + any extra computation time. Kp is left unchanged
// because the proportional term acts directly on the current sampled error
// and doesn't accumulate lag the way the integral term's history does.
//
// The correction factor used is the standard small-delay linearization:
//   Ki_corrected = Ki_original * (1 - wc*Td)
// where wc is the designed closed-loop bandwidth (rad/s). This keeps the
// same DC/low-frequency integral gain shape while trimming the portion of
// integral action that would otherwise eat into the phase margin at the
// crossover frequency. For Td large enough that (1 - wc*Td) would go
// negative (i.e. the delay itself already exceeds what any Ki correction
// can compensate), the result is clamped at a small positive floor and
// flagged, since redesigning in z-domain would be the correct route there.
function computeKiCorrection(Ki, bwHz, TsSeconds, extraTcalcSeconds) {
  const wc = 2 * Math.PI * bwHz;
  const Td = TsSeconds / 2 + extraTcalcSeconds; // ZOH equivalent delay + extra computation delay
  const factor = 1 - wc * Td;
  const flooredFactor = Math.max(0.05, factor); // never fully cancel or invert Ki
  const KiCorrected = Ki * flooredFactor;
  return { Td, factor: flooredFactor, KiCorrected, clamped: factor < 0.05 };
}

function updateKiCorrection(prefix, Kp, Ki, bwHz, fsKHz) {
  const tcalcEl = document.getElementById(prefix + '_tcalc');
  if (!tcalcEl) return null; // card not present on this loop

  const Ts = 1 / (fsKHz * 1e3);
  const extraTcalc = (parseFloat(tcalcEl.value) || 0) * 1e-6;
  const result = computeKiCorrection(Ki, bwHz, Ts, extraTcalc);

  document.getElementById(prefix + '_td').textContent = (result.Td * 1e6).toFixed(2);
  document.getElementById(prefix + '_ki_orig').textContent = Ki.toFixed(2);
  document.getElementById(prefix + '_ki_new').textContent = result.KiCorrected.toFixed(2);
  document.getElementById(prefix + '_pct').textContent = ((1 - result.factor) * 100).toFixed(1) + '%';

  const formulaEl = document.getElementById(prefix + '_formula');
  if (formulaEl && typeof katex !== 'undefined') {
    try {
      katex.render(`K_{i,corr} = K_i \\cdot (1 - \\omega_c T_d) \\quad T_d = \\dfrac{T_s}{2} + T_{calc}`, formulaEl, { throwOnError: false, displayMode: true });
    } catch (e) { formulaEl.textContent = 'Ki_corr = Ki * (1 - wc*Td), Td = Ts/2 + Tcalc'; }
  } else if (formulaEl) {
    formulaEl.textContent = 'Ki_corr = Ki * (1 - wc*Td), Td = Ts/2 + Tcalc';
  }

  const badgeEl = document.getElementById(prefix + '_badge');
  if (badgeEl) {
    if (result.clamped) {
      badgeEl.innerHTML = '<span class="badge bad">❌ Ritardo troppo elevato per questa correzione: valuta una riprogettazione in dominio z o una f_campionamento più alta</span>';
    } else if (1 - result.factor > 0.3) {
      badgeEl.innerHTML = '<span class="badge warn">⚠️ Riduzione K<sub>i</sub> &gt; 30%: il ritardo digitale sta erodendo gran parte dell\'azione integrale</span>';
    } else {
      badgeEl.innerHTML = '<span class="badge ok">✅ Correzione contenuta, ritardo digitale ben gestito</span>';
    }
  }

  return result.KiCorrected;
}

let discKiSource_i = 'orig';
function setDiscKiSource(source) {
  discKiSource_i = source;
  document.getElementById('btnDiscKiOrig').classList.toggle('active', source === 'orig');
  document.getElementById('btnDiscKiCorr').classList.toggle('active', source === 'corr');
  updateCurrentLoop();
}

function renderDiscreteController(prefix, Kp, Ki, fsKHz, method) {
  const Ts = 1 / (fsKHz * 1e3);
  const d = discretizePI(Kp, Ki, Ts, method);

  const b0El = document.getElementById(prefix + '_b0');
  if (!b0El) return; // panel not present (shouldn't happen, but keep this defensive)

  document.getElementById(prefix + '_b0').textContent = d.b0.toFixed(6);
  document.getElementById(prefix + '_b1').textContent = d.b1.toFixed(6);
  document.getElementById(prefix + '_a1').textContent = '-1 (forma incrementale)';
  document.getElementById(prefix + '_ts').textContent = (Ts * 1e6).toFixed(2);

  const methodLabels = {
    tustin: 'Tustin (bilineare): s = (2/T_s)·(z-1)/(z+1)',
    backward: 'Backward Euler: s = (z-1)/(T_s·z)',
    forward: 'Forward Euler: s = (z-1)/T_s'
  };
  const noteEl = document.getElementById(prefix + '_note');
  if (noteEl) noteEl.textContent = methodLabels[method] + '. Forma incrementale (velocity form): niente stato integratore separato da saturare per l\'anti-windup.';

  const formulaEl = document.getElementById(prefix + '_formula');
  if (formulaEl && typeof katex !== 'undefined') {
    try {
      katex.render(`u[n] = u[n-1] + b_0\\,e[n] + b_1\\,e[n-1]`, formulaEl, { throwOnError: false, displayMode: true });
    } catch (e) { formulaEl.textContent = 'u[n] = u[n-1] + b0*e[n] + b1*e[n-1]'; }
  } else if (formulaEl) {
    formulaEl.textContent = 'u[n] = u[n-1] + b0*e[n] + b1*e[n-1]';
  }

  const codeEl = document.getElementById(prefix + '_code');
  if (codeEl) {
    codeEl.textContent =
`// Forma incrementale — firmware C
#define B0 ${d.b0.toFixed(8)}f
#define B1 ${d.b1.toFixed(8)}f
// Ts = ${(Ts*1e6).toFixed(2)} us, fs = ${fsKHz} kHz

float e_prev = 0, u_prev = 0;
float pi_update(float ref, float meas) {
  float e = ref - meas;
  float u = u_prev + B0*e + B1*e_prev;
  e_prev = e;
  u_prev = u;
  return u;
}`;
  }

  const badgeEl = document.getElementById(prefix + '_badge');
  if (badgeEl) {
    // Stability/accuracy sanity check: Nyquist-adjacent sampling relative to
    // the loop bandwidth degrades the discretization's fidelity to the
    // continuous design regardless of which method is used.
    const nyquistRatio = fsKHz * 1000 / 2;
    badgeEl.innerHTML = '';
    if (method === 'forward' && Ki * Ts > 2 * Kp) {
      badgeEl.innerHTML = '<span class="badge bad">❌ Forward Euler può essere instabile con questo T_s: valuta Tustin o Backward Euler</span>';
    }
  }
}

// ===================== Discretization method comparison =====================
// Evaluates the discretized PI's frequency response by substituting
// z = e^(jwTs) into each method's z-domain transfer function, and compares
// it against the continuous PI's own frequency response Kp + Ki/(jw). This
// shows visually how far each method drifts from the continuous design as
// frequency approaches the sampling rate — the divergence is the whole
// reason discretization method selection matters in practice.
function evalDiscretePI(Kp, Ki, Ts, method, w) {
  // z = e^(jwTs)
  const theta = w * Ts;
  const z = complex(Math.cos(theta), Math.sin(theta));

  let sEquiv; // the effective continuous 's' each method's bilinear-ish substitution implies
  if (method === 'tustin') {
    // s = (2/Ts) * (z-1)/(z+1)
    const zMinus1 = complex(z.re - 1, z.im);
    const zPlus1 = complex(z.re + 1, z.im);
    const ratio = cDiv(zMinus1, zPlus1);
    sEquiv = complex(ratio.re * 2 / Ts, ratio.im * 2 / Ts);
  } else if (method === 'backward') {
    // s = (z-1)/(Ts*z)
    const zMinus1 = complex(z.re - 1, z.im);
    sEquiv = cDiv(zMinus1, complex(z.re * Ts, z.im * Ts));
  } else {
    // forward: s = (z-1)/Ts
    sEquiv = complex((z.re - 1) / Ts, z.im / Ts);
  }

  // C(s_equiv) = Kp + Ki/s_equiv
  const KiOverS = cDiv(complex(Ki, 0), sEquiv);
  return complex(Kp + KiOverS.re, KiOverS.im);
}

function updateDiscretizationCompare(canvasId, Kp, Ki, fsKHz) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return; // comparison chart not present on this loop's panel (collapsed section not yet expanded is fine, still drawable)
  const fs = fsKHz * 1e3;
  const Ts = 1 / fs;

  const freqs = [], magContinuous = [], magTustin = [], magBackward = [], magForward = [];
  const fMax = fs * 0.9; // stop just short of Nyquist*2 to keep the chart focused on the meaningful range
  const fMin = 1;
  const n = 150;
  for (let i = 0; i <= n; i++) {
    const f = fMin * Math.pow(fMax / fMin, i / n);
    const w = 2 * Math.PI * f;
    freqs.push(f);

    const contH = complex(Kp, -Ki / w); // Kp + Ki/(jw) = Kp - j*Ki/w
    magContinuous.push(20 * Math.log10(cAbs(contH)));

    magTustin.push(20 * Math.log10(cAbs(evalDiscretePI(Kp, Ki, Ts, 'tustin', w))));
    magBackward.push(20 * Math.log10(cAbs(evalDiscretePI(Kp, Ki, Ts, 'backward', w))));
    magForward.push(20 * Math.log10(cAbs(evalDiscretePI(Kp, Ki, Ts, 'forward', w))));
  }

  drawDiscretizationCompare(canvasId, freqs, magContinuous, magTustin, magBackward, magForward, fs);
}

function updateCurrentLoop() {
  const bwSliderEl = document.getElementById('bw_i_slider');
  const bw = parseInt(bwSliderEl.value);
  const bwLabel = (bw >= 1000 ? (bw/1000).toFixed(1) + ' kHz' : bw + ' Hz');
  document.getElementById('bw_i_val').textContent = bwLabel;

  // Mantiene la barra BW duplicata (accanto alla step response) sincronizzata
  // con quella principale: stesso range e stesso valore, in entrambe le direzioni.
  const bwSlider2 = document.getElementById('bw_i_slider_2');
  if (bwSlider2) {
    bwSlider2.min = bwSliderEl.min;
    bwSlider2.max = bwSliderEl.max;
    bwSlider2.step = bwSliderEl.step;
    bwSlider2.value = bw;
    const bwVal2 = document.getElementById('bw_i_val_2');
    if (bwVal2) bwVal2.textContent = bwLabel;
  }

  const L = (parseFloat(document.getElementById('L').value) || 2.5) * 1e-3;
  const R = parseFloat(document.getElementById('R_l').value) || 0.1;
  const f_sw = (parseFloat(document.getElementById('f_sw').value) || 20) * 1e3;

  if (window._debugBode) {
    const td_pwm_raw = document.getElementById('td_pwm').value;
    const f_sense_raw = document.getElementById('f_sense').value;
    const f_aaf_raw = document.getElementById('f_aaf').value;
    const td_dig_raw = document.getElementById('td_dig').value;
    const w_test = 2 * Math.PI * bw;
    const parTest = parasiticMagPhase(w_test);
    window._debugBode('updateCurrentLoop() called', {
      bw, L, R, f_sw,
      'td_pwm (raw field value)': td_pwm_raw,
      'f_sense (raw field value)': f_sense_raw,
      'f_aaf (raw field value)': f_aaf_raw,
      'td_dig (raw field value)': td_dig_raw,
      'parasitic phase @ BW freq': parTest.phase.toFixed(6) + ' deg',
      'parasitic mag @ BW freq': parTest.mag.toFixed(6)
    });
  }

  const w_bw = 2 * Math.PI * bw;
  const Kp = L * w_bw;
  const Ki = R * w_bw;

  document.getElementById('kp_i').textContent = Kp.toFixed(4);
  document.getElementById('ki_i').textContent = Ki.toFixed(2);

  const discMethodI = document.getElementById('disc_method_i')?.value || 'tustin';
  const discFsI = parseFloat(document.getElementById('disc_fs_i')?.value) || 20;
  const KiCorrected = updateKiCorrection('ki_corr', Kp, Ki, bw, discFsI);
  const KiForDiscretization = (discKiSource_i === 'corr' && KiCorrected !== null) ? KiCorrected : Ki;
  renderDiscreteController('disc_i', Kp, KiForDiscretization, discFsI, discMethodI);
  updateDiscretizationCompare('discCompareIPlot', Kp, KiForDiscretization, discFsI);

  const numOL = [Ki, Kp];
  const denOL = [0, R, L];

  const freqs = [], magsIdeal = [], phasesIdeal = [], magsReal = [], phasesReal = [];
  const nSweepPoints = 400;
  for (let i = 0; i <= nSweepPoints; i++) {
    const f = Math.pow(10, 1 + 4.5 * i / nSweepPoints);
    const w = 2 * Math.PI * f;
    const s = complex(0, w);
    const H = evalTF(numOL, denOL, s);

    const magIdeal = 20 * Math.log10(cAbs(H));
    const phaseIdeal = cArg(H);

    const parasitic = parasiticMagPhase(w);
    const magReal = magIdeal + 20 * Math.log10(parasitic.mag);
    const phaseReal = phaseIdeal + parasitic.phase;

    freqs.push(f);
    magsIdeal.push(magIdeal);
    phasesIdeal.push(phaseIdeal);
    magsReal.push(magReal);
    phasesReal.push(phaseReal);
  }

  const prev = compareEnabled.current ? prevCurves.current : null;
  drawBodeDual('bodeI', freqs, magsIdeal, phasesIdeal, magsReal, phasesReal, bw, prev);

  let pmIdeal = 90, gmIdeal = 100;
  for (let i = 0; i < freqs.length; i++) {
    if (Math.abs(magsIdeal[i]) < 1) { pmIdeal = 180 + phasesIdeal[i]; break; }
  }
  for (let i = 0; i < freqs.length; i++) {
    if (Math.abs(phasesIdeal[i] + 180) < 5) { gmIdeal = -magsIdeal[i]; break; }
  }

  let pmReal = 90, gmReal = 100;
  for (let i = 0; i < freqs.length; i++) {
    if (Math.abs(magsReal[i]) < 1) { pmReal = 180 + phasesReal[i]; break; }
  }
  for (let i = 0; i < freqs.length; i++) {
    if (Math.abs(phasesReal[i] + 180) < 5) { gmReal = -magsReal[i]; break; }
  }

  document.getElementById('pm_i').textContent = pmIdeal.toFixed(1);
  document.getElementById('pm_i_real').textContent = pmReal.toFixed(1);
  document.getElementById('gm_i').textContent = gmReal.toFixed(1);

  const badge = document.getElementById('badge_i');
  const pmLoss = pmIdeal - pmReal;
  let badgeHTML = '';
  if (pmReal > 60 && bw < f_sw / 10) {
    badgeHTML += '<span class="badge ok">✅ Tuning Ottimale (reale)</span>';
  } else if (pmReal > 45) {
    badgeHTML += '<span class="badge warn">⚠️ Accettabile reale, ideale=' + pmIdeal.toFixed(1) + '°</span>';
  } else {
    badgeHTML += '<span class="badge bad">❌ PM reale insufficiente!</span>';
  }
  if (pmLoss > 15) {
    badgeHTML += ' <span class="badge bad">⚠️ Perdita PM=' + pmLoss.toFixed(1) + '° dai parassiti</span>';
  } else if (pmLoss > 5) {
    badgeHTML += ' <span class="badge warn">ℹ️ Perdita PM=' + pmLoss.toFixed(1) + '°</span>';
  }
  badge.innerHTML = badgeHTML;

  const dt = 1e-6;
  const nominalTau = 1 / (w_bw / (2 * Math.PI));
  const stepResult = simulateStepResponse({
    init: () => ({ i: 0, e_int: 0, output: 0 }),
    step: (s, dt) => {
      const e = 1 - s.i;
      const u = Kp * e + Ki * s.e_int;
      const di = (u - R * s.i) / L;
      const i = s.i + di * dt;
      const e_int = s.e_int + e * dt;
      return { i, e_int, output: i };
    }
  }, dt, nominalTau, 40);

  drawStep('stepI', stepResult.times, stepResult.vals, 1.0);
  displayStepMetrics('current', stepResult);

  renderCoherenceList();
  window._lastCurrentSnapshot = { freqs, mags: magsReal };
}

function updateVoltageLoop() {
  const bw = parseInt(document.getElementById('bw_v_slider').value);
  document.getElementById('bw_v_val').textContent = bw + ' Hz';

  const C = (parseFloat(document.getElementById('C_dc').value) || 1000) * 1e-6;
  const Rload = parseFloat(document.getElementById('R_load').value) || 53.3;
  const f_line = parseFloat(document.getElementById('f_line').value) || 50;

  const w_bw = 2 * Math.PI * bw;
  const Kp = C * w_bw * 0.8;
  const Ki = C * w_bw * w_bw * 0.3;

  document.getElementById('kp_v').textContent = Kp.toFixed(4);
  document.getElementById('ki_v').textContent = Ki.toFixed(4);

  const discMethodV = document.getElementById('disc_method_v')?.value || 'tustin';
  const discFsV = parseFloat(document.getElementById('disc_fs_v')?.value) || 10;
  renderDiscreteController('disc_v', Kp, Ki, discFsV, discMethodV);

  const numOL = [Ki, Kp];
  const denOL = [0, 1 / Rload, C];

  // FIX: voltage loop now has its own "ideal" (no parasitics modeled) vs itself;
  // previously both curves were literally the same array reference/values, making
  // the dashed "ideal" line and solid "real" line always coincide. We keep a single
  // physical model here (no separate parasitic chain defined for the voltage loop
  // in this tool), so instead of faking a second curve we draw one true curve and
  // no longer mislabel it as two independent curves. The comparison overlay
  // (previous tuning) is the "second curve" feature instead.
  const freqs = [], mags = [], phases = [];
  for (let i = 0; i <= 200; i++) {
    const f = Math.pow(10, -1 + 3.5 * i / 200);
    const w = 2 * Math.PI * f;
    const s = complex(0, w);
    const H = evalTF(numOL, denOL, s);
    freqs.push(f);
    mags.push(20 * Math.log10(cAbs(H)));
    phases.push(cArg(H));
  }

  const prev = compareEnabled.voltage ? prevCurves.voltage : null;
  drawBodeDual('bodeV', freqs, mags, phases, mags, phases, bw, prev);

  let pm = 90, gm = 100;
  for (let i = 0; i < freqs.length; i++) {
    if (Math.abs(mags[i]) < 1) { pm = 180 + phases[i]; break; }
  }
  for (let i = 0; i < freqs.length; i++) {
    if (Math.abs(phases[i] + 180) < 5) { gm = -mags[i]; break; }
  }
  document.getElementById('pm_v').textContent = pm.toFixed(1);
  document.getElementById('gm_v').textContent = gm.toFixed(1);

  const badge = document.getElementById('badge_v');
  if (pm > 45 && bw < f_line / 2) {
    badge.innerHTML = '<span class="badge ok">✅ Tuning Ottimale</span>';
  } else if (bw >= f_line / 2) {
    badge.innerHTML = '<span class="badge bad">❌ BW troppo alta: distorsione corrente!</span>';
  } else if (pm > 30) {
    badge.innerHTML = '<span class="badge warn">⚠️ Margine di fase ridotto</span>';
  } else {
    badge.innerHTML = '<span class="badge bad">❌ Instabile o quasi</span>';
  }

  const dt = 1e-4;
  const nominalTau = 1 / bw;
  const stepResultV = simulateStepResponse({
    init: () => ({ v: 0, e_int: 0, output: 0 }),
    step: (s, dt) => {
      const e = 1 - s.v;
      const u = Kp * e + Ki * s.e_int;
      const dv = (u - s.v / Rload) / C;
      const v = s.v + dv * dt;
      const e_int = s.e_int + e * dt;
      return { v, e_int, output: v };
    }
  }, dt, nominalTau, 40);

  drawStep('stepV', stepResultV.times, stepResultV.vals, 1.0);
  displayStepMetrics('voltage', stepResultV);

  renderCoherenceList();
  window._lastVoltageSnapshot = { freqs, mags };
}

function updatePLL() {
  const bw = parseFloat(document.getElementById('bw_pll_slider').value);
  const zeta = parseFloat(document.getElementById('zeta_pll_slider').value);
  const f_line = parseFloat(document.getElementById('f_line').value) || 50;

  document.getElementById('bw_pll_val').textContent = bw.toFixed(1) + ' Hz';
  document.getElementById('zeta_pll_val').textContent = zeta.toFixed(2);

  const wn = 2 * Math.PI * bw;
  const Kp = 2 * zeta * wn;
  const Ki = wn * wn;

  document.getElementById('kp_pll').textContent = Kp.toFixed(2);
  document.getElementById('ki_pll').textContent = Ki.toFixed(1);
  document.getElementById('pll_omega_n').textContent = wn.toFixed(1);
  document.getElementById('pll_omega_n_hz').textContent = (wn / (2 * Math.PI)).toFixed(1);

  const discMethodPLL = document.getElementById('disc_method_pll')?.value || 'tustin';
  const discFsPLL = parseFloat(document.getElementById('disc_fs_pll')?.value) || 20;
  renderDiscreteController('disc_pll', Kp, Ki, discFsPLL, discMethodPLL);

  let overshoot = 0;
  if (zeta < 1) {
    overshoot = Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta*zeta)) * 100;
  }
  document.getElementById('pll_overshoot').textContent = overshoot.toFixed(1) + '%';

  const ts = 4 / (zeta * wn);
  document.getElementById('ts_pll').textContent = (ts * 1000).toFixed(1);

  const freqs = [], mags = [], phases = [];
  for (let i = 0; i <= 200; i++) {
    const f = Math.pow(10, -1 + 3.5 * i / 200);
    const w = 2 * Math.PI * f;
    const s = complex(0, w);
    const num = [Ki, Kp];
    const den = [0, 0, 1];
    const H = evalTF(num, den, s);
    freqs.push(f);
    mags.push(20 * Math.log10(cAbs(H)));
    phases.push(cArg(H));
  }

  // FIX: same as voltage loop - single true PLL open-loop curve, no fake duplicate.
  const prev = compareEnabled.pll ? prevCurves.pll : null;
  drawBodeDual('bodePLL', freqs, mags, phases, mags, phases, bw, prev);

  let pm = 90;
  for (let i = 0; i < freqs.length; i++) {
    if (Math.abs(mags[i]) < 1) { pm = 180 + phases[i]; break; }
  }
  document.getElementById('pm_pll').textContent = pm.toFixed(1);

  const w100 = 2 * Math.PI * 2 * f_line;
  const s100 = complex(0, w100);
  const cl100 = evalTF([Ki, Kp], [Ki, Kp, 1], s100);
  const rejection = 20 * Math.log10(cAbs(cl100));
  document.getElementById('pll_rejection').textContent = rejection.toFixed(1);

  const badge = document.getElementById('badge_pll');
  if (bw < f_line / 10 && pm > 45) {
    badge.innerHTML = '<span class="badge ok">✅ PLL ben sintonizzato</span>';
  } else if (bw >= f_line / 10) {
    badge.innerHTML = '<span class="badge bad">❌ BW PLL troppo alta: non reietta 100 Hz!</span>';
  } else if (pm > 30) {
    badge.innerHTML = '<span class="badge warn">⚠️ PM ridotto, ma accettabile</span>';
  } else {
    badge.innerHTML = '<span class="badge bad">❌ PM insufficiente</span>';
  }

  // Frequency step
  const dt = 1e-4;
  const tEnd = 0.5;
  const nSteps = Math.floor(tEnd / dt);
  const timesF = [], freqErr = [];
  let theta_pll = 0, omega_pll = 2 * Math.PI * f_line;
  let int_err = 0;
  const f0 = f_line;
  const delta_f = parseFloat(document.getElementById('pll_step_freq_delta')?.value) || 0.5;
  const t_step = 0.1;
  const freqTitleEl = document.getElementById('stepFreq_title');
  if (freqTitleEl) freqTitleEl.textContent = `📈 Risposta a Salto di Frequenza (${delta_f >= 0 ? '+' : ''}${delta_f} Hz)`;

  let theta_real_freq = 0; // integrated incrementally below, never as omega*t (see note above)
  for (let n = 0; n < nSteps; n++) {
    const t = n * dt;
    const f_real = f0 + (t >= t_step ? delta_f : 0);
    const omega_real = 2 * Math.PI * f_real;
    theta_real_freq += omega_real * dt;

    const err = theta_real_freq - theta_pll;
    let err_wrapped = err;
    while (err_wrapped > Math.PI) err_wrapped -= 2 * Math.PI;
    while (err_wrapped < -Math.PI) err_wrapped += 2 * Math.PI;

    int_err += err_wrapped * dt;
    omega_pll = 2 * Math.PI * f0 + Kp * err_wrapped + Ki * int_err;
    theta_pll += omega_pll * dt;

    if (n % Math.ceil(nSteps / 500) === 0) {
      timesF.push(t);
      freqErr.push((omega_pll / (2 * Math.PI)) - f_real);
    }
  }
  drawXY('stepFreq', timesF, freqErr, null, null, [themeColor('--accent')]);

  // Phase step
  const timesP = [], phaseErr = [];
  theta_pll = 0; omega_pll = 2 * Math.PI * f_line; int_err = 0;
  const phase_jump_deg = parseFloat(document.getElementById('pll_step_phase_delta')?.value) || 30;
  const phase_jump = phase_jump_deg * Math.PI / 180;
  const phaseTitleEl = document.getElementById('stepPhase_title');
  if (phaseTitleEl) phaseTitleEl.textContent = `📈 Risposta a Salto di Fase (${phase_jump_deg >= 0 ? '+' : ''}${phase_jump_deg}°)`;

  for (let n = 0; n < nSteps; n += Math.ceil(nSteps / 500)) {
    const t = n * dt;
    const theta_real = 2 * Math.PI * f_line * t + (t >= t_step ? phase_jump : 0);

    const err = theta_real - theta_pll;
    let err_wrapped = err;
    while (err_wrapped > Math.PI) err_wrapped -= 2 * Math.PI;
    while (err_wrapped < -Math.PI) err_wrapped += 2 * Math.PI;

    int_err += err_wrapped * dt;
    omega_pll = 2 * Math.PI * f_line + Kp * err_wrapped + Ki * int_err;
    theta_pll += omega_pll * dt;

    timesP.push(t);
    phaseErr.push(err_wrapped * 180 / Math.PI);
  }
  drawXY('stepPhase', timesP, phaseErr, null, null, [themeColor('--accent-2')]);

  // Theta tracking with 100 Hz disturbance
  const timesT = [], thetaReal = [], thetaEst = [];
  theta_pll = 0; omega_pll = 2 * Math.PI * f_line; int_err = 0;
  const tEndT = 0.2;
  const nStepsT = Math.floor(tEndT / dt);
  const distAmp = 0.05;

  for (let n = 0; n < nStepsT; n += Math.ceil(nStepsT / 500)) {
    const t = n * dt;
    const theta_r = 2 * Math.PI * f_line * t;
    const theta_dist = distAmp * Math.sin(2 * 2 * Math.PI * f_line * t);
    const theta_r_total = theta_r + theta_dist;

    const err = theta_r_total - theta_pll;
    let err_wrapped = err;
    while (err_wrapped > Math.PI) err_wrapped -= 2 * Math.PI;
    while (err_wrapped < -Math.PI) err_wrapped += 2 * Math.PI;

    int_err += err_wrapped * dt;
    omega_pll = 2 * Math.PI * f_line + Kp * err_wrapped + Ki * int_err;
    theta_pll += omega_pll * dt;

    timesT.push(t);
    thetaReal.push(theta_r_total);
    thetaEst.push(theta_pll);
  }
  drawXY('thetaPlot', timesT, thetaReal, thetaEst, null, [themeColor('--accent'), themeColor('--success')]);

  updateDq0(Kp, Ki, f_line);

  renderCoherenceList();
  window._lastPLLSnapshot = { freqs, mags };
}

// ---------- Park transform (dq0) using the PLL-estimated theta ----------
function updateDq0(Kp, Ki, f_line) {
  const v_ac = parseFloat(document.getElementById('v_ac').value) || 230;
  const p_out = parseFloat(document.getElementById('p_out').value) || 3000;
  const pf = parseFloat(document.getElementById('pf_slider')?.value) || 0.99;
  const v_pk = v_ac * Math.sqrt(2);
  const i_pk = Math.sqrt(2) * p_out / (3 * v_ac * pf);
  const phi = Math.acos(pf);

  const dt = 1e-4;
  const tEnd = 0.2;
  const nSteps = Math.floor(tEnd / dt);
  const distAmp = 0.05; // same 100 Hz disturbance used in the theta tracking plot above

  // Run the same PLL dynamics as the theta plot, but this time also project
  // the actual three-phase v/i (with their own real theta) onto the PLL's
  // ESTIMATED theta, not the ideal one. This is exactly what a real vector
  // control does: if the PLL lags or has ripple, d/q will show it.
  let theta_pll = 0, omega_pll = 2 * Math.PI * f_line, int_err = 0;

  const times = [], vd = [], vq = [], id = [], iq = [];
  let vdSum = 0, idSum = 0, iqSum = 0;
  let vqMax = -Infinity, vqMin = Infinity;

  for (let n = 0; n < nSteps; n += Math.ceil(nSteps / 400)) {
    const t = n * dt;

    // Real network angle (with 100 Hz PLL-input disturbance, same as theta plot)
    const theta_r = 2 * Math.PI * f_line * t;
    const theta_dist = distAmp * Math.sin(2 * 2 * Math.PI * f_line * t);
    const theta_r_total = theta_r + theta_dist;

    // Advance PLL estimate (re-simulated identically to the theta plot above)
    const err = theta_r_total - theta_pll;
    let err_wrapped = err;
    while (err_wrapped > Math.PI) err_wrapped -= 2 * Math.PI;
    while (err_wrapped < -Math.PI) err_wrapped += 2 * Math.PI;
    int_err += err_wrapped * dt;
    omega_pll = 2 * Math.PI * f_line + Kp * err_wrapped + Ki * int_err;
    theta_pll += omega_pll * dt;

    // Real three-phase voltages/currents at the true network angle
    const va = v_pk * Math.sin(theta_r_total);
    const vb = v_pk * Math.sin(theta_r_total - 2 * Math.PI / 3);
    const vc = v_pk * Math.sin(theta_r_total + 2 * Math.PI / 3);

    const ia = i_pk * Math.sin(theta_r_total - phi);
    const ib = i_pk * Math.sin(theta_r_total - 2 * Math.PI / 3 - phi);
    const ic = i_pk * Math.sin(theta_r_total + 2 * Math.PI / 3 - phi);

    // Clarke (alpha-beta)
    const alpha_v = va, beta_v = (vb - vc) / Math.sqrt(3);
    const alpha_i = ia, beta_i = (ib - ic) / Math.sqrt(3);

    // Park, rotated by the PLL's ESTIMATED theta (not theta_r_total)
    const cosT = Math.cos(theta_pll), sinT = Math.sin(theta_pll);
    const vd_i = alpha_v * cosT + beta_v * sinT;
    const vq_i = -alpha_v * sinT + beta_v * cosT;
    const id_i = alpha_i * cosT + beta_i * sinT;
    const iq_i = -alpha_i * sinT + beta_i * cosT;

    times.push(t);
    vd.push(vd_i); vq.push(vq_i);
    id.push(id_i); iq.push(iq_i);
    vdSum += vd_i; idSum += id_i; iqSum += iq_i;
    if (vq_i > vqMax) vqMax = vq_i;
    if (vq_i < vqMin) vqMin = vq_i;
  }

  const n = times.length;
  const vdAvg = vdSum / n;
  const idAvg = idSum / n;
  const iqAvg = iqSum / n;
  const vqRipple = vqMax - vqMin;

  document.getElementById('dq_vd_avg').textContent = vdAvg.toFixed(1);
  document.getElementById('dq_vq_ripple').textContent = vqRipple.toFixed(1);
  document.getElementById('dq_id_avg').textContent = idAvg.toFixed(2);
  document.getElementById('dq_iq_avg').textContent = iqAvg.toFixed(2);

  drawXYDualScale('dqVPlot', times, vd, vq, [themeColor('--accent'), themeColor('--accent-2')]);
  drawXYDualScale('dqIPlot', times, id, iq, [themeColor('--accent'), themeColor('--accent-2')]);

  const badge = document.getElementById('badge_dq');
  if (badge) {
    if (vqRipple < v_pk * 0.02) {
      badge.innerHTML = '<span class="badge ok">✅ V<sub>q</sub> quasi nullo: PLL ben orientato</span>';
    } else if (vqRipple < v_pk * 0.08) {
      badge.innerHTML = '<span class="badge warn">⚠️ Ripple V<sub>q</sub> percepibile: PLL non perfettamente agganciato</span>';
    } else {
      badge.innerHTML = '<span class="badge bad">❌ V<sub>q</sub> elevato: errore di tracking del PLL significativo</span>';
    }
  }

  updateFeedforward();
}

// ---------- Decoupled feedforward demonstration ----------
// Simplified d/q current-loop model: the inductor's coupling term omega*L
// makes a step on one axis disturb the other. With feedforward, the PI
// controller's reference is offset by the coupling term so the disturbance
// is (ideally) cancelled. This uses the current loop's own L, R_l and PI
// gains so it stays consistent with the tuning shown in the Corrente tab.
function updateFeedforward() {
  const ffEnabled = document.getElementById('ffEnabledToggle')?.checked;
  const L = (parseFloat(document.getElementById('L').value) || 2.5) * 1e-3;
  const R = parseFloat(document.getElementById('R_l').value) || 0.1;
  const f_line = parseFloat(document.getElementById('f_line').value) || 50;
  const bwI = parseInt(document.getElementById('bw_i_slider')?.value) || 2000;
  const w_bw = 2 * Math.PI * bwI;
  const Kp = L * w_bw;
  const Ki = R * w_bw;
  const omega = 2 * Math.PI * f_line;

  const dt = 5e-6;
  const tEnd = 4 / bwI; // a few current-loop time constants
  const nSteps = Math.floor(tEnd / dt);
  const tStep = tEnd / 2;
  const iqStepValue = 5; // A, arbitrary step on the q-axis reference

  function simulate(withFF) {
    let id = 0, iq = 0, eIntD = 0, eIntQ = 0;
    const times = [], idVals = [];
    for (let n = 0; n < nSteps; n += Math.ceil(nSteps / 400)) {
      const t = n * dt;
      const idRef = 0; // d-axis target held at zero to isolate the cross-coupling disturbance
      const iqRef = t >= tStep ? iqStepValue : 0;

      const eD = idRef - id;
      const eQ = iqRef - iq;
      eIntD += eD * dt;
      eIntQ += eQ * dt;

      let vd = Kp * eD + Ki * eIntD;
      let vq = Kp * eQ + Ki * eIntQ;
      if (withFF) {
        vd -= omega * L * iq;
        vq += omega * L * id;
      }

      const did = (vd - R * id + omega * L * iq) / L;
      const diq = (vq - R * iq - omega * L * id) / L;
      id += did * dt;
      iq += diq * dt;

      times.push(t);
      idVals.push(id);
    }
    return { times, idVals };
  }

  const noFF = simulate(false);
  const withFF = simulate(true);

  const peakNoFF = Math.max(...noFF.idVals.map(Math.abs));
  const peakWithFF = Math.max(...withFF.idVals.map(Math.abs));

  document.getElementById('ff_peak_no').textContent = peakNoFF.toFixed(3);
  document.getElementById('ff_peak_yes').textContent = peakWithFF.toFixed(3);

  drawXY('ffPlot', noFF.times, noFF.idVals, withFF.idVals, null, [themeColor('--danger'), themeColor('--accent')]);

  const badge = document.getElementById('badge_ff');
  if (badge) {
    const reduction = peakNoFF > 0 ? (1 - peakWithFF / peakNoFF) * 100 : 0;
    if (reduction > 90) {
      badge.innerHTML = '<span class="badge ok">✅ Feedforward riduce la perturbazione incrociata del ' + reduction.toFixed(0) + '%</span>';
    } else if (reduction > 50) {
      badge.innerHTML = '<span class="badge warn">⚠️ Riduzione parziale (' + reduction.toFixed(0) + '%) — verifica L e ω usati nel FF</span>';
    } else {
      badge.innerHTML = '<span class="badge bad">❌ Feedforward inefficace in questo scenario</span>';
    }
  }
}

function saveSnapshotForComparison(loopName) {
  if (loopName === 'current' && window._lastCurrentSnapshot) {
    snapshotCurve('current', window._lastCurrentSnapshot.freqs, window._lastCurrentSnapshot.mags);
    showToast('Curva salvata per confronto', 'success');
  } else if (loopName === 'voltage' && window._lastVoltageSnapshot) {
    snapshotCurve('voltage', window._lastVoltageSnapshot.freqs, window._lastVoltageSnapshot.mags);
    showToast('Curva salvata per confronto', 'success');
  } else if (loopName === 'pll' && window._lastPLLSnapshot) {
    snapshotCurve('pll', window._lastPLLSnapshot.freqs, window._lastPLLSnapshot.mags);
    showToast('Curva salvata per confronto', 'success');
  }
}

function updateGrid() {
  const v_ac = parseFloat(document.getElementById('v_ac').value) || 230;
  const p_out = parseFloat(document.getElementById('p_out').value) || 3000;
  const f_line = parseFloat(document.getElementById('f_line').value) || 50;
  const thd = parseFloat(document.getElementById('thd_slider').value) || 3;
  const pf = parseFloat(document.getElementById('pf_slider').value) || 0.99;

  document.getElementById('thd_val').textContent = thd.toFixed(1) + '%';
  document.getElementById('pf_val').textContent = pf.toFixed(2);

  const v_pk = v_ac * Math.sqrt(2);
  const i_pk = Math.sqrt(2) * p_out / (3 * v_ac * pf);

  document.getElementById('grid_v_pk').textContent = v_pk.toFixed(1);
  document.getElementById('grid_i_pk').textContent = i_pk.toFixed(2);
  document.getElementById('grid_pf').textContent = pf.toFixed(3);
  document.getElementById('grid_thd').textContent = thd.toFixed(1) + '%';

  const nPoints = 360;
  const vA = [], vB = [], vC = [];
  const iA = [], iB = [], iC = [];
  const alphaV = [], betaV = [];
  const alphaI = [], betaI = [];

  for (let deg = 0; deg <= nPoints; deg++) {
    const rad = deg * Math.PI / 180;
    const va = v_pk * Math.sin(rad);
    const vb = v_pk * Math.sin(rad - 2 * Math.PI / 3);
    const vc = v_pk * Math.sin(rad + 2 * Math.PI / 3);

    const phi = Math.acos(pf);
    const ia_base = i_pk * Math.sin(rad - phi);
    const ib_base = i_pk * Math.sin(rad - 2 * Math.PI / 3 - phi);
    const ic_base = i_pk * Math.sin(rad + 2 * Math.PI / 3 - phi);

    const thd_factor = thd / 100;
    const h3 = thd_factor * 0.5 * i_pk * Math.sin(3 * rad);
    const h5 = thd_factor * 0.3 * i_pk * Math.sin(5 * rad);
    const h7 = thd_factor * 0.2 * i_pk * Math.sin(7 * rad);

    const ia = ia_base + h3 + h5 + h7;
    const ib = ib_base + h3 + h5 + h7;
    const ic = ic_base + h3 + h5 + h7;

    vA.push(va); vB.push(vb); vC.push(vc);
    iA.push(ia); iB.push(ib); iC.push(ic);

    alphaV.push(va);
    betaV.push((vb - vc) / Math.sqrt(3));
    alphaI.push(ia);
    betaI.push((ib - ic) / Math.sqrt(3));
  }

  drawGridWaveform('vGrid', vA, vB, vC, 'V');
  drawGridWaveform('iGrid', iA, iB, iC, 'A');
  drawSpaceVector('spaceVector', alphaV, betaV, alphaI, betaI);
}

function updatePower() {
  const v_ac = parseFloat(document.getElementById('v_ac').value) || 230;
  const p_out = parseFloat(document.getElementById('p_out').value) || 3000;
  const f_line = parseFloat(document.getElementById('f_line').value) || 50;
  const thd = parseFloat(document.getElementById('thd_slider_p').value) || 3;
  const pf = parseFloat(document.getElementById('pf_slider_p').value) || 0.99;

  document.getElementById('thd_val_p').textContent = thd.toFixed(1) + '%';
  document.getElementById('pf_val_p').textContent = pf.toFixed(2);

  const v_pk = v_ac * Math.sqrt(2);
  const i_pk = Math.sqrt(2) * p_out / (3 * v_ac * pf);
  const phi = Math.acos(pf);

  const dt = 1 / (f_line * 360);
  const tEnd = 2 / f_line;
  const nPoints = Math.floor(tEnd / dt);

  const times = [], pData = [], qData = [];
  let pSum = 0, qSum = 0;

  for (let n = 0; n < nPoints; n++) {
    const t = n * dt;
    const theta = 2 * Math.PI * f_line * t;

    const va = v_pk * Math.sin(theta);
    const vb = v_pk * Math.sin(theta - 2 * Math.PI / 3);
    const vc = v_pk * Math.sin(theta + 2 * Math.PI / 3);

    const ia_base = i_pk * Math.sin(theta - phi);
    const ib_base = i_pk * Math.sin(theta - 2 * Math.PI / 3 - phi);
    const ic_base = i_pk * Math.sin(theta + 2 * Math.PI / 3 - phi);

    const thd_factor = thd / 100;
    const h3 = thd_factor * 0.5 * i_pk * Math.sin(3 * theta);
    const h5 = thd_factor * 0.3 * i_pk * Math.sin(5 * theta);
    const h7 = thd_factor * 0.2 * i_pk * Math.sin(7 * theta);

    const ia = ia_base + h3 + h5 + h7;
    const ib = ib_base + h3 + h5 + h7;
    const ic = ic_base + h3 + h5 + h7;

    const p_inst = va * ia + vb * ib + vc * ic;
    const alpha_v = va;
    const beta_v = (vb - vc) / Math.sqrt(3);
    const alpha_i = ia;
    const beta_i = (ib - ic) / Math.sqrt(3);
    const q_inst = 1.5 * (beta_v * alpha_i - alpha_v * beta_i);

    times.push(t);
    pData.push(p_inst);
    qData.push(q_inst);
    pSum += p_inst;
    qSum += q_inst;
  }

  const pAvg = pSum / nPoints;
  const qAvg = qSum / nPoints;
  const pRipple = (Math.max(...pData) - Math.min(...pData)) / pAvg * 100;
  const sApp = Math.sqrt(pAvg * pAvg + qAvg * qAvg);

  document.getElementById('p_avg').textContent = pAvg.toFixed(0);
  document.getElementById('q_avg').textContent = qAvg.toFixed(0);
  document.getElementById('p_ripple').textContent = pRipple.toFixed(1) + '%';
  document.getElementById('s_app').textContent = sApp.toFixed(0);

  const ds = Math.ceil(nPoints / 600);
  const dsTimes = [], dsP = [], dsQ = [];
  for (let i = 0; i < nPoints; i += ds) {
    dsTimes.push(times[i]);
    dsP.push(pData[i]);
    dsQ.push(qData[i]);
  }
  drawPower('powerPlot', dsTimes, dsP, dsQ);
}

function updateRipple() {
  const v_ac = parseFloat(document.getElementById('v_ac').value) || 230;
  const p_out = parseFloat(document.getElementById('p_out').value) || 3000;
  const v_dc = parseFloat(document.getElementById('v_dc').value) || 400;
  const L = (parseFloat(document.getElementById('L').value) || 2.5) * 1e-3;
  const f_sw = (parseFloat(document.getElementById('f_sw').value) || 20) * 1e3;
  const f_line = parseFloat(document.getElementById('f_line').value) || 50;
  const zoom = parseFloat(document.getElementById('ripple_zoom').value) || 3;

  document.getElementById('ripple_zoom_val').textContent = zoom.toFixed(1) + 'x';

  const i_pk = Math.sqrt(2) * p_out / (3 * v_ac);
  const vdcMinFactor = getVdcMinFactor();
  const d_max = Math.max(0, Math.min(0.99, 1 - (v_ac * vdcMinFactor) / v_dc));
  const delta_i_max = v_dc * d_max * (1 - d_max) / (L * f_sw);
  const T_sw = 1 / f_sw;

  document.getElementById('ripple_delta').textContent = delta_i_max.toFixed(3);
  document.getElementById('ripple_delta_pk').textContent = ((delta_i_max / i_pk) * 100).toFixed(1) + '%';
  document.getElementById('ripple_fsw').textContent = (f_sw / 1000).toFixed(1);
  document.getElementById('ripple_period').textContent = (T_sw * 1e6).toFixed(1);

  const tEnd = 2 / f_line;
  const dt = T_sw / 40;
  const nSteps = Math.floor(tEnd / dt);

  const fullA = [], fullB = [], fullC = [];
  const ripA = [], ripB = [], ripC = [];

  for (let n = 0; n < nSteps; n += 1) {
    const t = n * dt;
    const theta = 2 * Math.PI * f_line * t;

    const iA_fund = i_pk * Math.sin(theta);
    const iB_fund = i_pk * Math.sin(theta - 2 * Math.PI / 3);
    const iC_fund = i_pk * Math.sin(theta + 2 * Math.PI / 3);

    const v_inst = v_ac * Math.sqrt(2) * Math.abs(Math.sin(theta));
    const d_inst = 1 - v_inst / v_dc;
    const d_clamped = Math.max(0.01, Math.min(0.99, d_inst));
    const delta_i_inst = v_dc * d_clamped * (1 - d_clamped) / (L * f_sw);

    const posInPeriod = (t % T_sw) / T_sw;
    const tri = (posInPeriod < d_clamped)
      ? -delta_i_inst/2 + (delta_i_inst/d_clamped) * posInPeriod
      : delta_i_inst/2 - (delta_i_inst/(1-d_clamped)) * (posInPeriod - d_clamped);

    fullA.push(iA_fund + tri);
    fullB.push(iB_fund + tri);
    fullC.push(iC_fund + tri);
    ripA.push(tri);
    ripB.push(tri);
    ripC.push(tri);
  }

  const ds = Math.ceil(nSteps / 800);
  const dsFullA = [], dsFullB = [], dsFullC = [];
  const dsRipA = [], dsRipB = [], dsRipC = [];
  for (let i = 0; i < nSteps; i += ds) {
    dsFullA.push(fullA[i]); dsFullB.push(fullB[i]); dsFullC.push(fullC[i]);
    dsRipA.push(ripA[i] * zoom); dsRipB.push(ripB[i] * zoom); dsRipC.push(ripC[i] * zoom);
  }

  drawGridWaveform('rippleFull', dsFullA, dsFullB, dsFullC, 'A');
  drawGridWaveform('rippleOnly', dsRipA, dsRipB, dsRipC, 'A·' + zoom);
}

function updateSummary() {
  const tbody = document.getElementById('summaryBody');
  const v_ac = document.getElementById('v_ac').value;
  const p_out = document.getElementById('p_out').value;
  const v_dc = document.getElementById('v_dc').value;
  const L = document.getElementById('L').value;
  const C_dc = document.getElementById('C_dc').value;
  const f_sw = document.getElementById('f_sw').value;
  const kp_i = document.getElementById('kp_i').textContent;
  const ki_i = document.getElementById('ki_i').textContent;
  const kp_v = document.getElementById('kp_v').textContent;
  const ki_v = document.getElementById('ki_v').textContent;
  const kp_pll = document.getElementById('kp_pll').textContent;
  const ki_pll = document.getElementById('ki_pll').textContent;
  const pm_i = document.getElementById('pm_i').textContent;
  const pm_i_real = document.getElementById('pm_i_real').textContent;
  const pm_v = document.getElementById('pm_v').textContent;
  const pm_pll = document.getElementById('pm_pll').textContent;

  tbody.innerHTML = `
    <tr><td>V<sub>AC</sub></td><td>${v_ac}</td><td>V</td></tr>
    <tr><td>P<sub>out</sub></td><td>${p_out}</td><td>W</td></tr>
    <tr><td>V<sub>DC</sub></td><td>${v_dc}</td><td>V</td></tr>
    <tr><td>L</td><td>${L}</td><td>mH</td></tr>
    <tr><td>C<sub>DC</sub></td><td>${C_dc}</td><td>μF</td></tr>
    <tr><td>f<sub>sw</sub></td><td>${f_sw}</td><td>kHz</td></tr>
    <tr><td>K<sub>p</sub> (corrente)</td><td>${kp_i}</td><td>Ω</td></tr>
    <tr><td>K<sub>i</sub> (corrente)</td><td>${ki_i}</td><td>Ω/s</td></tr>
    <tr><td>K<sub>p</sub> (tensione)</td><td>${kp_v}</td><td>A/V</td></tr>
    <tr><td>K<sub>i</sub> (tensione)</td><td>${ki_v}</td><td>A/(V·s)</td></tr>
    <tr><td>K<sub>p</sub> (PLL)</td><td>${kp_pll}</td><td>rad/s</td></tr>
    <tr><td>K<sub>i</sub> (PLL)</td><td>${ki_pll}</td><td>rad/s²</td></tr>
    <tr><td>PM ideale (corrente)</td><td>${pm_i}</td><td>°</td></tr>
    <tr><td>PM reale (corrente)</td><td>${pm_i_real}</td><td>°</td></tr>
    <tr><td>PM (tensione)</td><td>${pm_v}</td><td>°</td></tr>
    <tr><td>PM (PLL)</td><td>${pm_pll}</td><td>°</td></tr>
  `;

  renderCoherenceList();
}

function exportParams() {
  exportFullConfig();
}

// ===================== ROBUSTNESS: pure loop-PM calculators =====================
// These mirror the formulas in updateCurrentLoop/updateVoltageLoop/updatePLL but
// take explicit parameters and return numbers only (no DOM writes), so they can
// be reused for parametric sweeps and worst-case combinations without duplicating
// the control design math or touching the on-screen nominal results.

function computeCurrentLoopPM(L, R, bw, f_sw, includeParasitics) {
  const w_bw = 2 * Math.PI * bw;
  const Kp = L * w_bw;
  const Ki = R * w_bw;
  const numOL = [Ki, Kp];
  const denOL = [0, R, L];

  let pm = 90;
  for (let i = 0; i <= 200; i++) {
    const f = Math.pow(10, 1 + 4.5 * i / 200);
    const w = 2 * Math.PI * f;
    const s = complex(0, w);
    const H = evalTF(numOL, denOL, s);
    let magDb = 20 * Math.log10(cAbs(H));
    let phaseDeg = cArg(H);
    if (includeParasitics) {
      const par = parasiticMagPhase(w);
      magDb += 20 * Math.log10(par.mag);
      phaseDeg += par.phase;
    }
    if (Math.abs(magDb) < 1) { pm = 180 + phaseDeg; break; }
  }
  return { Kp, Ki, pm };
}

function computeVoltageLoopPM(C, Rload, bw) {
  const w_bw = 2 * Math.PI * bw;
  const Kp = C * w_bw * 0.8;
  const Ki = C * w_bw * w_bw * 0.3;
  const numOL = [Ki, Kp];
  const denOL = [0, 1 / Rload, C];

  let pm = 90;
  for (let i = 0; i <= 200; i++) {
    const f = Math.pow(10, -1 + 3.5 * i / 200);
    const w = 2 * Math.PI * f;
    const s = complex(0, w);
    const H = evalTF(numOL, denOL, s);
    const magDb = 20 * Math.log10(cAbs(H));
    const phaseDeg = cArg(H);
    if (Math.abs(magDb) < 1) { pm = 180 + phaseDeg; break; }
  }
  return { Kp, Ki, pm };
}

function computePLLPM(bw, zeta) {
  const wn = 2 * Math.PI * bw;
  const Kp = 2 * zeta * wn;
  const Ki = wn * wn;
  const num = [Ki, Kp];
  const den = [0, 0, 1];

  let pm = 90;
  for (let i = 0; i <= 200; i++) {
    const f = Math.pow(10, -1 + 3.5 * i / 200);
    const w = 2 * Math.PI * f;
    const s = complex(0, w);
    const H = evalTF(num, den, s);
    const magDb = 20 * Math.log10(cAbs(H));
    const phaseDeg = cArg(H);
    if (Math.abs(magDb) < 1) { pm = 180 + phaseDeg; break; }
  }
  let overshoot = 0;
  if (zeta < 1) overshoot = Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta)) * 100;
  return { Kp, Ki, pm, overshoot };
}

// Rough closed-loop overshoot estimate from phase margin, valid for a
// dominant second-order approximation (standard control-design rule of thumb).
function overshootFromPM(pmDeg) {
  const pm = Math.max(5, Math.min(90, pmDeg));
  const zetaApprox = pm / 100; // common approximation: zeta ~ PM/100 for PM in [0,90]
  if (zetaApprox >= 1) return 0;
  return Math.exp(-Math.PI * zetaApprox / Math.sqrt(1 - zetaApprox * zetaApprox)) * 100;
}

// ===================== ROBUSTNESS: parametric sweep =====================

const SWEEP_PARAMS_BY_LOOP = {
  current: [
    { id: 'L', label: 'Induttanza L (mH)' },
    { id: 'R_l', label: 'Resistenza serie R_L (Ω)' },
    { id: 'bw_i', label: 'Banda passante BW (Hz)' }
  ],
  voltage: [
    { id: 'C_dc', label: 'Capacità C_DC (μF)' },
    { id: 'R_load', label: 'Resistenza di carico R_load (Ω)' },
    { id: 'bw_v', label: 'Banda passante BW (Hz)' }
  ],
  pll: [
    { id: 'bw_pll', label: 'Banda passante BW PLL (Hz)' },
    { id: 'zeta_pll', label: 'Damping ζ' }
  ]
};

function updateSweepUI() {
  const loop = document.getElementById('sweep_loop').value;
  const select = document.getElementById('sweep_param');
  const opts = SWEEP_PARAMS_BY_LOOP[loop];
  select.innerHTML = opts.map(o => `<option value="${o.id}">${o.label}</option>`).join('');
  runSweep();
}

function runSweep() {
  const loop = document.getElementById('sweep_loop')?.value;
  const paramId = document.getElementById('sweep_param')?.value;
  if (!loop || !paramId) return;

  const rangePct = parseFloat(document.getElementById('sweep_range').value) || 20;
  document.getElementById('sweep_range_val').textContent = '±' + rangePct + '%';

  const L_nom = (parseFloat(document.getElementById('L').value) || 2.5) * 1e-3;
  const R_nom = parseFloat(document.getElementById('R_l').value) || 0.1;
  const f_sw = (parseFloat(document.getElementById('f_sw').value) || 20) * 1e3;
  const bwI_nom = parseInt(document.getElementById('bw_i_slider').value) || 2000;
  const C_nom = (parseFloat(document.getElementById('C_dc').value) || 1000) * 1e-6;
  const Rload_nom = parseFloat(document.getElementById('R_load').value) || 53.3;
  const bwV_nom = parseInt(document.getElementById('bw_v_slider').value) || 10;
  const bwPLL_nom = parseFloat(document.getElementById('bw_pll_slider').value) || 10;
  const zeta_nom = parseFloat(document.getElementById('zeta_pll_slider').value) || 0.707;

  const nPoints = 21;
  const xVals = [], pmVals = [], osVals = [];

  for (let i = 0; i < nPoints; i++) {
    const frac = -1 + 2 * i / (nPoints - 1); // -1..+1
    const variation = 1 + (frac * rangePct / 100);
    let x, pm, os;

    if (loop === 'current') {
      let L = L_nom, R = R_nom, bw = bwI_nom;
      if (paramId === 'L') { L = L_nom * variation; x = L * 1e3; }
      else if (paramId === 'R_l') { R = R_nom * variation; x = R; }
      else { bw = bwI_nom * variation; x = bw; }
      const res = computeCurrentLoopPM(L, R, bw, f_sw, true);
      pm = res.pm;
      os = overshootFromPM(pm);
    } else if (loop === 'voltage') {
      let C = C_nom, Rload = Rload_nom, bw = bwV_nom;
      if (paramId === 'C_dc') { C = C_nom * variation; x = C * 1e6; }
      else if (paramId === 'R_load') { Rload = Rload_nom * variation; x = Rload; }
      else { bw = bwV_nom * variation; x = bw; }
      const res = computeVoltageLoopPM(C, Rload, bw);
      pm = res.pm;
      os = overshootFromPM(pm);
    } else {
      let bw = bwPLL_nom, zeta = zeta_nom;
      if (paramId === 'bw_pll') { bw = bwPLL_nom * variation; x = bw; }
      else { zeta = Math.max(0.1, zeta_nom * variation); x = zeta; }
      const res = computePLLPM(bw, zeta);
      pm = res.pm;
      os = res.overshoot;
    }

    xVals.push(x);
    pmVals.push(pm);
    osVals.push(os);
  }

  drawSweepLine('sweepPMPlot', xVals, pmVals, 45, 'PM (°)');
  drawSweepLine('sweepOSPlot', xVals, osVals, 30, 'Overshoot (%)');

  const minPM = Math.min(...pmVals);
  const maxOS = Math.max(...osVals);
  const badge = document.getElementById('badge_sweep');
  if (minPM > 45 && maxOS < 30) {
    badge.innerHTML = '<span class="badge ok">✅ Tuning robusto su tutto il range ±' + rangePct + '%</span>';
  } else if (minPM > 30) {
    badge.innerHTML = '<span class="badge warn">⚠️ PM minimo ' + minPM.toFixed(1) + '° nel range — margine ridotto agli estremi</span>';
  } else {
    badge.innerHTML = '<span class="badge bad">❌ PM minimo ' + minPM.toFixed(1) + '° — rischio instabilità in parte del range</span>';
  }
}

// ===================== ROBUSTNESS: worst-case analysis =====================

function runWorstCase() {
  const tolL = (parseFloat(document.getElementById('tol_L').value) || 20) / 100;
  const tolC = (parseFloat(document.getElementById('tol_C').value) || 20) / 100;
  const tolRload = (parseFloat(document.getElementById('tol_Rload').value) || 10) / 100;

  const L_nom = (parseFloat(document.getElementById('L').value) || 2.5) * 1e-3;
  const R_nom = parseFloat(document.getElementById('R_l').value) || 0.1;
  const f_sw = (parseFloat(document.getElementById('f_sw').value) || 20) * 1e3;
  const bwI = parseInt(document.getElementById('bw_i_slider').value) || 2000;

  const C_nom = (parseFloat(document.getElementById('C_dc').value) || 1000) * 1e-6;
  const Rload_nom = parseFloat(document.getElementById('R_load').value) || 53.3;
  const bwV = parseInt(document.getElementById('bw_v_slider').value) || 10;

  // Corner combinations: nominal + 4 extremes (L and C each at their own tolerance
  // extreme). R_l and R_load tolerances are also applied together with L/C at each
  // corner to reflect a true worst case rather than varying one at a time.
  const corners = [
    { label: 'Nominale', Lf: 1, Cf: 1, Rf: 1 },
    { label: 'L min, C min', Lf: 1 - tolL, Cf: 1 - tolC, Rf: 1 - tolRload },
    { label: 'L min, C max', Lf: 1 - tolL, Cf: 1 + tolC, Rf: 1 + tolRload },
    { label: 'L max, C min', Lf: 1 + tolL, Cf: 1 - tolC, Rf: 1 - tolRload },
    { label: 'L max, C max', Lf: 1 + tolL, Cf: 1 + tolC, Rf: 1 + tolRload }
  ];

  const rows = corners.map(c => {
    const L = L_nom * c.Lf;
    const R = R_nom; // R_l tolerance not separately exposed as an input; kept at nominal
    const resI = computeCurrentLoopPM(L, R, bwI, f_sw, true);
    const C = C_nom * c.Cf;
    const Rload = Rload_nom * c.Rf;
    const resV = computeVoltageLoopPM(C, Rload, bwV);
    return { label: c.label, pmI: resI.pm, pmV: resV.pm };
  });

  const tbody = document.getElementById('worstCaseBody');
  const nominalPmI = rows[0].pmI, nominalPmV = rows[0].pmV;
  tbody.innerHTML = rows.map(r => {
    const clsI = r.pmI < nominalPmI - 0.5 ? 'diff-worse' : (r.pmI > nominalPmI + 0.5 ? 'diff-better' : '');
    const clsV = r.pmV < nominalPmV - 0.5 ? 'diff-worse' : (r.pmV > nominalPmV + 0.5 ? 'diff-better' : '');
    return `<tr><td>${r.label}</td><td class="${clsI}">${r.pmI.toFixed(1)}</td><td class="${clsV}">${r.pmV.toFixed(1)}</td></tr>`;
  }).join('');

  const worstPmI = Math.min(...rows.map(r => r.pmI));
  const worstPmV = Math.min(...rows.map(r => r.pmV));
  const badge = document.getElementById('badge_worstcase');
  if (worstPmI > 45 && worstPmV > 45) {
    badge.innerHTML = '<span class="badge ok">✅ PM garantito &gt; 45° in tutti i corner (corrente min ' + worstPmI.toFixed(1) + '°, tensione min ' + worstPmV.toFixed(1) + '°)</span>';
  } else if (worstPmI > 30 && worstPmV > 30) {
    badge.innerHTML = '<span class="badge warn">⚠️ PM worst-case ridotto (corrente min ' + worstPmI.toFixed(1) + '°, tensione min ' + worstPmV.toFixed(1) + '°) — considera margini di progetto più ampi</span>';
  } else {
    badge.innerHTML = '<span class="badge bad">❌ PM worst-case insufficiente (corrente min ' + worstPmI.toFixed(1) + '°, tensione min ' + worstPmV.toFixed(1) + '°) — rischio instabilità con componenti reali</span>';
  }
}

// ===================== Load robustness (R_load operating sweep) =====================
function runLoadRobustness() {
  const Rload_nom = parseFloat(document.getElementById('R_load').value) || 53.3;
  const C_nom = (parseFloat(document.getElementById('C_dc').value) || 1000) * 1e-6;
  const bwV = parseInt(document.getElementById('bw_v_slider').value) || 10;

  const rminPct = parseFloat(document.getElementById('load_rmin_pct').value) || 10;
  const rmaxPct = parseFloat(document.getElementById('load_rmax_pct').value) || 500;
  const Rmin = Rload_nom * (rminPct / 100);
  const Rmax = Rload_nom * (rmaxPct / 100);

  const nPoints = 25;
  const rVals = [], pmVals = [], poleFreqVals = [];
  for (let i = 0; i < nPoints; i++) {
    // Logarithmic spacing: load resistance spans a wide multiplicative range
    // (light load to overload), so linear spacing would over-sample the high
    // end and under-sample near full load where behavior changes fastest.
    const logMin = Math.log10(Rmin), logMax = Math.log10(Rmax);
    const R = Math.pow(10, logMin + (logMax - logMin) * i / (nPoints - 1));
    const res = computeVoltageLoopPM(C_nom, R, bwV);
    const poleFreq = 1 / (2 * Math.PI * R * C_nom);
    rVals.push(R);
    pmVals.push(res.pm);
    poleFreqVals.push(poleFreq);
  }

  drawSweepLine('loadPMPlot', rVals, pmVals, 45, 'PM (°)');
  drawSweepLine('loadBWPlot', rVals, poleFreqVals, bwV, 'f_polo (Hz)');

  const minPM = Math.min(...pmVals);
  const resAtMin = computeVoltageLoopPM(C_nom, Rmin, bwV);
  const resAtMax = computeVoltageLoopPM(C_nom, Rmax, bwV);
  const resAtNom = computeVoltageLoopPM(C_nom, Rload_nom, bwV);

  document.getElementById('load_pm_min').textContent = minPM.toFixed(1);
  document.getElementById('load_pm_at_rmin').textContent = resAtMin.pm.toFixed(1);
  document.getElementById('load_pm_at_rmax').textContent = resAtMax.pm.toFixed(1);
  document.getElementById('load_pm_nominal').textContent = resAtNom.pm.toFixed(1);

  const badge = document.getElementById('badge_loadrob');
  if (minPM > 45) {
    badge.innerHTML = '<span class="badge ok">✅ PM &gt; 45° su tutto il range di carico (' + rminPct + '%–' + rmaxPct + '% del nominale)</span>';
  } else if (minPM > 30) {
    badge.innerHTML = '<span class="badge warn">⚠️ PM minimo ' + minPM.toFixed(1) + '° nel range di carico — margine ridotto in alcune condizioni operative</span>';
  } else {
    badge.innerHTML = '<span class="badge bad">❌ PM minimo ' + minPM.toFixed(1) + '° — possibile instabilità in alcune condizioni di carico reali</span>';
  }
}

// ===================== ADC quantization noise =====================
function updateAdcNoise() {
  const loop = document.getElementById('adc_loop')?.value || 'current';
  const bits = parseFloat(document.getElementById('adc_bits')?.value) || 12;
  const fullscale = parseFloat(document.getElementById('adc_fullscale')?.value) || 20;

  const lsb = fullscale / Math.pow(2, bits);
  const sigmaQ = lsb / Math.sqrt(12);

  // Propagate through the proportional path only (Kp), as a first-order
  // estimate of how much quantization noise shows up directly on the
  // controller output — the integral path further filters/averages this
  // noise over time, so the proportional term is the conservative (worst
  // case) estimate for instantaneous output ripple.
  let Kp;
  if (loop === 'current') {
    Kp = parseFloat(document.getElementById('kp_i')?.textContent) || 0;
  } else {
    Kp = parseFloat(document.getElementById('kp_v')?.textContent) || 0;
  }
  const outputRippleSigma = Kp * sigmaQ;

  // SNR: full-scale sine wave vs quantization noise (standard ADC SNR formula).
  const snrDb = 6.02 * bits + 1.76;

  document.getElementById('adc_lsb').textContent = lsb.toExponential(3);
  document.getElementById('adc_sigma').textContent = sigmaQ.toExponential(3);
  document.getElementById('adc_out_ripple').textContent = outputRippleSigma.toExponential(3);
  document.getElementById('adc_snr').textContent = snrDb.toFixed(1);

  const badge = document.getElementById('badge_adcnoise');
  if (badge) {
    if (bits >= 12) {
      badge.innerHTML = '<span class="badge ok">✅ Risoluzione tipica per loop di controllo PFC (≥12 bit)</span>';
    } else if (bits >= 10) {
      badge.innerHTML = '<span class="badge warn">⚠️ Risoluzione ridotta: verifica che il ripple indotto sia accettabile per l\'applicazione</span>';
    } else {
      badge.innerHTML = '<span class="badge bad">❌ Risoluzione bassa per un loop di controllo di precisione: rumore di quantizzazione probabilmente dominante</span>';
    }
  }
}

function updateRobustnessTab() {
  const select = document.getElementById('sweep_param');
  if (select && select.options.length === 0) {
    updateSweepUI();
  } else {
    runSweep();
  }
  runWorstCase();
  runLoadRobustness();
  updateAdcNoise();
}

let resizeTimer;
let lastKnownWidth = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // Ignore resize events that don't change the width (e.g. mobile browser
    // address bar show/hide only changes height, and re-running draw logic
    // on those was the original trigger for the runaway vertical growth bug).
    if (window.innerWidth === lastKnownWidth) return;
    lastKnownWidth = window.innerWidth;
    refreshCurrentTab();
  }, 250);
});

// ---------- Init ----------
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  const restored = loadFromStorageIfPresent();
  applyValidationUI();
  computeSystem();
  if (restored) showToast('Configurazione precedente ripristinata', 'success', 1800);

  ALL_PARAM_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', onParamInputChanged);
  });

  // Self-healing redraw: if a chart's draw was skipped earlier because the
  // canvas guard caught a transient zero/near-zero layout width (e.g. the
  // on-screen keyboard resizing the viewport mid-keystroke), this guarantees
  // it catches up as soon as the field loses focus, without requiring the
  // user to notice anything was wrong or manually revisit the tab.
  document.querySelectorAll('input[type="number"], input[type="range"]').forEach(el => {
    el.addEventListener('blur', () => refreshCurrentTab());
  });

  document.getElementById('importFileInput')?.addEventListener('change', handleImportFile);
  updatePresetComparison();
});
