import * as T from 'three';
import type { SurfaceKind } from './city-materials';
import { animateResident, blob, DEPTH, HEAD, lathe, paint, part, shade, taper, TORSO, torsoAt } from './city-people';
import { ellipsoid, sculpt } from './town-sculpt';

/*
 * Alison Heppenstall's little figure for the sky island, built like the town's residents
 * (city-people.ts: the same kit, scale and joints, so their walk code drives her) but as one named
 * person: long, loose, curly ginger hair, dark rectangular glasses, a black long-sleeved top with a
 * small pale pendant, fair skin, dark trousers. Her hands carry a watering can, or a teacup and its
 * saucer; poseAlison() sets every joint and prop for a pose and a phase, from nothing
 * else, so town time can drive it and a paused town holds it. The sky island (town-sky's alison())
 * stands her on its deck and poses her through her day from town-plan's alisonDay.
 */
type Material = (c: string, k?: SurfaceKind) => T.MeshStandardMaterial;
type V3 = [number, number, number];

/**
 * Her colours (sRGB). Like the residents', every one stays at or under HSV saturation 0.55, but for
 * the hair: one ginger, the portrait's orange (hue 25), in shades of its one saturation, just under
 * HAIR_SATURATION, its hue turning between copper and a golden ginger with the light each face gets
 * (HAIR_TURN; the hair is the likeness, and held to 0.55 it reads brown). check-town names that
 * exception and holds everything else to 0.55.
 */
export const ALISON_LOOK = {
  hair: '#cc793e',
  skin: '#f0cba9',
  top: '#2d2b2e',
  trousers: '#3b4552',
  shoes: '#4b392e',
  frames: '#262220',
  lens: '#f2d7c3',
  eyes: '#2b2622',
  pendant: '#ece4d3',
  // The watering can: pale galvanised zinc, so it reads against her black top and the border's
  // greens (a mid grey was lost against both); the water it pours, a pale blue.
  zinc: '#c9ccc8',
  water: '#9fd3df',
  china: '#efeae0',
  chinaBand: '#8ea2b4',
  tea: '#a07a58',
};
/**
 * The hair's saturation cap (HSV, sRGB): her one exception to the figures' 0.55. It is 0.70, not the
 * 0.62 it was: under the town's 0.72 grade a copper held to 0.62 rendered a salmon brown beside the
 * portrait's ginger.
 */
export const HAIR_SATURATION = 0.7;
/**
 * How many degrees the hair's hue turns from ALISON_LOOK.hair's: more golden on what faces straight
 * up, more coppery on what faces straight down and as a shade deepens to black (see hair()); and the
 * band every shade's hue stays in, from a copper to a golden ginger.
 */
const HAIR_TURN = [5, 8, 10],
  HAIR_HUES = [16, 32];

/* ------------------------------------------------------------------ */
/* Measures (the residents', see city-people.ts)                       */
/* ------------------------------------------------------------------ */
/** The hips' pivot height (each leg's group), and the arms' pivots (shoulders). */
const HIP = 0.31,
  SHOULDER = { x: 0.165, y: 0.6 };
/** The arm's two bones: shoulder to elbow, and elbow to the hand's (mitten's) centre (0.215 in all, as a resident's). */
const UPPER = 0.095,
  FORE = 0.12;
/** The thigh's radius at the hip: seated, its underside rests this far below the hip line. */
const THIGH_R = 0.063;
/** An eye's point on the face (where a resident's eyes sit), behind the glasses. */
const EYE: V3 = [0, 0.772, 0.137];
/** The pendant's middle, just under the top's collar. */
const PENDANT_Y = 0.565;
/** The teacup's axis stands this far from its handle (the cup's origin), along its +x. */
const CUP_AXIS = 0.058;
/** The spacing of the distance grid the hair's crown is meshed on: its triangles go as 1/h² (about 460 show at this spacing). */
const HAIR_GRID = 0.034;

/**
 * The seat she sits on, its top above her floor: the town's park bench (town-props' bench: slats
 * centred 0.405 up, 0.07 thick, so 0.44; the residence's oak bench is 0.40 and the airport's 0.38).
 * Seated, her hip line is 0.193 over her floor (`lift`), her thighs rest on the seat, and her
 * short legs hang from the knee with her soles 0.33 clear of the floor, as a resident's would. Any
 * seat from 0.11 (where her soles just clear the floor) works: pass `seat` to poseAlison.
 */
const SEAT = 0.44;
/** A stride (one 'walk' phase, two steps) in units: animateResident's gait turns 17 radians a unit. */
const STRIDE = (Math.PI * 2) / 17;

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */
const srgb = new T.Color();
/** A hex colour as sRGB components (0..1). */
function sRGB(hex: string): V3 {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A hex colour as HSV: hue in degrees, saturation and value 0..1. */
function toHsv(hex: string): V3 {
  const [r, g, b] = sRGB(hex),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  return [max === min ? 0 : (60 * (g - b)) / (max - min), max ? (max - min) / max : 0, max];
}
/** HSV (hue in degrees, saturation and value 0..1) as sRGB components. */
function hsv(h: number, sat: number, v: number): V3 {
  const f = (k: number) => {
    const m = (k + h / 60) % 6;
    return v - v * sat * Math.max(0, Math.min(m, 4 - m, 1));
  };
  return [f(5), f(3), f(1)];
}
/** Whether a point is hidden inside her head or her torso (a little under their surfaces). */
function insideBody(x: number, y: number, z: number) {
  const [a, b, c] = HEAD.r;
  if (Math.hypot(x / a, (y - HEAD.y) / b, (z - 0.005) / c) < 0.94) return true;
  const r = torsoAt(y);
  return r > 0 && Math.hypot(x / r, z / (r * DEPTH)) < 0.9;
}
/** A geometry (un-indexed, its positions and normals only) without the triangles whose three corners are all `hidden`. */
function shown(geometry: T.BufferGeometry, hidden: (x: number, y: number, z: number) => boolean) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry,
    p = flat.getAttribute('position'),
    n = flat.getAttribute('normal'),
    pos: number[] = [],
    nor: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    if ([0, 1, 2].every((k) => hidden(p.getX(i + k), p.getY(i + k), p.getZ(i + k)))) continue;
    for (let k = 0; k < 3; k++) {
      pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
      nor.push(n.getX(i + k), n.getY(i + k), n.getZ(i + k));
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  return g;
}
/**
 * Which way a point of the hair faces: out from the head's middle above it and the body's upright
 * axis below, or, below the jaw, towards `face` if a lock is given one (a lock hanging in front of
 * the shoulder turns its flat side forward).
 */
function away(q: T.Vector3, out: T.Vector3, face?: V3) {
  out.set(q.x, q.y - Math.min(q.y, HEAD.y), q.z - (q.y < HEAD.y ? -0.02 : 0.005)).normalize();
  if (face) out.lerp(new T.Vector3(...face), 1 - T.MathUtils.smoothstep(q.y, 0.6, 0.7)).normalize();
  return out;
}
/**
 * A lock of hair: a smooth tube along a centripetal Catmull-Rom curve through `p`, its section an
 * ellipse lying on the mass (half-width `a` across it, half-thickness `b` along `out`, the way it
 * faces, all running smoothly through their lists, one a point), closed at each end by a half
 * ellipsoid, so its tip is round. Rings about `step` apart along it, `radial` points round each,
 * `tip` more rings in the round end; every normal is the surface's own (the section's, tilted as
 * the lock narrows), so it shades round at any size and has no seams along it. `shape` is the same
 * solid as a field: the nearest point of its axis, and the ellipse round it.
 */
function lock(p: V3[], a: number[], b: number[], out: V3[], radial = 10, step = 0.036, tip = 2) {
  const curve = new T.CatmullRomCurve3(p.map((q) => new T.Vector3(...q)), false, 'centripetal'),
    length = curve.getLength(),
    n = Math.max(4, Math.ceil(length / step)),
    m = a.length - 1,
    // A list's value at curve parameter t: a Catmull-Rom through it (point k is at t = k / m), held at the ends.
    spline = (r: number[], t: number) => {
      const f = Math.min(m - 1e-9, Math.max(0, t * m)),
        i = Math.floor(f),
        s = f - i,
        r0 = r[Math.max(0, i - 1)],
        r1 = r[i],
        r2 = r[i + 1],
        r3 = r[Math.min(m, i + 2)];
      return r1 + 0.5 * s * (r2 - r0 + s * (2 * r0 - 5 * r1 + 4 * r2 - r3 + s * (3 * (r1 - r2) + r3 - r0)));
    },
    c: T.Vector3[] = [],
    t: T.Vector3[] = [],
    N: T.Vector3[] = [],
    S: T.Vector3[] = [],
    A: number[] = [],
    B: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n,
      q = curve.getPointAt(u),
      tt = curve.getTangentAt(u),
      k = curve.getUtoTmapping(u, u * length),
      // The way it faces, square to the lock (or the last ring's, where the lock runs out along it).
      o = new T.Vector3(...([0, 1, 2].map((j) => spline(out.map((v) => v[j]), k)) as V3));
    o.addScaledVector(tt, -o.dot(tt));
    if (o.lengthSq() < 0.04 && i) o.copy(N[i - 1]).addScaledVector(tt, -N[i - 1].dot(tt));
    o.normalize();
    c.push(q);
    t.push(tt);
    N.push(o);
    S.push(new T.Vector3().crossVectors(o, tt));
    A.push(spline(a, k));
    B.push(Math.min(spline(b, k), spline(a, k)));
  }
  const slope = (r: number[], i: number) => {
      const i0 = Math.max(0, i - 1),
        i1 = Math.min(n, i + 1);
      return T.MathUtils.clamp(((r[i1] - r[i0]) * n) / ((i1 - i0) * length), -0.8, 0.8);
    },
    pos: number[] = [],
    nor: number[] = [],
    idx: number[] = [],
    rings: number[] = [],
    d = new T.Vector3();
  /**
   * A ring of ellipsoid points round ring i's centre: at latitude `lat` towards `end` (+1 the tip,
   * -1 the root; 0 is the tube's own section), the ellipsoid's third half-axis `along`.
   */
  const ring = (i: number, lat: number, end: number, along: number) => {
    rings.push(pos.length / 3);
    const ca = Math.cos(lat),
      sa = Math.sin(lat),
      sA = slope(A, i),
      sB = slope(B, i);
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2,
        x = Math.cos(th),
        y = Math.sin(th);
      // The point, and the ellipsoid's normal there (its gradient); on the tube, tilted by the section's narrowing.
      d.copy(S[i]).multiplyScalar(A[i] * x * ca).addScaledVector(N[i], B[i] * y * ca).addScaledVector(t[i], along * sa * end).add(c[i]);
      pos.push(d.x, d.y, d.z);
      d.copy(S[i]).multiplyScalar((x * ca) / A[i]).addScaledVector(N[i], (y * ca) / B[i]);
      const l = d.length();
      d.multiplyScalar(1 / l).addScaledVector(t[i], lat ? ((sa * end) / along) / l : -(sA * x * x + sB * y * y)).normalize();
      nor.push(d.x, d.y, d.z);
    }
  };
  const pole = (i: number, end: number, along: number) => {
    pos.push(c[i].x + t[i].x * along * end, c[i].y + t[i].y * along * end, c[i].z + t[i].z * along * end);
    nor.push(t[i].x * end, t[i].y * end, t[i].z * end);
    return pos.length / 3 - 1;
  };
  // The root's end, the tube, and the tip's end: each end half an ellipsoid as deep as the section is thick.
  const pole0 = pole(0, -1, B[0]);
  ring(0, Math.PI / 4, -1, B[0]);
  for (let i = 0; i <= n; i++) ring(i, 0, 1, 1);
  for (let k = 1; k <= tip; k++) ring(n, ((Math.PI / 2) * k) / (tip + 1), 1, B[n]);
  const pole1 = pole(n, 1, B[n]);
  for (let k = 0; k < rings.length; k++)
    for (let j = 0; j < radial; j++) {
      const v0 = rings[k] + j,
        v1 = rings[k] + ((j + 1) % radial);
      if (k === 0) idx.push(pole0, v1, v0);
      if (k === rings.length - 1) idx.push(v0, v1, pole1);
      else idx.push(v0, v1, v1 + radial, v0, v1 + radial, v0 + radial);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  geometry.setIndex(idx);
  // The field: from the nearest point of the axis (each segment's frame and half-axes blended
  // along it), the ellipsoid bound of the section there (its third half-axis the thickness, so
  // the ends come out round).
  const lo = [1e3, 1e3, 1e3],
    hi = [-1e3, -1e3, -1e3],
    reach = Math.max(...A);
  for (const q of c)
    q.toArray().forEach((v, k) => {
      lo[k] = Math.min(lo[k], v - reach);
      hi[k] = Math.max(hi[k], v + reach);
    });
  const shape = {
    d(x: number, y: number, z: number) {
      let best = 1e3;
      for (let i = 0; i < n; i++) {
        const P = c[i],
          Q = c[i + 1],
          sx = Q.x - P.x,
          sy = Q.y - P.y,
          sz = Q.z - P.z,
          f = T.MathUtils.clamp(((x - P.x) * sx + (y - P.y) * sy + (z - P.z) * sz) / (sx * sx + sy * sy + sz * sz), 0, 1),
          px = x - P.x - sx * f,
          py = y - P.y - sy * f,
          pz = z - P.z - sz * f,
          ra = A[i] + (A[i + 1] - A[i]) * f;
        // Too far from this segment to be nearer than the best so far.
        if (Math.sqrt(px * px + py * py + pz * pz) - ra > best) continue;
        const rb = B[i] + (B[i + 1] - B[i]) * f,
          g = (V: T.Vector3[]) => [V[i].x + (V[i + 1].x - V[i].x) * f, V[i].y + (V[i + 1].y - V[i].y) * f, V[i].z + (V[i + 1].z - V[i].z) * f],
          [ux, uy, uz] = g(S),
          [vx, vy, vz] = g(N),
          [wx, wy, wz] = g(t),
          u = (px * ux + py * uy + pz * uz) / ra,
          v = (px * vx + py * vy + pz * vz) / rb,
          w = (px * wx + py * wy + pz * wz) / rb,
          k0 = Math.sqrt(u * u + v * v + w * w),
          k1 = Math.sqrt((u / ra) ** 2 + (v / rb) ** 2 + (w / rb) ** 2);
        best = Math.min(best, k1 < 1e-9 ? -rb : (k0 * (k0 - 1)) / k1);
      }
      return best;
    },
    min: lo as unknown as V3,
    max: hi as unknown as V3,
  };
  return { geometry, shape };
}
/**
 * The triangles of an indexed geometry that are not wholly `hidden`, un-indexed, with colours on
 * their vertices from `colour` (sRGB, from each vertex's position and normal).
 */
function kept(geometry: T.BufferGeometry, hidden: (x: number, y: number, z: number) => boolean, colour: (p: T.Vector3, n: T.Vector3) => V3) {
  const p = geometry.getAttribute('position'),
    nrm = geometry.getAttribute('normal'),
    index = geometry.index!,
    gone = new Uint8Array(p.count),
    rgb = new Float32Array(p.count * 3),
    v = new T.Vector3(),
    n = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    gone[i] = hidden(p.getX(i), p.getY(i), p.getZ(i)) ? 1 : 0;
    const [r, g, b] = colour(v.fromBufferAttribute(p, i), n.fromBufferAttribute(nrm, i));
    srgb.setRGB(r, g, b, T.SRGBColorSpace).toArray(rgb, i * 3);
  }
  const pos: number[] = [],
    nor: number[] = [],
    col: number[] = [];
  for (let k = 0; k < index.count; k += 3) {
    const tri = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    if (tri.every((i) => gone[i])) continue;
    for (const i of tri) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      col.push(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  return g;
}
/**
 * A lock's line and section, from its spine `p` (inside the crown down to where its curl begins)
 * and its half-width `r` at each spine point: resampled to `k` points, each moved across the fall
 * by a gentle wave (`wave` across the mass, half as much out from it, a quarter turn behind, so the
 * lock winds a little as a ringlet does), `turns` waves over its length from `phase`, faded in from
 * the root so it stays in the crown; its width swells a little with the wave, and it is `flat` as
 * thick as it is wide (never under 0.072 through). Then the curl: the line turns towards `curl`
 * through `hook` radians on a bend of radius `bend`, rounding as it goes, so the tip ends in a
 * round curl. Returns the line, the section's half-width and half-thickness along it, and the way
 * it faces (away(), with the lock's `face`).
 */
function line(spec: Lock, k = 12): [V3[], number[], number[], V3[]] {
  const { p, r, flat = 0.62, wave = 0.026, phase = 0, turns = 1.5, curl, hook = 1.4, bend = 0.032, face } = spec,
    curve = new T.CatmullRomCurve3(p.map((q) => new T.Vector3(...q)), false, 'centripetal'),
    length = curve.getLength(),
    m = r.length - 1,
    pts: V3[] = [],
    wide: number[] = [],
    thick: number[] = [],
    outs: V3[] = [],
    o = new T.Vector3(),
    s = new T.Vector3();
  for (let i = 0; i < k; i++) {
    const u = i / (k - 1),
      q = curve.getPointAt(u),
      tt = curve.getTangentAt(u),
      f = curve.getUtoTmapping(u, u * length) * m,
      j = Math.min(m - 1, Math.floor(f)),
      a = (phase + turns * u) * Math.PI * 2,
      fade = T.MathUtils.smoothstep(u, 0, 0.35),
      w = (r[j] + (r[j + 1] - r[j]) * (f - j)) * (1 + 0.07 * fade * Math.cos(a));
    away(q, o, face);
    outs.push([o.x, o.y, o.z]);
    o.addScaledVector(tt, -o.dot(tt)).normalize();
    s.crossVectors(o, tt);
    q.addScaledVector(s, wave * fade * Math.sin(a)).addScaledVector(o, 0.5 * wave * fade * Math.cos(a));
    pts.push([q.x, q.y, q.z]);
    wide.push(w);
    thick.push(Math.max(0.036, w * flat));
  }
  // The curl: an arc from the end, leaving along the line's last direction and turning towards `curl`.
  const end = new T.Vector3(...pts[k - 1]),
    dir = end.clone().sub(new T.Vector3(...pts[k - 2])).normalize(),
    side = new T.Vector3(...curl).addScaledVector(dir, -new T.Vector3(...curl).dot(dir)).normalize(),
    centre = end.clone().addScaledVector(side, bend),
    w0 = wide[k - 1],
    b0 = thick[k - 1];
  for (let i = 1; i <= 4; i++) {
    const a = (hook * i) / 4,
      q = centre.clone().addScaledVector(side, -bend * Math.cos(a)).addScaledVector(dir, bend * Math.sin(a));
    pts.push([q.x, q.y, q.z]);
    wide.push(Math.max(b0, w0 + (b0 - w0) * (i / 4)));
    thick.push(b0);
    outs.push(outs[k - 1]);
  }
  return [pts, wide, thick, outs];
}
/** Each lock's line as the hair builds it (line()'s points, from inside the crown to the tip of its curl), for the checks. */
export function hairLockLines() {
  return LOCKS.map((spec) => line(spec)[0]);
}
/** A lock's spec for line(): see there. `radial` is its points round, for lock(). */
type Lock = { p: V3[]; r: number[]; curl: V3; flat?: number; wave?: number; phase?: number; turns?: number; hook?: number; bend?: number; face?: V3; radial?: number };
/**
 * The hair, blocked out from the portrait for a camera that looks down on her: a smooth crown and
 * ten big locks, every normal an exact one, so nothing is faceted.
 * - The crown, from town-sculpt's distance grid: close over the skull (under the tallest
 *   resident's head), with the face carved out of it from a hairline well above the glasses, so
 *   her forehead and face stay clear; and a curtain down her back, so no gap between the locks
 *   shows her top.
 * - The locks (LOCKS, lock()): each one smooth form, flat as hair lies, tapering from the crown to
 *   a round curl at its tip and waving gently from side to side as it falls, neighbours out of
 *   step. The first is the swoop: from her parting, on her right, over the top of her head to her
 *   left temple, then down past her cheek onto her chest; on the parting's other side one falls
 *   down her right temple and cheek. Those two frame her face and lie in over her collarbones, so
 *   a reaching arm comes out beside them rather than through them. The rest fall from the crown
 *   down the sides and back, past her shoulders and behind her arms, to mid-back. The locks meet
 *   one another and the crown in crisp creases: at the town's scale that is what reads as curls,
 *   where a blended mass reads as a hood and a cluster of small balls as bubbles.
 * From in front the hair is widest at her cheeks, about 1.57 times her head (F1b's 1.37 read narrow
 * and rope-like beside the portrait's big curly volume): the face's two locks are broader, and the
 * locks over her ears and down her sides stand out from her temples, fuller and rounder, and lie
 * out over the backs of her shoulders, every lock ending in a fuller curl; no band below is wider.
 * Whatever another part of the hair, the head or the torso hides is left out. Returns the pieces
 * (the crown, then each lock) and `covers`: whether a point lies under the hair.
 */
function hair() {
  const s = sculpt([-0.24, 0.42, -0.26], [0.24, 0.97, 0.21], HAIR_GRID),
    e = (c: V3, r: V3, rot?: V3) => ellipsoid(c, r, rot);
  // The crown, close over the skull, and a thin curtain down her back, behind the locks.
  s.add(e([0.002, 0.758, -0.01], [0.168, 0.162, 0.165]));
  s.add(e([0, 0.6, -0.12], [0.12, 0.16, 0.05]), 0.05);
  // The face, carved out from a hairline well above the glasses down past the chin, tilted so the
  // hairline rises towards her parting.
  s.cut(e([0, 0.735, 0.15], [0.118, 0.14, 0.13], [0, 0, 0.15]), 0.015);
  const locks = LOCKS.map((spec) => lock(...line(spec), spec.radial ?? 10, 0.04));
  /** The hair's distance field: the crown (unless `cap` is false) and every lock but `skip`. */
  const field = (x: number, y: number, z: number, skip = -1, cap = true) => {
    let d = cap ? s.exact(x, y, z) : 1e3;
    for (let i = 0; i < locks.length; i++) {
      if (i === skip) continue;
      const shape = locks[i].shape,
        { min, max } = shape,
        ox = Math.max(min[0] - x, 0, x - max[0]),
        oy = Math.max(min[1] - y, 0, y - max[1]),
        oz = Math.max(min[2] - z, 0, z - max[2]);
      if (ox * ox + oy * oy + oz * oz < d * d) d = Math.min(d, shape.d(x, y, z));
    }
    return d;
  };
  const [hue, sat, value] = toHsv(ALISON_LOOK.hair),
    copper = (p: T.Vector3, n: T.Vector3): V3 => {
      // How far the field opens out along the normal (a distance-field occlusion): the creases
      // between locks and the hair's own underside come out deeper, so the locks read.
      let shut = 0;
      for (const [d, w] of [[0.012, 0.5], [0.028, 0.35], [0.05, 0.2]])
        shut += (w * Math.max(0, d - field(p.x + n.x * d, p.y + n.y * d, p.z + n.z * d))) / d;
      // One ginger, in shades of one saturation (ALISON_LOOK.hair's): deeper towards the hem and in
      // the creases. Its hue turns with the light each face gets, against what the town's light
      // does to it, so the hair reads ginger in sun and copper in shade, never salmon or brown: in
      // sun (what faces the sky) the key light, the grade and the tone curve pull an orange towards
      // salmon, so it is more golden there, and a touch deeper; in shade the sky's blue and the
      // ground's olive bounce pull it towards brown, so it warms towards copper on what faces down
      // and as it deepens in the creases.
      const up = T.MathUtils.smoothstep(n.y, 0.2, 0.9),
        down = T.MathUtils.smoothstep(-n.y, 0.1, 0.8),
        k = T.MathUtils.lerp(0.84, 1, T.MathUtils.smoothstep(p.y, 0.44, 0.84)) * (1 - 0.42 * Math.min(1, shut));
      return hsv(T.MathUtils.clamp(hue + HAIR_TURN[0] * up - HAIR_TURN[1] * down - HAIR_TURN[2] * (1 - k), HAIR_HUES[0], HAIR_HUES[1]), sat, value * k * (1 - 0.12 * up));
    };
  // Every triangle that shows: not wholly inside another part of the hair, the head or the torso.
  return {
    pieces: [
      kept(s.mesh(), (x, y, z) => insideBody(x, y, z) || field(x, y, z, -1, false) < -0.004, copper),
      ...locks.map((l, i) => kept(l.geometry, (x, y, z) => insideBody(x, y, z) || field(x, y, z, i) < -0.004, copper)),
    ],
    covers: (x: number, y: number, z: number) => field(x, y, z) < -0.004,
  };
}
/**
 * Her locks (line() has the fields): each spine runs from inside the crown down to where its curl
 * begins. Her left is +x.
 */
const LOCKS: Lock[] = [
  // The swoop: from her parting (on her right) over the top of her head to her left temple, then
  // down past her cheek and in over the collarbone onto her chest; on the parting's other side, a
  // lock falls down her right temple and cheek and in onto her right collarbone. Below the jaw
  // both turn their flat side forward.
  { p: [[-0.045, 0.88, 0.03], [0.01, 0.893, 0.035], [0.078, 0.872, 0.05], [0.135, 0.815, 0.07], [0.162, 0.735, 0.066], [0.145, 0.66, 0.084], [0.115, 0.6, 0.104], [0.098, 0.55, 0.116]], r: [0.04, 0.048, 0.056, 0.064, 0.066, 0.06, 0.054, 0.05], curl: [1, 0.3, 0.2], phase: 0.1, wave: 0.022, turns: 1.25, face: [0.25, 0, 1], bend: 0.036 },
  { p: [[-0.09, 0.86, 0.01], [-0.14, 0.815, 0.043], [-0.165, 0.748, 0.062], [-0.15, 0.675, 0.078], [-0.12, 0.615, 0.098], [-0.102, 0.57, 0.11]], r: [0.04, 0.052, 0.064, 0.062, 0.054, 0.05], curl: [-1, 0.3, 0.2], phase: 0.6, wave: 0.022, turns: 1.25, face: [-0.25, 0, 1], bend: 0.036 },
  // Over each ear, behind the face's lock and further out, falling onto the back of the shoulder.
  { p: [[0.112, 0.835, 0.005], [0.162, 0.785, 0.018], [0.182, 0.72, 0.008], [0.178, 0.648, -0.035], [0.165, 0.594, -0.08]], r: [0.045, 0.06, 0.066, 0.064, 0.06], curl: [0.2, 0.3, -1], phase: 0.35, wave: 0.02, flat: 0.72, bend: 0.036, radial: 9 },
  { p: [[-0.112, 0.835, 0.003], [-0.161, 0.785, 0.016], [-0.18, 0.722, 0.006], [-0.177, 0.652, -0.037], [-0.163, 0.602, -0.08]], r: [0.044, 0.058, 0.064, 0.062, 0.058], curl: [-0.2, 0.3, -1], phase: 0.85, wave: 0.02, flat: 0.72, bend: 0.036, radial: 9 },
  // Down each side, from above the ear on behind the shoulder.
  { p: [[0.105, 0.83, -0.04], [0.162, 0.785, -0.058], [0.18, 0.71, -0.08], [0.17, 0.63, -0.11], [0.148, 0.55, -0.145], [0.13, 0.49, -0.162]], r: [0.045, 0.06, 0.066, 0.064, 0.06, 0.056], curl: [-0.6, 0.3, -1], phase: 0.7, bend: 0.036, radial: 9 },
  { p: [[-0.105, 0.83, -0.04], [-0.162, 0.785, -0.058], [-0.18, 0.712, -0.08], [-0.17, 0.634, -0.11], [-0.148, 0.556, -0.145], [-0.131, 0.498, -0.162]], r: [0.044, 0.059, 0.065, 0.063, 0.059, 0.055], curl: [0.6, 0.3, -1], phase: 0.2, bend: 0.036, radial: 9 },
  // Down her back: four, out of step with one another, to a ragged hem at mid-back, curling to the
  // side. Seen from behind, at the gentle wave of the others they ran straight down like a mop's
  // strands; each winds a deeper S across the mass on its way down (`wave`, `turns`), so they read as
  // curls. (The face's locks and those over her ears and down her sides, which frame her face from
  // in front, keep theirs.)
  { p: [[0.065, 0.83, -0.085], [0.102, 0.79, -0.135], [0.108, 0.715, -0.156], [0.1, 0.635, -0.163], [0.09, 0.555, -0.174], [0.085, 0.495, -0.178]], r: [0.045, 0.058, 0.062, 0.06, 0.056, 0.052], curl: [1, 0.4, 0.3], phase: 0.45, wave: 0.042, turns: 1.25, radial: 9 },
  { p: [[0.022, 0.83, -0.09], [0.034, 0.79, -0.148], [0.036, 0.715, -0.168], [0.034, 0.635, -0.172], [0.03, 0.555, -0.178], [0.028, 0.48, -0.182]], r: [0.045, 0.058, 0.062, 0.06, 0.056, 0.052], curl: [-1, 0.4, 0.3], phase: 0.95, wave: 0.042, turns: 1.25, radial: 9 },
  { p: [[-0.022, 0.83, -0.09], [-0.034, 0.79, -0.148], [-0.036, 0.715, -0.168], [-0.034, 0.635, -0.172], [-0.03, 0.555, -0.178], [-0.028, 0.488, -0.182]], r: [0.045, 0.058, 0.062, 0.06, 0.056, 0.052], curl: [1, 0.4, 0.3], phase: 0.25, wave: 0.042, turns: 1.25, radial: 9 },
  { p: [[-0.065, 0.83, -0.085], [-0.102, 0.79, -0.135], [-0.108, 0.715, -0.156], [-0.1, 0.635, -0.163], [-0.09, 0.555, -0.174], [-0.085, 0.5, -0.178]], r: [0.045, 0.058, 0.062, 0.06, 0.056, 0.052], curl: [-1, 0.4, 0.3], phase: 0.7, wave: 0.042, turns: 1.25, radial: 9 },
];

/** The glasses' band: its middle's height, half-height, how far it stands proud of the face and sinks into it, and its half-length round the face. */
const GLASSES = { y: 0.776, half: 0.036, out: 0.006, sink: 0.064, reach: 0.135 };
/**
 * The frames drawn on the band, as |u| (arc length from the bridge) and v (height from the band's
 * middle) edges: each rim's outer and inner (lens) edges, the eye's cell, the bridge and the arm.
 */
const FRAME = { rim: [0.012, 0.102, -0.03, 0.03], lens: [0.026, 0.088, -0.02, 0.013], eye: [0.043, 0.064, -0.012, 0.005], bar: [0.008, 0.026] };
/**
 * Her glasses: one solid band across the eyes, hugging the face, 0.072 tall, 0.07 deep and 0.27
 * round it, its ends running under the hair like the arms. It stands only 0.006 proud of the face,
 * so from above it shows no top of its own, and on its front, in flat colours whose edges are the
 * triangles' own (so the ink pass's multisampling smooths them), are the dark rectangular frames (a
 * heavier top bar, as in the portrait), a slim bridge, the clear lenses (her skin a shade lighter
 * through them), her eyes, and her skin round them. Rims 0.07 thick round open lenses would be
 * wider than her face; thinner ones standing free would twinkle; drawn on the band they hold still.
 */
function glassesGeometry() {
  const { y: yc, half, out, sink, reach } = GLASSES,
    [a, , c] = HEAD.r,
    // The head's cross-section at height y (its half-widths shrink by q above and below the middle).
    qAt = (y: number) => Math.sqrt(1 - ((y - HEAD.y) / HEAD.r[1]) ** 2),
    R = ((a + c) / 2) * qAt(yc),
    { rim, lens: glass, eye: pupil, bar } = FRAME,
    // Columns along the band (arc length from its middle) at every edge of the pattern, rows the same.
    edges = [0, rim[0], glass[0], pupil[0], pupil[1], glass[1], rim[1], reach],
    cols = [...edges.slice(1).map((u) => -u).reverse(), ...edges],
    rows = [...new Set([-half, rim[2], glass[2], pupil[2], pupil[3], bar[0], glass[3], bar[1], rim[3], half])].sort((p, q) => p - q),
    frame = sRGB(ALISON_LOOK.frames),
    lens = sRGB(ALISON_LOOK.lens),
    eye = sRGB(ALISON_LOOK.eyes),
    skin = sRGB(ALISON_LOOK.skin),
    inside = (x: number, lo: number, hi: number) => x > lo && x < hi,
    colourAt = (u: number, v: number): V3 => {
      const m = Math.abs(u);
      if (inside(m, pupil[0], pupil[1]) && inside(v, pupil[2], pupil[3])) return eye;
      if (inside(m, glass[0], glass[1]) && inside(v, glass[2], glass[3])) return lens;
      if (inside(m, rim[0], rim[1]) && inside(v, rim[2], rim[3])) return frame;
      // The bridge between the rims and the arms beyond them, at the top bar's height.
      return inside(v, bar[0], bar[1]) ? frame : skin;
    },
    pos: number[] = [],
    nor: number[] = [],
    col: number[] = [];
  /**
   * The face's point at arc length u and height yc + v, pushed out by w (negative: into the face),
   * and the band's outward normal there: the band hugs the head's curve up and down as well as round.
   */
  const at = (u: number, w: number, v: number) => {
    const t = u / R,
      q = qAt(yc + v),
      x = a * q * Math.sin(t),
      z = c * q * Math.cos(t),
      nx = Math.sin(t) / (a * q),
      nz = Math.cos(t) / (c * q),
      l = Math.hypot(nx, nz);
    return { p: [x + (nx / l) * w, yc + v, 0.005 + z + (nz / l) * w], n: [nx / l, 0, nz / l] };
  };
  const quad = (A: { p: number[] }, B: { p: number[] }, C: { p: number[] }, D: { p: number[] }, n: (k: number) => number[], colour: V3) => {
    // A B C D anticlockwise seen from outside; n(k) gives each corner's normal.
    for (const [k, Q] of [[0, A], [1, B], [2, C], [0, A], [2, C], [3, D]] as const) {
      pos.push(...Q.p);
      nor.push(...n(k));
      col.push(...colour);
    }
  };
  for (let i = 0; i < cols.length - 1; i++) {
    const u0 = cols[i],
      u1 = cols[i + 1],
      um = (u0 + u1) / 2;
    // The front, one flat colour a cell; cells of one colour up a column are one quad.
    for (let j = 0, k = 1; j < rows.length - 1; j = k++) {
      const colour = colourAt(um, (rows[j] + rows[j + 1]) / 2);
      while (k < rows.length - 1 && colourAt(um, (rows[k] + rows[k + 1]) / 2) === colour) k++;
      const A = at(u0, out, rows[j]),
        B = at(u1, out, rows[j]),
        C = at(u1, out, rows[k]),
        D = at(u0, out, rows[k]);
      quad(A, B, C, D, (q) => (q === 0 || q === 3 ? A.n : B.n), colour);
    }
    // The top and the underside, running back into the face (whose skin hides the band's back).
    const ft = [at(u0, out, half), at(u1, out, half)],
      bt = [at(u0, -sink, half), at(u1, -sink, half)],
      fb = [at(u0, out, -half), at(u1, out, -half)],
      bb = [at(u0, -sink, -half), at(u1, -sink, -half)];
    quad(ft[0], ft[1], bt[1], bt[0], () => [0, 1, 0], colourAt(um, half));
    quad(fb[1], fb[0], bb[0], bb[1], () => [0, -1, 0], colourAt(um, -half));
  }
  // The two ends, where the arms run back into the hair.
  for (const [u, s] of [[cols[0], -1], [cols[cols.length - 1], 1]] as const) {
    const A = at(u, -sink, -half),
      B = at(u, out, -half),
      C = at(u, out, half),
      D = at(u, -sink, half),
      t = [A.n[2] * s, 0, -A.n[0] * s];
    if (s > 0) quad(A, B, C, D, () => t, frame);
    else quad(B, A, D, C, () => t, frame);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  const lin = new Float32Array(col.length);
  for (let i = 0; i < col.length; i += 3) srgb.setRGB(col[i], col[i + 1], col[i + 2], T.SRGBColorSpace).toArray(lin, i);
  g.setAttribute('color', new T.BufferAttribute(lin, 3));
  return g;
}

export type AlisonJoints = {
  root: T.Group;
  body: T.Object3D;
  /** leg-left (-x) and leg-right (+x), and their knees. */
  legs: [T.Object3D, T.Object3D];
  knees: [T.Object3D, T.Object3D];
  /** arm-left (-x: her right hand; the residents name their sides by the viewer's left) and arm-right (+x), and their elbows. */
  arms: [T.Object3D, T.Object3D];
  elbows: [T.Object3D, T.Object3D];
};
export type AlisonProps = { can: T.Group; cup: T.Group; saucer: T.Group; water: T.Group };

/** The watering can's drum: its axis this far ahead of the handle's grip (the can's origin, +z towards the spout). */
const DRUM = 0.141;
/** A 0.07 tube's radius: six-sided, so 0.041 to its corners leaves it 0.071 across its flats. */
const TUBE = 0.041;
/** The middle of the can's rose (the spout's flared end), in the can's frame. */
const ROSE: V3 = [0, 0.004, DRUM + 0.195];
/** The spout's last stretch, into the rose, in the can's frame: from here to ROSE is the way the water leaves. */
const SPOUT: V3 = [0, -0.012, DRUM + 0.165];
/**
 * The water she pours: `count` pale beads of radius `r` (twenty-faced, so 0.0715 across their box
 * the narrowest way, never under the 0.07 a part needs), `gap` apart down a straight stream from
 * inside the rose (`inset` back along the spout from its middle, where the first bead sits in the
 * rose's flare, wholly inside it) to the bed, falling `lead` forward for each unit it drops, as
 * water leaving a spout does. It comes and goes along that line, never in a frame (poseAlison's
 * `front` and `tail`): starting, the beads come out of the rose one behind another, the front of the
 * stream carrying those still to come, until each is at its place; stopping, its top leaves the rose
 * and falls on down the line, gathering the beads below it, `sink` past the last bead's place, which
 * is down in the bed (the kerb and the mound under the rose), out of sight.
 */
export const ALISON_STREAM = { count: 4, r: 0.042, gap: 0.075, inset: 0.03, lead: 0.3, sink: 0.4 };
/** The can's foot (the middle of its drum's base, where it stands) in the can's own frame: its handle's grip is the can's origin. */
export const CAN_FOOT: V3 = [0, -0.09, DRUM];
/**
 * Her hand props, each a group of its own in her root (so batching part by part makes each one
 * mesh, and a pose shows only its own), placed by poseAlison. Every joined piece is at least 0.07
 * thick: the can's handle and its spout are 0.07 tubes (the spout flares into its rose), the cup's
 * handle is a 0.07 lug, the saucer stands 0.07 from its foot to its rim. Their origins are where
 * they are held: the can's handle at its back, the cup's handle, the saucer's foot.
 */
function createProps(material: Material): AlisonProps {
  const L = ALISON_LOOK;
  const can = new T.Group(),
    cup = new T.Group(),
    saucer = new T.Group(),
    water = new T.Group();
  can.name = 'watering-can';
  cup.name = 'teacup';
  saucer.name = 'saucer';
  water.name = 'water-stream';
  // The can, level: a zinc drum, a loop handle on its back (held at its rearmost point, the
  // origin) and a spout from its foot, forward and a little up, flaring into the rose.
  part(can, [
    paint(lathe([[0, -0.09], [0.064, -0.09], [0.07, -0.076], [0.07, 0.04], [0.061, 0.055], [0, 0.055]], 10).translate(0, 0, DRUM), L.zinc, [-0.09, 0.055, 0.9, 1.04]),
    paint(outward(taper([[0, 0.032, DRUM - 0.062], [0, 0.044, 0.04], [0, 0.028, 0.004], [0, -0.024, 0.002], [0, -0.062, 0.034], [0, -0.066, DRUM - 0.062]], [TUBE, TUBE, TUBE, TUBE, TUBE, TUBE], 6, 6)), shade(L.zinc, 0.9)),
    paint(outward(taper([[0, -0.054, DRUM + 0.04], [0, -0.034, DRUM + 0.105], [0, -0.012, DRUM + 0.165], ROSE], [TUBE, TUBE, TUBE, 0.062], 5, 6)), shade(L.zinc, 0.96)),
  ], material, 'paint', 'watering-can');
  // The teacup, its handle (a lug) at the origin on its -x side; milky tea inside, a blue band at the rim.
  const ring = (p: T.Vector3) => Math.hypot(p.x - CUP_AXIS, p.z);
  part(cup, [
    paint(lathe([[0, -0.037], [0.034, -0.037], [0.049, 0.014], [0.052, 0.037], [0.046, 0.039], [0.041, 0.024], [0, 0.024]], 9).translate(CUP_AXIS, 0, 0), (p) =>
      p.y < 0.0245 && p.y > 0.02 && ring(p) < 0.0415 ? L.tea : p.y > 0.024 && ring(p) > 0.0485 ? L.chinaBand : L.china,
    ),
    paint(blob([0.037, 0.037, 0.037], [0, 0, 0], 8), L.china),
  ], material, 'paint', 'teacup');
  // The saucer, its foot at the origin: a dish 0.15 across with a well for the cup.
  part(saucer, [
    paint(lathe([[0, 0], [0.04, 0], [0.06, 0.03], [0.075, 0.064], [0.071, 0.07], [0.056, 0.044], [0.044, 0.036], [0, 0.036]], 9), (p) =>
      p.y > 0.055 && Math.hypot(p.x, p.z) > 0.066 ? L.chinaBand : L.china,
    ),
  ], material, 'paint', 'saucer');
  // The water, its origin the first bead's middle, falling along its -y: each bead a round icosahedron
  // (its normals the sphere's own, so it shades smooth at twenty faces), opaque.
  const S = ALISON_STREAM,
    bead = (k: number) => {
      const g = new T.IcosahedronGeometry(1, 0),
        p = g.getAttribute('position'),
        n = g.getAttribute('normal');
      for (let i = 0; i < p.count; i++) n.setXYZ(i, p.getX(i), p.getY(i), p.getZ(i));
      return g.scale(S.r, S.r, S.r).translate(0, -k * S.gap, 0);
    };
  const stream = part(water, [paint(mergeBeads(Array.from({ length: S.count }, (_, k) => bead(k))), L.water)], material, 'paint', 'water-stream');
  // The beads where the stream is whole, for poseAlison to move them from (the batched mesh that
  // takes this one's place keeps its corners in the same order).
  water.userData.rest = Float32Array.from(stream.geometry.getAttribute('position').array);
  for (const g of [can, cup, saucer, water]) g.visible = false;
  return { can, cup, saucer, water };
}
/**
 * A tube of city-people's taper with its faces turned the way its normals point: taper winds them
 * inward, so drawn one-sided a tube shows its far wall's inside, and anything in it (the water in the
 * can's rose) shows through its near one.
 */
function outward(geometry: T.BufferGeometry) {
  const index = geometry.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  return geometry;
}
/** Beads as one geometry (positions and normals: paint() adds the colours). */
function mergeBeads(beads: T.BufferGeometry[]) {
  const pos: number[] = [],
    nor: number[] = [];
  for (const g of beads) {
    const p = g.getAttribute('position'),
      n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  return out;
}

/**
 * Alison Heppenstall's figure: a resident's 0.9-tall body (city-people's measures: the head a
 * third of her height, hips at 0.31, shoulders at 0.6, the same thighs, shins and shoes) in her own
 * look, standing with her soles on y 0 and facing +z. Her joints are the residents' ('body',
 * 'leg-left' and 'leg-right' with a 'knee' each, 'arm-left' and 'arm-right'), so animateResident
 * walks her, plus an 'elbow' in each arm for the poses that hold things. Every part is one mesh per
 * surface kind, its colours on its vertices: batched part by part (as town-build batches its
 * figures) she is 10 meshes, and each prop one more. She takes the material function as the
 * residents do. `props` hang in her root, hidden until a pose shows them.
 */
export function createAlison(material: Material) {
  const L = ALISON_LOOK,
    root = new T.Group(),
    body = new T.Group();
  root.name = 'alison';
  body.name = 'body';
  root.add(body);
  // The top: a resident's torso in soft black, a shade deeper towards its hem.
  part(body, [paint(lathe(TORSO, 14).scale(1, 1, DEPTH), L.top, [0.27, 0.6, 0.9, 1.06])], material, 'fabric');
  const locks = hair();
  part(body, locks.pieces, material, 'fabric', 'alison-hair');
  // Skin and the small hard things on it: the head, the neck (a shade deeper, so the chin parts
  // from it), a resident's small nose under the glasses' bridge, the glasses, and the pendant, which
  // hangs on the black just under the collar, where a short cord would bring it.
  const chest = torsoAt(PENDANT_Y) * DEPTH;
  part(body, [
    paint(shown(blob(HEAD.r, [0, HEAD.y, 0.005], 16), locks.covers), L.skin),
    paint(lathe([[0, 0.585], [0.05, 0.585], [0.05, 0.66], [0, 0.66]], 8), shade(L.skin, 0.96)),
    paint(blob([0.021, 0.019, 0.019], [0, 0.727, 0.005 + HEAD.r[2] * Math.sqrt(1 - ((0.727 - HEAD.y) / HEAD.r[1]) ** 2) - 0.006], 6), shade(L.skin, 0.97)),
    glassesGeometry(),
    paint(lathe([[0, -0.048], [0.018, -0.032], [0.034, -0.006], [0.038, 0.012], [0.028, 0.032], [0, 0.04]], 8).rotateX(-0.2).translate(0, PENDANT_Y, chest - 0.012), L.pendant),
  ], material, 'paint');
  const legs: T.Object3D[] = [],
    knees: T.Object3D[] = [],
    arms: T.Object3D[] = [],
    elbows: T.Object3D[] = [];
  for (const side of [-1, 1]) {
    // The legs are a resident's, in dark trousers over plain shoes.
    const hip = new T.Group();
    hip.name = side < 0 ? 'leg-left' : 'leg-right';
    hip.position.set(side * 0.065, HIP, 0);
    root.add(hip);
    part(hip, [paint(lathe([[0, 0.03], [0.05, 0.025], [THIGH_R, 0.0], [0.06, -0.07], [0.055, -0.14], [0.03, -0.165], [0, -0.17]], 10), L.trousers, [-0.17, 0.02, 0.92, 1.02])], material, 'fabric');
    const knee = new T.Group();
    knee.name = 'knee';
    knee.position.y = -0.14;
    hip.add(knee);
    const shoe = blob([0.058, 0.044, 0.09], [0, 0, 0], 10),
      sp = shoe.getAttribute('position');
    for (let i = 0; i < sp.count; i++) if (sp.getY(i) < 0) sp.setY(i, sp.getY(i) * 0.8); // a flatter sole
    shoe.computeVertexNormals();
    shoe.translate(0, -0.135, 0.025);
    part(knee, [
      paint(lathe([[0, 0.02], [0.055, 0.01], [0.052, -0.07], [0.053, -0.094], [0.04, -0.106], [0, -0.108]], 10), L.trousers, [-0.1, 0.02, 0.84, 0.94]),
      paint(shoe, (p) => (p.y < -0.157 ? shade(L.shoes, 1.35) : L.shoes)),
    ], material, 'fabric', 'shoe');
    // The arms: a resident's sleeve and mitten hand, split at an elbow (0.095 down) so a hand can
    // reach a cup or a can; each half is capped round at the elbow, so the joint stays whole bent.
    const arm = new T.Group();
    arm.name = side < 0 ? 'arm-left' : 'arm-right';
    arm.position.set(side * SHOULDER.x, SHOULDER.y, 0);
    arm.rotation.z = side * 0.12;
    root.add(arm);
    part(arm, [paint(lathe([[0, 0.045], [0.04, 0.035], [0.055, 0.0], [0.051, -0.05], [0.048, -UPPER], [0.034, -0.129], [0, -0.143]], 10), L.top, [-0.14, 0.03, 0.9, 1.04])], material, 'fabric');
    const elbow = new T.Group();
    elbow.name = 'elbow';
    elbow.position.y = -UPPER;
    arm.add(elbow);
    part(elbow, [
      paint(lathe([[0, 0.048], [0.034, 0.034], [0.047, 0.0], [0.045, -0.04], [0.043, -0.072], [0.03, -0.083], [0, -0.088]], 10), L.top, [-0.08, 0.04, 0.88, 1.0]),
      paint(blob([0.043, 0.05, 0.046], [0, -FORE, 0], 8), L.skin),
    ], material, 'fabric');
    legs.push(hip);
    knees.push(knee);
    arms.push(arm);
    elbows.push(elbow);
  }
  const props = createProps(material);
  root.add(props.can, props.cup, props.saucer, props.water);
  root.userData.gait = { phase: 0, amount: 0 };
  root.userData.sole = 0;
  const joints: AlisonJoints = {
    root,
    body,
    legs: legs as [T.Object3D, T.Object3D],
    knees: knees as [T.Object3D, T.Object3D],
    arms: arms as [T.Object3D, T.Object3D],
    elbows: elbows as [T.Object3D, T.Object3D],
  };
  poseAlison(joints, props, 'stand', 0);
  return { root, joints, props };
}

/* ------------------------------------------------------------------ */
/* Poses                                                               */
/* ------------------------------------------------------------------ */
export const ALISON_POSES = ['stand', 'walk', 'water', 'sit', 'sip', 'telescope', 'rise', 'set', 'take'] as const;
export type AlisonPose = (typeof ALISON_POSES)[number];

const tmp = new T.Vector3(),
  basis = new T.Matrix4();
/** A body-frame point after the body leans forward by `a` about the hip line (as seatRider leans the rider). */
function leaned([x, y, z]: V3, a: number): V3 {
  const dy = y - HIP;
  return [x, HIP + dy * Math.cos(a) - z * Math.sin(a), dy * Math.sin(a) + z * Math.cos(a)];
}
/**
 * Lean the body forward by `a` about the hip line (y 0.31), carrying the shoulders with it; `reach`
 * draws each shoulder in, up and forward (the shoulder blade sliding round as an arm reaches out);
 * `back` moves her hips, and all of her over them, back over her feet (as her knees bend).
 */
function lean(j: AlisonJoints, a: number, reach: V3 = [0, 0, 0], back = 0) {
  j.body.rotation.set(a, 0, 0);
  j.body.position.set(0, HIP - HIP * Math.cos(a), -HIP * Math.sin(a) - back);
  j.arms.forEach((arm, k) => {
    arm.position.set(...leaned([(k ? 1 : -1) * (SHOULDER.x - reach[0]), SHOULDER.y + reach[1], reach[2]], a));
    arm.position.z -= back;
  });
  j.legs.forEach((leg) => (leg.position.z = -back));
}
/** A hand's centre (the mitten's) in her root's frame, from its arm and elbow as posed. */
export function alisonHand(j: AlisonJoints, k: 0 | 1, out = new T.Vector3()) {
  const arm = j.arms[k],
    elbow = j.elbows[k];
  return out.set(0, -FORE, 0).applyQuaternion(elbow.quaternion).add(elbow.position).applyQuaternion(arm.quaternion).add(arm.position);
}
/**
 * Put hand k's centre on `target` (her root's frame) by a two-bone solve from the shoulder, the
 * elbow pointing along `bend` as far as it can (out and down, so the arm folds as an arm does), the
 * forearm folding forward about the elbow. A target out of reach leaves the arm straight towards
 * it, and the checks catch that.
 */
function reach(j: AlisonJoints, k: 0 | 1, target: V3, bend: V3) {
  const S = j.arms[k].position,
    d = new T.Vector3(target[0] - S.x, target[1] - S.y, target[2] - S.z),
    dist = T.MathUtils.clamp(d.length(), FORE - UPPER + 1e-4, UPPER + FORE - 1e-4),
    a = d.normalize(),
    cosA = (UPPER * UPPER + dist * dist - FORE * FORE) / (2 * UPPER * dist),
    e = new T.Vector3(...bend);
  e.addScaledVector(a, -e.dot(a)).normalize();
  // The upper arm's direction, then the forearm's.
  const u = a.clone().multiplyScalar(cosA).addScaledVector(e, Math.sqrt(Math.max(0, 1 - cosA * cosA))),
    f = a.clone().multiplyScalar(dist).addScaledVector(u, -UPPER).normalize(),
    cosE = T.MathUtils.clamp(f.dot(u), -1, 1);
  // The arm's frame: -y down the upper arm, z the way the forearm folds, x across.
  const ly = u.clone().negate(),
    lz = f.clone().addScaledVector(u, -cosE);
  if (lz.lengthSq() < 1e-10) lz.set(0, 0, 1).addScaledVector(u, -u.z);
  lz.normalize();
  j.arms[k].quaternion.setFromRotationMatrix(basis.makeBasis(new T.Vector3().crossVectors(ly, lz), ly, lz));
  j.elbows[k].rotation.set(-Math.acos(cosE), 0, 0);
}
/** The lowest point of a leg's shoe above the floor its hip stands over, for a hip swing a and a knee bend b (animateResident's sole). */
function sole(a: number, b: number) {
  const c = a + b;
  return HIP - 0.14 * Math.cos(a) - 0.135 * Math.cos(c) - 0.025 * Math.sin(c) - Math.hypot(0.035 * Math.cos(c), 0.09 * Math.sin(c));
}
/** From the hip to the middle of the shoe, down a straight leg (thigh 0.14, shin 0.135); and the shoe's half sizes under its middle (its sole is flattened). */
const LEG = 0.275,
  SHOE: V3 = [0.058, 0.0352, 0.09];
const kneeFrame = new T.Matrix4(),
  shoeAt = new T.Vector3();
/**
 * The lowest point of a leg's shoe over the floor under her root, however the leg is turned (its
 * hip, `leg`, and its `knee`, as posed): the bottom of the shoe's ellipsoid, carried by both joints.
 */
function soleOf(leg: T.Object3D, knee: T.Object3D) {
  leg.updateMatrix();
  knee.updateMatrix();
  const m = kneeFrame.multiplyMatrices(leg.matrix, knee.matrix),
    e = m.elements;
  shoeAt.set(0, -0.135, 0.025).applyMatrix4(m);
  // The ellipsoid's lowest point: its middle less its reach straight down (the y row of its turn).
  return shoeAt.y - Math.hypot(SHOE[0] * e[1], SHOE[1] * e[5], SHOE[2] * e[9]);
}
const smooth = T.MathUtils.smoothstep,
  TAU = Math.PI * 2;

/**
 * The 'water' pose: her lean, how far her shoulders reach in, up and forward, the can's grip in her -x
 * hand, and its tilt (spout down) and turn (towards her middle). The can is held up at her waist, its
 * rose 0.55 over her feet (at 0.44 it hung just over the bed's mound, with no room under it for the
 * water to show).
 */
const WATER = { lean: 0.1, reach: [0.01, 0.02, 0.045] as V3, grip: [-0.13, 0.71, 0.255] as V3, tilt: 0.52, yaw: 0.25 };
/**
 * The 'sip' pose: her lean and reach, the saucer's foot where her +x hand holds it, in front of her,
 * and her lips (the cup's axis there, before the lean). At the sky island's tea table the saucer is
 * held over the table's near edge, its foot a little over the top (at 0.468 it and the hand under its
 * rim dipped 4 mm into it).
 */
const SIP = { lean: 0.05, reach: [0.012, 0, 0.035] as V3, saucer: [0.03, 0.482, 0.214] as V3, lips: [0, 0.655, 0.178] as V3 };
/** The 'telescope' pose's stoop (from the hips) and how far her shoulders reach in, up and forward. */
const SCOPE = { lean: 0.26, reach: [0.015, 0.02, 0.05] as V3 };
/**
 * Where her cup and saucer stand on a table in front of her seat, in her seated frame: the saucer's
 * foot `x` across and `z` ahead of her root, `up` over the seat (the tea table's top over its chairs'
 * seats: 0.665 and 0.44). 'set' takes them from her hands to there and back; set down, they stay
 * there however she moves (poseAlison's `rest`, which carries the place into her frame).
 */
export const ALISON_TABLE = { x: 0.03, z: 0.3, up: 0.225 };
/**
 * The 'set' pose's reach: she leans `lean` to set the saucer down (it lies past where she holds it
 * to drink), and her hand holds its near rim from `over` higher than she drinks from it, so the
 * hand under it never dips into the table's top.
 */
const SET = { lean: 0.2, over: 0.035 };
/** The 'rise' pose: how far she leans forward at its middle, as anyone does to stand up. */
const RISE = { lean: 0.16 };
/**
 * Carrying the watering can (poseAlison's `carry`): her -x arm hangs at her side `out` from plumb
 * (a little further out than at ease, so the can's drum clears her leg), its elbow `elbow` bent,
 * her hand on the can's handle; the can level, its spout ahead, turned `yaw` (out a little).
 */
export const ALISON_CARRY = { out: 0.2, elbow: 0.16, yaw: -0.06 };
/**
 * The 'take' pose, bending to the can where it stands (a border's kerb, 0.32 over her feet) and up
 * again with it: at the bottom she stoops `lean` from the hips, her shoulders reaching `reach`, her
 * thighs forward and her knees bent by `knee` (her shins upright, so her hips go back over her
 * feet and her soles stay flat); she goes down over the phase's first `down` and up over its last,
 * her hand on the can's handle between, and on the way never more than `arm` from her shoulder (so
 * her arm is never quite straight: a two-bone solve turns fast as it straightens).
 */
const TAKE = { lean: 0.7, reach: [0.012, 0, 0.04] as V3, knee: 0.5, down: 0.42, arm: 0.2 };
/** Hand k's place in her lap seated, and the way its elbow bends there ('sit'). */
const LAP = (k: 0 | 1): [V3, V3] => [
  [(k ? 1 : -1) * 0.1, 0.42, 0.075],
  [(k ? 1 : -1) * 0.8, -0.2, -0.6],
];
/** A mix of a and b, exact at both ends. */
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t,
  mixV = (a: V3, b: V3, t: number): V3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
/**
 * Her cup resting in its saucer's well, as between sips (the cup's handle back and to her -x, as she
 * holds it): the saucer's foot at `at`, both turned `ry` about the upright.
 */
function cupOnSaucer(props: AlisonProps, at: V3, ry: number) {
  const { cup, saucer } = props;
  saucer.visible = cup.visible = true;
  saucer.position.set(...at);
  saucer.rotation.set(0, ry, 0);
  cup.rotation.set(0, ry - 0.5, 0, 'YXZ');
  const lug = tmp.set(-CUP_AXIS, 0, 0).applyQuaternion(cup.quaternion);
  cup.position.set(at[0] + lug.x, at[1] + 0.036 + 0.037 + lug.y, at[2] + lug.z);
}
/**
 * Where a hand holds each prop, in the prop's own frame: the can's handle and the cup's lug in her
 * -x hand (hand 0), the saucer's near rim in her +x hand (hand 1).
 */
export const ALISON_HOLDS = {
  can: [0, 0, 0] as V3,
  cup: [0, 0, 0] as V3,
  saucer: [0.066, 0.03, -0.038] as V3,
};
/**
 * The telescope in her frame, which is the station's: her root on the deck, facing +z, the town
 * ahead and below. She stands stooped from the hips, so she looks `gaze` (15 degrees below level)
 * straight down a refractor on a tripod: its eyepiece's eye end at `eyepiece` (0.06 beyond her
 * eye, clear of her glasses); its tube runs on from there along `gaze`, radius `radius`; her hands
 * cradle the eyepiece end from below on either side (`grips`, their centres 0.083 off the axis),
 * elbows out. She is 0.93 tall and her eye is 0.77 up standing, so an eyepiece 1.1 to 1.3 up would
 * be over her head: the eyepiece is at her stooped eye (ALISON.eyepiece up, ALISON.standOff ahead).
 */
export const ALISON_TELESCOPE = (() => {
  const eye = leaned(EYE, SCOPE.lean),
    gaze: V3 = [0, -Math.sin(SCOPE.lean), Math.cos(SCOPE.lean)],
    eyepiece: V3 = [0, eye[1] + gaze[1] * 0.06, eye[2] + gaze[2] * 0.06],
    grips = [-1, 1].map((s) => leaned([s * 0.06, 0.715, 0.21], SCOPE.lean)) as [V3, V3];
  return { eye, gaze, eyepiece, radius: 0.04, grips };
})();

/** poseAlison's options (see there). */
export type AlisonPoseOptions = {
  seat?: number;
  amount?: number;
  step?: number;
  side?: [number, number];
  rest?: [number, number, number, number];
  can?: [number, number, number, number];
  carry?: boolean;
  lift?: number;
  pour?: number;
  front?: number;
  tail?: number;
  stoop?: number;
};
/** An arm as a pose leaves it: its turn at the shoulder and its elbow's bend. */
type ArmState = { q: T.Quaternion; bend: number };
const armState = (j: AlisonJoints, k: 0 | 1): ArmState => ({ q: j.arms[k].quaternion.clone(), bend: j.elbows[k].rotation.x });
/** Arm k part of the way `t` from one state to another (exactly each at 0 and 1). */
function easeArm(j: AlisonJoints, k: 0 | 1, a: ArmState, b: ArmState, t: number) {
  j.arms[k].quaternion.slerpQuaternions(a.q, b.q, t);
  j.elbows[k].rotation.set(mix(a.bend, b.bend, t), 0, 0);
}
/** Each arm at ease, as poseAlison leaves it; her -x arm carrying the can (ALISON_CARRY). */
const AT_EASE = [-1, 1].map((s) => ({ q: new T.Quaternion().setFromEuler(new T.Euler(0, 0, s * 0.12)), bend: -0.12 })) as [ArmState, ArmState],
  CARRYING: ArmState = { q: new T.Quaternion().setFromEuler(new T.Euler(0, 0, -ALISON_CARRY.out)), bend: -ALISON_CARRY.elbow },
  /** The can's turn as she carries it, and level at a turn of `ry` about the upright. */
  CAN_CARRIED = new T.Quaternion().setFromEuler(new T.Euler(0, ALISON_CARRY.yaw, 0)),
  level = (ry: number) => new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), ry);
/** The can in her -x hand, its handle's grip on the hand's centre, turned `q`. */
function canInHand(j: AlisonJoints, props: AlisonProps, q: T.Quaternion) {
  props.can.visible = true;
  alisonHand(j, 0, props.can.position);
  props.can.quaternion.copy(q);
}
/** The can's grip, in her root's frame (her root `lift` over her floor), as it stands at `at` (its foot in her frame, y over her floor, and its turn). */
function gripOf(at: [number, number, number, number], lift: number): V3 {
  const foot = tmp.set(...CAN_FOOT).applyAxisAngle(new T.Vector3(0, 1, 0), at[3]);
  return [at[0] - foot.x, at[1] - lift - foot.y, at[2] - foot.z];
}
/**
 * The water from the can's rose: its line from inside the rose down the way the spout points,
 * falling as it goes, and its beads along it (ALISON_STREAM): each at its own place, but none past
 * the stream's `front` (0 to 1: from inside the rose to the last bead's place, gathering pace as the
 * square of it) nor above its `tail` (0 to 1: from the rose to `sink` past the last bead's place).
 * Shown only while some of it is out of the rose and not yet down in the bed. The beads move on the
 * batched mesh itself, which keeps the corners in the order createProps made them.
 */
function pourWater(props: AlisonProps, front: number, tail: number) {
  const W = ALISON_STREAM,
    { can, water } = props;
  water.visible = front > 1e-6 && tail < 1 - 1e-6;
  if (!water.visible) return;
  const along = new T.Vector3(...ROSE).sub(new T.Vector3(...SPOUT)).normalize(),
    out = along.clone().applyQuaternion(can.quaternion),
    fall = new T.Vector3(out.x, 0, out.z).normalize().multiplyScalar(W.lead).setY(-1).normalize();
  water.position.set(...ROSE).addScaledVector(along, -W.inset).applyQuaternion(can.quaternion).add(can.position);
  water.quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), fall);
  const mesh = water.children.find((c): c is T.Mesh => c instanceof T.Mesh),
    rest = water.userData.rest as Float32Array | undefined,
    last = (W.count - 1) * W.gap,
    // (The front gathers pace as it comes, as water leaving a spout does: its first frames stay in the rose.)
    f = front * front * last,
    g = tail * (last + W.sink);
  if (!mesh || !rest) return;
  const at = mesh.geometry.getAttribute('position') as T.BufferAttribute,
    was = mesh.userData.stream as [number, number] | undefined;
  if (at.count * 3 !== rest.length || (was && was[0] === f && was[1] === g)) return;
  const per = at.count / W.count;
  for (let k = 0; k < W.count; k++) {
    // Its middle `place` down the line (the group's -y), so it moves up by its own place less that.
    const own = k * W.gap,
      place = Math.max(Math.min(own, f), g);
    for (let i = k * per; i < (k + 1) * per; i++) at.setY(i, rest[i * 3 + 1] + own - place);
  }
  at.needsUpdate = true;
  mesh.geometry.computeBoundingSphere();
  mesh.userData.stream = [f, g];
}
/** Where the can stands for 'take' when no `can` is given: on a border's kerb in front of her, as at the west border. */
export const ALISON_KERB: [number, number, number, number] = [0.01, 0.228, 0.315, 0.85];

/**
 * Pose her for `name` at `phase` (0..1, looping), from nothing else: every joint and prop that any
 * pose moves is set on each call, so poses never leak into one another, and the same arguments
 * always give the same pose. Returns `lift`: her root's height over the floor under her (standing
 * and walking, her lowest sole touches it; seated, her thighs rest on a seat `seat` high,
 * ALISON.seat by default). Place her root at the floor plus lift.
 * - 'stand': at ease; `carry`, the watering can in her -x hand at her side (ALISON_CARRY).
 * - 'walk': one stride a phase (two steps), the residents' gait: ALISON.stride units a phase.
 *   `amount` (1 by default) scales the gait, so 0 is 'stand' and a walk can ease in and out;
 *   `carry`, the can at her side, that arm still.
 * - 'water': standing, the can held out in her -x hand by its handle and tipped, so its rose hangs
 *   over a border in front of her (ALISON.rose), swaying gently along it; her other hand on her hip.
 *   `lift` (1 by default) takes her from carrying the can (0: 'stand' with `carry`) to holding it out
 *   so, her lean and both arms easing; `pour` (1 by default) tips it from level (0) to pouring and
 *   sways it; `front` and `tail` (1 and 0 by default: the whole stream) say how much of the water is
 *   out of the rose and how much has gone down into the bed (ALISON_STREAM: shown only between).
 *   `step` (0 to 1) takes her through a sidestep along the border that moves her root `side` ([x,
 *   z] in her frame), her root moved there by side x smoothstep(step) by whoever places her (step
 *   0, the default: feet together).
 * - 'take': bending to the can where it stands (`can`) and up again with it, phase 0 'stand' to 1
 *   'stand' with `carry`: she stoops from the hips, her knees bending and her hips going back over
 *   her feet, her -x hand coming to the can's handle at the bottom (over 0.42 to 0.58 it is there),
 *   then she straightens with the can and it comes level to her side. Back from 1 to 0, she sets it
 *   down where `can` says.
 * - 'sit': on a seat, hands on her thighs.
 * - 'sip': seated, the saucer held in front of her in her +x hand, the cup lifted from it to her
 *   lips and down again in her -x hand (on the saucer from 0.88 round to 0.12, at her lips from
 *   0.4 to 0.6).
 * - 'telescope': standing, stooped a little to the eyepiece (ALISON_TELESCOPE), both hands on the
 *   tube; `stoop` (1 by default) eases her into it from standing at ease (0), her lean, her stance
 *   and her arms together; with `carry`, her -x hand keeps the can at her side and her +x hand alone
 *   is on the tube.
 * - 'rise': getting up from a seat, phase 0 'sit' (her hands in her lap) to 1 'stand' (at ease),
 *   while whoever places her slides her root out sideways by the smoothstep of the phase: her hips
 *   come up and her legs straighten under her (her soles never below her floor, touching it at 1),
 *   she leans a little forward into it and her arms come down to her sides. Back from 1 to 0, she
 *   sits down.
 * - 'set': seated, setting her cup and saucer down on the table in front of her, phase 0 'sip' as
 *   she rests between sips to 1 'sit': her -x hand lets go of the cup, her +x hand sets the saucer
 *   down where `rest` says (ALISON_TABLE's place if none is given), leaning to it, and follows to her
 *   lap. Back from 1 to 0, she takes them up again.
 * `rest` ([x, y, z, turn]: the saucer's foot in her frame, y over her floor, and its turn about the
 * upright) is where her cup and saucer stand once she has set them down: every pose but 'sip' (and
 * 'set', which moves them) shows them there, so they stay on the table while she goes about her day.
 * `can` (the same, for the can's foot) is where the can stands when she is not holding it: every pose
 * that does not hold it shows it there.
 */
export function poseAlison(j: AlisonJoints, props: AlisonProps, name: AlisonPose, phase: number, opts: AlisonPoseOptions = {}) {
  const u = ((phase % 1) + 1) % 1,
    // 'rise', 'set' and 'take' run from one pose to another: their phase does not loop.
    p = T.MathUtils.clamp(phase, 0, 1),
    unit = (v: number | undefined, d: number) => T.MathUtils.clamp(v ?? d, 0, 1);
  // At ease: upright, legs straight, arms down and a little out, elbows soft, no props.
  lean(j, 0);
  j.legs.forEach((leg) => leg.rotation.set(0, 0, 0));
  j.knees.forEach((knee) => knee.rotation.set(0, 0, 0));
  j.arms.forEach((arm, k) => arm.rotation.set(0, 0, (k ? 1 : -1) * 0.12));
  j.elbows.forEach((elbow) => elbow.rotation.set(-0.12, 0, 0));
  for (const p of Object.values(props)) {
    p.visible = false;
    p.position.set(0, 0, 0);
    p.rotation.set(0, 0, 0, 'XYZ');
  }
  let lift = 0;
  const carry = () => {
    easeArm(j, 0, CARRYING, CARRYING, 0);
    canInHand(j, props, CAN_CARRIED);
  };
  if (name === 'sit' || name === 'sip' || name === 'set') {
    // Thighs level and a little apart, shins hanging just forward of plumb, sitting up.
    lift = Math.max(0.11, opts.seat ?? SEAT) + THIGH_R - HIP;
    j.legs.forEach((leg, k) => leg.rotation.set(-Math.PI / 2, 0, (k ? 1 : -1) * 0.07));
    j.knees.forEach((knee) => knee.rotation.set(Math.PI / 2 - 0.12, 0, 0));
    lean(j, -0.03);
  }
  if (name === 'stand') {
    if (opts.carry) carry();
  } else if (name === 'walk') {
    // The residents' own walk, one stride a phase; the elbows fold a little more as each arm swings
    // forward. Carrying the can, that arm hangs still.
    const amount = T.MathUtils.clamp(opts.amount ?? 1, 0, 1);
    j.root.userData.gait = { phase: u * TAU, amount };
    animateResident(j.root, 0, 0, false);
    lift = -j.root.userData.sole;
    j.arms.forEach((arm, k) => j.elbows[k].rotation.set(-0.12 - 0.04 * amount - 0.5 * Math.max(0, -arm.rotation.x), 0, 0));
    if (opts.carry) carry();
  } else if (name === 'water') {
    const held = unit(opts.lift, 1),
      pour = unit(opts.pour, 1),
      sway = Math.sin(u * TAU) * pour,
      bob = Math.sin(u * TAU * 2) * pour;
    // Her arms as they hold the can out over the bed, at the hold's own lean; then her lean and her
    // arms `held` of the way there from carrying it.
    lean(j, WATER.lean, WATER.reach);
    reach(j, 0, [WATER.grip[0] + 0.014 * sway, WATER.grip[1] + 0.006 * bob, WATER.grip[2]], [-0.8, -0.6, -0.2]);
    const out = armState(j, 0);
    // Her other hand rests on her hip, its elbow out.
    reach(j, 1, leaned([0.19, 0.455, 0.03], WATER.lean), [0.9, -0.1, -0.5]);
    const hip = armState(j, 1);
    lean(j, WATER.lean * held, [WATER.reach[0] * held, WATER.reach[1] * held, WATER.reach[2] * held]);
    easeArm(j, 0, CARRYING, out, held);
    easeArm(j, 1, AT_EASE[1], hip, held);
    // The can comes level from her side, then tips (spout down) and turns towards her middle.
    canInHand(j, props, CAN_CARRIED.clone().slerp(new T.Quaternion().setFromEuler(new T.Euler(WATER.tilt * pour + 0.05 * bob, WATER.yaw + 0.1 * sway, 0, 'YXZ')), held));
    // The water, from inside the rose down to the bed, leaving the way the spout points and falling.
    pourWater(props, unit(opts.front, 1), unit(opts.tail, 0));
    // A sidestep along the bed: `step` of the way through one that takes her root `side` ([x, z] in
    // her frame, mostly to her right), while whoever places her moves her root there by side x
    // smoothstep(step). The foot on that side (her right, to her right) steps out over the first
    // half and the other follows over the second, each lifted a little as it swings; the planted
    // one stays where it was, its leg leaning as she goes over it.
    const step = opts.step ?? 0,
      [sx, sz] = opts.side ?? [0, 0];
    if (step > 0 && step < 1 && Math.hypot(sx, sz) > 0) {
      const moved = smooth(step, 0, 1),
        lead = sx < 0 ? 0 : 1,
        feet = lead === 0 ? [smooth(step, 0, 0.5), smooth(step, 0.5, 1)] : [smooth(step, 0.5, 1), smooth(step, 0, 0.5)],
        swing = [0, 1].map((k) => (feet[k] > 0 && feet[k] < 1 ? Math.sin(Math.PI * (k === lead ? 2 * step : 2 * step - 1)) : 0));
      j.legs.forEach((leg, k) => {
        // The foot's place from its hip (x across, z ahead): how far it has come, less how far her root has.
        const ox = sx * (feet[k] - moved),
          oz = sz * (feet[k] - moved),
          across = Math.asin(ox / LEG);
        leg.rotation.set(-Math.asin(oz / (LEG * Math.cos(across))) - 0.35 * swing[k], 0, across);
        j.knees[k].rotation.set(0.7 * swing[k], 0, 0);
      });
      lift = -Math.min(soleOf(j.legs[0], j.knees[0]), soleOf(j.legs[1], j.knees[1]));
    }
  } else if (name === 'take') {
    // Stooping to the can, her knees bending and her hips going back; at the bottom her -x hand is
    // on its handle. Between her side and the handle her hand keeps low and out to her side (it
    // comes out sideways first and rises last, so the can never swings up into her hair hanging in
    // front of her as she leans), her arm reaching for it by a two-bone solve and settling at her
    // side at the top.
    const at = opts.can ?? ALISON_KERB,
      bend = p <= 0.5 ? smooth(p, 0, TAKE.down) : 1 - smooth(p, 1 - TAKE.down, 1),
      crouch = (b: number) => {
        lean(j, TAKE.lean * b, [TAKE.reach[0] * b, TAKE.reach[1] * b, TAKE.reach[2] * b], 0.14 * Math.sin(TAKE.knee * b));
        j.legs.forEach((leg) => leg.rotation.set(-TAKE.knee * b, 0, 0));
        j.knees.forEach((knee) => knee.rotation.set(TAKE.knee * b, 0, 0));
        // (Her shins upright, her soles stay flat: her hips come down as her thighs come forward.)
        return -sole(-TAKE.knee * b, TAKE.knee * b);
      },
      // Her hand, standing, with her arm `side` (at ease or carrying).
      upright = (side: ArmState) => {
        easeArm(j, 0, side, side, 0);
        return alisonHand(j, 0).toArray() as V3;
      },
      side = p <= 0.5 ? AT_EASE[0] : CARRYING,
      from = upright(side);
    lift = crouch(bend);
    const grip = gripOf(at, lift),
      // How far from her side to the handle her hand has come: across first, then forward, then down;
      // never further from her shoulder than her arm reaches with its elbow still soft.
      to = new T.Vector3(mix(from[0], grip[0], smooth(bend, 0.5, 1)), mix(from[1], grip[1], smooth(bend, 0, 0.7)), mix(from[2], grip[2], smooth(bend, 0.15, 0.9))),
      shoulder = j.arms[0].position,
      off = to.clone().sub(shoulder);
    if (off.length() > TAKE.arm) to.copy(shoulder).addScaledVector(off, TAKE.arm / off.length());
    reach(j, 0, to.toArray() as V3, [-0.7, -0.1, -0.7]);
    easeArm(j, 0, side, armState(j, 0), smooth(bend, 0, 0.3));
    if (p <= 0.5) {
      // Going down, the can still stands where it is.
      props.can.visible = true;
      props.can.quaternion.copy(level(at[3]));
      props.can.position.set(...grip);
    } else {
      // Coming up, it comes with her hand, turning level to her side.
      canInHand(j, props, level(at[3]).slerp(CAN_CARRIED, 1 - bend));
    }
  } else if (name === 'sit') {
    for (const k of [0, 1] as const) reach(j, k, [(k ? 1 : -1) * 0.1, 0.42, 0.075], [(k ? 1 : -1) * 0.8, -0.2, -0.6]);
  } else if (name === 'sip') {
    // The saucer held level in front of her; the cup lifted from its well to her lips and back,
    // on an arc that swings it clear of her chin.
    const { cup, saucer } = props,
      S = SIP.saucer,
      lifted = smooth(u, 0.12, 0.4) - smooth(u, 0.6, 0.88),
      rest: V3 = [S[0], S[1] + 0.036 + 0.037, S[2]],
      lips = leaned(SIP.lips, SIP.lean),
      at = (i: number) => T.MathUtils.lerp(rest[i], lips[i], lifted) + (i === 2 ? 0.03 * Math.sin(Math.PI * lifted) : 0);
    lean(j, SIP.lean, SIP.reach);
    saucer.visible = cup.visible = true;
    saucer.position.set(...S);
    // The cup turned so its handle faces her -x hand (back and to -x), tipped to her lips at the top.
    cup.rotation.set(-0.55 * smooth(lifted, 0.55, 1), -0.5, 0, 'YXZ');
    const lug = tmp.set(-CUP_AXIS, 0, 0).applyQuaternion(cup.quaternion);
    cup.position.set(at(0) + lug.x, at(1) + lug.y, at(2) + lug.z);
    reach(j, 0, [cup.position.x, cup.position.y, cup.position.z], [-0.8, -0.5, -0.3]);
    const hold = ALISON_HOLDS.saucer;
    reach(j, 1, [S[0] + hold[0], S[1] + hold[1], S[2] + hold[2]], [0.8, -0.4, -0.3]);
  } else if (name === 'telescope') {
    // Her hands as they hold the tube at the full stoop; then her stoop, her stance (her -x foot a
    // little back) and her arms `stoop` of the way there from standing at ease.
    const S = ALISON_TELESCOPE,
      stoop = unit(opts.stoop, 1);
    lean(j, SCOPE.lean, SCOPE.reach);
    const grips = ([0, 1] as const).map((k) => (reach(j, k, S.grips[k], [(k ? 1 : -1) * 0.9, -0.4, -0.3]), armState(j, k)));
    lean(j, SCOPE.lean * stoop, [SCOPE.reach[0] * stoop, SCOPE.reach[1] * stoop, SCOPE.reach[2] * stoop]);
    j.legs[0].rotation.set(0.09 * stoop, 0, 0);
    j.legs[1].rotation.set(-0.05 * stoop, 0, 0);
    lift = -Math.min(sole(0.09 * stoop, 0), sole(-0.05 * stoop, 0));
    if (opts.carry) carry();
    else easeArm(j, 0, AT_EASE[0], grips[0], stoop);
    easeArm(j, 1, AT_EASE[1], grips[1], stoop);
  } else if (name === 'rise') {
    // From 'sit' (0) to 'stand' (1): every joint goes from the one to the other by the same smoothstep
    // that slides her root, her seat's lift comes down to her floor, and she leans into it midway.
    const e = smooth(p, 0, 1),
      seated = Math.max(0.11, opts.seat ?? SEAT) + THIGH_R - HIP;
    lift = seated * (1 - e);
    j.legs.forEach((leg, k) => leg.rotation.set((-Math.PI / 2) * (1 - e), 0, (k ? 1 : -1) * 0.07 * (1 - e)));
    j.knees.forEach((knee) => knee.rotation.set((Math.PI / 2 - 0.12) * (1 - e), 0, 0));
    lean(j, -0.03 * (1 - e) + RISE.lean * 4 * e * (1 - e));
    // Her arms from her lap (as 'sit' reaches them, from her shoulders as they are now) to at ease.
    const easy = new T.Quaternion();
    for (const k of [0, 1] as const) {
      const [lap, bend] = LAP(k);
      reach(j, k, lap, bend);
      const bent = j.elbows[k].rotation.x;
      easy.setFromEuler(new T.Euler(0, 0, (k ? 1 : -1) * 0.12));
      j.arms[k].quaternion.slerp(easy, e);
      j.elbows[k].rotation.set(mix(bent, -0.12, e), 0, 0);
    }
  } else if (name === 'set') {
    // From 'sip' at rest (0) to 'sit' (1): her -x hand lets go of the cup's handle and goes to her
    // lap; her +x hand carries the saucer (the cup resting in it) from where she holds it to drink to
    // its place on the table, leaning to reach it, holding its rim a little higher as it comes down
    // to the table, and follows to her lap as she sits back.
    const S = SIP.saucer,
      seat = Math.max(0.11, opts.seat ?? SEAT),
      table: V3 = opts.rest ? [opts.rest[0], opts.rest[1] - lift, opts.rest[2]] : [ALISON_TABLE.x, seat + ALISON_TABLE.up - lift, ALISON_TABLE.z],
      turn = opts.rest ? opts.rest[3] : 0,
      free0 = smooth(p, 0, 0.4),
      moved = smooth(p, 0.2, 0.6),
      free1 = smooth(p, 0.6, 1),
      reached = smooth(p, 0.15, 0.5),
      at = mixV(S, table, moved),
      ry = turn * moved,
      hold = ALISON_HOLDS.saucer;
    lean(j, mix(mix(SIP.lean, SET.lean, reached), -0.03, free1), mixV(SIP.reach, [0, 0, 0], free1));
    cupOnSaucer(props, at, ry);
    const [lap0, bend0] = LAP(0),
      [lap1, bend1] = LAP(1),
      lug = props.cup.position,
      rim = new T.Vector3(hold[0], hold[1] + SET.over * moved, hold[2]).applyAxisAngle(new T.Vector3(0, 1, 0), ry).add(new T.Vector3(...at));
    reach(j, 0, mixV([lug.x, lug.y, lug.z], lap0, free0), mixV([-0.8, -0.5, -0.3], bend0, free0));
    reach(j, 1, mixV([rim.x, rim.y, rim.z], lap1, free1), mixV([0.8, -0.4, -0.3], bend1, free1));
  }
  // The can where it stands, while she is not holding it; her cup and saucer, set down on the
  // table, where they stand there while she is away.
  if (opts.can && !props.can.visible) {
    props.can.visible = true;
    props.can.quaternion.copy(level(opts.can[3]));
    props.can.position.set(...gripOf(opts.can, lift));
  }
  if (opts.rest && !props.saucer.visible) cupOnSaucer(props, [opts.rest[0], opts.rest[1] - lift, opts.rest[2]], opts.rest[3]);
  j.root.userData.lift = lift;
  return { lift };
}
/** Where the 'water' pose's rose (the middle of the spout's flared end) is at phase 0, in her frame. */
const WATER_ROSE = ((): V3 => {
  const g = () => new T.Group(),
    j: AlisonJoints = { root: g(), body: g(), legs: [g(), g()], knees: [g(), g()], arms: [g(), g()], elbows: [g(), g()] },
    props: AlisonProps = { can: g(), cup: g(), saucer: g(), water: g() };
  j.elbows.forEach((e, k) => {
    j.arms[k].add(e);
    e.position.y = -UPPER;
  });
  poseAlison(j, props, 'water', 0);
  props.can.updateMatrix();
  const tip = new T.Vector3(...ROSE).applyMatrix4(props.can.matrix);
  return [tip.x, tip.y, tip.z];
})();

/**
 * What a station needs to know of her (units; her frame has its origin under her root, +z the way
 * she faces):
 * - `height`: standing, to the crown of her hair.
 * - `seat`: the seat she sits at, its top above her floor (the town's park bench); `setback`: her
 *   root stands this far behind the seat's front edge, so her knees clear it and her shins hang free.
 * - `eyepiece` and `standOff`: where the telescope's eyepiece must be for the 'telescope' pose,
 *   above the floor she stands on and ahead of her root (ALISON_TELESCOPE has the rest).
 * - `rose`: the middle of the can's rose in the 'water' pose, [x, y above her floor, z ahead of her
 *   root]. Nothing of the can hangs under 0.38, so what she waters should stand under that there
 *   (the town's flower bed does between its blooms: its mound tops out at 0.37, they reach 0.47).
 * - `stride`: how far one 'walk' phase (two steps) carries her.
 */
export const ALISON = {
  height: 0.93,
  seat: SEAT,
  setback: 0.09,
  eyepiece: ALISON_TELESCOPE.eyepiece[1],
  standOff: ALISON_TELESCOPE.eyepiece[2],
  rose: WATER_ROSE,
  stride: STRIDE,
};
