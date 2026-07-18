// Global state variables
let items = [];
let rotationAngle = 0;
let isSpinning = false;
let audioCtx = null;
let isTurbo = false;
let turboCount = 3;
let lastWinnerIndices = [];
let poppedOutSlices = [];
let currentTurboSpinIndex = 0;


// DOM Elements
const namesInput = document.getElementById('names-input');
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
const appContainer = document.querySelector('.app-container');

// Turbo Play elements
const turboToggle = document.getElementById('turbo-toggle');
const turboStepperContainer = document.getElementById('turbo-stepper-container');
const btnStepperMinus = document.getElementById('btn-stepper-minus');
const btnStepperPlus = document.getElementById('btn-stepper-plus');
const stepperValue = document.getElementById('stepper-value');

// Sample names list
const defaultNames = [
  "Alice",
  "Bob",
  "Charlie",
  "David",
  "Emily",
  "Frank",
  "Grace",
  "Henry",
  "Isabella",
  "Jack"
];

// Audio synthesizer for Apple Watch style crown haptic tick sound
function playTickSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    
    osc.type = 'sine';
    // Very high, crisp frequency haptic tick
    osc.frequency.setValueAtTime(1600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.012);
    
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1000, audioCtx.currentTime);
    
    gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.012);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.015);
  } catch (e) {
    // Audio context not allowed or failed, ignore
  }
}

// Apple Pay style dual chime win sound
function playSuccessSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    const now = audioCtx.currentTime;
    
    // First chime (C6, 1046.50Hz)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1046.50, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.16);
    
    // Second chime (E6, 1318.51Hz), starting 80ms later
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.51, now + 0.08);
    gain2.gain.setValueAtTime(0.12, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.08 + 0.3);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.08 + 0.32);
    
  } catch (e) {
    // Audio context not allowed or failed, ignore
  }
}

// Custom HSL colors for slices based on index and total
function getSliceColor(index, total) {
  // Use a nice spaced out HSL palette to ensure vibrant colors
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

// Clean cheat character for visual rendering (no prefix check is needed now)
function cleanName(name) {
  return name;
}

// Check if name is a cheat name (no prefix check is needed now)
function isCheatName(name) {
  return false;
}

// Draw the wheel onto the canvas
function drawWheel() {
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) - 15;

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  const list = getNamesList();
  if (list.length === 0) {
    // Draw placeholder
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    const placeholderGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    placeholderGrad.addColorStop(0, '#1d173e');
    placeholderGrad.addColorStop(1, '#0b0816');
    ctx.fillStyle = placeholderGrad;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'var(--panel-border)';
    ctx.stroke();

    ctx.fillStyle = 'var(--text-secondary)';
    ctx.font = "bold 20px 'Outfit'";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText("Enter names in the sidebar", cx, cy);
    return;
  }

  const arc = (2 * Math.PI) / list.length;

  for (let i = 0; i < list.length; i++) {
    const angle = rotationAngle + i * arc;
    const isPopped = poppedOutSlices.includes(i);
    
    // Calculate slice center angle
    const midAngle = angle + arc / 2;
    
    // Shift center coordinate if popped out
    const shiftDistance = isPopped ? 18 : 0;
    const scx = cx + Math.cos(midAngle) * shiftDistance;
    const scy = cy + Math.sin(midAngle) * shiftDistance;
    
    // Draw slice
    ctx.beginPath();
    ctx.moveTo(scx, scy);
    ctx.arc(scx, scy, radius, angle, angle + arc);
    ctx.closePath();
    
    if (isPopped) {
      // Golden gradient fill
      const grad = ctx.createRadialGradient(scx, scy, 0, scx, scy, radius);
      grad.addColorStop(0, '#ffe066');
      grad.addColorStop(1, '#ffd60a');
      ctx.fillStyle = grad;
    } else {
      // Custom HSL radial gradient to make the wheel look glowing and three-dimensional
      const hue = (i * (360 / list.length)) % 360;
      const grad = ctx.createRadialGradient(scx, scy, radius * 0.1, scx, scy, radius);
      grad.addColorStop(0, `hsl(${hue}, 88%, 62%)`);
      grad.addColorStop(1, `hsl(${hue}, 76%, 42%)`);
      ctx.fillStyle = grad;
    }
    ctx.fill();
    
    // Slice border lines
    ctx.lineWidth = isPopped ? 3 : 2;
    ctx.strokeStyle = isPopped ? '#ffffff' : 'rgba(10, 8, 19, 0.4)';
    ctx.stroke();

    // Draw text
    ctx.save();
    ctx.translate(scx, scy);
    // Rotate text to the center of the slice
    ctx.rotate(angle + arc / 2);
    
    ctx.fillStyle = isPopped ? '#000000' : '#ffffff';
    // Scale text font size based on slice count
    let fontSize = 20;
    if (list.length > 20) fontSize = 12;
    else if (list.length > 12) fontSize = 15;

    ctx.font = `bold ${fontSize}px 'Outfit'`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    // Shadow effect for text readability (only for normal white text)
    if (!isPopped) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;
    }

    // Draw name
    const displayName = cleanName(list[i]);
    const maxTextWidth = radius * 0.7;
    
    // Truncate name if it's too long
    let text = displayName;
    if (ctx.measureText(text).width > maxTextWidth) {
      while (ctx.measureText(text + "...").width > maxTextWidth && text.length > 0) {
        text = text.slice(0, -1);
      }
      text += "...";
    }

    ctx.fillText(text, radius - 30, 0);
    ctx.restore();
  }

  // Draw outer glowing rim
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#b185ff';
  ctx.stroke();
}

// Handle wheel ticking sounds
let lastSoundSlice = -1;
function checkTick(currentRotation, totalSlices) {
  if (totalSlices <= 0) return;
  const arc = (2 * Math.PI) / totalSlices;
  
  // Calculate which slice is currently under the pointer at 12 o'clock (1.5 * Math.PI or -Math.PI/2)
  // Pointer is static at the top. The wheel rotates clockwise.
  // The relative angle of the pointer on the rotating wheel is (1.5 * Math.PI - currentRotation) mod 2π
  const pointerAngleOnWheel = (1.5 * Math.PI - currentRotation) % (2 * Math.PI);
  const normalizedAngle = pointerAngleOnWheel < 0 ? pointerAngleOnWheel + 2 * Math.PI : pointerAngleOnWheel;
  const currentSlice = Math.floor(normalizedAngle / arc);

  if (currentSlice !== lastSoundSlice) {
    playTickSound();
    lastSoundSlice = currentSlice;
  }
}

// Generate simple visual CSS confetti particles
function launchConfetti() {
  confettiContainer.innerHTML = '';
  const colors = ['#b185ff', '#00f2fe', '#ff4a83', '#ffff00', '#ff00ff', '#00ffff'];
  const particleCount = 100;

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
    
    // Animate falling
    const duration = Math.random() * 2 + 2; // 2-4 seconds
    const delay = Math.random() * 0.5;
    p.style.transition = `transform ${duration}s linear ${delay}s, top ${duration}s linear ${delay}s, opacity ${duration}s ease-out ${delay}s`;
    
    confettiContainer.appendChild(p);

    // Force reflow and apply translation to trigger CSS transition
    setTimeout(() => {
      p.style.top = '110%';
      p.style.transform = `translate3d(${Math.random() * 100 - 50}px, 0, 0) rotate(${Math.random() * 720}deg)`;
      p.style.opacity = '0';
    }, 50);
  }
}

// Easing function for smooth deceleration (cubic ease-out)
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Main spin animation
let lastWinnerIndex = -1;

function spinWheel() {
  if (isSpinning) return;

  const list = getNamesList();
  if (list.length === 0) {
    alert("Please enter names to spin!");
    return;
  }

  isSpinning = true;
  spinButton.disabled = true;
  poppedOutSlices = [];
  currentTurboSpinIndex = 0;

  // 1. Identify Target Winner Indices (100% random, supports turbo)
  if (isTurbo) {
    const targetIndices = [];
    const availableIndices = Array.from({ length: list.length }, (_, idx) => idx);
    const countToPick = Math.min(turboCount, list.length);
    for (let idx = 0; idx < countToPick; idx++) {
      const randIdx = Math.floor(Math.random() * availableIndices.length);
      targetIndices.push(availableIndices.splice(randIdx, 1)[0]);
    }
    lastWinnerIndices = targetIndices;
  } else {
    const targetIndex = Math.floor(Math.random() * list.length);
    lastWinnerIndices = [targetIndex];
  }

  // Start the sequential spins
  runSpinSequence();
}

function runSpinSequence() {
  const list = getNamesList();
  const targetIndex = lastWinnerIndices[currentTurboSpinIndex];
  lastWinnerIndex = targetIndex;

  // 2. Calculate stopping angle
  const arc = (2 * Math.PI) / list.length;
  const randomOffsetInSlice = (Math.random() * 0.6 + 0.2) * arc; // target between 20% and 80% of slice width
  
  const targetAngle = (1.5 * Math.PI - (targetIndex * arc + randomOffsetInSlice)) % (2 * Math.PI);
  const normalizedTargetAngle = targetAngle < 0 ? targetAngle + 2 * Math.PI : targetAngle;
  
  // Choose random number of rotations (3 to 5 full spins for subsequent draws to be faster and exciting!)
  const fullSpins = currentTurboSpinIndex === 0 ? 4 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2);
  const startAngle = rotationAngle;
  const finalAngle = rotationAngle + (fullSpins * 2 * Math.PI) + (normalizedTargetAngle - (rotationAngle % (2 * Math.PI)));
  const angleDelta = finalAngle - startAngle;

  // 3. Perform Animation Loop (Slightly faster for subsequent spins)
  const duration = currentTurboSpinIndex === 0 ? 4000 : 2500;
  const startTime = performance.now();

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Apply easing
    const easedProgress = easeOutCubic(progress);
    rotationAngle = startAngle + angleDelta * easedProgress;

    // Draw and tick sound
    drawWheel();
    checkTick(rotationAngle, list.length);

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Completed current spin!
      rotationAngle = rotationAngle % (2 * Math.PI);
      
      // Make this wedge pop out and turn gold
      poppedOutSlices.push(targetIndex);
      drawWheel();
      
      // Play tick sound to acknowledge landing haptic
      playTickSound();

      currentTurboSpinIndex++;
      if (currentTurboSpinIndex < lastWinnerIndices.length) {
        // Pause shortly then spin to the next winner
        setTimeout(runSpinSequence, 800);
      } else {
        // Finished all spins! Wait a brief moment to showcase the gold wedges then announce
        setTimeout(() => {
          isSpinning = false;
          spinButton.disabled = false;
          announceWinner(list[lastWinnerIndex]);
        }, 800);
      }
    }
  }

  requestAnimationFrame(animate);
}

// Show the winner popup
function announceWinner(rawName) {
  const list = getNamesList();
  if (isTurbo && lastWinnerIndices.length > 1) {
    const winnerNames = lastWinnerIndices.map(idx => cleanName(list[idx]));
    winnerNameEl.innerHTML = `<ol style="text-align: left; margin: 15px auto; padding: 0 0 0 24px; display: inline-block; font-size: 1.15rem; line-height: 1.6; color: #ffffff;">` +
      winnerNames.map(name => `<li>${name}</li>`).join('') +
      `</ol>`;
  } else {
    winnerNameEl.textContent = cleanName(rawName);
  }
  winnerModal.classList.remove('hidden');
  launchConfetti();
  playSuccessSound();
}

// Remove winner from the list
function removeWinner() {
  if (lastWinnerIndices.length === 0) return;
  
  const list = getNamesList();
  const sortedIndices = [...lastWinnerIndices].sort((a, b) => b - a);
  sortedIndices.forEach(idx => {
    if (idx >= 0 && idx < list.length) {
      list.splice(idx, 1);
    }
  });
  
  namesInput.value = list.join('\n');
  saveNamesToStorage();
  drawWheel();
  closeModal();
}

// Close the winner modal
function closeModal() {
  winnerModal.classList.add('hidden');
  lastWinnerIndex = -1;
  lastWinnerIndices = [];
}

// Save input list to local storage
function saveNamesToStorage() {
  localStorage.setItem('wheel_names', namesInput.value);
  localStorage.setItem('wheel_is_turbo', isTurbo ? '1' : '0');
  localStorage.setItem('wheel_turbo_count', turboCount);
}

// Load input list from local storage or set defaults
function loadNamesFromStorage() {
  const stored = localStorage.getItem('wheel_names');
  if (stored !== null) {
    namesInput.value = stored;
  } else {
    namesInput.value = defaultNames.join('\n');
  }

  isTurbo = localStorage.getItem('wheel_is_turbo') === '1';
  turboCount = parseInt(localStorage.getItem('wheel_turbo_count') || '3', 10);

  // Sync controls UI
  if (turboToggle) {
    turboToggle.checked = isTurbo;
  }
  if (turboStepperContainer) {
    if (isTurbo) {
      turboStepperContainer.classList.remove('hidden');
    } else {
      turboStepperContainer.classList.add('hidden');
    }
  }
  if (stepperValue) {
    stepperValue.textContent = turboCount;
  }

  drawWheel();
}

// Initialize Event Listeners
function init() {
  loadNamesFromStorage();

  // Listeners for inputs
  namesInput.addEventListener('input', () => {
    saveNamesToStorage();
    drawWheel();
  });

  // Action buttons
  btnShuffle.addEventListener('click', () => {
    const list = getNamesList();
    if (list.length === 0) return;
    
    // Fisher-Yates Shuffle
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    
    namesInput.value = list.join('\n');
    saveNamesToStorage();
    drawWheel();
  });

  btnClear.addEventListener('click', () => {
    namesInput.value = '';
    saveNamesToStorage();
    drawWheel();
  });

  btnSample.addEventListener('click', () => {
    namesInput.value = defaultNames.join('\n');
    saveNamesToStorage();
    drawWheel();
  });

  // Turbo Play control listeners
  if (turboToggle) {
    turboToggle.addEventListener('change', () => {
      isTurbo = turboToggle.checked;
      if (isTurbo) {
        turboStepperContainer.classList.remove('hidden');
      } else {
        turboStepperContainer.classList.add('hidden');
      }
      saveNamesToStorage();
    });
  }

  if (btnStepperMinus) {
    btnStepperMinus.addEventListener('click', () => {
      if (turboCount > 1) {
        turboCount--;
        stepperValue.textContent = turboCount;
        saveNamesToStorage();
      }
    });
  }

  if (btnStepperPlus) {
    btnStepperPlus.addEventListener('click', () => {
      const maxCount = Math.max(1, getNamesList().length);
      if (turboCount < maxCount) {
        turboCount++;
        stepperValue.textContent = turboCount;
        saveNamesToStorage();
      }
    });
  }

  // Spin control
  spinButton.addEventListener('click', () => {
    // Initialize or resume audio context synchronously within user gesture callback
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    spinWheel();
  });

  // Modal actions
  btnRemoveWinner.addEventListener('click', removeWinner);
  btnKeepWinner.addEventListener('click', closeModal);

  // Sidebar toggle collapse
  btnSidebarToggle.addEventListener('click', () => {
    const isCollapsed = sidebarPanel.classList.toggle('collapsed');
    appContainer.classList.toggle('sidebar-collapsed');
    btnSidebarToggle.textContent = isCollapsed ? '▶' : '◀';
    
    // Redraw wheel to fit new available screen layout
    setTimeout(drawWheel, 310);
  });

  // No hide names checkbox listener

  // Redraw canvas on window resize to ensure correct bounds scaling
  window.addEventListener('resize', () => {
    // Drawing handles pixel layouts correctly
    drawWheel();
  });
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', init);
