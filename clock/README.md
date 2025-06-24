# Clock Tick/Tock Diagnostic Tool

This web app uses your microphone and the Web Audio API to visualize and analyze the ticking of a mechanical clock. It helps you determine if the clock's ticks and tocks are evenly spaced, and provides real-time visual feedback.

## Features

- **Live Audio Waveform:**  
  Displays a real-time, scrolling waveform of the absolute value of the microphone input, using the full height of the canvas.

- **Peak Detection:**  
  Detects sharp "tick" or "tock" sounds by identifying when the waveform crosses a user-adjustable threshold.  
  - When the signal crosses from above the threshold to below, the app looks back to find the local maximum in that segment and marks it as a peak.
  - Detected peaks are shown as orange circles that move left with the waveform and disappear when they leave the screen.

- **Threshold Control:**  
  A slider below the waveform allows you to adjust the detection threshold in real time.  
  - The current threshold is shown as a red dashed line on the waveform.
  - Only peaks above this line are detected and marked.

- **Pause/Resume:**  
  You can pause the waveform display at any time to inspect the data, and resume to continue live analysis.

- **Evenness Indicator:**  
  The app calculates the intervals between detected peaks and provides a real-time indicator of how even the ticks/tocks are.

## Internal Functionality

- **Audio Processing:**  
  - Uses the Web Audio API to access the microphone and obtain audio samples.
  - Maintains a rolling buffer (`sweepBuffer`) of the most recent samples, with one sample per horizontal pixel of the canvas.
  - The waveform is plotted as the absolute value of each sample, mapped so 0 is at the bottom and 1 is at the top of the canvas.

- **Peak Detection Algorithm:**  
  - On each animation frame, the app scans the rolling buffer for points where the waveform crosses from above the threshold to below.
  - For each crossing, it looks back to find the local maximum in the segment above the threshold.
  - If a peak is found and is sufficiently far from the last detected peak (debounce), it is marked as a detected tick/tock.

- **Peak Visualization:**  
  - Each detected peak is stored with its x position (relative to the canvas) and value.
  - On each frame, the x position of each peak is decremented so it moves left with the waveform.
  - Peaks are only drawn while they are visible on the canvas.

- **Threshold Visualization:**  
  - The threshold is shown as a red dashed horizontal line.
  - The slider allows real-time adjustment, and the line and detection logic update immediately.

- **UI Controls:**  
  - **Start/Stop:** Begin or end audio capture and visualization.
  - **Pause/Resume:** Freeze or continue the waveform display.
  - **Threshold Slider:** Adjust the sensitivity of peak detection.

## Usage

1. Open the app in a browser and allow microphone access.
2. Click "Start" to begin visualizing the clock's sound.
3. Adjust the threshold slider so that only the clock's ticks/tocks are detected (orange circles).
4. Use the evenness indicator and waveform to diagnose and adjust your clock. 