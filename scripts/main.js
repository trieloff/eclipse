import { calculateTotality, ECLIPSE_2026_AUG_12 } from './eclipse-calculator.js';

const SPAIN_BOUNDS = {
    north: 44.8,
    south: 35.3,
    west: -10.8,
    east: 5.6
};

const MAP_STYLES = [
    { elementType: 'geometry', stylers: [{ color: '#1a2136' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#d9e3f0' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1424' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2c3755' }] },
    { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#151c2f' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1b253d' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#13223a' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#253454' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1b2540' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#cfd8e6' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#32466a' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#2a3a5f' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#e8eef7' }] },
    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#1f2b45' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1a2d' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9fb0c7' }] }
];

// DOM Elements
const locationBoxEl = document.getElementById('location-box');
const locationCoordsEl = document.getElementById('location-coords');
const locationLabelEl = document.getElementById('location-label');
const inPathEl = document.getElementById('in-path');
const durationEl = document.getElementById('duration');
const distanceEl = document.getElementById('distance');
const lockedLinksEl = document.getElementById('locked-links');

let locationLocked = false;

locationBoxEl.addEventListener('click', () => {
    if (locationLocked) {
        locationLocked = false;
        locationLabelEl.textContent = 'Location';
    }
});

// Geometry utilities
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function closestCenterlineDistance(lat, lon, centerline) {
    let min = Infinity;
    for (const point of centerline) {
        const pointLon = point.lon ?? point.lng;
        const dist = haversineDistance(lat, lon, point.lat, pointLon);
        if (dist < min) min = dist;
    }
    return min;
}

function closestCenterlinePoint(lat, lon, centerline) {
    let minDist = Infinity;
    let closest = null;
    for (const point of centerline) {
        const pointLon = point.lon ?? point.lng;
        const dist = haversineDistance(lat, lon, point.lat, pointLon);
        if (dist < minDist) {
            minDist = dist;
            closest = point;
        }
    }
    return closest;
}

function interpolatePoint(a, b, t) {
    return {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t
    };
}

function densifyPath(path, maxKmStep = 50) {
    if (path.length < 2) return path;
    const densified = [];

    for (let i = 0; i < path.length - 1; i += 1) {
        const current = path[i];
        const next = path[i + 1];
        const distance = haversineDistance(
            current.central.lat,
            current.central.lon,
            next.central.lat,
            next.central.lon
        );
        const steps = Math.max(1, Math.ceil(distance / maxKmStep));

        for (let step = 0; step < steps; step += 1) {
            const t = step / steps;
            const northern = current.northern?.lat !== null && next.northern?.lat !== null
                ? interpolatePoint(current.northern, next.northern, t)
                : { lat: null, lon: null };
            const southern = current.southern?.lat !== null && next.southern?.lat !== null
                ? interpolatePoint(current.southern, next.southern, t)
                : { lat: null, lon: null };
            densified.push({
                time: current.time,
                northern,
                southern,
                central: interpolatePoint(current.central, next.central, t)
            });
        }
    }

    densified.push(path[path.length - 1]);
    return densified;
}

// Data loading
async function loadEclipsePath() {
    const response = await fetch('./data/eclipse-2026.json');
    if (!response.ok) {
        throw new Error('Failed to load eclipse path data');
    }
    const data = await response.json();
    return data.path;
}

async function loadPoi() {
    const response = await fetch('./data/poi-2026.json');
    if (!response.ok) {
        throw new Error('Failed to load POI data');
    }
    return response.json();
}

async function loadCloudData() {
    const response = await fetch('./data/cloud-2026.json');
    if (!response.ok) {
        throw new Error('Failed to load cloud data');
    }
    return response.json();
}

// Cloud data grid access
function getCloudChance(lat, lon) {
    if (!window.__cloudGrid) return null;
    const { latStart, lonStart, step, rows, cols, grid } = window.__cloudGrid;
    const i = Math.round((lat - latStart) / step);
    const j = Math.round((lon - lonStart) / step);
    if (i < 0 || j < 0 || i >= rows || j >= cols) return null;
    const value = grid[i]?.[j];
    if (!Number.isFinite(value)) return null;
    return Math.round(value);
}

// Display formatting
function formatDuration(result) {
    if (!result.inTotality) {
        return 'Not in path';
    }
    const totalSeconds = Math.round(result.durationSeconds);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

function updateDurationDisplay(lat, lon, inPath) {
    if (!inPath) {
        durationEl.textContent = '-';
        return;
    }
    const result = calculateTotality(lat, lon, ECLIPSE_2026_AUG_12);
    const cloudChance = getCloudChance(lat, lon);
    if (cloudChance === null) {
        durationEl.textContent = formatDuration(result);
    } else {
        const cloudClass = cloudChance < 30 ? 'cloud-low'
            : cloudChance < 60 ? 'cloud-mid'
                : 'cloud-high';
        durationEl.innerHTML = `${formatDuration(result)} · <span class="${cloudClass}">${cloudChance}% cloud</span>`;
    }
}

// URL state management
function readMapStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get('lat'));
    const lon = parseFloat(params.get('lon'));
    const zoom = parseFloat(params.get('z'));

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return {
            center: { lat, lng: lon },
            zoom: Number.isFinite(zoom) ? zoom : null
        };
    }
    return null;
}

function readHomeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const homeLat = parseFloat(params.get('homeLat'));
    const homeLon = parseFloat(params.get('homeLon'));

    if (Number.isFinite(homeLat) && Number.isFinite(homeLon)) {
        return { lat: homeLat, lon: homeLon, name: 'Home' };
    }
    return null;
}

function writeMapStateToUrl(map) {
    const center = map.getCenter();
    if (!center) return;
    const params = new URLSearchParams(window.location.search);
    params.set('lat', center.lat().toFixed(4));
    params.set('lon', center.lng().toFixed(4));
    params.set('z', map.getZoom());
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
}

// POI icons
function createPoiIcons() {
    const svgIcon = (svg, size = 28) => ({
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
        scaledSize: new google.maps.Size(size, size)
    });

    return {
        town: svgIcon(
            `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M3 11.5L12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" fill="#f39c12" stroke="#111827" stroke-width="1"/>
              <rect x="10" y="16" width="4" height="5" fill="#0b111f"/>
            </svg>`
        ),
        viewing: svgIcon(
            `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="7" cy="12" r="4" fill="#67e8f9" stroke="#111827" stroke-width="1"/>
              <circle cx="17" cy="12" r="4" fill="#67e8f9" stroke="#111827" stroke-width="1"/>
              <rect x="9" y="10.5" width="6" height="3" fill="#111827"/>
              <rect x="6" y="9" width="12" height="6" rx="3" fill="none" stroke="#111827" stroke-width="1"/>
            </svg>`
        )
    };
}

// Cloud overlay class
function createCloudOverlayClass(maxCloud) {
    return class CloudOverlay extends google.maps.OverlayView {
        constructor(map, tilesList, pathPolygon) {
            super();
            this.map = map;
            this.tiles = tilesList;
            this.pathPolygon = pathPolygon;
            this.div = null;
            this.canvas = null;
            this.setMap(map);
        }

        onAdd() {
            this.div = document.createElement('div');
            this.div.style.position = 'absolute';
            this.div.style.pointerEvents = 'none';
            this.canvas = document.createElement('canvas');
            this.div.appendChild(this.canvas);
            const panes = this.getPanes();
            panes.overlayLayer.appendChild(this.div);
        }

        onRemove() {
            if (this.div?.parentNode) {
                this.div.parentNode.removeChild(this.div);
            }
            this.div = null;
            this.canvas = null;
        }

        draw() {
            if (!this.canvas || !this.div) return;
            const projection = this.getProjection();
            const bounds = this.map.getBounds();
            if (!bounds) return;

            const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast());
            const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest());

            const width = Math.max(1, Math.round(ne.x - sw.x));
            const height = Math.max(1, Math.round(sw.y - ne.y));

            this.div.style.left = `${Math.round(sw.x)}px`;
            this.div.style.top = `${Math.round(ne.y)}px`;
            this.div.style.width = `${width}px`;
            this.div.style.height = `${height}px`;

            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
            }

            const ctx = this.canvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, width, height);

            // Clip to totality polygon
            ctx.save();
            ctx.beginPath();
            this.pathPolygon.forEach((point, idx) => {
                const pixel = projection.fromLatLngToDivPixel(new google.maps.LatLng(point.lat, point.lon));
                const x = pixel.x - sw.x;
                const y = pixel.y - ne.y;
                if (idx === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.closePath();
            ctx.clip();

            const boundsCheck = bounds;
            this.tiles.forEach(tile => {
                if (!boundsCheck.contains(tile.location)) return;
                const opacity = Math.min(0.85, Math.max(0.05, tile.value / maxCloud));
                const nw = projection.fromLatLngToDivPixel(new google.maps.LatLng(tile.bounds.north, tile.bounds.west));
                const se = projection.fromLatLngToDivPixel(new google.maps.LatLng(tile.bounds.south, tile.bounds.east));
                const x = nw.x - sw.x;
                const y = nw.y - ne.y;
                const w = se.x - nw.x;
                const h = se.y - nw.y;
                if (w <= 0 || h <= 0) return;
                ctx.fillStyle = `rgba(245, 158, 11, ${opacity.toFixed(3)})`;
                ctx.fillRect(x, y, w, h);
            });

            ctx.restore();
        }
    };
}

// Main initialization
async function initMap() {
    const urlState = readMapStateFromUrl();
    const urlHome = readHomeFromUrl();

    const map = new google.maps.Map(document.getElementById('map'), {
        mapTypeId: 'terrain',
        center: urlState?.center || { lat: 40.3, lng: -3.7 },
        zoom: urlState?.zoom || 8,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        styles: MAP_STYLES
    });

    const poiIcons = createPoiIcons();
    const directionsService = new google.maps.DirectionsService();

    const path = await loadEclipsePath();
    const poiData = await loadPoi();
    const cloudData = await loadCloudData();
    const densifiedPath = densifyPath(path, 20);

    // Home location: URL params take priority, then POI with category 'home', then first POI
    const poiHome = poiData?.points?.find(point => point.category === 'home')
        || poiData?.points?.[0];
    const homePoi = urlHome || poiHome || null;
    const hasHome = homePoi !== null;

    const polygonPoints = densifiedPath.filter(entry =>
        entry.northern?.lat !== null && entry.southern?.lat !== null
    );

    const northern = polygonPoints.map(entry => ({
        lat: entry.northern.lat,
        lng: entry.northern.lon
    }));

    const southern = polygonPoints.map(entry => ({
        lat: entry.southern.lat,
        lng: entry.southern.lon
    }));

    const centerline = densifiedPath.map(entry => ({
        lat: entry.central.lat,
        lng: entry.central.lon
    }));

    // Center map on closest centerline point to home, or fit Spain bounds
    if (!urlState) {
        if (hasHome) {
            const closest = closestCenterlinePoint(homePoi.lat, homePoi.lon, centerline);
            if (closest) {
                map.setCenter({ lat: closest.lat, lng: closest.lng });
            }
        } else {
            const bounds = new google.maps.LatLngBounds(
                { lat: SPAIN_BOUNDS.south, lng: SPAIN_BOUNDS.west },
                { lat: SPAIN_BOUNDS.north, lng: SPAIN_BOUNDS.east }
            );
            map.fitBounds(bounds);
        }
    }

    const pathPolygon = new google.maps.Polygon({
        paths: [...northern, ...southern.slice().reverse()],
        strokeOpacity: 0,
        strokeWeight: 0,
        fillColor: '#f39c12',
        fillOpacity: 0,
        clickable: false,
        map
    });

    new google.maps.Polyline({
        path: centerline,
        strokeColor: '#e74c3c',
        strokeOpacity: 0.8,
        strokeWeight: 1,
        geodesic: false,
        zIndex: 2,
        clickable: false,
        map
    });

    const geometry = google.maps.geometry.poly;
    const pathPolygonLatLon = [
        ...northern.map(point => ({ lat: point.lat, lon: point.lng })),
        ...southern.slice().reverse().map(point => ({ lat: point.lat, lon: point.lng }))
    ];

    // Cloud overlay setup
    if (cloudData?.lat?.length && cloudData?.lon?.length && cloudData?.cfc?.length) {
        const maxCloud = 100;
        const step = cloudData.resolution || 0.25;
        const halfStep = step / 2;
        const tiles = [];
        const highlightOverlays = [];

        window.__cloudGrid = {
            latStart: cloudData.lat[0],
            lonStart: cloudData.lon[0],
            step,
            rows: cloudData.lat.length,
            cols: cloudData.lon.length,
            grid: cloudData.cfc
        };

        // Check if any corner of a tile intersects the path polygon
        const tileIntersectsPath = (lat, lon) => {
            const corners = [
                new google.maps.LatLng(lat + halfStep, lon - halfStep),
                new google.maps.LatLng(lat + halfStep, lon + halfStep),
                new google.maps.LatLng(lat - halfStep, lon + halfStep),
                new google.maps.LatLng(lat - halfStep, lon - halfStep),
                new google.maps.LatLng(lat, lon)
            ];
            return corners.some(corner => geometry.containsLocation(corner, pathPolygon));
        };

        for (let i = 0; i < cloudData.lat.length; i += 1) {
            const lat = cloudData.lat[i];
            const row = cloudData.cfc[i] || [];
            for (let j = 0; j < cloudData.lon.length; j += 1) {
                const lon = cloudData.lon[j];
                const value = row[j];
                if (!Number.isFinite(value)) continue;

                const location = new google.maps.LatLng(lat, lon);
                if (polygonPoints.length > 2 && tileIntersectsPath(lat, lon)) {
                    const totality = calculateTotality(lat, lon, ECLIPSE_2026_AUG_12);
                    const durationSeconds = totality.inTotality ? totality.durationSeconds : 0;
                    const clearPercent = Math.max(0, Math.min(100, maxCloud - value));
                    const score = durationSeconds * clearPercent * 2;
                    tiles.push({
                        i,
                        j,
                        value,
                        durationSeconds,
                        score,
                        location,
                        bounds: {
                            north: lat + halfStep,
                            south: lat - halfStep,
                            east: lon + halfStep,
                            west: lon - halfStep
                        }
                    });
                }
            }
        }

        const CloudOverlay = createCloudOverlayClass(maxCloud);
        const cloudOverlay = new CloudOverlay(map, tiles, pathPolygonLatLon);

        const renderCloudOverlay = () => {
            while (highlightOverlays.length) {
                const overlay = highlightOverlays.pop();
                overlay.setMap(null);
            }

            const bounds = map.getBounds();
            if (!bounds) return;

            const inViewTiles = tiles.filter(tile => bounds.contains(tile.location));
            const ranked = inViewTiles.slice().sort((a, b) => b.score - a.score);

            const rankIndex = new Map();
            ranked.forEach((tile, idx) => {
                rankIndex.set(`${tile.i},${tile.j}`, idx);
            });

            ranked.forEach(tile => {
                const idx = rankIndex.get(`${tile.i},${tile.j}`);
                const neighbors = [
                    `${tile.i + 1},${tile.j}`,
                    `${tile.i - 1},${tile.j}`,
                    `${tile.i},${tile.j + 1}`,
                    `${tile.i},${tile.j - 1}`,
                    `${tile.i + 1},${tile.j + 1}`,
                    `${tile.i + 1},${tile.j - 1}`,
                    `${tile.i - 1},${tile.j + 1}`,
                    `${tile.i - 1},${tile.j - 1}`
                ];
                const higherAdjacent = neighbors.reduce((count, key) => {
                    const neighborIdx = rankIndex.get(key);
                    if (neighborIdx !== undefined && neighborIdx < idx) {
                        return count + 1;
                    }
                    return count;
                }, 0);
                const penaltyFactor = Math.max(0, 1 - higherAdjacent * 0.1);
                tile.adjustedScore = tile.score * penaltyFactor;
            });

            const highlighted = ranked
                .slice()
                .sort((a, b) => b.adjustedScore - a.adjustedScore)
                .slice(0, 10);

            const highlightOrder = new Map();
            highlighted.forEach((tile, idx) => {
                highlightOrder.set(`${tile.i},${tile.j}`, idx);
            });

            cloudOverlay.draw();

            const highlightedMap = new Map();
            highlighted.forEach(tile => {
                highlightedMap.set(`${tile.i},${tile.j}`, tile);
            });

            const visited = new Set();
            const radiusMeters = (step * 111320) / 2;

            const neighborKeys = (tile) => ([
                `${tile.i + 1},${tile.j}`,
                `${tile.i - 1},${tile.j}`,
                `${tile.i},${tile.j + 1}`,
                `${tile.i},${tile.j - 1}`,
                `${tile.i + 1},${tile.j + 1}`,
                `${tile.i + 1},${tile.j - 1}`,
                `${tile.i - 1},${tile.j + 1}`,
                `${tile.i - 1},${tile.j - 1}`
            ]);

            highlighted.forEach(tile => {
                const key = `${tile.i},${tile.j}`;
                if (visited.has(key)) return;

                const queue = [tile];
                visited.add(key);
                const cluster = [];

                while (queue.length) {
                    const current = queue.pop();
                    cluster.push(current);
                    neighborKeys(current).forEach(neighborKey => {
                        if (visited.has(neighborKey)) return;
                        const neighbor = highlightedMap.get(neighborKey);
                        if (neighbor) {
                            visited.add(neighborKey);
                            queue.push(neighbor);
                        }
                    });
                }

                const avg = cluster.reduce((acc, item) => {
                    acc.lat += item.location.lat();
                    acc.lon += item.location.lng();
                    acc.rankSum += (highlightOrder.get(`${item.i},${item.j}`) ?? 9);
                    return acc;
                }, { lat: 0, lon: 0, rankSum: 0 });

                const centerLat = avg.lat / cluster.length;
                const centerLon = avg.lon / cluster.length;
                const avgRank = avg.rankSum / cluster.length;
                const rankOpacity = 0.3 + (1 - avgRank / 9) * 0.5;

                const circle = new google.maps.Circle({
                    map,
                    center: { lat: centerLat, lng: centerLon },
                    radius: radiusMeters,
                    strokeColor: '#e2e8f0',
                    strokeOpacity: rankOpacity,
                    strokeWeight: 2,
                    fillOpacity: 0,
                    clickable: false,
                    zIndex: 3
                });
                highlightOverlays.push(circle);
            });
        };

        renderCloudOverlay();
        map.addListener('idle', renderCloudOverlay);
    }

    // POI markers
    if (poiData?.points?.length) {
        poiData.points.forEach(point => {
            const icon = poiIcons[point.category] || poiIcons.town;
            new google.maps.Marker({
                map,
                position: { lat: point.lat, lng: point.lon },
                title: point.name,
                icon
            });
        });
    }

    // Update locked location links
    const updateLockedLinks = (lat, lon, result) => {
        const lonDir = lon >= 0 ? 'E' : 'W';
        locationCoordsEl.textContent = `${lat.toFixed(2)}°N, ${Math.abs(lon).toFixed(2)}°${lonDir}`;
        locationLabelEl.textContent = 'Locked Location';

        const defaultTime = `${ECLIPSE_2026_AUG_12.date}T18:00:00Z`;
        const midTime = result?.mid || defaultTime;
        const shadowTime = new Date(midTime).getTime();
        const shadowUrl = `https://app.shadowmap.org/?lat=${lat.toFixed(5)}&lng=${lon.toFixed(5)}&zoom=12.5&basemap=map&hud=true&time=${shadowTime}`;

        const links = [];
        links.push(`<a href="${shadowUrl}" target="_blank" rel="noopener">Shadowmap</a>`);

        if (!hasHome) {
            const checkin = '2026-08-11';
            const checkout = '2026-08-13';
            const latStr = lat.toFixed(4);
            const lonStr = lon.toFixed(4);
            const pathCoord = `${latStr}-${lonStr}`;
            const delta = 0.5;
            const airbnbParams = new URLSearchParams({
                checkin,
                checkout,
                'refinement_paths[]': '/homes',
                query: `${latStr}, ${lonStr}`,
                search_mode: 'regular_search',
                price_filter_input_type: '2',
                price_filter_num_nights: '2',
                channel: 'EXPLORE',
                ne_lat: (lat + delta).toFixed(6),
                ne_lng: (lon + delta).toFixed(6),
                sw_lat: (lat - delta).toFixed(6),
                sw_lng: (lon - delta).toFixed(6),
                zoom: '10',
                zoom_level: '10',
                search_by_map: 'true',
                search_type: 'user_map_move'
            });
            const airbnbUrl = `https://www.airbnb.com/s/${pathCoord}/homes?${airbnbParams}`;
            links.push(`<a href="${airbnbUrl}" target="_blank" rel="noopener">Airbnb</a>`);
        }

        lockedLinksEl.innerHTML = links.join(' ');

        const centerlineDistance = closestCenterlineDistance(lat, lon, centerline);

        if (hasHome) {
            const origin = `${homePoi.lat},${homePoi.lon}`;
            const destination = `${lat},${lon}`;
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
            const homeDistance = haversineDistance(lat, lon, homePoi.lat, homePoi.lon);

            distanceEl.innerHTML = `${centerlineDistance.toFixed(0)} km · <a href="${mapsUrl}" target="_blank" rel="noopener" style="color: inherit;">${homeDistance.toFixed(0)} km</a>`;

            directionsService.route(
                {
                    origin: { lat: homePoi.lat, lng: homePoi.lon },
                    destination: { lat, lng: lon },
                    travelMode: google.maps.TravelMode.DRIVING
                },
                (routeResult, status) => {
                    if (status !== 'OK' || !routeResult?.routes?.[0]?.legs?.[0]) {
                        return;
                    }
                    const leg = routeResult.routes[0].legs[0];
                    const durationSecs = leg.duration?.value || 0;
                    const hours = Math.floor(durationSecs / 3600);
                    const mins = Math.floor((durationSecs % 3600) / 60);
                    const durationFormatted = `${hours}:${mins.toString().padStart(2, '0')}`;
                    const distanceText = leg.distance?.text || `${homeDistance.toFixed(0)} km`;
                    distanceEl.innerHTML = `${centerlineDistance.toFixed(0)} km · <a href="${mapsUrl}" target="_blank" rel="noopener" style="color: inherit;">${distanceText} (${durationFormatted})</a>`;
                }
            );
        } else {
            distanceEl.textContent = `${centerlineDistance.toFixed(0)} km`;
        }
    };

    // Map event listeners
    map.addListener('mousemove', (event) => {
        if (locationLocked) return;

        const lat = event.latLng.lat();
        const lon = event.latLng.lng();
        const lonDir = lon >= 0 ? 'E' : 'W';
        locationCoordsEl.textContent = `${lat.toFixed(2)}°N, ${Math.abs(lon).toFixed(2)}°${lonDir}`;

        const inPath = polygonPoints.length > 2
            ? geometry.containsLocation(event.latLng, pathPolygon)
            : false;
        inPathEl.textContent = inPath ? 'Yes' : 'No';
        inPathEl.style.color = inPath ? '#2ecc71' : '#e74c3c';

        const centerlineDistance = closestCenterlineDistance(lat, lon, centerline);
        if (hasHome) {
            const homeDistance = haversineDistance(lat, lon, homePoi.lat, homePoi.lon);
            distanceEl.textContent = `${centerlineDistance.toFixed(0)} km · ${homeDistance.toFixed(0)} km`;
        } else {
            distanceEl.textContent = `${centerlineDistance.toFixed(0)} km`;
        }

        updateDurationDisplay(lat, lon, inPath);
    });

    map.addListener('click', (event) => {
        const lat = event.latLng.lat();
        const lon = event.latLng.lng();
        const result = calculateTotality(lat, lon, ECLIPSE_2026_AUG_12);
        locationLocked = true;

        inPathEl.textContent = result.inTotality ? 'Yes' : 'No';
        inPathEl.style.color = result.inTotality ? '#2ecc71' : '#e74c3c';

        updateDurationDisplay(lat, lon, result.inTotality);
        updateLockedLinks(lat, lon, result);
    });

    map.addListener('idle', () => writeMapStateToUrl(map));
}

// Export for Google Maps callback
window.__initMapImpl = initMap;
if (window.__initMapPending) {
    window.__initMapPending = false;
    window.__initMapImpl();
}
