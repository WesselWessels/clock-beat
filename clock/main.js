let audioContext;
let analyser;
let microphone;
let animationId;
let running = false;
let lastPeakTime = 0;
let peakTimes = [];
let lastPeakValue = 0;
let waveformBuffer = [];
let waveformWritePos = 0;
const waveformHistorySeconds = 4; // Show last 4 seconds
let sweepBuffer = [];
let sweepPos = 0;
let sweepBufferSize = 0;
let paused = false;
let peakIndices = [];
let threshold = 0.2;
let peakCircles = [];
let lastAboveThreshold = false;
let aboveThresholdBuffer = [];
let lastDetectionIdx = -1000;
let lastSweepPos = 0;
let minDistancePx = 20;
let lastPeakTimestamp = 0;

const startStopBtn = document.getElementById('startStopBtn');
const audioCanvas = document.getElementById('audioCanvas');
const intervalsDiv = document.getElementById('intervals');
const analysisDiv = document.getElementById('analysis');
const canvasCtx = audioCanvas.getContext('2d');
const evennessCanvas = document.getElementById('evennessIndicator');
const evennessCtx = evennessCanvas.getContext('2d');
const evennessLabel = document.getElementById('evennessLabel');
const pauseBtn = document.getElementById('pauseBtn');

const thresholdSlider = document.getElementById('thresholdSlider');
const thresholdValue = document.getElementById('thresholdValue');
thresholdSlider.addEventListener('input', () => {
  threshold = parseFloat(thresholdSlider.value);
  thresholdValue.textContent = threshold.toFixed(2);
  console.log('[Threshold] New threshold:', threshold);
});

const widthSlider = document.getElementById('widthSlider');
const widthValue = document.getElementById('widthValue');
widthSlider.addEventListener('input', () => {
  minDistancePx = parseInt(widthSlider.value, 10);
  widthValue.textContent = minDistancePx;
  console.log('[Width] minDistancePx set to:', minDistancePx);
});

startStopBtn.addEventListener('click', () => {
  if (!running) {
    startAudio();
  } else {
    stopAudio();
  }
});

pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  if (!paused) {
    draw();
  }
});

async function startAudio() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphone = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    microphone.connect(analyser);
    running = true;
    startStopBtn.textContent = 'Stop';
    peakTimes = [];
    lastPeakTime = 0;
    lastPeakValue = 0;
    // Circular buffer setup
    const maxSamples = Math.floor(audioContext.sampleRate * waveformHistorySeconds);
    waveformBuffer = new Float32Array(maxSamples);
    waveformWritePos = 0;
    // Deterministic sweep buffer: one sample per pixel
    sweepBufferSize = audioCanvas.width;
    sweepBuffer = new Array(sweepBufferSize).fill(0);
    sweepPos = 0;
    peakIndices = [];
    peakCircles = [];
    draw();
  } catch (err) {
    alert('Microphone access denied or not available.');
  }
}

function stopAudio() {
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (animationId) {
    cancelAnimationFrame(animationId);
  }
  running = false;
  startStopBtn.textContent = 'Start';
  clearCanvas();
  intervalsDiv.textContent = '';
  analysisDiv.textContent = '';
  peakTimes = [];
  waveformBuffer = [];
  waveformWritePos = 0;
  sweepBuffer = [];
  sweepPos = 0;
  sweepBufferSize = 0;
  peakIndices = [];
  peakCircles = [];
}

function draw() {
  if (!analyser || paused) return;
  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  // Write only the latest sample to the sweep buffer
  const latest = (dataArray[bufferLength - 1] - 128) / 128;
  sweepBuffer[sweepPos] = Math.abs(latest);
  sweepPos = (sweepPos + 1) % sweepBufferSize;

  // Always clear the canvas
  canvasCtx.clearRect(0, 0, audioCanvas.width, audioCanvas.height);

  // Draw the sweep line: left = oldest, right = newest, one sample per pixel
  canvasCtx.beginPath();
  for (let x = 0; x < audioCanvas.width; x++) {
    // Map x=0 to oldest, x=width-1 to newest
    const bufferIdx = (sweepPos + 1 + x) % sweepBufferSize;
    const v = sweepBuffer[bufferIdx];
    const y = (1 - v) * audioCanvas.height;
    if (x === 0) {
      canvasCtx.moveTo(x, y);
    } else {
      canvasCtx.lineTo(x, y);
    }
  }
  canvasCtx.lineWidth = 2;
  canvasCtx.strokeStyle = '#00ff99';
  canvasCtx.stroke();

  // Draw threshold line
  drawThresholdLine();

  // Draw circles for detected peaks
  drawPeakCircles();

  // Tick/tock detection
  detectTicks(dataArray);

  animationId = requestAnimationFrame(draw);
}

function drawThresholdLine() {
  // Use the same y-mapping as the waveform (full height)
  const y = (1 - threshold) * audioCanvas.height;
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, y);
  canvasCtx.lineTo(audioCanvas.width, y);
  canvasCtx.lineWidth = 1.5;
  canvasCtx.strokeStyle = '#ff4136';
  canvasCtx.setLineDash([8, 8]);
  canvasCtx.stroke();
  canvasCtx.setLineDash([]);
}

function detectTicks(dataArray) {
  // Detect peaks only in the new samples written to sweepBuffer this frame
  const bufferLength = analyser.fftSize;
  let newSamples = [];
  // Figure out which indices in sweepBuffer were just written
  if (sweepPos >= lastSweepPos) {
    for (let i = lastSweepPos; i < sweepPos; i++) {
      newSamples.push(i);
    }
  } else {
    for (let i = lastSweepPos; i < sweepBufferSize; i++) {
      newSamples.push(i);
    }
    for (let i = 0; i < sweepPos; i++) {
      newSamples.push(i);
    }
  }
  lastSweepPos = sweepPos;

  // For each new sample, check for threshold crossing
  let lastPeakIdx = peakCircles.length > 0 ? peakCircles[peakCircles.length - 1].bufferIdx : -minDistancePx;
  for (let idx of newSamples) {
    const prevIdx = (idx - 1 + sweepBufferSize) % sweepBufferSize;
    const vPrev = sweepBuffer[prevIdx];
    const vCurr = sweepBuffer[idx];
    if (vPrev > threshold && vCurr <= threshold) {
      // Look back for local max in this segment
      let localMax = vPrev;
      let localMaxIdx = prevIdx;
      let j = prevIdx;
      while (sweepBuffer[j] > threshold) {
        if (sweepBuffer[j] > localMax) {
          localMax = sweepBuffer[j];
          localMaxIdx = j;
        }
        j = (j - 1 + sweepBufferSize) % sweepBufferSize;
        if (j === idx) break; // avoid infinite loop
      }
      // Calculate x position for this peak
      let x = (localMaxIdx - (sweepPos + 1) + sweepBufferSize) % sweepBufferSize;
      // Debounce: only register if far enough from last peak
      let distance = (localMaxIdx - lastPeakIdx + sweepBufferSize) % sweepBufferSize;
      if (distance > minDistancePx && x >= 0 && x < audioCanvas.width) {
        lastPeakIdx = localMaxIdx;
        peakCircles.push({ x, value: localMax, bufferIdx: localMaxIdx, time: audioContext.currentTime });
        if (audioContext) {
          peakTimes.push(audioContext.currentTime);
          updateIntervals();
        }
      }
    }
  }
}

function updateIntervals() {
  // Only use peaks that are still visible on the canvas
  const visiblePeaks = peakCircles
    .filter(c => c.x >= 0 && typeof c.time === 'number')
    .sort((a, b) => a.time - b.time);

  if (visiblePeaks.length < 4) {
    hideResults();
    updateEvennessIndicator(null);
    return;
  }

  // Use only the most recent 4 peaks
  const last4 = visiblePeaks.slice(-4);
  const t1 = last4[0].time;
  const t2 = last4[1].time;
  const t3 = last4[2].time;
  const t4 = last4[3].time;
  const total = (t4 - t1) * 1000;
  const tick = (t2 - t1) * 1000;
  const tock = (t4 - t3) * 1000;
  const ratio = tick / tock;

  intervalsDiv.textContent = `Tick: ${tick.toFixed(1)} ms, Tock: ${tock.toFixed(1)} ms, Total: ${total.toFixed(1)} ms`;
  analysisDiv.textContent = `Ratio (Tick/Tock): ${ratio.toFixed(3)}${Math.abs(ratio - 1) < 0.05 ? ' ✅ Good' : ''}`;
  updateEvennessIndicator(Math.abs(ratio - 1));
  lastPeakTimestamp = Date.now();
  showResults();
}

function hideResults() {
  intervalsDiv.style.visibility = 'hidden';
  analysisDiv.style.visibility = 'hidden';
}

function showResults() {
  intervalsDiv.style.visibility = 'visible';
  analysisDiv.style.visibility = 'visible';
}

// Timer to hide results if no new peaks in 2 seconds
setInterval(() => {
  if (Date.now() - lastPeakTimestamp > 2000) {
    hideResults();
  }
}, 500);

function updateEvennessIndicator(stddev) {
  // Clear
  evennessCtx.clearRect(0, 0, evennessCanvas.width, evennessCanvas.height);
  if (stddev === null || stddev === undefined) {
    evennessLabel.textContent = '';
    return;
  }
  let color = '#ccc';
  let label = '';
  if (stddev < 0.05) {
    color = '#2ecc40'; // green
    label = 'Even';
  } else if (stddev < 0.15) {
    color = '#ffdc00'; // yellow
    label = 'Slightly uneven';
  } else {
    color = '#ff4136'; // red
    label = 'Uneven';
  }
  // Draw circle
  evennessCtx.beginPath();
  evennessCtx.arc(20, 20, 16, 0, 2 * Math.PI);
  evennessCtx.fillStyle = color;
  evennessCtx.fill();
  evennessCtx.lineWidth = 2;
  evennessCtx.strokeStyle = '#888';
  evennessCtx.stroke();
  evennessLabel.textContent = label;
}

function clearCanvas() {
  canvasCtx.clearRect(0, 0, audioCanvas.width, audioCanvas.height);
}

function drawPeakCircles() {
  // Move circles left and only keep those still on screen
  peakCircles = peakCircles.filter(c => {
    c.x -= 1;
    return c.x >= 0;
  });
  for (const c of peakCircles) {
    // Always use the stored value for y position
    const y = (1 - c.value) * audioCanvas.height;
    // Draw the circle
    canvasCtx.beginPath();
    canvasCtx.arc(c.x, y, 8, 0, 2 * Math.PI);
    canvasCtx.fillStyle = '#FF851B';
    canvasCtx.globalAlpha = 0.7;
    canvasCtx.fill();
    canvasCtx.globalAlpha = 1.0;
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = '#fff';
    canvasCtx.stroke();
    // Draw a small red dot for debug
    canvasCtx.beginPath();
    canvasCtx.arc(c.x, y, 3, 0, 2 * Math.PI);
    canvasCtx.fillStyle = '#ff4136';
    canvasCtx.fill();
    // Draw a horizontal line through the circle for minDistancePx
    canvasCtx.beginPath();
    canvasCtx.moveTo(c.x - minDistancePx / 2, y);
    canvasCtx.lineTo(c.x + minDistancePx / 2, y);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = '#ff4136';
    canvasCtx.stroke();
  }
} 