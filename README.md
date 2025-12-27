# Eclipse 2026 Spain

Interactive map of the 2026 total solar eclipse path over Spain.

**Live:** https://trieloff.github.io/eclipse/

**Demo with home location:** [View from El Poal](https://trieloff.github.io/eclipse/?homeLat=41.68&homeLon=0.85) – shows driving distances from your location

## Data Files

- `data/eclipse-{year}.json` - Eclipse path and Besselian elements from NASA GSFC
- `data/cloud-{year}.json` - Cloud cover climatology grid from CM SAF/EUMETSAT

Currently available: 2026, 2027

## Code Structure

- `index.html` - Single-page app with Google Maps, totality polygon, and duration calculator
- `scripts/eclipse-calculator.js` - Besselian-element based totality calculator
- `scripts/fetch-eclipse-path.js` - Fetches NASA GSFC eclipse path data
- `scripts/build-cloud-climatology.js` - Builds cloud cover climatology from EUMETSAT

## UI Behavior

- Clicking a location locks it and shows links for driving directions (from a POI named `Home-POI` or the first POI), Shadowmap, and Airbnb (Aug 11–13, 2026).

## Development

```bash
npm install
npm run dev    # starts on port 3000
```

## Data Scripts

### Eclipse Path

```bash
# Fetch 2026 eclipse data
npm run fetch-2026

# Fetch 2027 eclipse data
npm run fetch-2027

# Fetch any eclipse (outputs to stdout)
node scripts/fetch-eclipse-path.js <nasa-url>
```

Eclipse path URLs follow the pattern:
```
https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE{YYYY}{Mon}{DD}{T|A|H}path.html
```
Where T=Total, A=Annular, H=Hybrid. Find eclipse URLs at: https://eclipse.gsfc.nasa.gov/solar.html

### Cloud Climatology

Requires EUMETSAT API credentials. See `README.local.md` for setup.

```bash
# Build cloud climatology for any eclipse year
node scripts/build-cloud-climatology.js <year>

# Examples:
npm run cloud-2026
npm run cloud-2027
```

Downloads ~400 daily NetCDF files (~2.8GB) and computes climatology around the eclipse date from 2002-2020.

## Shadowmap Integration

Visualize sun position at eclipse time:

```
https://app.shadowmap.org/?lat=43.33560&lng=-5.84591&zoom=13.62&time=1786554530978
```

Parameters: `lat`, `lng`, `zoom`, `time` (unix ms), `basemap`, `elevation`, `hud`

## Attribution

- Eclipse Predictions by Fred Espenak, NASA's GSFC
- Cloud data: CM SAF/EUMETSAT (CLARA-A3, CC BY 4.0)
