let audioContext;
let analyser;
let microphone;
let animationId;
let running = false;

const startStopBtn = document.getElementById('startStopBtn');
const audioCanvas = document.getElementById('audioCanvas');
const intervalsDiv = document.getElementById('intervals');
const analysisDiv = document.getElementById('analysis');
const canvasCtx = audioCanvas.getContext('2d');

startStopBtn.addEventListener('click', () => {
  if (!running) {
    startAudio();
  } else {
    stopAudio();
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
    draw();
    // TODO: Add tick/tock detection and interval analysis
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
}

function draw() {
  if (!analyser) return;
  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  canvasCtx.clearRect(0, 0, audioCanvas.width, audioCanvas.height);
  canvasCtx.beginPath();
  const sliceWidth = audioCanvas.width / bufferLength;
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * audioCanvas.height) / 2;
    if (i === 0) {
      canvasCtx.moveTo(x, y);
    } else {
      canvasCtx.lineTo(x, y);
    }
    x += sliceWidth;
  }
  canvasCtx.lineWidth = 2;
  canvasCtx.strokeStyle = '#00ff99';
  canvasCtx.stroke();
  animationId = requestAnimationFrame(draw);
}

function clearCanvas() {
  canvasCtx.clearRect(0, 0, audioCanvas.width, audioCanvas.height);
} 