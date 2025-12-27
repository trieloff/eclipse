/**
 * Fetches and parses NASA eclipse path data from GSFC
 *
 * Usage:
 *   node scripts/fetch-eclipse-path.js <url>
 *   node scripts/fetch-eclipse-path.js --help
 *
 * Examples:
 *   # 2026 Total Solar Eclipse (Spain)
 *   node scripts/fetch-eclipse-path.js https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2026Aug12Tpath.html
 *
 *   # 2024 Total Solar Eclipse (North America)
 *   node scripts/fetch-eclipse-path.js https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2024Apr08Tpath.html
 *
 *   # 2027 Total Solar Eclipse (Africa/Europe)
 *   node scripts/fetch-eclipse-path.js https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2027Aug02Tpath.html
 *
 * Eclipse path URLs follow the pattern:
 *   https://eclipse.gsfc.nasa.gov/SEpath/SEpath{century}/SE{YYYY}{Mon}{DD}{T|A|H}path.html
 *   Where T=Total, A=Annular, H=Hybrid
 *
 * Find eclipse URLs at: https://eclipse.gsfc.nasa.gov/solar.html
 *
 * Attribution: Eclipse Predictions by Fred Espenak, NASA's GSFC
 */

/**
 * Parse degrees and minutes string like "42 54.5" to decimal degrees
 * @param {string} degMin - String in format "DD MM.M"
 * @returns {number} Decimal degrees
 */
function parseDegMin(degMin) {
  const parts = degMin.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const deg = parseInt(parts[0], 10);
  const min = parseFloat(parts[1]);
  return deg + min / 60;
}

/**
 * Parse a coordinate with direction (N/S/E/W)
 * @param {string} coord - Coordinate string like "42 54.5N" or "002 05.1W"
 * @returns {number} Decimal degrees (negative for S/W)
 */
function parseCoordinate(coord) {
  if (!coord || coord.trim() === '-') return null;

  const match = coord.trim().match(/^(\d+)\s+(\d+\.?\d*)\s*([NSEW]?)$/i);
  if (!match) return null;

  const deg = parseInt(match[1], 10);
  const min = parseFloat(match[2]);
  const dir = match[3].toUpperCase();

  let decimal = deg + min / 60;
  if (dir === 'S' || dir === 'W') {
    decimal = -decimal;
  }
  return decimal;
}

/**
 * Parse duration string like "01m34.3s" or "02m18.2s" to seconds
 * @param {string} duration - Duration string
 * @returns {number} Duration in seconds
 */
function parseDuration(duration) {
  const match = duration.trim().match(/^(\d+)m(\d+\.?\d*)s$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseFloat(match[2]);
}

/**
 * Parse eclipse date from URL or HTML title
 * @param {string} html - Raw HTML content
 * @param {string} url - Source URL
 * @returns {string} Date in YYYY-MM-DD format
 */
function parseEclipseDate(html, url) {
  // Try to extract from URL: SE2026Aug12Tpath.html
  const urlMatch = url?.match(/SE(\d{4})([A-Z][a-z]{2})(\d{2})/);
  if (urlMatch) {
    const year = urlMatch[1];
    const monthNames = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                         Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const month = monthNames[urlMatch[2]] || '01';
    const day = urlMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Fallback: try to extract from HTML title
  const titleMatch = html.match(/(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})/);
  if (titleMatch) {
    const year = titleMatch[1];
    const monthNames = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                         Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const month = monthNames[titleMatch[2]] || '01';
    const day = titleMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * Convert time string (HH:MM) and date to ISO 8601 UTC timestamp
 * @param {string} time - Time in HH:MM format
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {string} ISO 8601 timestamp
 */
function toIsoTimestamp(time, date) {
  if (!time || !date) return null;
  // Handle times with seconds (HH:MM:SS.s)
  const timeParts = time.split(':');
  const hours = timeParts[0].padStart(2, '0');
  const minutes = timeParts[1]?.padStart(2, '0') || '00';
  const seconds = timeParts[2] || '00';
  return `${date}T${hours}:${minutes}:${seconds}Z`;
}

/**
 * Parse the NASA eclipse path HTML and extract path data
 * @param {string} html - Raw HTML content
 * @param {string} url - Source URL (used to extract date)
 * @returns {Object} Parsed eclipse path data
 */
function parseEclipsePathHtml(html, url = null) {
  // Extract eclipse date
  const eclipseDate = parseEclipseDate(html, url);

  // Extract the <pre> block containing the data table
  const preMatch = html.match(/<pre>([\s\S]*?)<\/pre>/i);
  if (!preMatch) {
    throw new Error('Could not find data table in HTML');
  }

  const preContent = preMatch[1];
  const lines = preContent.split('\n');

  const result = {
    eclipse: {
      date: eclipseDate,
      source: 'NASA GSFC',
      attribution: 'Eclipse Predictions by Fred Espenak, NASA\'s GSFC',
      license: 'Permission is freely granted to reproduce this data when accompanied by the acknowledgment above.',
      fetchedAt: new Date().toISOString()
    },
    path: [],
    limits: null,
    limitsAll: [],
    greatestEclipse: null,
    greatestDuration: null
  };

  // Parse the data rows
  for (const line of lines) {
    // Skip empty lines and header lines
    if (!line.trim() || line.includes('Universal') || line.includes('Time') ||
        line.includes('Latitude') || line.includes('---') || line.includes('°')) {
      continue;
    }

    // Match data rows - format varies slightly
    // Time format: HH:MM or "Limits"
    // Coordinates: DD MM.M[N/S] DDD MM.M[E/W]

    // Check for "Limits" row
    if (line.trim().startsWith('Limits')) {
      const limitsMatch = line.match(
        /Limits\s+(\d+\s+\d+\.?\d*[NS])\s+(\d+\s+\d+\.?\d*[EW])\s+(\d+\s+\d+\.?\d*[NS])\s+(\d+\s+\d+\.?\d*[EW])\s+(\d+\s+\d+\.?\d*[NS])\s+(\d+\s+\d+\.?\d*[EW])\s+([\d.]+)\s+(\d+)\s+-\s+(\d+)\s+(\d+m[\d.]+s)/
      );

      if (limitsMatch) {
        const limitEntry = {
          northern: { lat: parseCoordinate(limitsMatch[1]), lon: parseCoordinate(limitsMatch[2]) },
          southern: { lat: parseCoordinate(limitsMatch[3]), lon: parseCoordinate(limitsMatch[4]) },
          central: { lat: parseCoordinate(limitsMatch[5]), lon: parseCoordinate(limitsMatch[6]) },
          ratio: parseFloat(limitsMatch[7]),
          pathWidth: parseInt(limitsMatch[9], 10),
          duration: parseDuration(limitsMatch[10])
        };
        result.limits = limitEntry;
        result.limitsAll.push(limitEntry);
      }
      continue;
    }

    const tokens = line.trim().split(/\s+/);
    if (!/^\d{2}:\d{2}$/.test(tokens[0])) {
      continue;
    }

    let idx = 1;
    let northern = { lat: null, lon: null };

    if (tokens[idx] === '-' && tokens[idx + 1] === '-') {
      idx += 2;
    } else {
      northern = {
        lat: parseCoordinate(`${tokens[idx]} ${tokens[idx + 1]}`),
        lon: parseCoordinate(`${tokens[idx + 2]} ${tokens[idx + 3]}`)
      };
      idx += 4;
    }

    const southern = {
      lat: parseCoordinate(`${tokens[idx]} ${tokens[idx + 1]}`),
      lon: parseCoordinate(`${tokens[idx + 2]} ${tokens[idx + 3]}`)
    };
    idx += 4;

    const central = {
      lat: parseCoordinate(`${tokens[idx]} ${tokens[idx + 1]}`),
      lon: parseCoordinate(`${tokens[idx + 2]} ${tokens[idx + 3]}`)
    };
    idx += 4;

    const ratio = parseFloat(tokens[idx++]);
    const sunAltitude = parseInt(tokens[idx++], 10);
    const sunAzimuthToken = tokens[idx++];
    const sunAzimuth = sunAzimuthToken === '-' ? null : parseInt(sunAzimuthToken, 10);
    const pathWidth = parseInt(tokens[idx++], 10);
    const duration = parseDuration(tokens[idx++]);

    if (central.lat !== null && central.lon !== null) {
      result.path.push({
        time: toIsoTimestamp(tokens[0], eclipseDate),
        northern,
        southern,
        central,
        ratio,
        sunAltitude,
        sunAzimuth,
        pathWidth,
        duration
      });
    }
  }

  // Extract Greatest Eclipse info
  const geMatch = html.match(
    /Greatest Eclipse.*?Time\s*=\s*([\d:.]+)\s*UT.*?Lat\s*=\s*([\d°'.\sNS]+).*?Long\s*=\s*([\d°'.\sEW]+).*?Sun Altitude\s*=\s*([\d.]+).*?Path Width\s*=\s*([\d.]+).*?Sun Azimuth\s*=\s*([\d.]+).*?Central Duration\s*=\s*(\d+m[\d.]+s)/s
  );

  if (geMatch) {
    // Parse lat/lon in degree format like "65°13.5'N"
    const parseDegreePrime = (str) => {
      const m = str.match(/([\d.]+)°([\d.]+)'([NSEW])/);
      if (!m) return null;
      let val = parseFloat(m[1]) + parseFloat(m[2]) / 60;
      if (m[3] === 'S' || m[3] === 'W') val = -val;
      return val;
    };

    result.greatestEclipse = {
      time: toIsoTimestamp(geMatch[1], eclipseDate),
      lat: parseDegreePrime(geMatch[2]),
      lon: parseDegreePrime(geMatch[3]),
      sunAltitude: parseFloat(geMatch[4]),
      pathWidth: parseFloat(geMatch[5]),
      sunAzimuth: parseFloat(geMatch[6]),
      duration: parseDuration(geMatch[7])
    };
  }

  if (result.limitsAll.length) {
    const lastLimit = result.limitsAll[result.limitsAll.length - 1];
    const lastPoint = result.path[result.path.length - 1];
    const isSameAsLast = lastPoint &&
      lastPoint.central?.lat === lastLimit.central?.lat &&
      lastPoint.central?.lon === lastLimit.central?.lon;

    if (!isSameAsLast) {
      result.path.push({
        time: null,
        northern: lastLimit.northern,
        southern: lastLimit.southern,
        central: lastLimit.central,
        ratio: lastLimit.ratio,
        sunAltitude: null,
        sunAzimuth: null,
        pathWidth: lastLimit.pathWidth,
        duration: lastLimit.duration,
        isLimit: true
      });
    }
  }

  return result;
}

/**
 * Convert path URL to Besselian elements URL
 * SEpath/SEpath2001/SE2026Aug12Tpath.html -> SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html
 */
function pathUrlToBesselUrl(pathUrl) {
  return pathUrl
    .replace(/SEpath/g, 'SEbeselm')
    .replace('path.html', 'beselm.html');
}

/**
 * Parse Besselian elements from NASA HTML
 * @param {string} html - Raw HTML content
 * @returns {Object} Besselian elements
 */
function parseBesselianElements(html) {
  const result = {
    source: 'NASA GSFC',
    attribution: 'Eclipse Predictions by Fred Espenak, NASA\'s GSFC'
  };

  // Extract t0 reference time
  // "Polynomial Besselian Elements for:   2026 Aug 12   18:00:00.0 TDT  (=t0)"
  const t0Match = html.match(/Polynomial Besselian Elements for:.*?(\d+):(\d+):[\d.]+\s*TDT\s*\(=t0\)/);
  if (t0Match) {
    result.t0 = parseInt(t0Match[1]) + parseInt(t0Match[2]) / 60;
  }

  // Extract deltaT
  // "ΔT =    71.4 s" or "&Delta;T =    71.4 s"
  const deltaTMatch = html.match(/(?:ΔT|&Delta;T)\s*=\s*([\d.]+)\s*s/);
  if (deltaTMatch) {
    result.deltaT = parseFloat(deltaTMatch[1]);
  }

  // Extract Gamma and magnitude
  const gammaMatch = html.match(/Gamma\s*=\s*([\d.-]+)/);
  if (gammaMatch) {
    result.gamma = parseFloat(gammaMatch[1]);
  }

  const magMatch = html.match(/Eclipse Magnitude\s*=\s*([\d.]+)/);
  if (magMatch) {
    result.eclipseMagnitude = parseFloat(magMatch[1]);
  }

  // Extract lunar radius constants
  // "k1 = 0.272488 (Penumbra)" and "k2 = 0.272281 (Umbra)"
  const k1Match = html.match(/k1\s*=\s*([\d.]+)\s*\(Penumbra\)/);
  const k2Match = html.match(/k2\s*=\s*([\d.]+)\s*\(Umbra\)/);
  if (k1Match) result.k1 = parseFloat(k1Match[1]);
  if (k2Match) result.k2 = parseFloat(k2Match[1]);

  // Extract tan f1 and tan f2
  // "Tan ƒ1 = 0.0046141" or "Tan &#402;1 = 0.0046141"
  const tanF1Match = html.match(/Tan\s*(?:ƒ|&#402;)1\s*=\s*([\d.]+)/);
  const tanF2Match = html.match(/Tan\s*(?:ƒ|&#402;)2\s*=\s*([\d.]+)/);
  if (tanF1Match) result.tanF1 = parseFloat(tanF1Match[1]);
  if (tanF2Match) result.tanF2 = parseFloat(tanF2Match[1]);

  // Extract polynomial coefficients from the table
  // Format:
  //   n        x          y         d          l1         l2          μ
  //   0   0.475593   0.771161   14.79667   0.537954  -0.008142   88.74776
  //   1   0.5189288 -0.2301664  -0.012065  0.0000940  0.0000935  15.003093
  //   2  -0.0000773 -0.0001245  -0.000003 -0.0000121 -0.0000121
  //   3  -0.0000088  0.0000037

  const coefficients = {
    x: [0, 0, 0, 0],
    y: [0, 0, 0, 0],
    d: [0, 0, 0, 0],
    l1: [0, 0, 0, 0],
    l2: [0, 0, 0, 0],
    mu: [0, 0, 0, 0]
  };

  // Get the pre block content and parse coefficient rows
  const preMatch = html.match(/<pre>([\s\S]*?)<\/pre>/i);
  if (preMatch) {
    const preContent = preMatch[1];
    const lines = preContent.split('\n');

    for (const line of lines) {
      // Match lines starting with 0, 1, 2, or 3 followed by numeric values
      // Format varies: row 0-1 have 6 values, row 2 has 5, row 3 has 2
      const rowMatch = line.match(/^\s*([0-3])\s+([-\d.]+(?:\s+[-\d.]+)*)/);
      if (rowMatch) {
        const n = parseInt(rowMatch[1]);
        const values = rowMatch[2].trim().split(/\s+/).map(parseFloat);

        // Assign values to coefficients (x, y, d, l1, l2, mu in order)
        if (values.length > 0) coefficients.x[n] = values[0];
        if (values.length > 1) coefficients.y[n] = values[1];
        if (values.length > 2) coefficients.d[n] = values[2];
        if (values.length > 3) coefficients.l1[n] = values[3];
        if (values.length > 4) coefficients.l2[n] = values[4];
        if (values.length > 5) coefficients.mu[n] = values[5];
      }
    }
  }

  result.coefficients = coefficients;

  // Create the format expected by eclipse-calculator.js
  result.elements = {
    t0: result.t0,
    deltaT: result.deltaT,
    x: coefficients.x,
    y: coefficients.y,
    d: coefficients.d,
    l1: coefficients.l1,
    l2: coefficients.l2,
    mu: coefficients.mu,
    tanF1: result.tanF1,
    tanF2: result.tanF2,
    k1: result.k1,
    k2: result.k2
  };

  return result;
}

/**
 * Fetch and parse NASA Besselian elements
 * @param {string} url - URL to Besselian elements page
 * @returns {Promise<Object>} Parsed Besselian elements
 */
async function fetchBesselianElements(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseBesselianElements(html);
}

/**
 * Fetch and parse NASA eclipse path data
 * @param {string} url - URL to fetch
 * @param {boolean} includeBesselian - Whether to also fetch Besselian elements
 * @returns {Promise<Object>} Parsed eclipse path data
 */
async function fetchEclipsePath(url, includeBesselian = true) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const data = parseEclipsePathHtml(html, url);
  data.eclipse.url = url;

  // Fetch Besselian elements if requested
  if (includeBesselian) {
    try {
      const besselUrl = pathUrlToBesselUrl(url);
      console.error(`Fetching Besselian elements: ${besselUrl}`);
      const besselian = await fetchBesselianElements(besselUrl);
      // Add eclipse date to elements for use with eclipse-calculator.js
      if (besselian.elements && data.eclipse.date) {
        besselian.elements.date = data.eclipse.date;
      }
      data.besselianElements = besselian;
    } catch (err) {
      console.error(`Warning: Could not fetch Besselian elements: ${err.message}`);
    }
  }

  return data;
}

/**
 * Filter path data to a specific longitude range
 * @param {Object} data - Parsed eclipse path data
 * @param {number} minLon - Minimum longitude
 * @param {number} maxLon - Maximum longitude
 * @returns {Array} Filtered path entries
 */
function filterByLongitude(data, minLon, maxLon) {
  return data.path.filter(entry => {
    // Check if any of the three points fall within the longitude range
    const lons = [entry.northern?.lon, entry.central?.lon, entry.southern?.lon].filter(l => l !== null);
    return lons.some(lon => lon >= minLon && lon <= maxLon);
  });
}

// CLI execution
if (typeof process !== 'undefined' && process.argv[1]?.includes('fetch-eclipse-path')) {
  const args = process.argv.slice(2);

  // Show help
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
Fetch and parse NASA GSFC eclipse path data

Usage:
  node scripts/fetch-eclipse-path.js <url> [options]

Arguments:
  url                    NASA GSFC eclipse path URL (required)

Options:
  --min-lon <degrees>    Filter: minimum longitude (default: -180)
  --max-lon <degrees>    Filter: maximum longitude (default: 180)
  --help, -h             Show this help message

Examples:
  # 2026 Total Solar Eclipse (Spain)
  node scripts/fetch-eclipse-path.js https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2026Aug12Tpath.html

  # 2024 Total Solar Eclipse (North America), filtered to US
  node scripts/fetch-eclipse-path.js https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2024Apr08Tpath.html --min-lon -130 --max-lon -60

  # 2027 Total Solar Eclipse (Africa/Europe)
  node scripts/fetch-eclipse-path.js https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2027Aug02Tpath.html

Eclipse path URLs follow the pattern:
  https://eclipse.gsfc.nasa.gov/SEpath/SEpath{century}/SE{YYYY}{Mon}{DD}{T|A|H}path.html
  Where T=Total, A=Annular, H=Hybrid

Find eclipse URLs at: https://eclipse.gsfc.nasa.gov/solar.html

Attribution: Eclipse Predictions by Fred Espenak, NASA's GSFC
`);
    process.exit(0);
  }

  // Parse arguments
  const url = args.find(arg => arg.startsWith('http'));
  if (!url) {
    console.error('Error: URL is required. Use --help for usage information.');
    process.exit(1);
  }

  // Parse longitude filter options
  let minLon = -180;
  let maxLon = 180;

  const minLonIdx = args.indexOf('--min-lon');
  if (minLonIdx !== -1 && args[minLonIdx + 1]) {
    minLon = parseFloat(args[minLonIdx + 1]);
  }

  const maxLonIdx = args.indexOf('--max-lon');
  if (maxLonIdx !== -1 && args[maxLonIdx + 1]) {
    maxLon = parseFloat(args[maxLonIdx + 1]);
  }

  console.error(`Fetching: ${url}`);
  console.error(`Longitude filter: ${minLon}° to ${maxLon}°`);

  fetchEclipsePath(url)
    .then(data => {
      // Add filtered region data
      const filteredPath = filterByLongitude(data, minLon, maxLon);
      data.filteredRegion = {
        minLon,
        maxLon,
        path: filteredPath
      };

      console.log(JSON.stringify(data, null, 2));
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

export {
  fetchEclipsePath,
  parseEclipsePathHtml,
  filterByLongitude,
  parseCoordinate,
  parseDuration,
  parseBesselianElements,
  fetchBesselianElements,
  pathUrlToBesselUrl
};
