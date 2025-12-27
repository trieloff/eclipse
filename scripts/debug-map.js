import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:3000/index.html';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const timeoutMs = 30000;

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: chromePath,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
page.setDefaultTimeout(timeoutMs);

page.on('console', (msg) => {
  const type = msg.type();
  const text = msg.text();
  console.log(`[console:${type}] ${text}`);
});

page.on('pageerror', (err) => {
  console.log(`[pageerror] ${err.message}`);
});

page.on('requestfailed', (req) => {
  const failure = req.failure();
  console.log(`[requestfailed] ${req.url()} ${failure?.errorText || ''}`);
});

const responses = [];
page.on('response', (res) => {
  const url = res.url();
  if (url.includes('maps.googleapis.com') || url.includes('maps.gstatic.com')) {
    responses.push({ url, status: res.status() });
  }
});

await page.goto(url, { waitUntil: 'networkidle2' });

// Wait for map tiles or error overlays.
await new Promise((resolve) => setTimeout(resolve, 5000));

const mapCanvas = await page.$('#map');
if (!mapCanvas) {
  console.log('Map container not found.');
} else {
  const box = await mapCanvas.boundingBox();
  console.log(`Map container size: ${Math.round(box.width)}x${Math.round(box.height)}`);
}

const mapTiles = await page.$$('.gm-style img');
console.log(`Map tiles found: ${mapTiles.length}`);

const errorOverlay = await page.$('.gm-err-container');
if (errorOverlay) {
  const text = await page.evaluate((el) => el.innerText, errorOverlay);
  console.log(`[gm-err-container] ${text.trim()}`);
}

const screenshotPath = '/Users/trieloff/Developer/eclipse/tmp-map-debug.png';
await page.screenshot({ path: screenshotPath, fullPage: true });
console.log(`Saved screenshot: ${screenshotPath}`);

if (responses.length) {
  console.log('Google Maps responses:');
  for (const entry of responses) {
    console.log(`- ${entry.status} ${entry.url}`);
  }
} else {
  console.log('No Google Maps network responses captured.');
}

await browser.close();
