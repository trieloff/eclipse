import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { clipPolygon, normalizeClockwise, polygonArea } from '../scripts/polygon-clip.js';

const EPS = 1e-6;

const areaAbs = (poly) => Math.abs(polygonArea(poly));

const withinBounds = (point, bounds) => (
  point.lat <= bounds.north + EPS &&
  point.lat >= bounds.south - EPS &&
  point.lon <= bounds.east + EPS &&
  point.lon >= bounds.west - EPS
);

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

const densifyPath = (path, maxKmStep = 20) => {
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
        northern,
        southern,
        central: interpolatePoint(current.central, next.central, t)
      });
    }
  }
  densified.push(path[path.length - 1]);
  return densified;
};

const buildPathPolygon = (pathData) => {
  const densified = densifyPath(pathData, 20);
  const polygonPoints = densified.filter(entry =>
    entry.northern?.lat !== null && entry.southern?.lat !== null
  );
  const northern = polygonPoints.map(entry => ({ lat: entry.northern.lat, lon: entry.northern.lon }));
  const southern = polygonPoints.map(entry => ({ lat: entry.southern.lat, lon: entry.southern.lon }));
  return normalizeClockwise([
    ...northern,
    ...southern.slice().reverse()
  ]);
};

const loadJson = (relativePath) => {
  const filePath = path.resolve(process.cwd(), relativePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const buildTileRect = (cloud, targetLat, targetLon) => {
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
    rectPoly: normalizeClockwise([
      { lat: lat + halfStep, lon: lon - halfStep },
      { lat: lat + halfStep, lon: lon + halfStep },
      { lat: lat - halfStep, lon: lon + halfStep },
      { lat: lat - halfStep, lon: lon - halfStep }
    ]),
    center: { lat, lon }
  };
};

test('clips a square by a smaller rectangle', () => {
  const square = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 2 },
    { lat: 2, lon: 2 },
    { lat: 2, lon: 0 }
  ];
  const rect = [
    { lat: 0.5, lon: 0.5 },
    { lat: 0.5, lon: 1.5 },
    { lat: 1.5, lon: 1.5 },
    { lat: 1.5, lon: 0.5 }
  ];

  const clipped = clipPolygon(square, rect);
  const expectedArea = 1; // 1x1

  assert.ok(clipped.length >= 3);
  assert.ok(Math.abs(areaAbs(clipped) - expectedArea) < EPS);
});

test('clipped polygon stays within rectangle bounds', () => {
  const triangle = [
    { lat: -1, lon: -1 },
    { lat: 2, lon: 0 },
    { lat: 0, lon: 3 }
  ];
  const rect = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 2 },
    { lat: 2, lon: 2 },
    { lat: 2, lon: 0 }
  ];
  const clipped = clipPolygon(triangle, rect);
  const bounds = { north: 2, south: 0, east: 2, west: 0 };

  assert.ok(clipped.length >= 3);
  clipped.forEach((point) => {
    assert.ok(withinBounds(point, bounds));
  });
});

test('orientation does not change clipped area', () => {
  const subject = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 3 },
    { lat: 2, lon: 3 },
    { lat: 2, lon: 0 }
  ];
  const clip = [
    { lat: 0.5, lon: 0.5 },
    { lat: 0.5, lon: 2.5 },
    { lat: 1.5, lon: 2.5 },
    { lat: 1.5, lon: 0.5 }
  ];

  const clippedA = clipPolygon(subject, clip);
  const clippedB = clipPolygon(subject.slice().reverse(), clip.slice().reverse());

  assert.ok(Math.abs(areaAbs(clippedA) - areaAbs(clippedB)) < EPS);
});

test('normalizeClockwise produces clockwise winding', () => {
  const poly = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
    { lat: 1, lon: 0 }
  ];
  const normalized = normalizeClockwise(poly);
  assert.ok(polygonArea(normalized) < 0);
});

test('clip polygon handles eclipse tiles along the borders', () => {
  const eclipse = loadJson('data/eclipse-2026.json');
  const cloud = loadJson('data/cloud-2026.json');
  const pathPolygon = buildPathPolygon(eclipse.path);

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
    const { rectPoly } = buildTileRect(cloud, lat, lon);
    const clipped = clipPolygon(pathPolygon, rectPoly);
    const rectArea = areaAbs(rectPoly);
    const clippedArea = areaAbs(clipped);
    const ratio = rectArea === 0 ? 0 : clippedArea / rectArea;

    if (expectation === 'full') {
      assert.ok(ratio > 0.98, `${name} expected full coverage, got ratio ${ratio.toFixed(2)}`);
    } else if (expectation === 'clipped') {
      assert.ok(ratio > 0.05 && ratio < 0.98, `${name} expected clipped, got ratio ${ratio.toFixed(2)}`);
    } else if (expectation === 'present') {
      assert.ok(ratio > 0.05, `${name} expected some coverage, got ratio ${ratio.toFixed(2)}`);
    }
  });
});
