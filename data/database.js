/**
 * SyncDB WASN - Database Layer
 * Local JSON/File persistence with Firestore integration adapter.
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'venues.json');

// Ensure data directory exists
if (!fs.existsSync(__dirname)) {
  fs.mkdirSync(__dirname, { recursive: true });
}

// Initial default database structure
const DEFAULT_DB = {
  venues: []
};

function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf8');
      return DEFAULT_DB;
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[DB Error] Failed to read database file:', err);
    return DEFAULT_DB;
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[DB Error] Failed to write database file:', err);
    return false;
  }
}

const db = {
  getVenues: () => {
    const data = readDb();
    return data.venues || [];
  },

  getVenueById: (id) => {
    const data = readDb();
    return (data.venues || []).find(v => v.id === id);
  },

  createVenue: (venueData) => {
    const data = readDb();
    const id = venueData.id || `VEN-${Date.now().toString(36).toUpperCase()}`;
    const newVenue = {
      id,
      name: venueData.name || `Recinto ${id}`,
      capacity: venueData.capacity || 200,
      surface: venueData.surface || "Estándar",
      createdAt: new Date().toISOString(),
      temperature: venueData.temperature || 20.0,
      humidity: venueData.humidity || 50,
      speedOfSound: venueData.speedOfSound || 343.5,
      calibrations: []
    };
    data.venues.push(newVenue);
    writeDb(data);
    return newVenue;
  },

  updateVenueEnvironmentalData: (id, { temperature, humidity, speedOfSound }) => {
    const data = readDb();
    const venue = (data.venues || []).find(v => v.id === id);
    if (!venue) return null;
    if (temperature !== undefined) venue.temperature = temperature;
    if (humidity !== undefined) venue.humidity = humidity;
    if (speedOfSound !== undefined) venue.speedOfSound = speedOfSound;
    venue.lastWeatherSync = new Date().toISOString();
    writeDb(data);
    return venue;
  },

  saveCalibration: (venueId, calibration) => {
    const data = readDb();
    const venue = (data.venues || []).find(v => v.id === venueId);
    if (!venue) return null;

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];

    const record = {
      id: `SNAP-${Date.now()}`,
      date: dateStr,
      time: timeStr,
      timestamp: now.toISOString(),
      venueId: venueId,
      venueName: venue.name,
      nodeCount: calibration.nodeCount || 1,
      nodesDetail: calibration.nodesDetail || [],
      avgSPL: calibration.avgSPL || 0,
      speedOfSound: calibration.speedOfSound || venue.speedOfSound,
      temperature: calibration.temperature || venue.temperature,
      humidity: calibration.humidity || venue.humidity,
      delayPerMeter: calibration.delayPerMeter || (1000 / (calibration.speedOfSound || venue.speedOfSound)),
      measuredCurve: calibration.measuredCurve || [],
      correctionFilters: calibration.correctionFilters || [],
      notes: calibration.notes || "Snapshot de calibración acústica"
    };

    if (!venue.calibrations) venue.calibrations = [];
    venue.calibrations.unshift(record); // newest first
    writeDb(data);
    return record;
  },

  getCalibrations: (venueId) => {
    const venue = db.getVenueById(venueId);
    return venue ? (venue.calibrations || []) : [];
  }
};

module.exports = db;
