// ===================== RENDERING (canvas) =====================

function themeColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function getCanvasWidth(canvasId) {
  const canvas = document.getElementById(canvasId);
  const container = canvas.parentElement;

  // Pin the container's height to the canvas's declared height attribute
  // (e.g. height="320") exactly once. Previously the container had no fixed
  // height (only min-height) and the canvas was laid out in normal flow, so
  // canvas.style.height set during drawing could nudge the container's own
  // measured height by a sub-pixel amount; that triggered another 'resize'
  // event, which re-ran this same draw code with a still-changed size,
  // compounding every ~1s until the chart grew unbounded. Fixing the
  // container height from the canvas attribute (not from measuring layout)
  // and taking the canvas out of flow (position:absolute, see CSS) removes
  // the feedback path entirely.
  if (!container.dataset.pinnedHeight) {
    const declaredHeight = parseInt(canvas.getAttribute('height')) || 220;
    container.style.height = declaredHeight + 'px';
    container.dataset.pinnedHeight = '1';
  }

  const rect = container.getBoundingClientRect();

  // IMPORTANT: previously this fell back to `window.innerWidth - 64` whenever
  // rect.width was 0 (e.g. the panel is still display:none right as a tab
  // switch fires refreshCurrentTab() before the browser has committed the
  // layout change). That silently let a draw proceed using a width that did
  // not match the container's real width. Because canvas.width (the pixel
  // buffer) is set from this same value, a later legitimate draw at the
  // container's actual width would then be interpreted relative to a
  // differently-scaled buffer, which is what produced the apparent
  // "zooming" of the axes on repeated tab visits. Returning null here and
  // having every draw* function bail out (see canvasIsDrawable) keeps
  // whatever was last correctly rendered until a real, valid layout is
  // available.
  if (rect.width < 50) return null;

  return rect.width;
}

// Defensive check used by every draw* function before touching a canvas:
// returns true if the canvas can be safely sized/drawn right now. A width or
// height of 0 typically means the canvas's panel is not currently visible
// (display:none) — resizing the canvas to 0 in that state corrupts it (shows
// as a broken-image icon) and it stays broken until something else happens
// to redraw it later. Skipping the draw leaves any previous valid frame in
// place instead.
function canvasIsDrawable(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return false;
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  // Require a sane minimum width, not just >0: a transient near-zero width
  // can occur mid-layout-shift (e.g. the on-screen keyboard opening/closing
  // on Android resizes the viewport for a frame or two before settling) and
  // would otherwise slip through a bare `> 0` check, corrupting the canvas.
  return rect.width > 50;
}

function drawBodeDual(canvasId, freqs, magsIdeal, phasesIdeal, magsReal, phasesReal, targetBw, prevCurve) {
  if (!canvasIsDrawable(canvasId)) return;
  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const wCanvas = getCanvasWidth(canvasId);
  if (wCanvas === null) return;
  if (!canvas.dataset.baseHeight) { canvas.dataset.baseHeight = canvas.getAttribute('height') || '320'; }
  const hCanvas = parseInt(canvas.dataset.baseHeight) || 320;
  canvas.width = wCanvas * dpr;
  canvas.height = hCanvas * dpr;
  canvas.style.width = wCanvas + 'px';
  canvas.style.height = hCanvas + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = wCanvas, h = hCanvas;
  const pad = { top: 30, right: 10, bottom: 35, left: 50 };

  const bgColor = themeColor('--bg');
  const gridColor = themeColor('--surface-2');
  const textColor = themeColor('--text-2');
  const idealColor = themeColor('--ideal');
  const accentColor = themeColor('--accent');
  const accent2Color = themeColor('--accent-2');
  const successColor = themeColor('--success');
  const warnColor = themeColor('--warning');

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (h - pad.top - pad.bottom) * i / 5;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }

  const hMag = (h - pad.top - pad.bottom) * 0.45;
  const MAG_AXIS_LOWER_BOUND = -120; // generous floor in dB; anything below is irrelevant to loop shaping
  const allMagsForScale = [...magsIdeal, ...magsReal, ...(prevCurve ? prevCurve.mags : [])]
    .map(v => Math.max(v, MAG_AXIS_LOWER_BOUND));
  const maxMag = Math.max(...allMagsForScale, 10);
  const minMag = Math.min(...allMagsForScale, -40);
  const scaleMag = hMag / (maxMag - minMag);

  let fcIdxReal = -1, pmReal = 90;
  for (let i = 0; i < freqs.length; i++) {
    if (magsReal[i] <= 0 && fcIdxReal < 0) fcIdxReal = i;
    if (Math.abs(magsReal[i]) < 0.5) { pmReal = 180 + phasesReal[i]; break; }
  }
  if (fcIdxReal < 0) fcIdxReal = Math.floor(freqs.length / 2);

  // Previous (comparison) curve, drawn faint
  if (prevCurve) {
    ctx.strokeStyle = accent2Color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const x = pad.left + (w - pad.left - pad.right) * i / (freqs.length - 1);
      const y = pad.top + hMag - (prevCurve.mags[i] - minMag) * scaleMag;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Ideal magnitude (dashed)
  ctx.strokeStyle = idealColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  for (let i = 0; i < freqs.length; i++) {
    const x = pad.left + (w - pad.left - pad.right) * i / (freqs.length - 1);
    const y = pad.top + hMag - (magsIdeal[i] - minMag) * scaleMag;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Real magnitude
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < freqs.length; i++) {
    const x = pad.left + (w - pad.left - pad.right) * i / (freqs.length - 1);
    const y = pad.top + hMag - (magsReal[i] - minMag) * scaleMag;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const y0dB = pad.top + hMag - (0 - minMag) * scaleMag;
  ctx.strokeStyle = 'rgba(128,128,128,0.25)';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.left, y0dB); ctx.lineTo(w - pad.right, y0dB); ctx.stroke();
  ctx.setLineDash([]);

  if (fcIdxReal >= 0) {
    const xFc = pad.left + (w - pad.left - pad.right) * fcIdxReal / (freqs.length - 1);
    ctx.strokeStyle = successColor;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(xFc, pad.top); ctx.lineTo(xFc, pad.top + hMag); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = successColor;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('fc', xFc, pad.top - 4);
  }

  if (targetBw) {
    const logF0 = Math.log10(freqs[0]), logF1 = Math.log10(freqs[freqs.length-1]);
    const logTarget = Math.log10(targetBw);
    if (logTarget >= logF0 && logTarget <= logF1) {
      const ratio = (logTarget - logF0) / (logF1 - logF0);
      const xTarget = pad.left + (w - pad.left - pad.right) * ratio;
      ctx.strokeStyle = warnColor;
      ctx.setLineDash([6, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xTarget, pad.top); ctx.lineTo(xTarget, pad.top + hMag); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = warnColor;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BW', xTarget, pad.top - 4);
    }
  }

  const topPhase = pad.top + hMag + 12;
  const hPhase = (h - pad.top - pad.bottom) * 0.45;

  // Normalize each phase array ONCE by wrapping only the first sample into
  // (-360, 0], then keep every subsequent sample as computed (cArg + summed
  // parasitic phase lags), which is already continuous/unwrapped by
  // construction since it comes from adding continuous phase contributions.
  // Wrapping every point independently (the previous approach) folds any
  // point that drifts past the fixed axis limits back by 360°, which made
  // adjacent samples jump between two representations of the same physical
  // angle and rendered as a sawtooth once the real curve (with several
  // cascaded parasitic poles/delays) dropped below -270°.
  function normalizePhaseSeries(phases) {
    if (phases.length === 0) return [];
    let offset = 0;
    let first = phases[0];
    while (first + offset > 0) offset -= 360;
    while (first + offset <= -360) offset += 360;
    return phases.map(p => p + offset);
  }

  const idealNorm = normalizePhaseSeries(phasesIdeal);
  const realNorm = normalizePhaseSeries(phasesReal);

  // Only consider phase values up to a couple of decades past the 0dB
  // crossover for axis-scaling purposes. Far beyond crossover the magnitude
  // curve is already deep below 0dB and irrelevant to stability (phase
  // margin is only meaningful AT crossover), but a phase-delay term that
  // grows linearly with frequency (e.g. digital/computational delay) can
  // still rack up thousands of degrees by the top of the sweep. Including
  // those in the axis range squashed the entire meaningful -360..0 portion
  // of the curve into a sliver of the chart.
  const PHASE_AXIS_LOWER_BOUND = -450; // generous floor: covers up to 5 cascaded poles/delays near crossover
  const allPhaseVals = [...idealNorm, ...realNorm].map(v => Math.max(v, PHASE_AXIS_LOWER_BOUND));
  const dataMaxPhase = Math.max(...allPhaseVals, -180);
  const dataMinPhase = Math.min(...allPhaseVals, -180);
  // Round the range outward to the nearest 90 degrees and add a little
  // headroom so the curve never touches the plot edge.
  const maxPhase = Math.max(0, Math.ceil(dataMaxPhase / 90) * 90);
  const minPhase = Math.min(-270, Math.floor(dataMinPhase / 90) * 90);
  const scalePhase = hPhase / (maxPhase - minPhase);

  ctx.strokeStyle = idealColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  for (let i = 0; i < freqs.length; i++) {
    const x = pad.left + (w - pad.left - pad.right) * i / (freqs.length - 1);
    const y = topPhase + hPhase - (idealNorm[i] - minPhase) * scalePhase;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = accent2Color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < freqs.length; i++) {
    const x = pad.left + (w - pad.left - pad.right) * i / (freqs.length - 1);
    const y = topPhase + hPhase - (realNorm[i] - minPhase) * scalePhase;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const y180 = topPhase + hPhase - (-180 - minPhase) * scalePhase;
  ctx.strokeStyle = 'rgba(128,128,128,0.25)';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.left, y180); ctx.lineTo(w - pad.right, y180); ctx.stroke();
  ctx.setLineDash([]);

  if (fcIdxReal >= 0) {
    const xFc = pad.left + (w - pad.left - pad.right) * fcIdxReal / (freqs.length - 1);
    const phAtFc = realNorm[fcIdxReal];
    const yPh = topPhase + hPhase - (phAtFc - minPhase) * scalePhase;

    ctx.strokeStyle = successColor;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(xFc, topPhase); ctx.lineTo(xFc, topPhase + hPhase); ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = successColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const arcR = 18;
    const arcY = y180;
    ctx.arc(xFc, arcY, arcR, -Math.PI/2, -Math.PI/2 + (pmReal * Math.PI / 180), false);
    ctx.stroke();

    ctx.fillStyle = successColor;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('PM = ' + pmReal.toFixed(1) + '°', xFc + 6, yPh - 6);
  }

  ctx.fillStyle = textColor;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const val = maxMag - (maxMag - minMag) * i / 5;
    ctx.fillText(val.toFixed(0) + 'dB', pad.left - 4, pad.top + hMag * i / 5 + 4);
  }
  const phaseSteps = 4;
  for (let i = 0; i <= phaseSteps; i++) {
    const val = maxPhase - (maxPhase - minPhase) * i / phaseSteps;
    ctx.fillText(val.toFixed(0) + '°', pad.left - 4, topPhase + hPhase * i / phaseSteps + 4);
  }

  ctx.textAlign = 'center';
  const f0 = freqs[0], f1 = freqs[freqs.length - 1];
  const logF0 = Math.log10(f0), logF1 = Math.log10(f1);
  for (let exp = Math.ceil(logF0); exp <= Math.floor(logF1); exp++) {
    const f = Math.pow(10, exp);
    if (f < f0 || f > f1) continue;
    const ratio = (Math.log10(f) - logF0) / (logF1 - logF0);
    const x = pad.left + (w - pad.left - pad.right) * ratio;
    ctx.fillText(f >= 1000 ? (f/1000).toFixed(0) + 'k' : f.toFixed(0), x, h - 6);
    ctx.strokeStyle = gridColor;
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, h - pad.bottom); ctx.stroke();
  }

  ctx.textAlign = 'left';
  ctx.font = '9px sans-serif';
  let legendY = pad.top + 12;
  ctx.fillStyle = accentColor; ctx.fillText('|L(jω)| reale', w - 112, legendY); legendY += 12;
  ctx.fillStyle = idealColor; ctx.fillText('|L(jω)| ideale', w - 112, legendY); legendY += 12;
  ctx.fillStyle = accent2Color; ctx.fillText('∠L(jω) reale', w - 112, legendY); legendY += 12;
  ctx.fillStyle = idealColor; ctx.fillText('∠L(jω) ideale', w - 112, legendY); legendY += 12;
  ctx.fillStyle = successColor; ctx.fillText('fc / PM reale', w - 112, legendY); legendY += 12;
  ctx.fillStyle = warnColor; ctx.fillText('BW target', w - 112, legendY); legendY += 12;
  if (prevCurve) { ctx.fillStyle = accent2Color; ctx.globalAlpha = 0.6; ctx.fillText('|L| precedente', w - 112, legendY); ctx.globalAlpha = 1; }
}

function drawStep(canvasId, times, values, settlingLine) {
  if (!canvasIsDrawable(canvasId)) return;
  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const wCanvas = getCanvasWidth(canvasId);
  if (wCanvas === null) return;
  if (!canvas.dataset.baseHeight) { canvas.dataset.baseHeight = canvas.getAttribute('height') || '220'; }
  const hCanvas = parseInt(canvas.dataset.baseHeight) || 220;
  canvas.width = wCanvas * dpr;
  canvas.height = hCanvas * dpr;
  canvas.style.width = wCanvas + 'px';
  canvas.style.height = hCanvas + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = wCanvas, h = hCanvas;
  const pad = { top: 20, right: 15, bottom: 30, left: 45 };

  const bgColor = themeColor('--bg');
  const gridColor = themeColor('--surface-2');
  const textColor = themeColor('--text-2');
  const successColor = themeColor('--success');
  const accentColor = themeColor('--accent');

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const maxT = times[times.length - 1];
  const maxV = Math.max(...values, 1.2);
  const minV = Math.min(...values, -0.1);

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h - pad.top - pad.bottom) * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }

  ctx.strokeStyle = successColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < times.length; i++) {
    const x = pad.left + (w - pad.left - pad.right) * times[i] / maxT;
    const y = pad.top + (h - pad.top - pad.bottom) * (1 - (values[i] - minV) / (maxV - minV));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (settlingLine !== undefined) {
    const y = pad.top + (h - pad.top - pad.bottom) * (1 - (settlingLine - minV) / (maxV - minV));
    ctx.strokeStyle = accentColor;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = textColor;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = minV + (maxV - minV) * (1 - i / 4);
    ctx.fillText(val.toFixed(2), pad.left - 4, pad.top + (h - pad.top - pad.bottom) * i / 4 + 4);
  }
  ctx.textAlign = 'center';
  ctx.fillText('0', pad.left, h - 8);
  ctx.fillText((maxT * 1000).toFixed(1) + 'ms', w - pad.right, h - 8);
}

function drawGridWaveform(canvasId, dataA, dataB, dataC, yLabel, colors) {
  if (!canvasIsDrawable(canvasId)) return;
  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const wCanvas = getCanvasWidth(canvasId);
  if (wCanvas === null) return;
  if (!canvas.dataset.baseHeight) { canvas.dataset.baseHeight = canvas.getAttribute('height') || '240'; }
  const hCanvas = parseInt(canvas.dataset.baseHeight) || 240;
  canvas.width = wCanvas * dpr;
  canvas.height = hCanvas * dpr;
  canvas.style.width = wCanvas + 'px';
  canvas.style.height = hCanvas + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = wCanvas, h = hCanvas;
  const pad = { top: 25, right: 15, bottom: 35, left: 50 };

  const bgColor = themeColor('--bg');
  const gridColor = themeColor('--surface-2');
  const textColor = themeColor('--text-2');
  const zeroColor = themeColor('--surface-2');

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const allVals = [...dataA, ...dataB, ...dataC];
  const maxAbs = Math.max(...allVals.map(Math.abs), 1);
  const margin = maxAbs * 0.15;
  const maxV = maxAbs + margin;
  const minV = -maxAbs - margin;

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h - pad.top - pad.bottom) * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }

  const yZero = pad.top + (h - pad.top - pad.bottom) * (1 - (0 - minV) / (maxV - minV));
  ctx.strokeStyle = zeroColor;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.left, yZero); ctx.lineTo(w - pad.right, yZero); ctx.stroke();

  const datasets = [dataA, dataB, dataC];
  const lineColors = colors || [themeColor('--phaseA'), themeColor('--phaseB'), themeColor('--phaseC')];

  for (let d = 0; d < 3; d++) {
    const data = datasets[d];
    ctx.strokeStyle = lineColors[d];
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = pad.left + (w - pad.left - pad.right) * i / (data.length - 1);
      const y = pad.top + (h - pad.top - pad.bottom) * (1 - (data[i] - minV) / (maxV - minV));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.fillStyle = textColor;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = minV + (maxV - minV) * (1 - i / 4);
    ctx.fillText(val.toFixed(0), pad.left - 4, pad.top + (h - pad.top - pad.bottom) * i / 4 + 4);
  }
  ctx.textAlign = 'center';
  ctx.fillText('0°', pad.left, h - 8);
  ctx.fillText('360°', w - pad.right, h - 8);
  ctx.fillText('180°', pad.left + (w - pad.left - pad.right) / 2, h - 8);

  if (yLabel) {
    ctx.save();
    ctx.translate(12, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }
}

function drawXY(canvasId, xData, yData, yData2, labels, colors) {
  if (!canvasIsDrawable(canvasId)) return;
  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const wCanvas = getCanvasWidth(canvasId);
  if (wCanvas === null) return;
  if (!canvas.dataset.baseHeight) { canvas.dataset.baseHeight = canvas.getAttribute('height') || '220'; }
  const hCanvas = parseInt(canvas.dataset.baseHeight) || 220;
  canvas.width = wCanvas * dpr;
  canvas.height = hCanvas * dpr;
  canvas.style.width = wCanvas + 'px';
  canvas.style.height = hCanvas + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = wCanvas, h = hCanvas;
  const pad = { top: 20, right: 15, bottom: 30, left: 45 };

  const bgColor = themeColor('--bg');
  const gridColor = themeColor('--surface-2');
  const textColor = themeColor('--text-2');

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const allY = [...yData, ...(yData2 || [])];
  const maxY = Math.max(...allY, 1);
  const minY = Math.min(...allY, -1);
  const marginY = (maxY - minY) * 0.1;
  const maxV = maxY + marginY;
  const minV = minY - marginY;
  const maxX = xData[xData.length - 1];

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h - pad.top - pad.bottom) * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }

  const lineColors = colors || [themeColor('--accent'), themeColor('--accent-2')];

  ctx.strokeStyle = lineColors[0];
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < xData.length; i++) {
    const x = pad.left + (w - pad.left - pad.right) * xData[i] / maxX;
    const y = pad.top + (h - pad.top - pad.bottom) * (1 - (yData[i] - minV) / (maxV - minV));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (yData2) {
    ctx.strokeStyle = lineColors[1];
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 0; i < xData.length; i++) {
      const x = pad.left + (w - pad.left - pad.right) * xData[i] / maxX;
      const y = pad.top + (h - pad.top - pad.bottom) * (1 - (yData2[i] - minV) / (maxV - minV));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = textColor;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = minV + (maxV - minV) * (1 - i / 4);
    ctx.fillText(val.toFixed(2), pad.left - 4, pad.top + (h - pad.top - pad.bottom) * i / 4 + 4);
  }
  ctx.textAlign = 'center';
  ctx.fillText('0', pad.left, h - 8);
  ctx.fillText((maxX * 1000).toFixed(0) + 'ms', w - pad.right, h - 8);
}

// Like drawXY, but each series gets its OWN y-axis scale. Needed for d/q pairs
// where the d component (large, ~constant) and q component (small, near zero)
// would otherwise be squashed onto the same range and q would look like a flat
// line even when it carries meaningful ripple information.
function drawXYDualScale(canvasId, xData, yDataD, yDataQ, colors) {
  if (!canvasIsDrawable(canvasId)) return;
  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const wCanvas = getCanvasWidth(canvasId);
  if (wCanvas === null) return;
  if (!canvas.dataset.baseHeight) { canvas.dataset.baseHeight = canvas.getAttribute('height') || '220'; }
  const hCanvas = parseInt(canvas.dataset.baseHeight) || 220;
  canvas.width = wCanvas * dpr;
  canvas.height = hCanvas * dpr;
  canvas.style.width = wCanvas + 'px';
  canvas.style.height = hCanvas + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = wCanvas, h = hCanvas;
  const pad = { top: 20, right: 45, bottom: 30, left: 45 };

  const bgColor = themeColor('--bg');
  const gridColor = themeColor('--surface-2');
  const textColor = themeColor('--text-2');
  const lineColors = colors || [themeColor('--accent'), themeColor('--accent-2')];

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const maxD = Math.max(...yDataD, 1), minD = Math.min(...yDataD, -1);
  const marginD = (maxD - minD) * 0.15 || 1;
  const maxVD = maxD + marginD, minVD = minD - marginD;

  const maxQ = Math.max(...yDataQ, 1), minQ = Math.min(...yDataQ, -1);
  const marginQ = (maxQ - minQ) * 0.15 || 1;
  const maxVQ = maxQ + marginQ, minVQ = minQ - marginQ;

  const maxX = xData[xData.length - 1];

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h - pad.top - pad.bottom) * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }

  // D curve (left axis)
  ctx.strokeStyle = lineColors[0];
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < xData.length; i++) {
    const x = pad.left + (w - pad.left - pad.right) * xData[i] / maxX;
    const y = pad.top + (h - pad.top - pad.bottom) * (1 - (yDataD[i] - minVD) / (maxVD - minVD));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Q curve (right axis)
  ctx.strokeStyle = lineColors[1];
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < xData.length; i++) {
    const x = pad.left + (w - pad.left - pad.right) * xData[i] / maxX;
    const y = pad.top + (h - pad.top - pad.bottom) * (1 - (yDataQ[i] - minVQ) / (maxVQ - minVQ));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.font = '10px sans-serif';
  ctx.fillStyle = lineColors[0];
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = minVD + (maxVD - minVD) * (1 - i / 4);
    ctx.fillText(val.toFixed(1), pad.left - 4, pad.top + (h - pad.top - pad.bottom) * i / 4 + 4);
  }
  ctx.fillStyle = lineColors[1];
  ctx.textAlign = 'left';
  for (let i = 0; i <= 4; i++) {
    const val = minVQ + (maxVQ - minVQ) * (1 - i / 4);
    ctx.fillText(val.toFixed(2), w - pad.right + 4, pad.top + (h - pad.top - pad.bottom) * i / 4 + 4);
  }

  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.fillText('0', pad.left, h - 8);
  ctx.fillText((maxX * 1000).toFixed(0) + 'ms', pad.left + (w - pad.left - pad.right) / 2, h - 8);
}

// Simple line chart for parametric sweeps: x = swept parameter value, y = metric
// (PM or overshoot), with an optional horizontal threshold line and a marker at
// the nominal (center) point.
// Compares the frequency response magnitude of the continuous PI against its
// three discretized versions (Tustin, Backward Euler, Forward Euler), so the
// user can see how far each digitalization method drifts from the continuous
// design as frequency approaches the sampling rate.
function drawDiscretizationCompare(canvasId, freqs, magContinuous, magTustin, magBackward, magForward, fs) {
  if (!canvasIsDrawable(canvasId)) return;
  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const wCanvas = getCanvasWidth(canvasId);
  if (wCanvas === null) return;
  if (!canvas.dataset.baseHeight) { canvas.dataset.baseHeight = canvas.getAttribute('height') || '240'; }
  const hCanvas = parseInt(canvas.dataset.baseHeight) || 240;
  canvas.width = wCanvas * dpr;
  canvas.height = hCanvas * dpr;
  canvas.style.width = wCanvas + 'px';
  canvas.style.height = hCanvas + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = wCanvas, h = hCanvas;
  const pad = { top: 20, right: 15, bottom: 32, left: 55 };

  const bgColor = themeColor('--bg');
  const gridColor = themeColor('--surface-2');
  const textColor = themeColor('--text-2');
  const idealColor = themeColor('--ideal');
  const accentColor = themeColor('--accent');
  const phaseBColor = themeColor('--phaseB');
  const phaseCColor = themeColor('--phaseC');
  const warnColor = themeColor('--warning');

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const allMags = [...magContinuous, ...magTustin, ...magBackward, ...magForward];
  const maxMag = Math.max(...allMags, 10);
  const minMag = Math.min(...allMags, -20);

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h - pad.top - pad.bottom) * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }

  const logF0 = Math.log10(freqs[0]), logF1 = Math.log10(freqs[freqs.length - 1]);
  function xAt(f) { return pad.left + (w - pad.left - pad.right) * (Math.log10(f) - logF0) / (logF1 - logF0); }
  function yAt(mag) { return pad.top + (h - pad.top - pad.bottom) * (1 - (mag - minMag) / (maxMag - minMag)); }

  function drawCurve(mags, color, dashed) {
    ctx.strokeStyle = color;
    ctx.lineWidth = dashed ? 1.5 : 2.2;
    if (dashed) ctx.setLineDash([6, 4]); else ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i < freqs.length; i++) {
      const x = xAt(freqs[i]), y = yAt(mags[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawCurve(magContinuous, idealColor, true);
  drawCurve(magTustin, accentColor, false);
  drawCurve(magBackward, phaseBColor, false);
  drawCurve(magForward, phaseCColor, false);

  // Nyquist frequency marker (fs/2) — beyond this, discretization is meaningless.
  const fNyquist = fs / 2;
  if (fNyquist >= freqs[0] && fNyquist <= freqs[freqs.length - 1]) {
    const xN = xAt(fNyquist);
    ctx.strokeStyle = warnColor;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(xN, pad.top); ctx.lineTo(xN, h - pad.bottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = warnColor;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('fs/2', xN, pad.top - 4);
  }

  ctx.fillStyle = textColor;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = maxMag - (maxMag - minMag) * i / 4;
    ctx.fillText(val.toFixed(0) + 'dB', pad.left - 4, pad.top + (h - pad.top - pad.bottom) * i / 4 + 4);
  }
  ctx.textAlign = 'center';
  const f0 = freqs[0], f1 = freqs[freqs.length - 1];
  for (let exp = Math.ceil(logF0); exp <= Math.floor(logF1); exp++) {
    const f = Math.pow(10, exp);
    if (f < f0 || f > f1) continue;
    const x = xAt(f);
    ctx.fillText(f >= 1000 ? (f/1000).toFixed(0) + 'k' : f.toFixed(0), x, h - 6);
    ctx.strokeStyle = gridColor;
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, h - pad.bottom); ctx.stroke();
  }
}

function drawSweepLine(canvasId, xVals, yVals, thresholdY, yLabel) {
  if (!canvasIsDrawable(canvasId)) return;
  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const wCanvas = getCanvasWidth(canvasId);
  if (wCanvas === null) return;
  if (!canvas.dataset.baseHeight) { canvas.dataset.baseHeight = canvas.getAttribute('height') || '240'; }
  const hCanvas = parseInt(canvas.dataset.baseHeight) || 240;
  canvas.width = wCanvas * dpr;
  canvas.height = hCanvas * dpr;
  canvas.style.width = wCanvas + 'px';
  canvas.style.height = hCanvas + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = wCanvas, h = hCanvas;
  const pad = { top: 20, right: 15, bottom: 32, left: 48 };

  const bgColor = themeColor('--bg');
  const gridColor = themeColor('--surface-2');
  const textColor = themeColor('--text-2');
  const accentColor = themeColor('--accent');
  const successColor = themeColor('--success');
  const warnColor = themeColor('--warning');

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const minX = Math.min(...xVals), maxX = Math.max(...xVals);
  const allY = [...yVals, thresholdY];
  const maxY = Math.max(...allY) * 1.1;
  const minY = Math.min(0, Math.min(...allY) * 1.1);

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h - pad.top - pad.bottom) * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }

  // Threshold line
  if (thresholdY !== undefined && thresholdY !== null) {
    const yT = pad.top + (h - pad.top - pad.bottom) * (1 - (thresholdY - minY) / (maxY - minY));
    ctx.strokeStyle = warnColor;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad.left, yT); ctx.lineTo(w - pad.right, yT); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = warnColor;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('soglia ' + thresholdY, pad.left + 4, yT - 4);
  }

  // Main curve
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < xVals.length; i++) {
    const x = pad.left + (w - pad.left - pad.right) * (xVals[i] - minX) / (maxX - minX || 1);
    const y = pad.top + (h - pad.top - pad.bottom) * (1 - (yVals[i] - minY) / (maxY - minY));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Nominal point marker (center of sweep)
  const midIdx = Math.floor(xVals.length / 2);
  const xMid = pad.left + (w - pad.left - pad.right) * (xVals[midIdx] - minX) / (maxX - minX || 1);
  const yMid = pad.top + (h - pad.top - pad.bottom) * (1 - (yVals[midIdx] - minY) / (maxY - minY));
  ctx.fillStyle = successColor;
  ctx.beginPath();
  ctx.arc(xMid, yMid, 4, 0, 2 * Math.PI);
  ctx.fill();

  ctx.fillStyle = textColor;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = minY + (maxY - minY) * (1 - i / 4);
    ctx.fillText(val.toFixed(0), pad.left - 4, pad.top + (h - pad.top - pad.bottom) * i / 4 + 4);
  }
  ctx.textAlign = 'center';
  ctx.fillText(minX < 1 ? minX.toFixed(3) : minX.toFixed(1), pad.left, h - 8);
  ctx.fillText(maxX < 1 ? maxX.toFixed(3) : maxX.toFixed(1), w - pad.right, h - 8);
  if (yLabel) {
    ctx.textAlign = 'left';
    ctx.font = '9px sans-serif';
    ctx.fillStyle = accentColor;
    ctx.fillText(yLabel, pad.left + 4, pad.top + 10);
  }
}

function drawSpaceVector(canvasId, alphaV, betaV, alphaI, betaI) {
  if (!canvasIsDrawable(canvasId)) return;
  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const wCanvas = getCanvasWidth(canvasId);
  if (wCanvas === null) return;
  if (!canvas.dataset.baseHeight) { canvas.dataset.baseHeight = canvas.getAttribute('height') || '280'; }
  const hCanvas = parseInt(canvas.dataset.baseHeight) || 280;
  canvas.width = wCanvas * dpr;
  canvas.height = hCanvas * dpr;
  canvas.style.width = wCanvas + 'px';
  canvas.style.height = hCanvas + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = wCanvas, h = hCanvas;
  const cx = w / 2, cy = h / 2;
  const radius = Math.min(w, h) * 0.38;

  const bgColor = themeColor('--bg');
  const gridColor = themeColor('--surface-2');
  const textColor = themeColor('--text-2');
  const accentColor = themeColor('--accent');
  const accent2Color = themeColor('--accent-2');
  const idealColor = themeColor('--ideal');

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let r = 0.25; r <= 1; r += 0.25) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * r, 0, 2 * Math.PI);
    ctx.stroke();
  }

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - radius - 10, cy); ctx.lineTo(cx + radius + 10, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - radius - 10); ctx.lineTo(cx, cy + radius + 10); ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('α', cx + radius + 15, cy + 4);
  ctx.textAlign = 'right';
  ctx.fillText('β', cx - 4, cy - radius - 12);

  ctx.strokeStyle = idealColor;
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const maxV = Math.max(...alphaV.map(Math.abs), ...betaV.map(Math.abs), 1);
  const scale = radius / maxV;

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < alphaV.length; i++) {
    const x = cx + alphaV[i] * scale;
    const y = cy - betaV[i] * scale;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const maxI = Math.max(...alphaI.map(Math.abs), ...betaI.map(Math.abs), 1);
  const scaleI = radius / maxI * 0.6;
  ctx.strokeStyle = accent2Color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < alphaI.length; i++) {
    const x = cx + alphaI[i] * scaleI;
    const y = cy - betaI[i] * scaleI;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const lastI = alphaI.length - 1;
  const tipX = cx + alphaI[lastI] * scaleI;
  const tipY = cy - betaI[lastI] * scaleI;
  ctx.fillStyle = accent2Color;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 4, 0, 2 * Math.PI);
  ctx.fill();

  const lastV = alphaV.length - 1;
  const tipVX = cx + alphaV[lastV] * scale;
  const tipVY = cy - betaV[lastV] * scale;
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.arc(tipVX, tipVY, 4, 0, 2 * Math.PI);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.font = '10px sans-serif';
  ctx.fillStyle = accentColor; ctx.fillText('Vettore Tensione (V)', 10, 18);
  ctx.fillStyle = accent2Color; ctx.fillText('Vettore Corrente (A, scalato)', 10, 32);
  ctx.fillStyle = idealColor; ctx.fillText('Cerchio ideale', 10, 46);
}

function drawPower(canvasId, times, pData, qData) {
  if (!canvasIsDrawable(canvasId)) return;
  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const wCanvas = getCanvasWidth(canvasId);
  if (wCanvas === null) return;
  if (!canvas.dataset.baseHeight) { canvas.dataset.baseHeight = canvas.getAttribute('height') || '260'; }
  const hCanvas = parseInt(canvas.dataset.baseHeight) || 260;
  canvas.width = wCanvas * dpr;
  canvas.height = hCanvas * dpr;
  canvas.style.width = wCanvas + 'px';
  canvas.style.height = hCanvas + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = wCanvas, h = hCanvas;
  const pad = { top: 25, right: 15, bottom: 35, left: 55 };

  const bgColor = themeColor('--bg');
  const gridColor = themeColor('--surface-2');
  const textColor = themeColor('--text-2');
  const zeroColor = themeColor('--surface-2');
  const accentColor = themeColor('--accent');
  const accent2Color = themeColor('--accent-2');

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, w, h);

  const allY = [...pData, ...qData];
  const maxAbs = Math.max(...allY.map(Math.abs), 100);
  const margin = maxAbs * 0.15;
  const maxV = maxAbs + margin;
  const minV = -maxAbs - margin;
  const maxT = times[times.length - 1];

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h - pad.top - pad.bottom) * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
  }

  const yZero = pad.top + (h - pad.top - pad.bottom) * (1 - (0 - minV) / (maxV - minV));
  ctx.strokeStyle = zeroColor;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.left, yZero); ctx.lineTo(w - pad.right, yZero); ctx.stroke();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < times.length; i++) {
    const x = pad.left + (w - pad.left - pad.right) * times[i] / maxT;
    const y = pad.top + (h - pad.top - pad.bottom) * (1 - (pData[i] - minV) / (maxV - minV));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = accent2Color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < times.length; i++) {
    const x = pad.left + (w - pad.left - pad.right) * times[i] / maxT;
    const y = pad.top + (h - pad.top - pad.bottom) * (1 - (qData[i] - minV) / (maxV - minV));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = minV + (maxV - minV) * (1 - i / 4);
    ctx.fillText(val.toFixed(0), pad.left - 4, pad.top + (h - pad.top - pad.bottom) * i / 4 + 4);
  }
  ctx.textAlign = 'center';
  ctx.fillText('0', pad.left, h - 8);
  ctx.fillText((maxT * 1000).toFixed(0) + 'ms', w - pad.right, h - 8);

  ctx.save();
  ctx.translate(14, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('Potenza (W / VAR)', 0, 0);
  ctx.restore();
}
