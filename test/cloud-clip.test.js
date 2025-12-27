import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { clipTileBoundsByPolygon } from '../scripts/cloud-clip.js';

const EPS = 1e-6;

const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const interpolatePoint = (a, b, t) => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lon: a.lon + (b.lon - a.lon) * t
});

const densifyPath = (pathData, maxKmStep = 20) => {
  if (pathData.length < 2) return pathData;
  const densified = [];
  for (let i = 0; i < pathData.length - 1; i += 1) {
    const current = pathData[i];
    const next = pathData[i + 1];
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
        northern,
        southern,
        central: interpolatePoint(current.central, next.central, t)
      });
    }
  }
  densified.push(pathData[pathData.length - 1]);
  return densified;
};

const loadJson = (relativePath) => {
  const filePath = path.resolve(process.cwd(), relativePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const buildTileBounds = (cloud, targetLat, targetLon) => {
  const latIndex = cloud.lat.reduce((bestIdx, value, idx) => (
    Math.abs(value - targetLat) < Math.abs(cloud.lat[bestIdx] - targetLat) ? idx : bestIdx
  ), 0);
  const lonIndex = cloud.lon.reduce((bestIdx, value, idx) => (
    Math.abs(value - targetLon) < Math.abs(cloud.lon[bestIdx] - targetLon) ? idx : bestIdx
  ), 0);

  const step = cloud.resolution;
  const halfStep = step / 2;
  const lat = cloud.lat[latIndex];
  const lon = cloud.lon[lonIndex];

  return {
    north: lat + halfStep,
    south: lat - halfStep,
    east: lon + halfStep,
    west: lon - halfStep
  };
};

test('clipTileBounds for known border tiles', () => {
  const eclipse = loadJson('data/eclipse-2026.json');
  const cloud = loadJson('data/cloud-2026.json');
  const densified = densifyPath(eclipse.path, 20);
  const polygonPoints = densified.filter(entry =>
    entry.northern?.lat !== null && entry.southern?.lat !== null
  );
  const pathPolygon = [
    ...polygonPoints.map(entry => ({ lat: entry.northern.lat, lon: entry.northern.lon })),
    ...polygonPoints.slice().reverse().map(entry => ({ lat: entry.southern.lat, lon: entry.southern.lon }))
  ];

  const cases = [
    {
      name: 'north border tile',
      lat: 41.44,
      lon: 1.26,
      expect: 'clipped'
    },
    {
      name: 'southern missing tile',
      lat: 40.45,
      lon: -2.32,
      expect: 'present'
    },
    {
      name: 'center tile',
      lat: 40.85,
      lon: 0.05,
      expect: 'full'
    },
    {
      name: 'southern clipped tile',
      lat: 40.62,
      lon: -2.71,
      expect: 'clipped'
    }
  ];

  cases.forEach(({ name, lat, lon, expect: expectation }) => {
    const bounds = buildTileBounds(cloud, lat, lon);
    const clipped = clipTileBoundsByPolygon(bounds, pathPolygon);

    if (expectation === 'present') {
      assert.ok(clipped, `${name} expected to render but got null`);
    } else if (expectation === 'full') {
      assert.ok(clipped, `${name} expected full coverage but got null`);
      assert.ok(Math.abs(clipped.north - bounds.north) < EPS, `${name} north should be uncut`);
      assert.ok(Math.abs(clipped.south - bounds.south) < EPS, `${name} south should be uncut`);
    } else if (expectation === 'clipped') {
      assert.ok(clipped, `${name} expected clipped but got null`);
      const isClipped = clipped.north < bounds.north - EPS || clipped.south > bounds.south + EPS;
      assert.ok(isClipped, `${name} expected a clipped edge`);
    }
  });
});
