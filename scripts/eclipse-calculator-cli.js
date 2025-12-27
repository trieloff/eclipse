#!/usr/bin/env node
/**
 * Solar Eclipse Calculator CLI
 *
 * Node.js command-line interface for the eclipse calculator.
 * For browser usage, import from eclipse-calculator.js directly.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateTotality, ECLIPSE_2026_AUG_12 } from './eclipse-calculator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load eclipse data from a JSON file
 * @param {number|string} year - Eclipse year (e.g., 2026, 2027) or path to JSON file
 * @returns {Object} Besselian elements in the format expected by calculateTotality
 */
export function loadEclipseData(year) {
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

// Re-export for convenience
export { calculateTotality, ECLIPSE_2026_AUG_12 };

// CLI execution
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length < 2) {
  console.log(`
Calculate solar eclipse totality times for a location

Usage:
  node scripts/eclipse-calculator-cli.js <lat> <lon> [alt] [--year=YYYY]

Arguments:
  lat         Latitude in degrees (positive = North)
  lon         Longitude in degrees (positive = East)
  alt         Altitude in meters (optional, default 0)
  --year=YYYY Use eclipse data for specified year (default: 2026)

Example:
  # Oviedo, Spain (on the centerline) - 2026 eclipse
  node scripts/eclipse-calculator-cli.js 43.36 -5.85

  # Luxor, Egypt - 2027 eclipse
  node scripts/eclipse-calculator-cli.js 25.69 32.64 --year=2027

Attribution: Eclipse Predictions by Fred Espenak and Chris O'Byrne (NASA's GSFC)
`);
  process.exit(0);
}

const lat = parseFloat(args[0]);
const lon = parseFloat(args[1]);
const altArg = args.find(a => !a.startsWith('--') && args.indexOf(a) === 2);
const alt = altArg ? parseFloat(altArg) : 0;
const yearArg = args.find(a => a.startsWith('--year='));
const year = yearArg ? parseInt(yearArg.split('=')[1], 10) : null;

if (isNaN(lat) || isNaN(lon)) {
  console.error('Error: Invalid coordinates');
  process.exit(1);
}

let elements = ECLIPSE_2026_AUG_12;
if (year && year !== 2026) {
  try {
    elements = loadEclipseData(year);
  } catch (err) {
    console.error(`Error loading eclipse data for ${year}: ${err.message}`);
    process.exit(1);
  }
}

const result = calculateTotality(lat, lon, elements, alt);
console.log(JSON.stringify(result, null, 2));
