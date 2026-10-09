/**
 * SyncDB WASN - Mobile Listener Node Controller (Modo Oyente)
 * Handles Microphone AudioContext FFT, Mobile Mic Flattening Calibration,
 * GPS Location -> Open-Meteo Weather sync, and real-time WebSocket streaming.
 */

(function () {
  'use strict';

  // Parse Venue ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  const VENUE_ID = urlParams.get('venue') || 'AUD-SAL-01';
  const NODE_ID = 'NODE-' + Math.random().toString(36).substring(2, 6).toUpperCase();

  // DOM Elements
  const elNodeId = document.getElementById('node-id-display');
  const elVenueNameDisplay = document.getElementById('venue-name-display');
  const elToggleConnect = document.getElementById('toggle-connect');
  const elToggleLabel = document.getElementById('toggle-label');
  const elToggleIndicator = document.getElementById('toggle-indicator');
  const elNetworkLed = document.getElementById('network-led');
  const elCarrierStateLabel = document.getElementById('carrier-state-label');
  const elSplValue = document.getElementById('spl-value');
  const elTempValue = document.getElementById('temp-value');
  const elHumidityValue = document.getElementById('humidity-value');
  const elSoundSpeedValue = document.getElementById('soundspeed-value');
  const elDelayValue = document.getElementById('delay-value');
  const elCalibToggle = document.getElementById('mic-calib-toggle');
  const elCalibStatus = document.getElementById('calib-status-badge');
  const elRings = [
    document.getElementById('pulse-ring-1'),
    document.getElementById('pulse-ring-2'),
    document.getElementById('pulse-ring-3')
  ];
  const elTransducerCore = document.getElementById('transducer-core');
  const elHaloGlow = document.getElementById('halo-glow');
  const elQrTrigger = document.getElementById('qr-trigger');
  const elQrModal = document.getElementById('qr-modal');
  const elQrClose = document.getElementById('qr-close');
  const elQrImage = document.getElementById('qr-image');
  const elMiniRtaContainer = document.getElementById('mini-rta-container');

  // State Variables
  let isTransmitting = false;
  let micCalibrated = true; // Default to flattened curve
  let audioCtx = null;
  let micStream = null;
  let analyserNode = null;
  let dataArray = null;
  let animFrameId = null;
  let ws = null;
  let weatherData = { temp: 21.0, humidity: 50, speedOfSound: 344.5, delayPerMeter: 2.90 };

  // Set Initial Text & Fetch Venue Name
  if (elNodeId) elNodeId.textContent = NODE_ID;
  if (elVenueNameDisplay) elVenueNameDisplay.textContent = VENUE_ID;

  async function fetchVenueName() {
    try {
      const res = await fetch(`/api/venues/${VENUE_ID}`);
      if (res.ok) {
        const v = await res.json();
        if (elVenueNameDisplay && v.name) elVenueNameDisplay.textContent = v.name;
      }
    } catch (e) {}
  }
  fetchVenueName();

  // Initialize Mini RTA Bars
  const OCTAVE_BANDS = AcousticMath.OCTAVES_1_1;
  const miniBars = [];
  if (elMiniRtaContainer) {
    elMiniRtaContainer.innerHTML = '';
    OCTAVE_BANDS.forEach(freq => {
      const col = document.createElement('div');
      col.className = 'flex flex-col items-center flex-1 gap-1';
      col.innerHTML = `
        <div class="w-full bg-[#1c2022] h-20 rounded-sm relative overflow-hidden flex items-end">
          <div class="w-full bg-[#30b764] transition-all duration-75" style="height: 0%;" id="bar-${freq}"></div>
        </div>
        <span class="font-mono-tech text-[9px] text-[#879486]">${freq >= 1000 ? (freq/1000)+'k' : freq}</span>
      `;
      elMiniRtaContainer.appendChild(col);
      miniBars.push({ freq, bar: col.querySelector(`#bar-${freq}`) });
    });
  }

  // 1. Environmental Telemetry (GPS -> Open-Meteo)
  async function syncEnvironmentalTelemetry() {
    if (!navigator.geolocation) {
      console.warn('[Telemetry] Geolocation not supported, using default ambient parameters.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        try {
          const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
          if (res.ok) {
            const data = await res.json();
            weatherData = data;
            updateWeatherDisplay(data);

            // Send to WebSocket if connected
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'environmental_telemetry',
                venueId: VENUE_ID,
                coords: { lat, lon },
                temp: data.temperature,
                humidity: data.humidity
              }));
            }
          }
        } catch (e) {
          console.error('[Weather] Failed to fetch live weather:', e);
        }
      },
      (err) => {
        console.warn('[Geolocation] Permiso no concedido o error:', err.message);
        // Fallback fetch default
        fetchDefaultWeather();
      },
      { timeout: 8000, enableHighAccuracy: false }
    );
  }

  async function fetchDefaultWeather() {
    try {
      const res = await fetch('/api/weather');
      if (res.ok) {
        const data = await res.json();
        weatherData = data;
        updateWeatherDisplay(data);
      }
    } catch (e) {}
  }

  function updateWeatherDisplay(data) {
    if (elTempValue) elTempValue.textContent = `${data.temperature.toFixed(1)}°C`;
    if (elHumidityValue) elHumidityValue.textContent = `${data.humidity.toFixed(0)}%`;
    if (elSoundSpeedValue) elSoundSpeedValue.textContent = `${data.speedOfSound.toFixed(1)} m/s`;
    if (elDelayValue) elDelayValue.textContent = `${data.delayPerMeter.toFixed(3)} ms/m`;
  }

  // 2. Microphone & Web Audio Engine
  async function startAudioEngine() {
    try {
      // Clean, uncompressed audio constraints essential for acoustic measurement
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        }
      };

      micStream = await navigator.mediaDevices.getUserMedia(constraints);
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      
      const source = audioCtx.createMediaStreamSource(micStream);
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 2048;
      analyserNode.smoothingTimeConstant = 0.65;
      source.connect(analyserNode);

      dataArray = new Uint8Array(analyserNode.frequencyBinCount);
      return true;
    } catch (err) {
      console.error('[Audio Error] Access denied or unsupported:', err);
      alert('Error de acceso al micrófono: Asegúrese de autorizar el micrófono en el navegador. (En móviles en red local, use la URL HTTPS).');
      return false;
    }
  }

  function stopAudioEngine() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      micStream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
  }

  // Extract IEC 1/1 Octave Band Magnitudes from raw FFT
  function extractOctaveBands(analyser, binArray) {
    analyser.getByteFrequencyData(binArray);
    const sampleRate = audioCtx.sampleRate;
    const binCount = analyser.frequencyBinCount;
    const binWidth = (sampleRate / 2) / binCount;

    // Calculate approximate RMS dB SPL
    let sumSquares = 0;
    for (let i = 0; i < binArray.length; i++) {
      const norm = binArray[i] / 255;
      sumSquares += norm * norm;
    }
    const rms = Math.sqrt(sumSquares / binArray.length);
    // Relative calibrated SPL approximation (30dB noise floor to 110dB peak)
    const splDb = Math.max(32, Math.round((20 * Math.log10(rms + 1e-6) + 94) * 10) / 10);

    const octaves = OCTAVE_BANDS.map(centerFreq => {
      // 1/1 octave bandwidth: f_low = f0 / sqrt(2), f_high = f0 * sqrt(2)
      const fLow = centerFreq / 1.414;
      const fHigh = centerFreq * 1.414;
      const binLow = Math.max(0, Math.floor(fLow / binWidth));
      const binHigh = Math.min(binCount - 1, Math.ceil(fHigh / binWidth));

      let bandSum = 0;
      let count = 0;
      for (let b = binLow; b <= binHigh; b++) {
        bandSum += binArray[b];
        count++;
      }
      const avgBin = count > 0 ? (bandSum / count) : 0;
      // Convert to dB relative scale (-40dB to +12dB)
      const magDb = Math.round(((avgBin / 255) * 52 - 40) * 10) / 10;
      return { freq: centerFreq, magnitude: magDb };
    });

    return { splDb, rawOctaves: octaves };
  }

  // 3. Audio Loop & WebSocket Streaming
  let lastStreamTime = 0;
  function processAudioLoop(timestamp) {
    if (!isTransmitting || !analyserNode) return;

    const { splDb, rawOctaves } = extractOctaveBands(analyserNode, dataArray);

    // Apply mobile microphone inverse flattening calibration if active
    const calibratedOctaves = AcousticMath.calibrateOctaveArray(rawOctaves, micCalibrated);

    // Update Phone UI
    if (elSplValue) elSplValue.textContent = splDb.toFixed(1);

    // Animate Visualizer Rings & Transducer Core
    const scaleFactor = Math.min(1.8, Math.max(0.9, splDb / 65));
    if (elTransducerCore) {
      elTransducerCore.style.transform = `scale(${scaleFactor})`;
    }
    if (elHaloGlow) {
      elHaloGlow.style.opacity = `${Math.min(1, splDb / 80)}`;
    }
    if (elRings[0]) elRings[0].setAttribute('r', `${38 + (scaleFactor - 1) * 20}`);
    if (elRings[1]) elRings[1].setAttribute('r', `${70 + (scaleFactor - 1) * 25}`);

    // Update Mini RTA Bars
    calibratedOctaves.forEach((item, idx) => {
      if (miniBars[idx] && miniBars[idx].bar) {
        // Normalize -40 to +10 dB to 0% - 100%
        const pct = Math.min(100, Math.max(4, ((item.calibratedMagnitude + 35) / 45) * 100));
        miniBars[idx].bar.style.height = `${pct}%`;
        // High level warning color
        if (pct > 85) miniBars[idx].bar.style.backgroundColor = '#ffca45';
        else miniBars[idx].bar.style.backgroundColor = '#30b764';
      }
    });

    // Stream to WebSocket every ~40ms (25 FPS)
    if (ws && ws.readyState === WebSocket.OPEN && (timestamp - lastStreamTime >= 40)) {
      lastStreamTime = timestamp;
      ws.send(JSON.stringify({
        type: 'audio_stream',
        venueId: VENUE_ID,
        nodeId: NODE_ID,
        splDb: splDb,
        octaves: calibratedOctaves.map(o => ({ freq: o.freq, magnitude: o.calibratedMagnitude })),
        rawOctaves: rawOctaves,
        micCalibrated: micCalibrated
      }));
    }

    animFrameId = requestAnimationFrame(processAudioLoop);
  }

  // 4. WebSocket Client Connection
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WebSocket] Connected as listener node:', NODE_ID);
      if (elNetworkLed) {
        elNetworkLed.style.backgroundColor = '#30b764';
        elNetworkLed.classList.add('led-live');
      }

      // Register this node to venue room
      ws.send(JSON.stringify({
        type: 'register_node',
        venueId: VENUE_ID,
        nodeId: NODE_ID,
        userAgent: navigator.userAgent.includes('iPhone') ? 'iPhone MEMS' : (navigator.userAgent.includes('Android') ? 'Android MEMS' : 'Terminal Audio'),
        micCalibrated: micCalibrated,
        temp: weatherData.temp,
        humidity: weatherData.humidity
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'registered') {
          console.log('[Node Registered]:', msg);
        }
      } catch (e) {}
    };

    ws.onclose = () => {
      console.warn('[WebSocket] Closed. Reconnecting in 3s...');
      if (elNetworkLed) {
        elNetworkLed.style.backgroundColor = '#ffca45';
        elNetworkLed.classList.remove('led-live');
      }
      setTimeout(() => {
        if (isTransmitting) connectWebSocket();
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error('[WebSocket] Error:', err);
    };
  }

  // 5. Connect / Disconnect Toggle
  async function toggleTransmission() {
    if (!isTransmitting) {
      const audioOk = await startAudioEngine();
      if (!audioOk) return;

      connectWebSocket();
      syncEnvironmentalTelemetry();

      isTransmitting = true;
      if (elToggleLabel) elToggleLabel.textContent = 'Detener Transmisión';
      if (elToggleConnect) {
        elToggleConnect.classList.remove('bg-on-background', 'text-surface');
        elToggleConnect.classList.add('bg-error-container', 'text-[#ffdad6]');
      }
      if (elCarrierStateLabel) {
        elCarrierStateLabel.textContent = 'TRANSMITIENDO EN VIVO // LOCK_OK';
        elCarrierStateLabel.classList.remove('text-tertiary');
        elCarrierStateLabel.classList.add('text-primary');
      }

      animFrameId = requestAnimationFrame(processAudioLoop);
    } else {
      isTransmitting = false;
      stopAudioEngine();
      if (ws) ws.close();

      if (elToggleLabel) elToggleLabel.textContent = 'Toca para Conectar';
      if (elToggleConnect) {
        elToggleConnect.classList.add('bg-on-background', 'text-surface');
        elToggleConnect.classList.remove('bg-error-container', 'text-[#ffdad6]');
      }
      if (elCarrierStateLabel) {
        elCarrierStateLabel.textContent = 'ESPECTRO EN ESPERA';
        elCarrierStateLabel.classList.add('text-tertiary');
        elCarrierStateLabel.classList.remove('text-primary');
      }
      if (elSplValue) elSplValue.textContent = '--.-';
    }
  }

  // 6. Microphone Calibration Toggle
  function toggleMicCalibration() {
    micCalibrated = !micCalibrated;
    updateCalibUI();

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'set_mic_calibration',
        venueId: VENUE_ID,
        nodeId: NODE_ID,
        enabled: micCalibrated
      }));
    }
  }

  function updateCalibUI() {
    if (elCalibStatus) {
      if (micCalibrated) {
        elCalibStatus.textContent = 'CURVA PLANA';
        elCalibStatus.className = 'px-2 py-0.5 rounded text-[10px] font-mono-tech uppercase bg-[#30b764]/20 text-[#5edf86] border border-[#30b764]/40';
      } else {
        elCalibStatus.textContent = 'RAW (DIRECTO)';
        elCalibStatus.className = 'px-2 py-0.5 rounded text-[10px] font-mono-tech uppercase bg-[#ffca45]/20 text-[#ffca45] border border-[#ffca45]/40';
      }
    }
  }

  // 7. QR Code Modal
  async function openQrModal() {
    if (!elQrModal) return;
    try {
      const currentUrl = window.location.href;
      const res = await fetch(`/api/qr?url=${encodeURIComponent(currentUrl)}`);
      if (res.ok) {
        const data = await res.json();
        if (elQrImage) elQrImage.src = data.dataUrl;
      }
      elQrModal.classList.remove('opacity-0', 'pointer-events-none');
    } catch (e) {
      console.error('[QR] Failed to generate QR:', e);
    }
  }

  function closeQrModal() {
    if (elQrModal) elQrModal.classList.add('opacity-0', 'pointer-events-none');
  }

  // Event Listeners
  if (elToggleConnect) elToggleConnect.addEventListener('click', toggleTransmission);
  if (elCalibToggle) elCalibToggle.addEventListener('click', toggleMicCalibration);
  if (elQrTrigger) elQrTrigger.addEventListener('click', openQrModal);
  if (elQrClose) elQrClose.addEventListener('click', closeQrModal);

  // Initial Sync
  updateCalibUI();
  syncEnvironmentalTelemetry();

})();
