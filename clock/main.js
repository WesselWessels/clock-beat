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
  // Robust peak detection using the rolling sweepBuffer
  // Check for threshold crossings in the sweepBuffer
  let prevAbove = false;
  let segmentStart = -1;
  let now = sweepPos;
  let bufferLen = sweepBufferSize;
  let minDistance = Math.floor(0.2 * bufferLen / 60); // ~0.2s at 60fps

  // Scan the visible buffer for threshold crossings
  for (let i = 1; i < bufferLen; i++) {
    let idxPrev = (now + i - 1) % bufferLen;
    let idxCurr = (now + i) % bufferLen;
    let vPrev = sweepBuffer[idxPrev];
    let vCurr = sweepBuffer[idxCurr];
    if (vPrev > threshold && vCurr <= threshold) {
      // Look back for local max in this segment
      let localMax = vPrev;
      let localMaxIdx = idxPrev;
      for (let j = idxPrev; j !== segmentStart && j !== now; j = (j - 1 + bufferLen) % bufferLen) {
        if (sweepBuffer[j] > localMax) {
          localMax = sweepBuffer[j];
          localMaxIdx = j;
        }
        if (sweepBuffer[j] <= threshold) break;
      }
      // Debounce: only register if far enough from last detection
      let distance = (localMaxIdx - lastDetectionIdx + bufferLen) % bufferLen;
      if (distance > minDistance) {
        lastDetectionIdx = localMaxIdx;
        // Calculate x position for this peak
        let x = (localMaxIdx - (sweepPos + 1) + bufferLen) % bufferLen;
        if (x >= 0 && x < audioCanvas.width) {
          peakCircles.push({ x, value: localMax });
        }
      }
    }
    if (vCurr > threshold && !prevAbove) {
      segmentStart = idxCurr;
    }
    prevAbove = vCurr > threshold;
  }
}

function updateIntervals() {
  if (peakTimes.length < 2) {
    intervalsDiv.textContent = 'Waiting for more ticks/tocks...';
    analysisDiv.textContent = '';
    updateEvennessIndicator(null);
    return;
  }
  // Calculate intervals in ms
  const intervals = [];
  for (let i = 1; i < peakTimes.length; i++) {
    intervals.push(((peakTimes[i] - peakTimes[i - 1]) * 1000).toFixed(1));
  }
  intervalsDiv.textContent = 'Intervals (ms): ' + intervals.join(', ');
  // Analyze evenness (last 6 intervals)
  let stddev = null;
  if (intervals.length >= 2) {
    const lastN = intervals.slice(-6).map(Number);
    const mean = lastN.reduce((a, b) => a + b, 0) / lastN.length;
    const variance = lastN.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / lastN.length;
    stddev = Math.sqrt(variance);
    analysisDiv.textContent = `Mean: ${mean.toFixed(1)} ms, Std Dev: ${stddev.toFixed(2)} ms`;
  }
  updateEvennessIndicator(stddev);
}

function updateEvennessIndicator(stddev) {
  // Clear
  evennessCtx.clearRect(0, 0, evennessCanvas.width, evennessCanvas.height);
  let color = '#ccc';
  let label = 'Waiting...';

  // Check for recent tick/tock
  const now = audioContext ? audioContext.currentTime : 0;
  if (peakTimes.length === 0 || (now - lastPeakTime > 2)) {
    color = '#888';
    label = 'No ticks detected';
  } else if (stddev !== null) {
    if (stddev < 10) {
      color = '#2ecc40'; // green
      label = 'Even';
    } else if (stddev < 30) {
      color = '#ffdc00'; // yellow
      label = 'Slightly uneven';
    } else {
      color = '#ff4136'; // red
      label = 'Uneven';
    }
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
    // Use the buffer value at the current x position for the circle
    // Calculate the buffer index corresponding to this x
    let bufferIdx = (sweepPos + 1 + c.x) % sweepBufferSize;
    let v = sweepBuffer[bufferIdx];
    const y = (1 - v) * audioCanvas.height;
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
  }
} 