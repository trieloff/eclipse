export function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.lon * b.lat - b.lon * a.lat;
  }
  return area / 2;
}

export function normalizeClockwise(points) {
  return polygonArea(points) < 0 ? points : points.slice().reverse();
}

// Sutherland–Hodgman polygon clipping (clip polygon must be convex)
export function clipPolygon(subject, clip) {
  if (subject.length < 3 || clip.length < 3) return [];
  let output = subject.slice();
  const clipIsClockwise = polygonArea(clip) < 0;

  const isInside = (p, a, b) => {
    const cross = (b.lon - a.lon) * (p.lat - a.lat) - (b.lat - a.lat) * (p.lon - a.lon);
    return clipIsClockwise ? cross <= 0 : cross >= 0;
  };

  const intersection = (p1, p2, a, b) => {
    const x1 = p1.lon;
    const y1 = p1.lat;
    const x2 = p2.lon;
    const y2 = p2.lat;
    const x3 = a.lon;
    const y3 = a.lat;
    const x4 = b.lon;
    const y4 = b.lat;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-12) return p2;

    const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
    const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;
    return { lat: py, lon: px };
  };

  for (let i = 0; i < clip.length; i += 1) {
    const input = output.slice();
    output = [];
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    for (let j = 0; j < input.length; j += 1) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pInside = isInside(p, a, b);
      const qInside = isInside(q, a, b);

      if (pInside && qInside) {
        output.push(q);
      } else if (pInside && !qInside) {
        output.push(intersection(p, q, a, b));
      } else if (!pInside && qInside) {
        output.push(intersection(p, q, a, b));
        output.push(q);
      }
    }
  }

  return output;
}
