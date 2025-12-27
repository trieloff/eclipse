/**
 * EUMETSAT CM SAF Cloud Cover Data Fetcher
 *
 * Downloads CLARA-A3 cloud cover data from EUMETSAT Data Store
 *
 * Setup:
 *   1. Create account at https://user.eumetsat.int/
 *   2. Get API keys from https://api.eumetsat.int/api-key/
 *   3. Set environment variables:
 *      export EUMETSAT_KEY="your-consumer-key"
 *      export EUMETSAT_SECRET="your-consumer-secret"
 *
 * Usage:
 *   node scripts/fetch-cloud-cover.js [--month 8] [--year 2020]
 *
 * Data source: CM SAF CLARA-A3 (Cloud Fractional Cover)
 * Collection: EO:EUM:DAT:0874
 *
 * Attribution: CM SAF/EUMETSAT
 */

const EUMETSAT_TOKEN_URL = 'https://api.eumetsat.int/token';
const EUMETSAT_BROWSE_URL = 'https://api.eumetsat.int/data/browse/1.0.0';
const EUMETSAT_SEARCH_URL = 'https://api.eumetsat.int/data/search-products/1.0.0/os';
const EUMETSAT_DOWNLOAD_URL = 'https://api.eumetsat.int/data/download/1.0.0';
const COLLECTION_ID = 'EO:EUM:DAT:0874'; // CLARA-A3

/**
 * Get OAuth2 access token from EUMETSAT
 */
async function getAccessToken(consumerKey, consumerSecret) {
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const response = await fetch(EUMETSAT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Search for products in a collection using OpenSearch API
 * @param {string} token - Access token (optional for search)
 * @param {string} collectionId - Collection ID (e.g., EO:EUM:DAT:0874)
 * @param {Object} params - Search parameters
 * @param {string} params.dtstart - Start date (ISO format)
 * @param {string} params.dtend - End date (ISO format)
 * @param {string} params.bbox - Bounding box (west,south,east,north)
 * @param {number} params.si - Start index (default 0)
 * @param {number} params.c - Count/limit (default 10)
 */
async function searchProducts(token, collectionId, params = {}) {
  const searchParams = new URLSearchParams({
    format: 'json',
    pi: collectionId,
    si: params.si || 0,
    c: params.c || 10,
    ...params
  });

  // Remove undefined params
  for (const [key, value] of searchParams.entries()) {
    if (value === 'undefined' || value === undefined) {
      searchParams.delete(key);
    }
  }

  const url = `${EUMETSAT_SEARCH_URL}?${searchParams}`;

  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Search failed: ${response.status} ${text}`);
  }

  return response.json();
}

/**
 * List available collections
 */
async function listCollections(token) {
  const response = await fetch(`${EUMETSAT_BROWSE_URL}/collections?format=json`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Collections request failed: ${response.status} ${text}`);
  }

  return response.json();
}

/**
 * Download a product
 */
async function downloadProduct(token, productUrl, outputPath) {
  const response = await fetch(productUrl, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const fs = await import('fs');
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  return outputPath;
}

// CLI execution
if (typeof process !== 'undefined' && process.argv[1]?.includes('fetch-cloud-cover')) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
EUMETSAT CM SAF Cloud Cover Data Fetcher

Usage:
  node scripts/fetch-cloud-cover.js [options]

Options:
  --list-collections    List available data collections
  --search              Search for products in CLARA-A3 collection
  --month <1-12>        Filter by month (default: 8 for August)
  --year <YYYY>         Filter by year (default: 2020)
  --help, -h            Show this help

Environment variables (required):
  EUMETSAT_KEY          Your EUMETSAT API consumer key
  EUMETSAT_SECRET       Your EUMETSAT API consumer secret

Get API keys at: https://api.eumetsat.int/api-key/

Data: CLARA-A3 Cloud Fractional Cover from CM SAF/EUMETSAT
`);
    process.exit(0);
  }

  const consumerKey = process.env.EUMETSAT_KEY;
  const consumerSecret = process.env.EUMETSAT_SECRET;

  if (!consumerKey || !consumerSecret) {
    console.error('Error: EUMETSAT_KEY and EUMETSAT_SECRET environment variables required');
    console.error('Get API keys at: https://api.eumetsat.int/api-key/');
    process.exit(1);
  }

  (async () => {
    try {
      console.error('Authenticating with EUMETSAT...');
      const token = await getAccessToken(consumerKey, consumerSecret);
      console.error('Authentication successful');

      if (args.includes('--list-collections')) {
        console.error('Fetching collections...');
        const collections = await listCollections(token);
        console.log(JSON.stringify(collections, null, 2));
        return;
      }

      // Parse options
      const monthIdx = args.indexOf('--month');
      const yearIdx = args.indexOf('--year');
      const month = (monthIdx !== -1 ? args[monthIdx + 1] : '08').padStart(2, '0');
      const year = yearIdx !== -1 ? args[yearIdx + 1] : '2025';

      if (args.includes('--search')) {
        // Search for products
        console.error(`Searching collection: ${COLLECTION_ID}`);
        const products = await searchProducts(token, COLLECTION_ID, {
          type: 'CFC',
          dtstart: `${year}-${month}-01`,
          dtend: `${year}-${month}-28`,
          c: 50
        });
        console.log(JSON.stringify(products, null, 2));
        return;
      }

      // Default: download monthly CFC for specified month/year
      console.error(`Downloading CFC monthly mean for ${year}-${month}...`);

      // Search for the monthly product
      const products = await searchProducts(token, COLLECTION_ID, {
        type: 'CFC',
        dtstart: `${year}-${month}-01`,
        dtend: `${year}-${month}-28`,
        c: 50
      });

      // Find monthly mean product (CFCmm)
      const monthly = products.features?.find(f =>
        f.properties?.identifier?.startsWith('CFCmm') &&
        f.properties?.identifier?.includes(`${year}${month}`)
      );

      if (!monthly) {
        console.error(`No monthly CFC product found for ${year}-${month}`);
        console.error('Available products:', products.features?.map(f => f.properties?.identifier));
        process.exit(1);
      }

      const productId = monthly.properties.identifier;
      const ncEntry = monthly.properties.links?.['sip-entries']?.find(e => e.title?.endsWith('.nc'));

      if (!ncEntry) {
        console.error('No NetCDF file found in product');
        process.exit(1);
      }

      console.error(`Found: ${productId}`);
      console.error(`Downloading: ${ncEntry.href}`);

      const fs = await import('fs');
      const path = await import('path');

      const outputDir = 'data/cloud-cover';
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const outputPath = path.join(outputDir, `CFCmm_${year}-${month}.nc`);
      await downloadProduct(token, ncEntry.href, outputPath);
      console.error(`Saved to: ${outputPath}`);

      console.log(JSON.stringify({
        product: productId,
        file: outputPath,
        year,
        month
      }, null, 2));

    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  })();
}

export { getAccessToken, searchProducts, listCollections, downloadProduct };
