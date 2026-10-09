/**
 * SyncDB Acoustic Math & Physics Engine
 * Shared client/server acoustic algorithms for WASN.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AcousticMath = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // IEC 61672-1 Standard 1/1 Octave Band Centers (Hz)
  const OCTAVES_1_1 = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  // Standard 1/3 Octave Centers (Hz)
  const OCTAVES_1_3 = [
    25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 
    400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 
    4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
  ];

  /**
   * Typical Smartphone MEMS Microphone Hardware Deviation relative to Class 1 Flat
   * (Values in dB of the raw phone microphone bias)
   */
  const PHONE_RAW_BIAS = {
    31.5: -14.2,
    63:   -8.8,
    125:  -3.5,
    250:  -0.5,
    500:   0.0,
    1000:  0.0,
    2000: +1.2,
    4000: +4.8, // Port resonance
    8000: -1.5,
    16000: -5.4
  };

  /**
   * Calculates real Speed of Sound (m/s) given Temperature (°C) and Relative Humidity (%)
   * Formula: Cramer (1993) / ISO 9613-1 approximation
   */
  function calcSpeedOfSound(tempC, humidityPercent = 50) {
    const T = Number(tempC);
    const RH = Number(humidityPercent);
    // c = 331.4 + (0.606 * T) + (0.0124 * RH)
    const c = 331.4 + (0.606 * T) + (0.0124 * RH);
    return Math.round(c * 100) / 100;
  }

  /**
   * Calculates Acoustic Latency / Delay per meter of distance
   * Return: milliseconds per meter (ms/m)
   */
  function calcDelayPerMeter(speedOfSound) {
    if (!speedOfSound || speedOfSound <= 0) speedOfSound = 343.5;
    const msPerMeter = 1000 / speedOfSound;
    return Math.round(msPerMeter * 1000) / 1000;
  }

  /**
   * Returns inverse compensation gain (dB) to flatten smartphone microphone response
   * @param {number} freq - Frequency in Hz
   * @returns {number} Offset in dB to add to raw reading
   */
  function getPhoneCalibrationOffset(freq) {
    // Interpolate offset based on nearest octaves
    const keys = OCTAVES_1_1;
    if (freq <= keys[0]) return -PHONE_RAW_BIAS[keys[0]];
    if (freq >= keys[keys.length - 1]) return -PHONE_RAW_BIAS[keys[keys.length - 1]];

    for (let i = 0; i < keys.length - 1; i++) {
      const f1 = keys[i];
      const f2 = keys[i + 1];
      if (freq >= f1 && freq <= f2) {
        const ratio = (Math.log10(freq) - Math.log10(f1)) / (Math.log10(f2) - Math.log10(f1));
        const bias1 = PHONE_RAW_BIAS[f1];
        const bias2 = PHONE_RAW_BIAS[f2];
        const bias = bias1 + ratio * (bias2 - bias1);
        return -bias; // Inverse to cancel bias!
      }
    }
    return 0;
  }

  /**
   * Applies calibration curve to an array of octave magnitudes
   * @param {Array<{freq: number, magnitude: number}>} octaveData
   * @param {boolean} applyCalibration
   */
  function calibrateOctaveArray(octaveData, applyCalibration = true) {
    return octaveData.map(item => {
      const offset = applyCalibration ? getPhoneCalibrationOffset(item.freq) : 0;
      return {
        freq: item.freq,
        rawMagnitude: item.magnitude,
        calibratedMagnitude: Math.round((item.magnitude + offset) * 10) / 10,
        offsetApplied: Math.round(offset * 10) / 10
      };
    });
  }

  /**
   * Calculates Parametric Auto-EQ Filters to achieve Flat Room Target Curve
   * @param {Array<{freq: number, magnitude: number}>} measuredOctaves - Average from nodes
   * @param {number} targetLevel - Target dB reference (e.g., 0 dB normalized or mean SPL)
   * @returns {Array<{band: string, freq: number, gainDb: number, q: number, type: string}>}
   */
  function computeAutoEqFilters(measuredOctaves, targetLevel = null) {
    if (!measuredOctaves || measuredOctaves.length === 0) return [];

    // Calculate baseline mean if target not specified
    const sum = measuredOctaves.reduce((acc, curr) => acc + curr.magnitude, 0);
    const mean = targetLevel !== null ? targetLevel : (sum / measuredOctaves.length);

    const filters = [];

    measuredOctaves.forEach(pt => {
      const deviation = pt.magnitude - mean;
      // We only correct if deviation exceeds threshold (e.g. ±1.5 dB)
      if (Math.abs(deviation) >= 1.5) {
        // Inverse gain to counteract room peak or room null
        // Limit max boost to +8 dB to avoid digital clipping / speaker burnout
        let correctionGain = -deviation;
        if (correctionGain > 8) correctionGain = 8;
        if (correctionGain < -12) correctionGain = -12;

        let q = 1.414; // Default 1/1 octave Q
        if (pt.freq <= 125) q = 2.0; // Narrower for room low-end modes
        if (pt.freq >= 8000) q = 1.0; // Gentler for HF air

        let bandName = "Media";
        if (pt.freq <= 63) bandName = "Subgrave";
        else if (pt.freq <= 250) bandName = "Grave";
        else if (pt.freq <= 2000) bandName = "Medio";
        else if (pt.freq <= 6000) bandName = "Medio-Agudo";
        else bandName = "Agudo";

        filters.push({
          band: bandName,
          freq: pt.freq,
          gainDb: Math.round(correctionGain * 10) / 10,
          q: q,
          type: correctionGain > 0 ? "PEQ Boost" : "PEQ Cut"
        });
      }
    });

    return filters;
  }

  /**
   * Evaluates the real-time health / level of calibration against 0 dB flat target
   * @param {Array<{freq: number, magnitude: number}>} measuredOctaves
   * @returns {{ status: string, maxDeviation: number, color: string, badgeClass: string }}
   */
  function evaluateCalibrationHealth(measuredOctaves) {
    if (!measuredOctaves || measuredOctaves.length === 0) {
      return { status: 'SIN SEÑAL', maxDeviation: 0, color: '#879486', badgeClass: 'bg-[#181c1e] text-[#879486] border-[#313537]' };
    }
    let maxDev = 0;
    measuredOctaves.forEach(pt => {
      const dev = Math.abs(pt.magnitude);
      if (dev > maxDev) maxDev = dev;
    });
    maxDev = Math.round(maxDev * 10) / 10;

    if (maxDev <= 1.2) {
      return { status: 'PERFECTO (PLANO)', maxDeviation: maxDev, color: '#5edf86', badgeClass: 'bg-[#30b764]/20 text-[#5edf86] border-[#30b764]/50' };
    } else if (maxDev <= 2.2) {
      return { status: 'EXCELENTE', maxDeviation: maxDev, color: '#5edf86', badgeClass: 'bg-[#30b764]/20 text-[#5edf86] border-[#30b764]/50' };
    } else if (maxDev <= 3.8) {
      return { status: 'CALIBRACIÓN BUENA', maxDeviation: maxDev, color: '#ffca45', badgeClass: 'bg-[#ffca45]/20 text-[#ffca45] border-[#ffca45]/50' };
    } else {
      return { status: 'DESVIACIÓN ALTA', maxDeviation: maxDev, color: '#ffb4ab', badgeClass: 'bg-[#93000a]/20 text-[#ffb4ab] border-[#93000a]/50' };
    }
  }

  return {
    OCTAVES_1_1,
    OCTAVES_1_3,
    PHONE_RAW_BIAS,
    calcSpeedOfSound,
    calcDelayPerMeter,
    getPhoneCalibrationOffset,
    calibrateOctaveArray,
    computeAutoEqFilters,
    evaluateCalibrationHealth
  };
}));
