#!/usr/bin/env node
/**
 * Build Cloud Cover Climatology for Eclipse Path
 *
 * Downloads CLARA-A3 cloud cover data from EUMETSAT and computes
 * a climatology for the eclipse path region.
 *
 * Usage:
 *   node scripts/build-cloud-climatology.js <year>
 *   node scripts/build-cloud-climatology.js 2026
 *   node scripts/build-cloud-climatology.js 2027
 *
 * Environment variables:
 *   EUMETSAT_KEY    - API consumer key
 *   EUMETSAT_SECRET - API consumer secret
 *
 * Output:
 *   data/cloud-{year}.json - Cloud climatology for eclipse path
 *
 * Attribution: CM SAF/EUMETSAT (CLARA-A3)
 */

import fs from 'fs';
import path from 'path';
import { calculateTotality, loadEclipseDataSync } from './eclipse-calculator.js';

const EUMETSAT_TOKEN_URL = 'https://api.eumetsat.int/token';
const EUMETSAT_SEARCH_URL = 'https://api.eumetsat.int/data/search-products/1.0.0/os';
const EUMETSAT_DOWNLOAD_URL = 'https://api.eumetsat.int/data/download/1.0.0';
const COLLECTION_ID = 'EO:EUM:DAT:0874';

/**
 * Build configuration from eclipse year
 * @param {number} year - Eclipse year
 * @returns {Object} Configuration object
 */
function buildConfig(year) {
  // Load eclipse data to get the date
  const eclipseData = loadEclipseDataSync(year);
  const [yearStr, monthStr, dayStr] = eclipseData.date.split('-');

  return {
    // Eclipse year (for output file naming)
    eclipseYear: parseInt(yearStr),
    eclipseMonth: parseInt(monthStr),
    eclipseDay: parseInt(dayStr),

    // Date range: +/- 10 days around eclipse day
    dayRange: 10,

    // Year range for climatology
    startYear: 2002,
    endYear: 2020,

    // Grid resolution (matches CLARA-A3)
    gridResolution: 0.25,

    // Padding around path (in grid cells) - cells within this distance of path are included
    cellPadding: 8,  // 8 cells = 2 degrees at 0.25° resolution

    // Output paths
    outputDir: 'data',
    cacheDir: 'data/cloud-cover/daily-cache',

    // Eclipse data for path calculations
    eclipseElements: eclipseData
  };
}

// Default configuration (will be overwritten in main)
let CONFIG = null;


/**
 * Get OAuth2 access token
 */
async function getToken(key, secret) {
  const creds = Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await fetch(EUMETSAT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

/**
 * Search for CFC products for a specific date
 */
async function searchProducts(date) {
  const params = new URLSearchParams({
    format: 'json',
    pi: COLLECTION_ID,
    type: 'CFC',
    dtstart: date,
    dtend: date,
    c: 10
  });

  const res = await fetch(`${EUMETSAT_SEARCH_URL}?${params}`);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

/**
 * Download a NetCDF file
 */
async function downloadFile(token, productId, outputPath) {
  const url = `${EUMETSAT_DOWNLOAD_URL}/collections/EO%3AEUM%3ADAT%3A0874/products/${productId}/entry?name=${productId}.nc`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const buffer = await res.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  return outputPath;
}

/**
 * Generate list of dates to download
 * Handles month boundaries correctly using Date objects
 */
function getDateList() {
  const dates = [];

  for (let year = CONFIG.startYear; year <= CONFIG.endYear; year++) {
    // Create base date for this year with the eclipse month/day
    const baseDate = new Date(Date.UTC(year, CONFIG.eclipseMonth - 1, CONFIG.eclipseDay));

    for (let offset = -CONFIG.dayRange; offset <= CONFIG.dayRange; offset++) {
      const date = new Date(baseDate);
      date.setUTCDate(date.getUTCDate() + offset);

      const y = date.getUTCFullYear();
      const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const d = date.getUTCDate().toString().padStart(2, '0');

      dates.push({
        year: y,
        date: `${y}-${m}-${d}`,
        productId: `CFCdm${y}${m}${d}000000319AVPOS01GL`
      });
    }
  }
  return dates;
}

/**
 * Download all required files
 */
async function downloadAllFiles(token) {
  const dates = getDateList();
  const cacheDir = CONFIG.cacheDir;

  fs.mkdirSync(cacheDir, { recursive: true });

  let downloaded = 0;
  let cached = 0;
  let failed = 0;

  for (const { year, date, productId } of dates) {
    const cachePath = path.join(cacheDir, `${productId}.nc`);

    if (fs.existsSync(cachePath)) {
      cached++;
      continue;
    }

    try {
      await downloadFile(token, productId, cachePath);
      downloaded++;
      process.stderr.write(`\rDownloaded: ${downloaded}, Cached: ${cached}, Failed: ${failed}`);
    } catch (e) {
      failed++;
      console.error(`\nFailed to download ${date}: ${e.message}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  console.error(`\nDownload complete: ${downloaded} new, ${cached} cached, ${failed} failed`);
  return { downloaded, cached, failed };
}

/**
 * Check if a grid cell touches the path of totality
 * Tests all 4 corners of the cell
 */
function cellTouchesPath(lat, lon, resolution, eclipseElements) {
  const corners = [
    [lat, lon],                           // SW
    [lat + resolution, lon],              // NW
    [lat, lon + resolution],              // SE
    [lat + resolution, lon + resolution]  // NE
  ];

  for (const [clat, clon] of corners) {
    const result = calculateTotality(clat, clon, eclipseElements);
    if (result.inTotality) {
      return true;
    }
  }
  return false;
}

/**
 * Build mask of grid cells that touch the path of totality
 * Returns cell coordinates and bounds
 */
function buildPathMask() {
  const resolution = CONFIG.gridResolution;
  const padding = CONFIG.cellPadding;
  const eclipseElements = CONFIG.eclipseElements;

  console.error('Scanning global grid for cells touching path of totality...');

  // First pass: find all cells that directly touch the path
  const pathCells = new Set();

  // Scan the globe at grid resolution
  // Scan full latitude range (-90 to 90) to support any eclipse
  for (let lat = -90; lat < 90; lat += resolution) {
    for (let lon = -180; lon < 180; lon += resolution) {
      if (cellTouchesPath(lat, lon, resolution, eclipseElements)) {
        pathCells.add(`${lat.toFixed(3)},${lon.toFixed(3)}`);
      }
    }
    // Progress indicator every 10 degrees
    if (Math.abs(lat % 10) < resolution) {
      process.stderr.write(`\rScanning latitude ${lat.toFixed(0)}°...`);
    }
  }

  console.error(`\nFound ${pathCells.size} cells in path of totality`);

  // Second pass: add padding cells
  const allCells = new Set(pathCells);

  for (const cellKey of pathCells) {
    const [lat, lon] = cellKey.split(',').map(Number);

    // Add cells within padding distance
    for (let dlat = -padding; dlat <= padding; dlat++) {
      for (let dlon = -padding; dlon <= padding; dlon++) {
        const newLat = lat + dlat * resolution;
        const newLon = lon + dlon * resolution;

        // Skip if outside valid range
        if (newLat < -90 || newLat >= 90) continue;

        // Wrap longitude
        let wrappedLon = newLon;
        if (wrappedLon < -180) wrappedLon += 360;
        if (wrappedLon >= 180) wrappedLon -= 360;

        allCells.add(`${newLat.toFixed(3)},${wrappedLon.toFixed(3)}`);
      }
    }
  }

  console.error(`Total cells with ${padding}-cell padding: ${allCells.size}`);

  // Convert to arrays and compute bounds
  const lats = [];
  const lons = [];

  for (const cellKey of allCells) {
    const [lat, lon] = cellKey.split(',').map(Number);
    lats.push(lat);
    lons.push(lon);
  }

  // Sort and deduplicate
  const uniqueLats = [...new Set(lats)].sort((a, b) => a - b);
  const uniqueLons = [...new Set(lons)].sort((a, b) => a - b);

  const bounds = {
    latMin: Math.min(...uniqueLats),
    latMax: Math.max(...uniqueLats) + resolution,
    lonMin: Math.min(...uniqueLons),
    lonMax: Math.max(...uniqueLons) + resolution
  };

  console.error(`Bounds: ${bounds.latMin.toFixed(1)}° to ${bounds.latMax.toFixed(1)}°N, ${bounds.lonMin.toFixed(1)}° to ${bounds.lonMax.toFixed(1)}°E`);

  return {
    cells: allCells,
    bounds,
    resolution
  };
}

/**
 * Process NetCDF files and compute climatology
 * Uses Python for NetCDF processing
 */
async function computeClimatology(pathMask) {
  const { cells, bounds, resolution } = pathMask;

  // Convert cell set to list for Python
  const cellList = [...cells].map(c => c.split(',').map(Number));

  const pythonScript = `
import netCDF4 as nc
import numpy as np
import json
import os
import glob

cache_dir = '${CONFIG.cacheDir}'
bounds = ${JSON.stringify(bounds)}
cell_list = ${JSON.stringify(cellList)}
resolution = ${resolution}

# Find all cached files
files = sorted(glob.glob(os.path.join(cache_dir, 'CFCdm*.nc')))
print(f'Processing {len(files)} files...', file=__import__('sys').stderr)

if len(files) == 0:
    print('No files found!')
    exit(1)

# Load first file to get grid
ds = nc.Dataset(files[0])
lat_full = ds.variables['lat'][:]
lon_full = ds.variables['lon'][:]
ds.close()

# Find indices for bounding box
lat_idx = (lat_full >= bounds['latMin']) & (lat_full <= bounds['latMax'])
lon_idx = (lon_full >= bounds['lonMin']) & (lon_full <= bounds['lonMax'])

lat = lat_full[lat_idx]
lon = lon_full[lon_idx]

print(f'Bounding box grid: {len(lat)} x {len(lon)}', file=__import__('sys').stderr)

# Build mask from cell list - True for cells we want to include
mask = np.zeros((len(lat), len(lon)), dtype=bool)
cell_set = set((round(c[0], 3), round(c[1], 3)) for c in cell_list)

for i, lt in enumerate(lat):
    for j, ln in enumerate(lon):
        # Round to match cell keys (cells are defined by their SW corner)
        cell_lat = round(np.floor(lt / resolution) * resolution, 3)
        cell_lon = round(np.floor(ln / resolution) * resolution, 3)
        if (cell_lat, cell_lon) in cell_set:
            mask[i, j] = True

valid_cells = np.sum(mask)
print(f'Cells in path (with padding): {valid_cells}', file=__import__('sys').stderr)

# Accumulate data
all_data = []
file_count = 0

for f in files:
    try:
        ds = nc.Dataset(f)
        cfc = ds.variables['cfc'][0, :, :]
        region_cfc = cfc[lat_idx, :][:, lon_idx]
        # Apply mask - set non-path cells to NaN
        region_cfc = np.where(mask, region_cfc, np.nan)
        all_data.append(region_cfc)
        ds.close()
        file_count += 1
    except Exception as e:
        print(f'Error processing {f}: {e}', file=__import__('sys').stderr)

print(f'Processed {file_count} files', file=__import__('sys').stderr)

# Compute statistics
all_data = np.array(all_data)
cfc_mean = np.nanmean(all_data, axis=0)
cfc_std = np.nanstd(all_data, axis=0)

# Replace NaN with None for JSON serialization
def nan_to_none(arr):
    return [[None if np.isnan(v) else float(v) for v in row] for row in arr]

# Output as JSON
result = {
    'lat': lat.tolist(),
    'lon': lon.tolist(),
    'cfc_mean': nan_to_none(cfc_mean),
    'cfc_std': nan_to_none(cfc_std),
    'mask': mask.tolist()
}

print(json.dumps(result))
`;

  // Run Python script
  const { execSync } = await import('child_process');
  const result = execSync(`python3 -c '${pythonScript.replace(/'/g, "'\"'\"'")}'`, {
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024 // 100MB buffer for large JSON
  });

  const gridData = JSON.parse(result);

  // Calculate period string with proper date handling
  const startDate = new Date(Date.UTC(2020, CONFIG.eclipseMonth - 1, CONFIG.eclipseDay));
  startDate.setUTCDate(startDate.getUTCDate() - CONFIG.dayRange);
  const endDate = new Date(Date.UTC(2020, CONFIG.eclipseMonth - 1, CONFIG.eclipseDay));
  endDate.setUTCDate(endDate.getUTCDate() + CONFIG.dayRange);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const periodStr = `${monthNames[startDate.getUTCMonth()]} ${startDate.getUTCDate()} - ${monthNames[endDate.getUTCMonth()]} ${endDate.getUTCDate()}`;

  // Build output in same structure as eclipse data files
  const cloudData = {
    cloud: {
      date: `${CONFIG.eclipseYear}-${String(CONFIG.eclipseMonth).padStart(2, '0')}-${String(CONFIG.eclipseDay).padStart(2, '0')}`,
      source: 'CM SAF CLARA-A3',
      attribution: 'CM SAF/EUMETSAT',
      license: 'Creative Commons Attribution 4.0 International License (CC BY 4.0)',
      fetchedAt: new Date().toISOString(),
      climatology: {
        period: periodStr,
        years: `${CONFIG.startYear}-${CONFIG.endYear}`,
        samples: (CONFIG.endYear - CONFIG.startYear + 1) * (CONFIG.dayRange * 2 + 1)
      }
    },
    bounds: pathMask.bounds,
    resolution: pathMask.resolution,
    lat: gridData.lat,
    lon: gridData.lon,
    cfc: gridData.cfc_mean,
    cfc_std: gridData.cfc_std
  };

  // Save to data/cloud-{year}.json
  const outputPath = path.join(CONFIG.outputDir, `cloud-${CONFIG.eclipseYear}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(cloudData, null, 2));
  console.error(`Saved to ${outputPath}`);

  // Summary statistics (avoid spread operator for large arrays)
  const allValues = gridData.cfc_mean.flat().filter(v => !isNaN(v) && v !== null);
  let minCloud = Infinity, maxCloud = -Infinity, sumCloud = 0;
  for (const v of allValues) {
    if (v < minCloud) minCloud = v;
    if (v > maxCloud) maxCloud = v;
    sumCloud += v;
  }
  const avgCloud = sumCloud / allValues.length;

  console.log('\n=== Cloud Climatology Summary ===');
  console.log(`Eclipse: ${CONFIG.eclipseYear}-${String(CONFIG.eclipseMonth).padStart(2, '0')}-${String(CONFIG.eclipseDay).padStart(2, '0')}`);
  console.log(`Period: ${periodStr}, ${CONFIG.startYear}-${CONFIG.endYear}`);
  console.log(`Grid: ${gridData.lat.length} x ${gridData.lon.length} (${allValues.length} valid cells)`);
  console.log(`Cloud cover range: ${minCloud.toFixed(1)}% - ${maxCloud.toFixed(1)}%`);
  console.log(`Average: ${avgCloud.toFixed(1)}%`);
  console.log(`\nOutput: ${outputPath}`);

  return cloudData;
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Show help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Build Cloud Cover Climatology for Eclipse Path

Usage:
  node scripts/build-cloud-climatology.js <year>

Arguments:
  year    Eclipse year (e.g., 2026, 2027). Must have data/eclipse-{year}.json

Environment variables:
  EUMETSAT_KEY    - API consumer key (required)
  EUMETSAT_SECRET - API consumer secret (required)

Examples:
  node scripts/build-cloud-climatology.js 2026
  node scripts/build-cloud-climatology.js 2027

Output:
  data/cloud-{year}.json - Cloud climatology for eclipse path

Get EUMETSAT API keys at: https://api.eumetsat.int/api-key/

Attribution: CM SAF/EUMETSAT (CLARA-A3)
`);
    process.exit(0);
  }

  // Parse year argument
  const yearArg = args.find(arg => /^\d{4}$/.test(arg));
  if (!yearArg) {
    console.error('Error: Eclipse year is required');
    console.error('Usage: node scripts/build-cloud-climatology.js <year>');
    console.error('Example: node scripts/build-cloud-climatology.js 2027');
    process.exit(1);
  }

  const year = parseInt(yearArg);

  // Check if eclipse data file exists
  const eclipseFile = path.join('data', `eclipse-${year}.json`);
  if (!fs.existsSync(eclipseFile)) {
    console.error(`Error: Eclipse data file not found: ${eclipseFile}`);
    console.error(`Run this first: npm run fetch-${year}`);
    console.error('Or: node scripts/fetch-eclipse-path.js <nasa-url> > data/eclipse-{year}.json');
    process.exit(1);
  }

  // Build configuration from year
  CONFIG = buildConfig(year);

  const key = process.env.EUMETSAT_KEY;
  const secret = process.env.EUMETSAT_SECRET;

  if (!key || !secret) {
    console.error('Error: EUMETSAT_KEY and EUMETSAT_SECRET environment variables required');
    console.error('Get API keys at: https://api.eumetsat.int/api-key/');
    process.exit(1);
  }

  console.error(`Building cloud cover climatology for ${year} eclipse...\n`);

  // Ensure output directory exists
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });

  // Build path mask first (to know which cells we need)
  const pathMask = buildPathMask();

  // Get token and download files
  console.error('\nAuthenticating...');
  const token = await getToken(key, secret);

  // Calculate date range for display
  const startDate = new Date(Date.UTC(2020, CONFIG.eclipseMonth - 1, CONFIG.eclipseDay));
  startDate.setUTCDate(startDate.getUTCDate() - CONFIG.dayRange);
  const endDate = new Date(Date.UTC(2020, CONFIG.eclipseMonth - 1, CONFIG.eclipseDay));
  endDate.setUTCDate(endDate.getUTCDate() + CONFIG.dayRange);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const startStr = `${monthNames[startDate.getUTCMonth()]} ${startDate.getUTCDate()}`;
  const endStr = `${monthNames[endDate.getUTCMonth()]} ${endDate.getUTCDate()}`;
  console.error(`\nDownloading daily CFC data (${startStr} - ${endStr}, ${CONFIG.startYear}-${CONFIG.endYear})...`);
  await downloadAllFiles(token);

  // Compute climatology
  console.error('\nComputing climatology...');
  await computeClimatology(pathMask);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
