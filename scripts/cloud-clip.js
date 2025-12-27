const EPS = 1e-9;

export function bandLatAtLon(polygon, lon, referenceLat = null) {
  const intersections = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const lon1 = a.lon;
    const lon2 = b.lon;

    if (Math.abs(lon1 - lon2) < EPS) {
      if (Math.abs(lon - lon1) < EPS) {
        intersections.push(a.lat, b.lat);
      }
      continue;
    }

    if ((lon >= lon1 && lon <= lon2) || (lon >= lon2 && lon <= lon1)) {
      const t = (lon - lon1) / (lon2 - lon1);
      const lat = a.lat + (b.lat - a.lat) * t;
      intersections.push(lat);
    }
  }

  if (intersections.length < 2) return null;
  const sorted = intersections.slice().sort((x, y) => x - y);

  if (referenceLat !== null) {
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const southLat = sorted[i];
      const northLat = sorted[i + 1];
      if (referenceLat >= southLat && referenceLat <= northLat) {
        return { northLat, southLat };
      }
    }
  }

  return { northLat: sorted[sorted.length - 1], southLat: sorted[0] };
}

export function clipTileBoundsByPolygon(bounds, polygon) {
  const centerLat = (bounds.north + bounds.south) / 2;
  const bandWest = bandLatAtLon(polygon, bounds.west, centerLat);
  const bandEast = bandLatAtLon(polygon, bounds.east, centerLat);
  if (!bandWest || !bandEast) return null;

  const northLat = Math.min(bandWest.northLat, bandEast.northLat);
  const southLat = Math.max(bandWest.southLat, bandEast.southLat);

  const clippedNorth = Math.min(bounds.north, northLat);
  const clippedSouth = Math.max(bounds.south, southLat);
  if (clippedSouth >= clippedNorth) return null;

  return {
    north: clippedNorth,
    south: clippedSouth,
    east: bounds.east,
    west: bounds.west
  };
}
