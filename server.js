/**
 * SyncDB WASN Server - Master Node & WebSocket Hub
 * Node.js + Express + WebSockets + Dual HTTP/HTTPS + Local Persistence
 */

const express = require('express');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');
const selfsigned = require('selfsigned');
const cors = require('cors');

const db = require('./data/database');
const AcousticMath = require('./public/js/acoustic-math');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Port configuration
const HTTP_PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Find Primary Local LAN IP
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Prefer Wi-Fi or Ethernet addresses (typically 192.168.x.x or 10.x.x.x)
        if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
          return iface.address;
        }
      }
    }
  }
  // Fallback to any external IPv4
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LAN_IP = getLocalIpAddress();

// Generate Self-Signed SSL Certificate for LAN mobile microphone access
let sslOptions;
try {
  const attrs = [{ name: 'commonName', value: LAN_IP }];
  const pems = selfsigned.generate(attrs, { days: 365 });
  sslOptions = {
    key: pems.private,
    cert: pems.cert
  };
  console.log('[Security] SSL Certificate generated for LAN HTTPS.');
} catch (err) {
  console.warn('[Security] Could not generate self-signed cert, running HTTP only:', err.message);
}

// REST Endpoints

// Server info & network endpoints
app.get('/api/server-info', (req, res) => {
  res.json({
    lanIp: LAN_IP,
    httpPort: HTTP_PORT,
    httpsPort: HTTPS_PORT,
    httpUrl: `http://${LAN_IP}:${HTTP_PORT}`,
    httpsUrl: `https://${LAN_IP}:${HTTPS_PORT}`,
    activeVenues: db.getVenues().map(v => ({ id: v.id, name: v.name }))
  });
});

// QR Code Generator (SVG or Data URL)
app.get('/api/qr', async (req, res) => {
  try {
    const targetUrl = req.query.url || `https://${LAN_IP}:${HTTPS_PORT}/listener.html?venue=AUD-SAL-01`;
    const dataUrl = await QRCode.toDataURL(targetUrl, {
      margin: 1,
      color: {
        dark: '#30b764',
        light: '#101416'
      },
      width: 320
    });
    res.json({ targetUrl, dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Venues API
app.get('/api/venues', (req, res) => {
  res.json(db.getVenues());
});

app.get('/api/venues/:id', (req, res) => {
  const venue = db.getVenueById(req.params.id);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  res.json(venue);
});

app.post('/api/venues', (req, res) => {
  const newVenue = db.createVenue(req.body);
  res.status(201).json(newVenue);
});

// Save calibration
app.post('/api/venues/:id/calibrate', (req, res) => {
  const record = db.saveCalibration(req.params.id, req.body);
  if (!record) return res.status(404).json({ error: 'Venue not found' });
  
  // Broadcast calibration to connected consoles in that room
  broadcastToVenue(req.params.id, {
    type: 'calibration_saved',
    venueId: req.params.id,
    record
  });

  res.status(201).json(record);
});

// List calibrations
app.get('/api/venues/:id/calibrations', (req, res) => {
  res.json(db.getCalibrations(req.params.id));
});

// Weather API proxy (Open-Meteo) for high reliability & no CORS friction
app.get('/api/weather', async (req, res) => {
  const lat = req.query.lat || '19.4326';
  const lon = req.query.lon || '-99.1332';
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.current) {
      const temp = data.current.temperature_2m;
      const humidity = data.current.relative_humidity_2m;
      const speedOfSound = AcousticMath.calcSpeedOfSound(temp, humidity);
      const delayPerMeter = AcousticMath.calcDelayPerMeter(speedOfSound);
      return res.json({
        temperature: temp,
        humidity: humidity,
        speedOfSound,
        delayPerMeter,
        source: 'Open-Meteo Real-Time Weather API'
      });
    }
    res.status(502).json({ error: 'Weather provider returned unexpected format' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Setup HTTP and HTTPS Servers
const httpServer = http.createServer(app);
let httpsServer = null;
if (sslOptions) {
  httpsServer = https.createServer(sslOptions, app);
}

// WebSocket Rooms & State Management
// Room state: venueId -> { consoles: Set, nodes: Map(nodeId -> nodeData) }
const rooms = new Map();

function getOrCreateRoom(venueId) {
  if (!rooms.has(venueId)) {
    rooms.set(venueId, {
      consoles: new Set(),
      nodes: new Map()
    });
  }
  return rooms.get(venueId);
}

function broadcastToVenue(venueId, message, excludeWs = null) {
  const room = rooms.get(venueId);
  if (!room) return;
  const msgStr = typeof message === 'string' ? message : JSON.stringify(message);

  room.consoles.forEach(ws => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(msgStr);
    }
  });

  room.nodes.forEach(node => {
    if (node.ws !== excludeWs && node.ws.readyState === WebSocket.OPEN) {
      node.ws.send(msgStr);
    }
  });
}

function broadcastToConsoles(venueId, message) {
  const room = rooms.get(venueId);
  if (!room) return;
  const msgStr = typeof message === 'string' ? message : JSON.stringify(message);
  room.consoles.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msgStr);
    }
  });
}

// Handle WebSocket Connection
function setupWebSocketServer(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let clientVenue = null;
    let clientRole = null;
    let clientNodeId = null;

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);

        switch (data.type) {
          // Master Console joining a venue
          case 'register_console': {
            clientVenue = data.venueId || 'AUD-SAL-01';
            clientRole = 'console';
            const room = getOrCreateRoom(clientVenue);
            room.consoles.add(ws);

            // Send initial state: list of currently active nodes
            const nodeList = Array.from(room.nodes.values()).map(n => ({
              nodeId: n.nodeId,
              userAgent: n.userAgent,
              micCalibrated: n.micCalibrated,
              splDb: n.lastSpl || 0,
              coords: n.coords || null,
              temp: n.temp || null,
              humidity: n.humidity || null,
              lastSeen: n.lastSeen
            }));

            ws.send(JSON.stringify({
              type: 'venue_state',
              venueId: clientVenue,
              nodes: nodeList,
              nodeCount: nodeList.length
            }));
            break;
          }

          // Listener phone joining a venue
          case 'register_node': {
            clientVenue = data.venueId || 'AUD-SAL-01';
            clientRole = 'listener';
            clientNodeId = data.nodeId || `NODE-${Date.now().toString(36).substr(-4).toUpperCase()}`;

            const room = getOrCreateRoom(clientVenue);
            const nodeInfo = {
              ws,
              nodeId: clientNodeId,
              userAgent: data.userAgent || 'Mobile Transducer',
              micCalibrated: !!data.micCalibrated,
              coords: data.coords || null,
              temp: data.temp || null,
              humidity: data.humidity || null,
              lastSeen: Date.now(),
              lastSpl: 0
            };
            room.nodes.set(clientNodeId, nodeInfo);

            // Update venue environmental telemetry if phone reported it
            if (data.temp !== undefined && data.humidity !== undefined) {
              const c = AcousticMath.calcSpeedOfSound(data.temp, data.humidity);
              db.updateVenueEnvironmentalData(clientVenue, {
                temperature: data.temp,
                humidity: data.humidity,
                speedOfSound: c
              });
            }

            // Notify consoles
            broadcastToConsoles(clientVenue, {
              type: 'node_joined',
              venueId: clientVenue,
              node: {
                nodeId: clientNodeId,
                userAgent: nodeInfo.userAgent,
                micCalibrated: nodeInfo.micCalibrated,
                temp: nodeInfo.temp,
                humidity: nodeInfo.humidity
              },
              nodeCount: room.nodes.size
            });

            // Ack to the node
            ws.send(JSON.stringify({
              type: 'registered',
              nodeId: clientNodeId,
              venueId: clientVenue
            }));
            break;
          }

          // Audio streaming from listener phone
          case 'audio_stream': {
            if (!clientVenue || !clientNodeId) return;
            const room = rooms.get(clientVenue);
            if (!room) return;

            const node = room.nodes.get(clientNodeId);
            if (node) {
              node.lastSeen = Date.now();
              node.lastSpl = data.splDb || 0;
              node.micCalibrated = !!data.micCalibrated;
            }

            // Relay live audio spectrum to consoles monitoring this venue
            broadcastToConsoles(clientVenue, {
              type: 'audio_stream',
              venueId: clientVenue,
              nodeId: clientNodeId,
              splDb: data.splDb,
              octaves: data.octaves, // [ { freq: 31.5, magnitude: -12.4 }, ... ]
              rawOctaves: data.rawOctaves,
              micCalibrated: data.micCalibrated,
              timestamp: Date.now()
            });
            break;
          }

          // Weather/Environmental update from listener phone
          case 'environmental_telemetry': {
            if (!clientVenue) return;
            const room = rooms.get(clientVenue);
            if (room && clientNodeId) {
              const node = room.nodes.get(clientNodeId);
              if (node) {
                node.coords = data.coords;
                node.temp = data.temp;
                node.humidity = data.humidity;
              }
            }
            if (data.temp !== undefined && data.humidity !== undefined) {
              const c = AcousticMath.calcSpeedOfSound(data.temp, data.humidity);
              db.updateVenueEnvironmentalData(clientVenue, {
                temperature: data.temp,
                humidity: data.humidity,
                speedOfSound: c
              });
              broadcastToConsoles(clientVenue, {
                type: 'venue_weather_updated',
                venueId: clientVenue,
                temp: data.temp,
                humidity: data.humidity,
                speedOfSound: c,
                delayPerMeter: AcousticMath.calcDelayPerMeter(c)
              });
            }
            break;
          }

          // Toggle mic calibration state from node
          case 'set_mic_calibration': {
            if (!clientVenue || !clientNodeId) return;
            const room = rooms.get(clientVenue);
            if (room) {
              const node = room.nodes.get(clientNodeId);
              if (node) {
                node.micCalibrated = !!data.enabled;
                broadcastToConsoles(clientVenue, {
                  type: 'node_updated',
                  nodeId: clientNodeId,
                  micCalibrated: node.micCalibrated
                });
              }
            }
            break;
          }
        }
      } catch (e) {
        console.error('[WS Parse Error]:', e);
      }
    });

    ws.on('close', () => {
      if (clientVenue) {
        const room = rooms.get(clientVenue);
        if (room) {
          if (clientRole === 'console') {
            room.consoles.delete(ws);
          } else if (clientRole === 'listener' && clientNodeId) {
            room.nodes.delete(clientNodeId);
            broadcastToConsoles(clientVenue, {
              type: 'node_left',
              venueId: clientVenue,
              nodeId: clientNodeId,
              nodeCount: room.nodes.size
            });
          }
        }
      }
    });
  });

  return wss;
}

// Start WebSocket on HTTP Server
setupWebSocketServer(httpServer);

// If HTTPS available, start WebSocket on HTTPS Server as well
if (httpsServer) {
  setupWebSocketServer(httpsServer);
}

// Launch Servers
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`[SyncDB WASN Console] Servidor iniciado con éxito`);
  console.log(`> Consola Master (Local):   http://localhost:${HTTP_PORT}`);
  console.log(`> Consola Master (LAN):     http://${LAN_IP}:${HTTP_PORT}`);
  console.log(`> Modo Oyente (Móvil LAN):  http://${LAN_IP}:${HTTP_PORT}/listener.html?venue=AUD-SAL-01`);
  if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`> Modo Oyente (HTTPS LAN): https://${LAN_IP}:${HTTPS_PORT}/listener.html?venue=AUD-SAL-01`);
      console.log(`  (Recomendado para móviles: Permite acceso a Micrófono y GPS)`);
      console.log(`======================================================\n`);
    });
  } else {
    console.log(`======================================================\n`);
  }
});
