// Vector, ray-intersection, reflection and refraction primitives for the REFRACT optics stack.

export const EPS = 1e-6;
export const SURFACE_OFFSET = 1e-4;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

const PARALLEL = 1e-12;

export function norm(a) {
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
}

export function normSigned(a) {
  let r = norm(a);
  if (r > Math.PI) r -= TAU;
  return r;
}

export function angleOf(dx, dy) {
  return norm(Math.atan2(dy, dx));
}

export function angleDelta(a, b) {
  return normSigned(b - a);
}

export function toDeg(a) {
  return a / DEG;
}

export function toRad(d) {
  return d * DEG;
}

export function rotate(x, y, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

export function length(x, y) {
  return Math.hypot(x, y);
}

export function normalize(x, y) {
  const l = Math.hypot(x, y);
  if (l < PARALLEL) return [0, 0];
  return [x / l, y / l];
}

// Nearest positive parameter t where the ray o+t*d crosses segment a..b, or null.
export function raySegment(ox, oy, dx, dy, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const den = dx * ey - dy * ex;
  if (den > -PARALLEL && den < PARALLEL) return null;
  const fx = ax - ox;
  const fy = ay - oy;
  const t = (fx * ey - fy * ex) / den;
  if (t <= EPS) return null;
  const u = (fx * dy - fy * dx) / den;
  if (u < 0 || u > 1) return null;
  return t;
}

// Nearest positive t where the ray meets the axis-aligned box, with the surface normal there.
export function rayAABBInto(out, ox, oy, dx, dy, x, y, w, h) {
  const x1 = x + w;
  const y1 = y + h;
  let tNear = -Infinity;
  let tFar = Infinity;
  let nearAxis = 0;
  let farAxis = 0;
  let nearSign = 0;
  let farSign = 0;

  if (dx > -PARALLEL && dx < PARALLEL) {
    if (ox < x || ox > x1) return false;
  } else {
    const inv = 1 / dx;
    let t0 = (x - ox) * inv;
    let t1 = (x1 - ox) * inv;
    let s0 = -1;
    let s1 = 1;
    if (t0 > t1) {
      const tt = t0; t0 = t1; t1 = tt;
      s0 = 1; s1 = -1;
    }
    if (t0 > tNear) { tNear = t0; nearAxis = 0; nearSign = s0; }
    if (t1 < tFar) { tFar = t1; farAxis = 0; farSign = s1; }
  }

  if (dy > -PARALLEL && dy < PARALLEL) {
    if (oy < y || oy > y1) return false;
  } else {
    const inv = 1 / dy;
    let t0 = (y - oy) * inv;
    let t1 = (y1 - oy) * inv;
    let s0 = -1;
    let s1 = 1;
    if (t0 > t1) {
      const tt = t0; t0 = t1; t1 = tt;
      s0 = 1; s1 = -1;
    }
    if (t0 > tNear) { tNear = t0; nearAxis = 1; nearSign = s0; }
    if (t1 < tFar) { tFar = t1; farAxis = 1; farSign = s1; }
  }

  if (tNear > tFar) return false;

  let t;
  let axis;
  let sign;
  if (tNear > EPS) {
    t = tNear; axis = nearAxis; sign = nearSign;
  } else if (tFar > EPS) {
    t = tFar; axis = farAxis; sign = farSign;
  } else {
    return false;
  }
  if (!isFinite(t)) return false;

  out[0] = t;
  out[1] = axis === 0 ? sign : 0;
  out[2] = axis === 1 ? sign : 0;
  return true;
}

const aabbScratch = new Float64Array(3);

export function rayAABB(ox, oy, dx, dy, x, y, w, h) {
  if (!rayAABBInto(aabbScratch, ox, oy, dx, dy, x, y, w, h)) return null;
  return { t: aabbScratch[0], nx: aabbScratch[1], ny: aabbScratch[2] };
}

// Nearest positive t where the ray meets the circle, or null.
export function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const mx = ox - cx;
  const my = oy - cy;
  const b = mx * dx + my * dy;
  const c = mx * mx + my * my - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 > EPS) return t0;
  const t1 = -b + s;
  if (t1 > EPS) return t1;
  return null;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  let u = 0;
  if (len2 > PARALLEL) u = ((px - ax) * ex + (py - ay) * ey) / len2;
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  return Math.hypot(px - (ax + ex * u), py - (ay + ey * u));
}

export function reflectInto(out, dx, dy, nx, ny) {
  const d = 2 * (dx * nx + dy * ny);
  out[0] = dx - d * nx;
  out[1] = dy - d * ny;
  return true;
}

const reflectScratch = new Float64Array(2);

export function reflect(dx, dy, nx, ny) {
  reflectInto(reflectScratch, dx, dy, nx, ny);
  return [reflectScratch[0], reflectScratch[1]];
}

// eta = n_incident / n_transmitted. The normal is flipped internally to face the ray.
export function refractInto(out, dx, dy, nx, ny, eta) {
  let ndoti = nx * dx + ny * dy;
  if (ndoti > 0) {
    nx = -nx;
    ny = -ny;
    ndoti = -ndoti;
  }
  const k = 1 - eta * eta * (1 - ndoti * ndoti);
  if (k < 0) return false;
  const s = eta * ndoti + Math.sqrt(k);
  out[0] = eta * dx - s * nx;
  out[1] = eta * dy - s * ny;
  return true;
}

const refractScratch = new Float64Array(2);

export function refract(dx, dy, nx, ny, eta) {
  if (!refractInto(refractScratch, dx, dy, nx, ny, eta)) return null;
  return [refractScratch[0], refractScratch[1]];
}

export function criticalAngle(n1, n2) {
  if (n2 >= n1) return Math.PI / 2;
  return Math.asin(n2 / n1);
}

// Unpolarized Fresnel reflectance. cosI is the cosine of the incidence angle, 0..1.
export function fresnel(cosI, n1, n2) {
  let ci = cosI < 0 ? -cosI : cosI;
  if (ci > 1) ci = 1;
  const sinI = Math.sqrt(Math.max(0, 1 - ci * ci));
  const sinT = (n1 / n2) * sinI;
  if (sinT >= 1) return 1;
  const cosT = Math.sqrt(Math.max(0, 1 - sinT * sinT));
  const rs = (n1 * ci - n2 * cosT) / (n1 * ci + n2 * cosT);
  const rp = (n1 * cosT - n2 * ci) / (n1 * cosT + n2 * ci);
  return Math.min(1, (rs * rs + rp * rp) * 0.5);
}
