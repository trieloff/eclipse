/**
 * Solar Eclipse Calculator
 *
 * Calculates local circumstances (totality start/end times) for a solar eclipse
 * given geographic coordinates and Besselian elements.
 *
 * Based on algorithms from NASA's JavaScript Solar Eclipse Explorer
 * by Chris O'Byrne and Fred Espenak (GPL licensed)
 *
 * Attribution: Eclipse Predictions by Fred Espenak and Chris O'Byrne (NASA's GSFC)
 *
 * Usage:
 *   import { calculateTotality, ECLIPSE_2026_AUG_12, loadEclipseData } from './eclipse-calculator.js';
 *   const result = calculateTotality(43.36, -5.85, ECLIPSE_2026_AUG_12);
 *   console.log(result.start, result.end, result.duration);
 *
 *   // Or load dynamically from data file:
 *   const eclipse2027 = await loadEclipseData(2027);
 *   const result = calculateTotality(lat, lon, eclipse2027);
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Besselian Elements for Total Solar Eclipse of 2026 Aug 12
// Source: https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html
export const ECLIPSE_2026_AUG_12 = {
  date: '2026-08-12',
  t0: 18.0, // Reference time in TDT (decimal hours)
  deltaT: 71.4, // Difference between TDT and UT in seconds

  // Polynomial coefficients for Besselian elements
  // a = a0 + a1*t + a2*t^2 + a3*t^3 where t = t1 - t0
  x: [0.475593, 0.5189288, -0.0000773, -0.0000088],
  y: [0.771161, -0.2301664, -0.0001245, 0.0000037],
  d: [14.79667, -0.012065, -0.000003, 0], // Sun's declination (degrees)
  l1: [0.537954, 0.0000940, -0.0000121, 0], // Penumbral radius
  l2: [-0.008142, 0.0000935, -0.0000121, 0], // Umbral radius
  mu: [88.74776, 15.003093, 0, 0], // Hour angle of shadow axis

  // Shadow cone angles
  tanF1: 0.0046141, // Penumbra
  tanF2: 0.0045911, // Umbra

  // Lunar radius constants
  k1: 0.272488, // Penumbra
  k2: 0.272281, // Umbra

  // Valid time range (TDT hours)
  validFrom: 15.0,
  validTo: 21.0
};

/**
 * Load eclipse data from a JSON file
 * @param {number|string} year - Eclipse year (e.g., 2026, 2027) or path to JSON file
 * @returns {Promise<Object>} Besselian elements in the format expected by calculateTotality
 */
export async function loadEclipseData(year) {
  let filePath;
  if (typeof year === 'string' && year.endsWith('.json')) {
    filePath = year;
  } else {
    filePath = path.join(__dirname, '..', 'data', `eclipse-${year}.json`);
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  if (!data.besselianElements?.elements) {
    throw new Error(`No Besselian elements found in ${filePath}`);
  }

  const el = data.besselianElements.elements;

  // Return in the format expected by calculateTotality
  return {
    date: el.date || data.eclipse?.date,
    t0: el.t0,
    deltaT: el.deltaT,
    x: el.x,
    y: el.y,
    d: el.d,
    l1: el.l1,
    l2: el.l2,
    mu: el.mu,
    tanF1: el.tanF1,
    tanF2: el.tanF2,
    k1: el.k1,
    k2: el.k2
  };
}

/**
 * Load eclipse data synchronously from a JSON file
 * @param {number|string} year - Eclipse year (e.g., 2026, 2027) or path to JSON file
 * @returns {Object} Besselian elements in the format expected by calculateTotality
 */
export function loadEclipseDataSync(year) {
  let filePath;
  if (typeof year === 'string' && year.endsWith('.json')) {
    filePath = year;
  } else {
    filePath = path.join(__dirname, '..', 'data', `eclipse-${year}.json`);
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  if (!data.besselianElements?.elements) {
    throw new Error(`No Besselian elements found in ${filePath}`);
  }

  const el = data.besselianElements.elements;

  // Return in the format expected by calculateTotality
  return {
    date: el.date || data.eclipse?.date,
    t0: el.t0,
    deltaT: el.deltaT,
    x: el.x,
    y: el.y,
    d: el.d,
    l1: el.l1,
    l2: el.l2,
    mu: el.mu,
    tanF1: el.tanF1,
    tanF2: el.tanF2,
    k1: el.k1,
    k2: el.k2
  };
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Evaluate polynomial: a0 + a1*t + a2*t^2 + a3*t^3
 */
function poly(coeffs, t) {
  let result = 0;
  let tPower = 1;
  for (const c of coeffs) {
    result += c * tPower;
    tPower *= t;
  }
  return result;
}

/**
 * Evaluate polynomial derivative: a1 + 2*a2*t + 3*a3*t^2
 */
function polyDeriv(coeffs, t) {
  if (coeffs.length < 2) return 0;
  let result = coeffs[1];
  if (coeffs.length > 2) result += 2 * coeffs[2] * t;
  if (coeffs.length > 3) result += 3 * coeffs[3] * t * t;
  return result;
}

/**
 * Calculate observer constants for a given location
 * @param {number} lat - Latitude in degrees (positive = North)
 * @param {number} lon - Longitude in degrees (positive = East)
 * @param {number} alt - Altitude in meters (default 0)
 * @returns {Object} Observer constants
 */
function getObserverConstants(lat, lon, alt = 0) {
  const latRad = lat * DEG_TO_RAD;
  // Convert to west longitude (positive = West) as used in Besselian elements
  const lonRadW = -lon * DEG_TO_RAD;

  // Calculate geocentric latitude and radius
  // Earth flattening factor
  const f = 1 / 298.257;
  const e2 = 2 * f - f * f;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);

  // Geocentric radius vector components
  const C = 1 / Math.sqrt(1 - e2 * sinLat * sinLat);
  const S = (1 - e2) * C;

  // Height in Earth radii
  const h = alt / 6378137;

  const rhoSinPhi = S * sinLat + h * sinLat; // rho * sin(geocentric lat)
  const rhoCosPhi = C * cosLat + h * cosLat; // rho * cos(geocentric lat)

  return {
    lat: latRad,
    lonW: lonRadW,
    alt,
    rhoSinPhi,
    rhoCosPhi
  };
}

/**
 * Calculate time-dependent Besselian elements
 */
function calcElements(elements, t) {
  const x = poly(elements.x, t);
  const y = poly(elements.y, t);
  const d = poly(elements.d, t) * DEG_TO_RAD;
  const l1 = poly(elements.l1, t);
  const l2 = poly(elements.l2, t);
  const mu = poly(elements.mu, t) * DEG_TO_RAD;

  const dx = polyDeriv(elements.x, t);
  const dy = polyDeriv(elements.y, t);
  const dd = polyDeriv(elements.d, t) * DEG_TO_RAD;
  const dmu = polyDeriv(elements.mu, t) * DEG_TO_RAD;
  const dl1 = polyDeriv(elements.l1, t);
  const dl2 = polyDeriv(elements.l2, t);

  return { x, y, d, l1, l2, mu, dx, dy, dd, dmu, dl1, dl2 };
}

/**
 * Calculate location-dependent circumstances
 */
function calcCircumstances(elements, obs, t, besselian) {
  const el = calcElements(besselian, t);

  // Hour angle
  const h = el.mu - obs.lonW - (besselian.deltaT / 13713.44);
  const sinH = Math.sin(h);
  const cosH = Math.cos(h);
  const sinD = Math.sin(el.d);
  const cosD = Math.cos(el.d);

  // Calculate xi, eta, zeta (shadow coordinates)
  const xi = obs.rhoCosPhi * sinH;
  const eta = obs.rhoSinPhi * cosD - obs.rhoCosPhi * cosH * sinD;
  const zeta = obs.rhoSinPhi * sinD + obs.rhoCosPhi * cosH * cosD;

  // Derivatives
  const dxi = el.dmu * obs.rhoCosPhi * cosH;
  const deta = el.dmu * xi * sinD - zeta * el.dd;

  // Shadow position relative to observer
  const u = el.x - xi;
  const v = el.y - eta;

  // Derivatives
  const a = el.dx - dxi;
  const b = el.dy - deta;

  // Calculate l1' and l2' (adjusted penumbral/umbral radii)
  const l1Prime = el.l1 - zeta * besselian.tanF1;
  const l2Prime = el.l2 - zeta * besselian.tanF2;

  // n squared
  const n2 = a * a + b * b;

  // Distance from shadow axis
  const m = Math.sqrt(u * u + v * v);

  return {
    t, u, v, a, b, l1Prime, l2Prime, n2, m, h, sinD, cosD, sinH, cosH,
    xi, eta, zeta
  };
}

/**
 * Calculate mid-eclipse time for a location
 */
function calcMidEclipse(obs, besselian) {
  let t = 0;
  let iter = 0;
  const maxIter = 50;

  while (iter < maxIter) {
    const c = calcCircumstances(null, obs, t, besselian);
    const tmp = (c.u * c.a + c.v * c.b) / c.n2;

    if (Math.abs(tmp) < 0.000001) break;

    t -= tmp;
    iter++;
  }

  return t;
}

/**
 * Calculate contact times (C2 = start of totality, C3 = end of totality)
 */
function calcContactTimes(obs, besselian, midT) {
  const midC = calcCircumstances(null, obs, midT, besselian);

  // Check if location is in path of totality
  // Totality occurs when observer is within umbral shadow (m < |l2'|)
  if (midC.m >= Math.abs(midC.l2Prime)) {
    // Not in totality - might be partial or annular
    return {
      inTotality: false,
      magnitude: (midC.l1Prime - midC.m) / (midC.l1Prime + midC.l2Prime)
    };
  }

  // Calculate initial estimates for C2 and C3
  const n = Math.sqrt(midC.n2);
  const tau = midC.a * midC.v - midC.u * midC.b;
  const tau2 = tau / n / midC.l2Prime;
  const dtau = Math.sqrt(1 - tau2 * tau2) * Math.abs(midC.l2Prime) / n;

  let c2t = midT - dtau;
  let c3t = midT + dtau;

  // Iterate to refine C2
  for (let iter = 0; iter < 50; iter++) {
    const c = calcCircumstances(null, obs, c2t, besselian);
    const n = Math.sqrt(c.n2);
    const tau = c.a * c.v - c.u * c.b;
    const sign = c.l2Prime < 0 ? 1 : -1;
    const dtau = tau / n / c.l2Prime;
    const tmp = sign * Math.sqrt(1 - dtau * dtau) * c.l2Prime / n;
    const correction = (c.u * c.a + c.v * c.b) / c.n2 - tmp;

    if (Math.abs(correction) < 0.000001) break;
    c2t -= correction;
  }

  // Iterate to refine C3
  for (let iter = 0; iter < 50; iter++) {
    const c = calcCircumstances(null, obs, c3t, besselian);
    const n = Math.sqrt(c.n2);
    const tau = c.a * c.v - c.u * c.b;
    const sign = c.l2Prime < 0 ? -1 : 1;
    const dtau = tau / n / c.l2Prime;
    const tmp = sign * Math.sqrt(1 - dtau * dtau) * c.l2Prime / n;
    const correction = (c.u * c.a + c.v * c.b) / c.n2 - tmp;

    if (Math.abs(correction) < 0.000001) break;
    c3t -= correction;
  }

  return {
    inTotality: true,
    c2: c2t,
    c3: c3t,
    midT
  };
}

/**
 * Convert decimal hours (relative to t0 in TDT) to ISO timestamp
 */
function toIsoTimestamp(t, besselian) {
  // t is relative to t0 (in TDT hours)
  // Convert to UT by subtracting deltaT
  const tdtHours = besselian.t0 + t;
  const utHours = tdtHours - besselian.deltaT / 3600;

  const hours = Math.floor(utHours);
  const minutes = Math.floor((utHours - hours) * 60);
  const seconds = ((utHours - hours) * 60 - minutes) * 60;

  const hh = hours.toString().padStart(2, '0');
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toFixed(1).padStart(4, '0');

  return `${besselian.date}T${hh}:${mm}:${ss}Z`;
}

/**
 * Calculate totality times for a given location
 *
 * @param {number} lat - Latitude in degrees (positive = North)
 * @param {number} lon - Longitude in degrees (positive = East)
 * @param {Object} besselian - Besselian elements for the eclipse
 * @param {number} alt - Altitude in meters (default 0)
 * @returns {Object} Totality information
 */
export function calculateTotality(lat, lon, besselian = ECLIPSE_2026_AUG_12, alt = 0) {
  const obs = getObserverConstants(lat, lon, alt);
  const midT = calcMidEclipse(obs, besselian);
  const contacts = calcContactTimes(obs, besselian, midT);

  if (!contacts.inTotality) {
    return {
      inTotality: false,
      lat,
      lon,
      magnitude: contacts.magnitude,
      message: 'Location is not in the path of totality'
    };
  }

  const durationSeconds = (contacts.c3 - contacts.c2) * 3600;

  return {
    inTotality: true,
    lat,
    lon,
    start: toIsoTimestamp(contacts.c2, besselian),
    end: toIsoTimestamp(contacts.c3, besselian),
    mid: toIsoTimestamp(contacts.midT, besselian),
    durationSeconds: Math.round(durationSeconds * 10) / 10,
    durationFormatted: formatDuration(durationSeconds)
  };
}

/**
 * Format duration in seconds to mm:ss.s
 */
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}m ${secs}s`;
}

// CLI execution
if (typeof process !== 'undefined' && process.argv[1]?.includes('eclipse-calculator')) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length < 2) {
    console.log(`
Calculate solar eclipse totality times for a location

Usage:
  node scripts/eclipse-calculator.js <lat> <lon> [alt]

Arguments:
  lat    Latitude in degrees (positive = North)
  lon    Longitude in degrees (positive = East)
  alt    Altitude in meters (optional, default 0)

Example:
  # Oviedo, Spain (on the centerline)
  node scripts/eclipse-calculator.js 43.36 -5.85

  # Valencia, Spain (near edge of path)
  node scripts/eclipse-calculator.js 39.47 -0.38

Attribution: Eclipse Predictions by Fred Espenak and Chris O'Byrne (NASA's GSFC)
`);
    process.exit(0);
  }

  const lat = parseFloat(args[0]);
  const lon = parseFloat(args[1]);
  const alt = args[2] ? parseFloat(args[2]) : 0;

  if (isNaN(lat) || isNaN(lon)) {
    console.error('Error: Invalid coordinates');
    process.exit(1);
  }

  const result = calculateTotality(lat, lon, ECLIPSE_2026_AUG_12, alt);
  console.log(JSON.stringify(result, null, 2));
}
