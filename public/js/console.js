/**
 * SYNCDB - Master Console Controller (Técnico Sonidista)
 * Real-time Multi-Node Audio FFT Aggregation, RTA Canvas Rendering,
 * Dynamic Real-Time Calibration Health Status, 1-Click Flat Curve Auto-EQ,
 * Snapshots by Day/Time and Venue Management.
 */

(function () {
  'use strict';

  // State
  let currentVenueId = '';
  let currentVenueName = '';
  let activeNodes = new Map(); // nodeId -> { nodeId, userAgent, splDb, octaves, micCalibrated, lastSeen, temp, humidity }
  let ws = null;
  let animFrameId = null;
  let latestCalibration = null; // Stored PEQ filters
  let maxPeakSpl = 0;
  let currentAmbient = { temp: 21.0, humidity: 50, speedOfSound: 344.5, delayPerMeter: 2.90 };

  // DOM Elements
  const elVenueSelect = document.getElementById('venue-select');
  const elBtnOpenCreateVenue = document.getElementById('btn-open-create-venue');
  const elBtnBannerCreateVenue = document.getElementById('btn-banner-create-venue');
  const elNoVenueBanner = document.getElementById('no-venue-banner');
  const elCreateVenueModal = document.getElementById('create-venue-modal');
  const elBtnCloseCreateVenue = document.getElementById('btn-close-create-venue');
  const elBtnCancelCreateVenue = document.getElementById('btn-cancel-create-venue');
  const elBtnSubmitCreateVenue = document.getElementById('btn-submit-create-venue');
  const elNewVenueName = document.getElementById('new-venue-name');
  const elNewVenueCapacity = document.getElementById('new-venue-capacity');
  const elListenerLink = document.getElementById('btn-open-listener-link');

  const elNodeCountPill = document.getElementById('node-count-pill');
  const elNodesCountHeader = document.getElementById('nodes-count-header');
  const elAvgSpl = document.getElementById('avg-spl');
  const elSplDispersion = document.getElementById('spl-dispersion');
  const elSplPeakLabel = document.getElementById('spl-peak-label');
  const elStatusIndicator = document.getElementById('status-indicator');

  const elCalibStatusText = document.getElementById('calib-status-text');
  const elCalibDevText = document.getElementById('calib-dev-text');
  const elBtnCalibrate = document.getElementById('btn-calibrate');
  const elBtnSaveSnapshot = document.getElementById('btn-save-snapshot');
  const elCalibrationAlert = document.getElementById('calibration-alert');
  const elPeqTableBody = document.getElementById('peq-table-body');
  const elActiveNodesList = document.getElementById('active-nodes-list');

  // Telemetry Tab Elements
  const elStatsTemp = document.getElementById('stats-temp');
  const elStatsHumidity = document.getElementById('stats-humidity');
  const elStatsSoundSpeed = document.getElementById('stats-soundspeed');
  const elStatsDelay = document.getElementById('stats-delay');
  const elStatsNodeCount = document.getElementById('stats-node-count');
  const elTelemetryNodesTable = document.getElementById('telemetry-nodes-table');

  // History Tab Elements
  const elHistoryTableBody = document.getElementById('history-table-body');

  // QR Modal Elements
  const elBtnShowQr = document.getElementById('btn-show-qr');
  const elQrModal = document.getElementById('console-qr-modal');
  const elQrClose = document.getElementById('console-qr-close');
  const elQrImg = document.getElementById('console-qr-img');
  const elQrUrl = document.getElementById('console-qr-url');

  // Canvas
  const canvas = document.getElementById('rta-canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;

  // Responsive Canvas Setup
  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
  }
  window.addEventListener('resize', resizeCanvas);

  // 1. Venues Management & Modal
  async function loadVenues() {
    try {
      const res = await fetch('/api/venues');
      if (res.ok) {
        const venues = await res.json();
        elVenueSelect.innerHTML = '';

        if (!venues || venues.length === 0) {
          elNoVenueBanner.classList.remove('hidden');
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = '(Sin recintos creados)';
          opt.disabled = true;
          opt.selected = true;
          elVenueSelect.appendChild(opt);
          currentVenueId = '';
          currentVenueName = '';
          if (elListenerLink) elListenerLink.href = '/listener.html';
        } else {
          elNoVenueBanner.classList.add('hidden');
          venues.forEach((v, idx) => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.name;
            opt.className = 'bg-[#181c1e] text-on-surface';
            elVenueSelect.appendChild(opt);
          });

          // Select first or keep current if valid
          if (!currentVenueId || !venues.some(v => v.id === currentVenueId)) {
            currentVenueId = venues[0].id;
            currentVenueName = venues[0].name;
          } else {
            const current = venues.find(v => v.id === currentVenueId);
            currentVenueName = current ? current.name : venues[0].name;
          }
          elVenueSelect.value = currentVenueId;

          if (elListenerLink) {
            elListenerLink.href = `/listener.html?venue=${currentVenueId}`;
          }

          fetchVenueData();
          loadCalibrationHistory();

          // Connect / Re-register WS for this venue
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'register_console',
              venueId: currentVenueId
            }));
          }
        }
      }
    } catch (e) {
      console.error('[Venues Error]:', e);
    }
  }

  function openCreateVenueModal() {
    elCreateVenueModal.classList.remove('opacity-0', 'pointer-events-none');
    elNewVenueName.value = '';
    elNewVenueCapacity.value = '';
    setTimeout(() => elNewVenueName.focus(), 100);
  }

  function closeCreateVenueModal() {
    elCreateVenueModal.classList.add('opacity-0', 'pointer-events-none');
  }

  async function handleCreateVenueSubmit() {
    const name = elNewVenueName.value.trim();
    if (!name) {
      alert('Por favor ingrese el nombre del recinto.');
      return;
    }
    const capacity = parseInt(elNewVenueCapacity.value, 10) || 300;

    try {
      const res = await fetch('/api/venues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, capacity })
      });
      if (res.ok) {
        const newVenue = await res.json();
        closeCreateVenueModal();
        currentVenueId = newVenue.id;
        currentVenueName = newVenue.name;
        await loadVenues();
      }
    } catch (e) {
      console.error('[Create Venue Error]:', e);
    }
  }

  // 2. WebSocket Client
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Master Console] WebSocket conectado');
      if (currentVenueId) {
        ws.send(JSON.stringify({
          type: 'register_console',
          venueId: currentVenueId
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'venue_state':
            activeNodes.clear();
            if (msg.nodes) {
              msg.nodes.forEach(n => activeNodes.set(n.nodeId, n));
            }
            updateNodeCountDisplay();
            updateNodesListUI();
            break;

          case 'node_joined':
            activeNodes.set(msg.node.nodeId, {
              ...msg.node,
              lastSeen: Date.now(),
              splDb: 0,
              octaves: []
            });
            updateNodeCountDisplay();
            updateNodesListUI();
            break;

          case 'node_left':
            activeNodes.delete(msg.nodeId);
            updateNodeCountDisplay();
            updateNodesListUI();
            break;

          case 'audio_stream':
            if (activeNodes.has(msg.nodeId)) {
              const node = activeNodes.get(msg.nodeId);
              node.splDb = msg.splDb;
              node.octaves = msg.octaves;
              node.rawOctaves = msg.rawOctaves;
              node.micCalibrated = msg.micCalibrated;
              node.lastSeen = Date.now();
            }
            break;

          case 'venue_weather_updated':
            updateEnvironmentalUI(msg);
            break;

          case 'calibration_saved':
            loadCalibrationHistory();
            break;
        }
      } catch (err) {
        console.error('[Console WS Message Error]:', err);
      }
    };

    ws.onclose = () => {
      console.warn('[Master Console] WS Desconectado. Reintentando en 3s...');
      setTimeout(connectWebSocket, 3000);
    };
  }

  // 3. Node Count & List UI Updates
  function updateNodeCountDisplay() {
    const count = activeNodes.size;
    if (elNodeCountPill) {
      elNodeCountPill.textContent = `${count} ${count === 1 ? 'NODO' : 'NODOS'}`;
      if (count > 0) {
        elNodeCountPill.className = 'font-mono text-xs px-2.5 py-1 rounded bg-[#30b764]/20 text-[#5edf86] border border-[#30b764]/50';
      } else {
        elNodeCountPill.className = 'font-mono text-xs px-2.5 py-1 rounded bg-[#ffca45]/20 text-[#ffca45] border border-[#ffca45]/50';
      }
    }
    if (elNodesCountHeader) elNodesCountHeader.textContent = `${count} ACTIVOS`;
    if (elStatsNodeCount) elStatsNodeCount.textContent = count;
  }

  function updateNodesListUI() {
    if (elActiveNodesList) {
      elActiveNodesList.innerHTML = '';
      if (activeNodes.size === 0) {
        elActiveNodesList.innerHTML = `
          <div class="p-4 text-center text-[#879486] font-mono text-xs">
            Sin dispositivos conectados.<br/>Escanee el código QR para vincular micrófonos.
          </div>
        `;
      } else {
        activeNodes.forEach(node => {
          const div = document.createElement('div');
          div.className = 'flex items-center justify-between p-2.5 bg-[#181c1e] border border-[#313537] rounded mb-1 text-xs font-mono';
          div.innerHTML = `
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full ${node.micCalibrated ? 'bg-[#5edf86]' : 'bg-[#ffca45]'}"></span>
              <span class="font-semibold text-on-surface">${node.nodeId}</span>
              <span class="text-[#879486] text-[10px]">[${node.userAgent || 'Móvil'}]</span>
            </div>
            <div class="flex items-center gap-2.5">
              <span class="text-[10px] ${node.micCalibrated ? 'text-[#5edf86]' : 'text-[#ffca45]'}">${node.micCalibrated ? 'PLANO' : 'RAW'}</span>
              <span class="font-bold text-on-surface">${node.splDb ? node.splDb.toFixed(1) : '--.-'} <span class="text-[#879486] text-[10px]">dBA</span></span>
            </div>
          `;
          elActiveNodesList.appendChild(div);
        });
      }
    }

    if (elTelemetryNodesTable) {
      elTelemetryNodesTable.innerHTML = '';
      if (activeNodes.size === 0) {
        elTelemetryNodesTable.innerHTML = `
          <tr>
            <td colspan="5" class="py-4 text-center text-[#879486] font-mono text-xs">
              No hay dispositivos conectados en este momento.
            </td>
          </tr>
        `;
      } else {
        activeNodes.forEach(node => {
          const tr = document.createElement('tr');
          tr.className = 'border-b border-[#313537]/50 text-xs font-mono';
          tr.innerHTML = `
            <td class="py-2.5 px-3 font-semibold text-on-surface">${node.nodeId}</td>
            <td class="py-2.5 px-3 text-[#879486]">${node.userAgent || 'Móvil'}</td>
            <td class="py-2.5 px-3">${node.micCalibrated ? '<span class="text-[#5edf86]">Compensado (Curva Plana)</span>' : '<span class="text-[#ffca45]">Sin compensar (Raw)</span>'}</td>
            <td class="py-2.5 px-3 font-bold text-on-surface">${node.splDb ? node.splDb.toFixed(1) : '--.-'} dBA</td>
            <td class="py-2.5 px-3 text-[#5edf86]">ACTIVO (ONLINE)</td>
          `;
          elTelemetryNodesTable.appendChild(tr);
        });
      }
    }
  }

  // 4. Real RTA Canvas & Dynamic Calibration Health Evaluation
  function renderRta() {
    if (!ctx || !canvas) return;

    const width = canvas.getBoundingClientRect().width;
    const height = canvas.getBoundingClientRect().height;
    ctx.clearRect(0, 0, width, height);

    const octaves = AcousticMath.OCTAVES_1_1;
    const paddingLeft = 50;
    const paddingRight = 20;
    const paddingTop = 25;
    const paddingBottom = 35;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    const dbMin = -30;
    const dbMax = +12;
    const dbRange = dbMax - dbMin;

    function yForDb(db) {
      const clamped = Math.max(dbMin, Math.min(dbMax, db));
      return paddingTop + (1 - (clamped - dbMin) / dbRange) * plotHeight;
    }

    function xForOctaveIdx(idx) {
      return paddingLeft + (idx / (octaves.length - 1)) * plotWidth;
    }

    // A. Draw Grid & Scales
    ctx.strokeStyle = '#272b2d';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#879486';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';

    // Horizontal dB Lines
    [-24, -18, -12, -6, 0, 6, 12].forEach(db => {
      const y = yForDb(db);
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(width - paddingRight, y);
      if (db === 0) {
        ctx.strokeStyle = '#3d4a3e';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.strokeStyle = '#272b2d';
        ctx.lineWidth = 1;
      } else {
        ctx.stroke();
      }
      ctx.fillText(`${db > 0 ? '+' : ''}${db} dB`, paddingLeft - 8, y + 3);
    });

    // Vertical Frequency Octave Lines
    ctx.textAlign = 'center';
    octaves.forEach((freq, idx) => {
      const x = xForOctaveIdx(idx);
      ctx.beginPath();
      ctx.moveTo(x, paddingTop);
      ctx.lineTo(x, height - paddingBottom);
      ctx.strokeStyle = '#1e2225';
      ctx.stroke();

      const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
      ctx.fillText(label, x, height - paddingBottom + 16);
    });

    ctx.fillStyle = '#879486';
    ctx.fillText('FRECUENCIA (Hz) // IEC 1/1 OCT', paddingLeft + plotWidth / 2, height - 8);

    // B. Calculate Spatial Average across active connected nodes
    const activeNodesList = Array.from(activeNodes.values()).filter(n => n.octaves && n.octaves.length === octaves.length);
    const nodeCount = activeNodesList.length;

    if (nodeCount === 0) {
      // ZERO MOCK DATA: Clean technical waiting display
      ctx.save();
      ctx.strokeStyle = '#30b764';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      const y0 = yForDb(0);
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y0);
      ctx.lineTo(width - paddingRight, y0);
      ctx.stroke();
      ctx.setLineDash([]);

      const cx = paddingLeft + plotWidth / 2;
      const cy = paddingTop + plotHeight / 2;

      ctx.strokeStyle = '#313537';
      ctx.beginPath();
      ctx.arc(cx, cy, 35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 45, cy);
      ctx.lineTo(cx + 45, cy);
      ctx.moveTo(cx, cy - 45);
      ctx.lineTo(cx, cy + 45);
      ctx.stroke();

      ctx.fillStyle = '#ffca45';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ESPERANDO CONEXIÓN DE MICRÓFONOS', cx, cy - 8);
      ctx.fillStyle = '#879486';
      ctx.font = '11px "Geist", sans-serif';
      ctx.fillText('Escanee el QR con un teléfono para transmitir señal de audio real.', cx, cy + 12);
      ctx.restore();

      if (elAvgSpl) elAvgSpl.textContent = '--.-';
      if (elSplDispersion) elSplDispersion.textContent = '± 0.0 dB';
      if (elSplPeakLabel) elSplPeakLabel.textContent = 'Pico: --.- dBA';
      if (elCalibStatusText) {
        elCalibStatusText.textContent = 'SIN SEÑAL';
        elCalibStatusText.style.color = '#879486';
      }
      if (elCalibDevText) {
        elCalibDevText.textContent = 'Conecte micrófonos para evaluar la respuesta de sala';
      }

      animFrameId = requestAnimationFrame(renderRta);
      return;
    }

    // Compute average magnitude per octave band
    const averageOctaves = octaves.map((freq, idx) => {
      let sum = 0;
      activeNodesList.forEach(node => {
        sum += node.octaves[idx].magnitude;
      });
      return { freq, magnitude: sum / nodeCount };
    });

    // Evaluate Real-Time Calibration Health (Card 2)
    const health = AcousticMath.evaluateCalibrationHealth(averageOctaves);
    if (elCalibStatusText) {
      elCalibStatusText.textContent = health.status;
      elCalibStatusText.style.color = health.color;
    }
    if (elCalibDevText) {
      elCalibDevText.textContent = `Desviación máx: ±${health.maxDeviation} dB (Ref: 0 dB)`;
    }

    // Compute Average SPL (Leq)
    let sumLin = 0;
    let localMax = 0;
    activeNodesList.forEach(node => {
      const spl = node.splDb || 40;
      sumLin += Math.pow(10, spl / 10);
      if (spl > localMax) localMax = spl;
    });
    const avgSplValue = 10 * Math.log10(sumLin / nodeCount);
    if (avgSplValue > maxPeakSpl) maxPeakSpl = avgSplValue;

    if (elAvgSpl) elAvgSpl.textContent = avgSplValue.toFixed(1);
    if (elSplPeakLabel) elSplPeakLabel.textContent = `Pico: ${localMax.toFixed(1)} dBA`;

    // Compute dispersion (max deviation across nodes)
    let minSpl = 999, maxSpl = -999;
    activeNodesList.forEach(n => {
      if (n.splDb < minSpl) minSpl = n.splDb;
      if (n.splDb > maxSpl) maxSpl = n.splDb;
    });
    const dispersion = Math.max(0, (maxSpl - minSpl) / 2);
    if (elSplDispersion) elSplDispersion.textContent = `± ${dispersion.toFixed(1)} dB`;

    // C. Draw Target Flat Reference Line (0 dB)
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    const yTarget = yForDb(0);
    ctx.beginPath();
    ctx.moveTo(paddingLeft, yTarget);
    ctx.lineTo(width - paddingRight, yTarget);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('OBJETIVO: CURVA PLANA (0 dB)', paddingLeft + 10, yTarget - 6);
    ctx.restore();

    // D. Draw Real Spatial Averaged Curve (Phosphor Green #5edf86)
    ctx.save();
    ctx.strokeStyle = '#5edf86';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(94, 223, 134, 0.4)';
    ctx.shadowBlur = 8;
    ctx.beginPath();

    averageOctaves.forEach((pt, idx) => {
      const x = xForOctaveIdx(idx);
      const y = yForDb(pt.magnitude);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Node dots
    averageOctaves.forEach((pt, idx) => {
      const x = xForOctaveIdx(idx);
      const y = yForDb(pt.magnitude);
      ctx.fillStyle = '#101416';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5edf86';
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // E. Draw Computed Calibration / Parametric EQ Curve if active (Amber #ffca45)
    if (latestCalibration && latestCalibration.filters && latestCalibration.filters.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#ffca45';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 2]);
      ctx.shadowColor = 'rgba(255, 202, 69, 0.4)';
      ctx.shadowBlur = 6;
      ctx.beginPath();

      averageOctaves.forEach((pt, idx) => {
        const x = xForOctaveIdx(idx);
        const matchingFilter = latestCalibration.filters.find(f => Math.abs(f.freq - pt.freq) < 5);
        const correctionGain = matchingFilter ? matchingFilter.gainDb : 0;
        const correctedMag = pt.magnitude + correctionGain;
        const y = yForDb(correctedMag);

        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    }

    animFrameId = requestAnimationFrame(renderRta);
  }

  // 5. One-Button Flat Curve Calibration & Snapshot Saving
  async function performRoomCalibration() {
    if (!currentVenueId) {
      alert('Por favor cree o seleccione un recinto primero.');
      openCreateVenueModal();
      return;
    }

    const activeNodesList = Array.from(activeNodes.values()).filter(n => n.octaves && n.octaves.length > 0);

    if (activeNodesList.length === 0) {
      alert('Se requiere al menos 1 dispositivo (micrófono) transmitiendo en vivo para calibrar la sala.');
      return;
    }

    // Compute averaged curve
    const octaves = AcousticMath.OCTAVES_1_1;
    const averageOctaves = octaves.map((freq, idx) => {
      let sum = 0;
      activeNodesList.forEach(node => {
        sum += node.octaves[idx].magnitude;
      });
      return { freq, magnitude: Math.round((sum / activeNodesList.length) * 10) / 10 };
    });

    // Compute Auto-EQ correction filters
    const filters = AcousticMath.computeAutoEqFilters(averageOctaves, 0); // target 0 dB flat
    latestCalibration = {
      timestamp: new Date().toISOString(),
      nodeCount: activeNodesList.length,
      avgSPL: Number(elAvgSpl ? elAvgSpl.textContent : 75),
      measuredCurve: averageOctaves,
      filters: filters
    };

    // Render Filter Matrix in UI
    renderFilterTable(filters);

    // Save as Snapshot in Database
    await saveSnapshotRecord(filters, averageOctaves, 'Calibración 1-Click Auto-EQ');
  }

  async function saveSnapshotRecord(filters = [], curve = [], note = 'Snapshot Acústico') {
    if (!currentVenueId) return;

    const activeNodesList = Array.from(activeNodes.values());
    const nodesDetail = activeNodesList.map(n => ({
      nodeId: n.nodeId,
      userAgent: n.userAgent,
      splDb: n.splDb,
      micCalibrated: n.micCalibrated
    }));

    try {
      const res = await fetch(`/api/venues/${currentVenueId}/calibrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeCount: activeNodesList.length,
          nodesDetail,
          avgSPL: Number(elAvgSpl ? elAvgSpl.textContent : 0),
          temperature: currentAmbient.temp,
          humidity: currentAmbient.humidity,
          speedOfSound: currentAmbient.speedOfSound,
          delayPerMeter: currentAmbient.delayPerMeter,
          measuredCurve: curve.length > 0 ? curve : (latestCalibration ? latestCalibration.measuredCurve : []),
          correctionFilters: filters.length > 0 ? filters : (latestCalibration ? latestCalibration.filters : []),
          notes: note
        })
      });

      if (res.ok) {
        if (elCalibrationAlert) {
          elCalibrationAlert.classList.remove('hidden');
          setTimeout(() => elCalibrationAlert.classList.add('hidden'), 5000);
        }
        loadCalibrationHistory();
      }
    } catch (e) {
      console.error('[Snapshot Save Error]:', e);
    }
  }

  function renderFilterTable(filters) {
    if (!elPeqTableBody) return;
    elPeqTableBody.innerHTML = '';
    if (!filters || filters.length === 0) {
      elPeqTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="py-3 px-4 text-center text-[#5edf86] font-mono text-xs">
            Respuesta de sala ya se encuentra dentro de la tolerancia plana (± 1.5 dB).
          </td>
        </tr>
      `;
      return;
    }

    filters.forEach((f, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-[#313537]/40 hover:bg-[#1c2022] font-mono text-xs';
      const gainColor = f.gainDb > 0 ? 'text-[#5edf86]' : (f.gainDb < 0 ? 'text-[#ffca45]' : 'text-on-surface');
      tr.innerHTML = `
        <td class="py-2.5 px-4 font-semibold text-on-surface">PEQ ${idx + 1} (${f.band})</td>
        <td class="py-2.5 px-4 font-bold text-on-surface">${f.freq >= 1000 ? (f.freq/1000)+'k' : f.freq} Hz</td>
        <td class="py-2.5 px-4 font-bold ${gainColor}">${f.gainDb > 0 ? '+' : ''}${f.gainDb.toFixed(1)} dB</td>
        <td class="py-2.5 px-4 text-[#879486]">${f.q.toFixed(2)}</td>
        <td class="py-2.5 px-4 text-on-surface">${f.type}</td>
      `;
      elPeqTableBody.appendChild(tr);
    });
  }

  // 6. Environmental Telemetry Sync
  function updateEnvironmentalUI(data) {
    if (data.temp !== undefined) currentAmbient.temp = data.temp;
    if (data.humidity !== undefined) currentAmbient.humidity = data.humidity;
    if (data.speedOfSound !== undefined) currentAmbient.speedOfSound = data.speedOfSound;
    if (data.delayPerMeter !== undefined) currentAmbient.delayPerMeter = data.delayPerMeter;

    if (elStatsTemp) elStatsTemp.textContent = `${Number(currentAmbient.temp).toFixed(1)} °C`;
    if (elStatsHumidity) elStatsHumidity.textContent = `${Number(currentAmbient.humidity).toFixed(0)} %`;
    if (elStatsSoundSpeed) elStatsSoundSpeed.textContent = `${Number(currentAmbient.speedOfSound).toFixed(1)} m/s`;
    if (elStatsDelay) elStatsDelay.textContent = `${Number(currentAmbient.delayPerMeter).toFixed(3)} ms/m`;
  }

  async function fetchVenueData() {
    if (!currentVenueId) return;
    try {
      const res = await fetch(`/api/venues/${currentVenueId}`);
      if (res.ok) {
        const v = await res.json();
        updateEnvironmentalUI({
          temp: v.temperature || 21.0,
          humidity: v.humidity || 50,
          speedOfSound: v.speedOfSound || 344.5,
          delayPerMeter: AcousticMath.calcDelayPerMeter(v.speedOfSound || 344.5)
        });
      }
    } catch (e) {
      console.error('[Venue Fetch Error]:', e);
    }
  }

  async function loadCalibrationHistory() {
    if (!elHistoryTableBody || !currentVenueId) return;
    try {
      const res = await fetch(`/api/venues/${currentVenueId}/calibrations`);
      if (res.ok) {
        const list = await res.json();
        elHistoryTableBody.innerHTML = '';
        if (list.length === 0) {
          elHistoryTableBody.innerHTML = `
            <tr>
              <td colspan="6" class="py-4 text-center text-[#879486] font-mono text-xs">
                No hay snapshots registrados aún para este recinto.
              </td>
            </tr>
          `;
          return;
        }

        list.forEach(c => {
          const tr = document.createElement('tr');
          tr.className = 'border-b border-[#313537]/50 font-mono text-xs hover:bg-[#181c1e]';
          const filterSummary = (c.correctionFilters || []).map(f => `${f.freq}Hz (${f.gainDb > 0 ? '+' : ''}${f.gainDb}dB)`).slice(0, 3).join(', ');
          const envSummary = `${c.temperature ? c.temperature.toFixed(1) + '°C' : '--'} / ${c.humidity ? c.humidity.toFixed(0) + '%' : '--'} / ${c.speedOfSound ? c.speedOfSound.toFixed(1) + 'm/s' : '--'}`;
          
          tr.innerHTML = `
            <td class="py-2.5 px-3 font-semibold text-on-surface">${c.date || c.timestamp.split('T')[0]}</td>
            <td class="py-2.5 px-3 text-[#879486]">${c.time || c.timestamp.split('T')[1].split('.')[0]}</td>
            <td class="py-2.5 px-3 text-on-surface">${c.nodeCount} Móviles</td>
            <td class="py-2.5 px-3 text-[#879486] text-[11px]">${envSummary}</td>
            <td class="py-2.5 px-3 text-[#5edf86] font-bold">${c.avgSPL ? c.avgSPL.toFixed(1) : '--'} dBA</td>
            <td class="py-2.5 px-3 text-on-surface">${filterSummary || 'Respuesta plana (sin filtros)'}</td>
          `;
          elHistoryTableBody.appendChild(tr);
        });
      }
    } catch (e) {}
  }

  // 7. QR Code Modal
  async function showVenueQrModal() {
    if (!elQrModal) return;
    if (!currentVenueId) {
      alert('Debe crear o seleccionar un recinto primero.');
      openCreateVenueModal();
      return;
    }
    try {
      const infoRes = await fetch('/api/server-info');
      const info = await infoRes.json();
      const targetUrl = `${info.httpsUrl}/listener.html?venue=${currentVenueId}`;

      const qrRes = await fetch(`/api/qr?url=${encodeURIComponent(targetUrl)}`);
      const qrData = await qrRes.json();

      if (elQrImg) elQrImg.src = qrData.dataUrl;
      if (elQrUrl) {
        elQrUrl.textContent = targetUrl;
        elQrUrl.href = targetUrl;
      }
      elQrModal.classList.remove('opacity-0', 'pointer-events-none');
    } catch (e) {
      console.error('[QR Error]:', e);
    }
  }

  function hideVenueQrModal() {
    if (elQrModal) elQrModal.classList.add('opacity-0', 'pointer-events-none');
  }

  // 8. Tabs Switching
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.add('hidden'));

      btn.classList.add('active');
      const targetEl = document.getElementById(targetId);
      if (targetEl) targetEl.classList.remove('hidden');

      if (targetId === 'tab-monitoring') {
        setTimeout(resizeCanvas, 50);
      }
    });
  });

  // Event Listeners
  if (elBtnCalibrate) elBtnCalibrate.addEventListener('click', performRoomCalibration);
  if (elBtnSaveSnapshot) elBtnSaveSnapshot.addEventListener('click', () => saveSnapshotRecord([], [], 'Snapshot Manual'));
  if (elBtnShowQr) elBtnShowQr.addEventListener('click', showVenueQrModal);
  if (elQrClose) elQrClose.addEventListener('click', hideVenueQrModal);

  // Venue Modal Listeners
  if (elBtnOpenCreateVenue) elBtnOpenCreateVenue.addEventListener('click', openCreateVenueModal);
  if (elBtnBannerCreateVenue) elBtnBannerCreateVenue.addEventListener('click', openCreateVenueModal);
  if (elBtnCloseCreateVenue) elBtnCloseCreateVenue.addEventListener('click', closeCreateVenueModal);
  if (elBtnCancelCreateVenue) elBtnCancelCreateVenue.addEventListener('click', closeCreateVenueModal);
  if (elBtnSubmitCreateVenue) elBtnSubmitCreateVenue.addEventListener('click', handleCreateVenueSubmit);

  if (elVenueSelect) {
    elVenueSelect.addEventListener('change', (e) => {
      currentVenueId = e.target.value;
      const opt = elVenueSelect.options[elVenueSelect.selectedIndex];
      currentVenueName = opt ? opt.textContent : currentVenueId;

      if (elListenerLink) {
        elListenerLink.href = `/listener.html?venue=${currentVenueId}`;
      }

      activeNodes.clear();
      updateNodeCountDisplay();
      updateNodesListUI();
      fetchVenueData();
      loadCalibrationHistory();

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'register_console', venueId: currentVenueId }));
      }
    });
  }

  // Start System
  resizeCanvas();
  loadVenues();
  connectWebSocket();
  animFrameId = requestAnimationFrame(renderRta);

})();
