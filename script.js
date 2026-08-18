'use strict';

/* ---------------- Global state ---------------- */
let rotationAngle = 0;
let isSpinning = false;
let audioCtx = null;
let isTurbo = false;
let turboCount = 3;
let lastWinnerIndices = [];
let lastWinnerIndex = -1;
let poppedOutSlices = [];
let currentTurboSpinIndex = 0;
// Snapshot of the names taken when a spin starts. Winners are tracked by index,
// so the list must not shift underneath the animation.
let spinList = null;
let lastFocusedBeforeModal = null;

/* ---------------- DOM Elements ---------------- */
const namesInput = document.getElementById('names-input');
const namesCount = document.getElementById('names-count');
const btnShuffle = document.getElementById('btn-shuffle');
const btnClear = document.getElementById('btn-clear');
const btnSample = document.getElementById('btn-sample');
const spinButton = document.getElementById('spin-button');
const canvas = document.getElementById('wheel-canvas');
const ctx = canvas.getContext('2d');
const winnerModal = document.getElementById('winner-modal');
const winnerNameEl = document.getElementById('winner-name');
const btnRemoveWinner = document.getElementById('btn-remove-winner');
const btnKeepWinner = document.getElementById('btn-keep-winner');
const confettiContainer = document.getElementById('confetti-container');
const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');
const sidebarPanel = document.getElementById('sidebar-panel');

/* Turbo Play elements */
const turboToggle = document.getElementById('turbo-toggle');
const turboStepperContainer = document.getElementById('turbo-stepper-container');
const btnStepperMinus = document.getElementById('btn-stepper-minus');
const btnStepperPlus = document.getElementById('btn-stepper-plus');
const stepperValue = document.getElementById('stepper-value');

/* Sample names list */
const defaultNames = [
  "Alice", "Bob", "Charlie", "David", "Emily",
  "Frank", "Grace", "Henry", "Isabella", "Jack"
];

const prefersReducedMotion = typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- Theme bridge ----------------
   Canvas fillStyle/strokeStyle cannot resolve CSS var() — assigning
   "var(--x)" is silently ignored and the previous style stays in effect.
   Resolve the custom properties through the cascade instead. */
function themeColor(name, fallback) {
  let value = '';
  try {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch (e) { /* non-browser test harness */ }
  return value || fallback;
}

function currentScheme() {
  return (typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

let palette = null;
let paletteScheme = null;

// Re-reading eight custom properties every animation frame would be wasteful,
// but a cache that never expires leaves the wheel painted in the old theme
// after a light/dark switch. Key the cache on the scheme instead of trusting a
// change event to arrive.
function getPalette() {
  const scheme = currentScheme();
  if (palette && paletteScheme === scheme) return palette;

  palette = {
    rim: themeColor('--wheel-rim', '#c9c9c9'),
    placeholderInner: themeColor('--wheel-placeholder-inner', '#f7f7f7'),
    placeholderOuter: themeColor('--wheel-placeholder-outer', '#e9e9e9'),
    divider: themeColor('--wheel-slice-divider', 'rgba(255, 255, 255, 0.7)'),
    goldLight: themeColor('--wheel-gold-light', '#ffe066'),
    gold: themeColor('--wheel-gold', '#f5b800'),
    border: themeColor('--input-border', '#c3c3c3'),
    muted: themeColor('--text-muted', '#888888')
  };
  paletteScheme = scheme;
  return palette;
}

/* ---------------- Audio ---------------- */
function ensureAudioContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Apple Watch style crown haptic tick
let lastTickTime = 0;
function playTickSound() {
  try {
    const ac = ensureAudioContext();
    if (!ac) return;

    // A fast wheel with many slices can request ticks faster than they are
    // audible; throttling keeps it from stacking dozens of oscillators.
    if (ac.currentTime - lastTickTime < 0.022) return;
    lastTickTime = ac.currentTime;

    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const filter = ac.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1600, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, ac.currentTime + 0.012);

    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1000, ac.currentTime);

    gain.gain.setValueAtTime(0.06, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.012);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);

    osc.start();
    osc.stop(ac.currentTime + 0.015);
  } catch (e) {
    // Audio blocked or unavailable — the wheel still works silently.
  }
}

// Apple Pay style dual chime win sound
function playSuccessSound() {
  try {
    const ac = ensureAudioContext();
    if (!ac) return;
    const now = ac.currentTime;

    [[1046.50, 0, 0.15], [1318.51, 0.08, 0.3]].forEach(([freq, offset, decay]) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.12, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + decay);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(now + offset);
      osc.stop(now + offset + decay + 0.02);
    });
  } catch (e) {
    // Audio blocked or unavailable.
  }
}

/* ---------------- Names ---------------- */

// Custom HSL colors for slices based on index and total
function getSliceColor(index, total) {
  const hue = (index * (360 / total)) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

// Parse text input to names list
function getNamesList() {
  return namesInput.value
    .split('\n')
    .map(name => name.trim())
    .filter(name => name.length > 0);
}

// The list the wheel should currently render: frozen mid-spin, live otherwise.
function activeList() {
  return spinList || getNamesList();
}

function cleanName(name) {
  return name;
}

function isCheatName(name) {
  return false;
}

/* ---------------- Canvas sizing ---------------- */

// Match the backing store to the CSS box times the device pixel ratio so the
// wheel stays sharp on retina screens and after the sidebar collapses.
function resizeCanvas() {
  if (typeof canvas.getBoundingClientRect !== 'function') return false;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return false;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.max(1, Math.round(rect.width * dpr));
  if (canvas.width === size && canvas.height === size) return false;

  canvas.width = size;
  canvas.height = size;
  return true;
}

/* ---------------- Rendering ---------------- */
function drawWheel() {
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  // Every hard-coded size below was tuned against an 800px canvas; scale keeps
  // the proportions identical at any backing-store resolution.
  const scale = width / 800;
  const radius = Math.min(cx, cy) - 15 * scale;

  ctx.clearRect(0, 0, width, height);

  const list = activeList();
  const theme = getPalette();

  if (list.length === 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    const placeholderGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    placeholderGrad.addColorStop(0, theme.placeholderInner);
    placeholderGrad.addColorStop(1, theme.placeholderOuter);
    ctx.fillStyle = placeholderGrad;
    ctx.fill();
    ctx.lineWidth = 4 * scale;
    ctx.strokeStyle = theme.border;
    ctx.stroke();

    ctx.fillStyle = theme.muted;
    ctx.font = `bold ${Math.round(22 * scale)}px 'Outfit', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Add names to spin', cx, cy);
    return;
  }

  const arc = (2 * Math.PI) / list.length;

  for (let i = 0; i < list.length; i++) {
    const angle = rotationAngle + i * arc;
    const isPopped = poppedOutSlices.includes(i);
    const midAngle = angle + arc / 2;

    const shiftDistance = isPopped ? 18 * scale : 0;
    const scx = cx + Math.cos(midAngle) * shiftDistance;
    const scy = cy + Math.sin(midAngle) * shiftDistance;

    ctx.beginPath();
    ctx.moveTo(scx, scy);
    ctx.arc(scx, scy, radius, angle, angle + arc);
    ctx.closePath();

    if (isPopped) {
      const grad = ctx.createRadialGradient(scx, scy, 0, scx, scy, radius);
      grad.addColorStop(0, theme.goldLight);
      grad.addColorStop(1, theme.gold);
      ctx.fillStyle = grad;
    } else {
      const hue = (i * (360 / list.length)) % 360;
      const grad = ctx.createRadialGradient(scx, scy, radius * 0.1, scx, scy, radius);
      grad.addColorStop(0, `hsl(${hue}, 88%, 62%)`);
      grad.addColorStop(1, `hsl(${hue}, 76%, 42%)`);
      ctx.fillStyle = grad;
    }
    ctx.fill();

    ctx.lineWidth = (isPopped ? 3 : 2) * scale;
    ctx.strokeStyle = isPopped ? '#ffffff' : theme.divider;
    ctx.stroke();

    /* Slice label */
    ctx.save();
    ctx.translate(scx, scy);
    ctx.rotate(midAngle);

    ctx.fillStyle = isPopped ? '#000000' : '#ffffff';

    let fontSize = 20;
    if (list.length > 20) fontSize = 12;
    else if (list.length > 12) fontSize = 15;
    ctx.font = `bold ${Math.max(8, Math.round(fontSize * scale))}px 'Outfit', sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    if (!isPopped) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 4 * scale;
      ctx.shadowOffsetX = 1 * scale;
      ctx.shadowOffsetY = 1 * scale;
    }

    let text = cleanName(list[i]);
    const maxTextWidth = radius * 0.7;
    if (ctx.measureText(text).width > maxTextWidth) {
      while (text.length > 0 && ctx.measureText(text + '…').width > maxTextWidth) {
        text = text.slice(0, -1);
      }
      text += '…';
    }

    ctx.fillText(text, radius - 30 * scale, 0);
    ctx.restore();
  }

  /* Outer glowing rim */
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.lineWidth = 6 * scale;
  ctx.strokeStyle = theme.rim;
  ctx.stroke();
}

function render() {
  resizeCanvas();
  drawWheel();
}

/* ---------------- Tick sounds ---------------- */
let lastSoundSlice = -1;
function checkTick(currentRotation, totalSlices) {
  if (totalSlices <= 0) return;
  const arc = (2 * Math.PI) / totalSlices;

  // The pointer is fixed at 12 o'clock (canvas angle 1.5π). Its position on the
  // rotating wheel is (1.5π − rotation) mod 2π.
  const pointerAngleOnWheel = (1.5 * Math.PI - currentRotation) % (2 * Math.PI);
  const normalizedAngle = pointerAngleOnWheel < 0 ? pointerAngleOnWheel + 2 * Math.PI : pointerAngleOnWheel;
  const currentSlice = Math.floor(normalizedAngle / arc);

  if (currentSlice !== lastSoundSlice) {
    playTickSound();
    lastSoundSlice = currentSlice;
  }
}

/* ---------------- Confetti ---------------- */
function launchConfetti() {
  if (prefersReducedMotion) return;

  confettiContainer.replaceChildren();
  const colors = ['#007af5', '#34c759', '#ff9500', '#ff375f', '#af52de', '#ffd60a'];
  const particleCount = 100;
  const created = [];

  for (let i = 0; i < particleCount; i++) {
    const p = document.createElement('div');
    p.style.position = 'absolute';
    p.style.width = Math.random() * 8 + 4 + 'px';
    p.style.height = Math.random() * 12 + 6 + 'px';
    p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    p.style.left = Math.random() * 100 + '%';
    p.style.top = '-20px';
    p.style.opacity = Math.random() * 0.5 + 0.5;
    p.style.borderRadius = '2px';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;

    const duration = Math.random() * 2 + 2;
    const delay = Math.random() * 0.5;
    p.style.transition = `transform ${duration}s linear ${delay}s, top ${duration}s linear ${delay}s, opacity ${duration}s ease-out ${delay}s`;

    confettiContainer.appendChild(p);
    created.push(p);
  }

  requestAnimationFrame(() => {
    created.forEach(p => {
      p.style.top = '110%';
      p.style.transform = `translate3d(${Math.random() * 100 - 50}px, 0, 0) rotate(${Math.random() * 720}deg)`;
      p.style.opacity = '0';
    });
  });

  // Leaving 100 nodes in the DOM after every spin adds up over a long session.
  setTimeout(() => confettiContainer.replaceChildren(), 5000);
}

/* ---------------- Spin ---------------- */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function setControlsDisabled(disabled) {
  spinButton.disabled = disabled;
  namesInput.disabled = disabled;
  [btnShuffle, btnClear, btnSample, turboToggle, btnStepperMinus, btnStepperPlus]
    .forEach(el => { if (el) el.disabled = disabled; });
  if (!disabled) updateStepperState();
}

function spinWheel() {
  if (isSpinning) return;

  const list = getNamesList();
  if (list.length === 0) {
    // Nagging about empty names is useless if the panel that holds them is
    // folded away, which is the default on a phone.
    expandSidebar();
    namesInput.focus();
    return;
  }

  isSpinning = true;
  spinList = list;
  poppedOutSlices = [];
  currentTurboSpinIndex = 0;
  lastSoundSlice = -1;
  setControlsDisabled(true);

  // Pick the winning indices up front (uniform random, no weighting).
  if (isTurbo) {
    const available = Array.from({ length: list.length }, (_, idx) => idx);
    const countToPick = Math.min(turboCount, list.length);
    const targets = [];
    for (let i = 0; i < countToPick; i++) {
      targets.push(available.splice(Math.floor(Math.random() * available.length), 1)[0]);
    }
    lastWinnerIndices = targets;
  } else {
    lastWinnerIndices = [Math.floor(Math.random() * list.length)];
  }

  runSpinSequence();
}

function runSpinSequence() {
  const list = spinList;
  const targetIndex = lastWinnerIndices[currentTurboSpinIndex];
  lastWinnerIndex = targetIndex;

  const arc = (2 * Math.PI) / list.length;
  const randomOffsetInSlice = (Math.random() * 0.6 + 0.2) * arc;   // land 20–80% into the slice

  const rawTarget = (1.5 * Math.PI - (targetIndex * arc + randomOffsetInSlice)) % (2 * Math.PI);
  const normalizedTargetAngle = rawTarget < 0 ? rawTarget + 2 * Math.PI : rawTarget;

  const fullSpins = currentTurboSpinIndex === 0
    ? 4 + Math.floor(Math.random() * 3)
    : 2 + Math.floor(Math.random() * 2);

  const startAngle = rotationAngle;
  // Keep the partial turn positive so the wheel always completes at least
  // `fullSpins` revolutions rather than shaving one off.
  let partialTurn = normalizedTargetAngle - (rotationAngle % (2 * Math.PI));
  if (partialTurn < 0) partialTurn += 2 * Math.PI;
  const angleDelta = fullSpins * 2 * Math.PI + partialTurn;

  const duration = currentTurboSpinIndex === 0 ? 4000 : 2500;
  const startTime = performance.now();

  function animate(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    rotationAngle = startAngle + angleDelta * easeOutCubic(progress);

    drawWheel();
    checkTick(rotationAngle, list.length);

    if (progress < 1) {
      requestAnimationFrame(animate);
      return;
    }

    rotationAngle = rotationAngle % (2 * Math.PI);
    poppedOutSlices.push(targetIndex);
    drawWheel();
    playTickSound();

    currentTurboSpinIndex++;
    if (currentTurboSpinIndex < lastWinnerIndices.length) {
      setTimeout(runSpinSequence, 800);
    } else {
      setTimeout(() => {
        isSpinning = false;
        setControlsDisabled(false);
        announceWinner(list[lastWinnerIndex]);
      }, 800);
    }
  }

  requestAnimationFrame(animate);
}

/* ---------------- Winner modal ---------------- */
function announceWinner(rawName) {
  const list = spinList || getNamesList();

  // Built as DOM nodes rather than an innerHTML string: names are free text and
  // "<img onerror=…>" is a perfectly legal thing to type into the box.
  if (isTurbo && lastWinnerIndices.length > 1) {
    const ol = document.createElement('ol');
    ol.className = 'winner-list';
    lastWinnerIndices.forEach(idx => {
      const li = document.createElement('li');
      li.textContent = cleanName(list[idx]);
      ol.appendChild(li);
    });
    winnerNameEl.replaceChildren(ol);
  } else {
    winnerNameEl.textContent = cleanName(rawName);
  }

  lastFocusedBeforeModal = document.activeElement;
  winnerModal.classList.remove('hidden');
  btnKeepWinner.focus();
  launchConfetti();
  playSuccessSound();
}

function removeWinner() {
  if (lastWinnerIndices.length === 0) return;

  const list = spinList || getNamesList();
  // Descending so each splice cannot shift the indices still to be removed.
  [...lastWinnerIndices].sort((a, b) => b - a).forEach(idx => {
    if (idx >= 0 && idx < list.length) list.splice(idx, 1);
  });

  namesInput.value = list.join('\n');
  saveNamesToStorage();
  closeModal();
  spinList = null;
  poppedOutSlices = [];
  updateNamesMeta();
  render();
}

function closeModal() {
  winnerModal.classList.add('hidden');
  lastWinnerIndex = -1;
  lastWinnerIndices = [];
  spinList = null;
  if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
    lastFocusedBeforeModal.focus();
  }
  lastFocusedBeforeModal = null;
}

function isModalOpen() {
  return !winnerModal.classList.contains('hidden');
}

/* ---------------- Sidebar ---------------- */
function setSidebarCollapsed(collapsed) {
  sidebarPanel.classList.toggle('collapsed', collapsed);
  btnSidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  // Wait out the slide transition before re-measuring the canvas.
  setTimeout(render, 320);
}

function expandSidebar() {
  if (sidebarPanel.classList.contains('collapsed')) setSidebarCollapsed(false);
}

/* ---------------- Turbo stepper ---------------- */
function updateStepperState() {
  const max = Math.max(1, getNamesList().length);
  if (turboCount > max) turboCount = max;
  if (turboCount < 1) turboCount = 1;
  stepperValue.textContent = turboCount;
  if (!isSpinning) {
    btnStepperMinus.disabled = turboCount <= 1;
    btnStepperPlus.disabled = turboCount >= max;
  }
}

function updateNamesMeta() {
  const n = getNamesList().length;
  namesCount.textContent = n === 0 ? 'No names yet' : n + (n === 1 ? ' name' : ' names');
  updateStepperState();
}

/* ---------------- Persistence ---------------- */
function saveNamesToStorage() {
  try {
    localStorage.setItem('wheel_names', namesInput.value);
    localStorage.setItem('wheel_is_turbo', isTurbo ? '1' : '0');
    localStorage.setItem('wheel_turbo_count', String(turboCount));
  } catch (e) {
    // Private browsing / storage disabled — the app still works for this session.
  }
}

function loadNamesFromStorage() {
  let stored = null;
  try {
    stored = localStorage.getItem('wheel_names');
    isTurbo = localStorage.getItem('wheel_is_turbo') === '1';
    turboCount = parseInt(localStorage.getItem('wheel_turbo_count') || '3', 10) || 3;
  } catch (e) {
    isTurbo = false;
    turboCount = 3;
  }

  namesInput.value = stored !== null ? stored : defaultNames.join('\n');

  turboToggle.checked = isTurbo;
  turboStepperContainer.classList.toggle('hidden', !isTurbo);
  updateNamesMeta();
}

/* ---------------- Init ---------------- */
function init() {
  loadNamesFromStorage();
  render();

  // The slice labels are drawn in Outfit; if it arrives after first paint the
  // canvas keeps the fallback metrics until something forces a redraw.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(render).catch(() => {});
  }

  namesInput.addEventListener('input', () => {
    saveNamesToStorage();
    updateNamesMeta();
    drawWheel();
  });

  btnShuffle.addEventListener('click', () => {
    const list = getNamesList();
    if (list.length === 0) return;
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    namesInput.value = list.join('\n');
    saveNamesToStorage();
    updateNamesMeta();
    drawWheel();
  });

  btnClear.addEventListener('click', () => {
    namesInput.value = '';
    poppedOutSlices = [];
    saveNamesToStorage();
    updateNamesMeta();
    drawWheel();
  });

  btnSample.addEventListener('click', () => {
    namesInput.value = defaultNames.join('\n');
    poppedOutSlices = [];
    saveNamesToStorage();
    updateNamesMeta();
    drawWheel();
  });

  turboToggle.addEventListener('change', () => {
    isTurbo = turboToggle.checked;
    turboStepperContainer.classList.toggle('hidden', !isTurbo);
    updateStepperState();
    saveNamesToStorage();
  });

  btnStepperMinus.addEventListener('click', () => {
    turboCount--;
    updateStepperState();
    saveNamesToStorage();
  });

  btnStepperPlus.addEventListener('click', () => {
    turboCount++;
    updateStepperState();
    saveNamesToStorage();
  });

  spinButton.addEventListener('click', () => {
    // Must happen inside the user gesture or iOS keeps the context suspended.
    ensureAudioContext();
    spinWheel();
  });

  btnRemoveWinner.addEventListener('click', removeWinner);
  btnKeepWinner.addEventListener('click', closeModal);

  // A modal you can only leave via two specific buttons is a trap on a phone
  // where those buttons can end up below the fold.
  winnerModal.addEventListener('click', (event) => {
    if (event.target === winnerModal) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isModalOpen()) closeModal();
  });

  btnSidebarToggle.addEventListener('click', () => {
    setSidebarCollapsed(!sidebarPanel.classList.contains('collapsed'));
  });

  // ResizeObserver catches viewport changes, orientation flips, sidebar
  // collapses and the mobile URL bar sliding away — a resize listener misses
  // the last two.
  if (typeof ResizeObserver === 'function') {
    let frame = null;
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    });
    observer.observe(canvas.parentElement || canvas);
  } else {
    window.addEventListener('resize', render);
  }

  window.addEventListener('orientationchange', () => setTimeout(render, 250));

  // getPalette() already notices a scheme flip on its next call; this just
  // repaints an idle wheel immediately instead of at the next draw.
  if (typeof window.matchMedia === 'function') {
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onSchemeChange = () => render();
    if (scheme.addEventListener) scheme.addEventListener('change', onSchemeChange);
    else if (scheme.addListener) scheme.addListener(onSchemeChange);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
