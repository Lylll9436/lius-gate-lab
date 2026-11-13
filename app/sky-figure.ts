import * as T from 'three';
import type { SurfaceKind } from './city-materials';
import { animateResident, blob, DEPTH, HEAD, lathe, paint, part, shade, taper, TORSO, torsoAt } from './city-people';
import { ellipsoid, sculpt, type Shape } from './town-sculpt';

/*
 * Alison Heppenstall's little figure for the sky island, built like the town's residents
 * (city-people.ts: the same kit, scale and joints, so their walk code drives her) but as one named
 * person: long, loose, curly copper hair, dark rectangular glasses, a black long-sleeved top with a
 * small pale pendant, fair skin, dark trousers. Her hands carry a watering can, or a teacup and its
 * saucer, or a book; poseAlison() sets every joint and prop for a pose and a phase, from nothing
 * else, so town time can drive it and a paused town holds it. Nothing in the town builds her yet:
 * the sky island's own task places her and scripts her day.
 */
type Material = (c: string, k?: SurfaceKind) => T.MeshStandardMaterial;
type V3 = [number, number, number];

/**
 * Her colours (sRGB). Like the residents', every one stays at or under HSV saturation 0.55, but for
 * the hair: one muted copper, in shades, just under HAIR_SATURATION (the hair is the likeness, and
 * copper held to 0.55 reads as brown). check-town names that exception and holds everything else
 * to 0.55.
 */
export const ALISON_LOOK = {
  hair: '#d27e50',
  skin: '#f0cba9',
  top: '#2d2b2e',
  trousers: '#3b4552',
  shoes: '#4b392e',
  frames: '#262220',
  lens: '#f2d7c3',
  eyes: '#2b2622',
  pendant: '#ece4d3',
  zinc: '#a7aeb1',
  china: '#efeae0',
  chinaBand: '#8ea2b4',
  tea: '#a07a58',
  cover: '#6f4a44',
  pages: '#efe7d6',
};
/** The hair's saturation cap (HSV, sRGB): her one exception to the figures' 0.55. */
export const HAIR_SATURATION = 0.62;

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
/** The spacing of the distance grid the hair's cap is meshed on: its triangles go as 1/h² (about 550 show at this spacing). */
const HAIR_GRID = 0.04;

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
/** A geometry's colours on its vertices from its position and normal (sRGB triples): paint(), continuous. */
function tint(geometry: T.BufferGeometry, fn: (p: T.Vector3, n: T.Vector3) => V3) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  const p = g.getAttribute('position'),
    nrm = g.getAttribute('normal'),
    out = new Float32Array(p.count * 3),
    v = new T.Vector3(),
    n = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    const [r, gg, b] = fn(v.fromBufferAttribute(p, i), n.fromBufferAttribute(nrm, i));
    srgb.setRGB(r, gg, b, T.SRGBColorSpace).toArray(out, i * 3);
  }
  g.setAttribute('color', new T.BufferAttribute(out, 3));
  return g;
}
/** A hex colour as sRGB components (0..1). */
function sRGB(hex: string): V3 {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const UP = new T.Vector3(0, 1, 0);
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
/** A curl: an ellipsoid of radii r at c, turned by rot, as the kit's small spheres are (an icosahedron of detail 1, its normals the ellipsoid's own). */
function lobe(r: V3, c: V3, rot: V3) {
  const g = new T.IcosahedronGeometry(1, 1);
  g.scale(r[0], r[1], r[2]);
  g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(...rot)));
  return g.translate(c[0], c[1], c[2]);
}
/**
 * The hair, blocked out from the portrait for a camera that looks down on her: two kinds of form,
 * every normal an exact one, so nothing is faceted.
 * - A smooth cap from town-sculpt's distance grid: the crown close over the skull (under the tallest
 *   resident's head), parted on her right (-x), its volume swept over to her left in broad soft
 *   waves, with one down over her left temple; the nape filled in and a thin curtain down her back;
 *   and the face carved out of it, from a hairline above the glasses down past the chin.
 * - On it the curls: 34 chunky ellipsoid lobes 0.08 to 0.13 across (each a little longer down the
 *   lock's fall than across it) in ringlets that wave from side to side. One hangs from each temple,
 *   widening down past the jaw (where the hair is widest, as hers is) and on behind the arm, with a
 *   second, outer one for the volume, fuller on her left; three hang down her back past the
 *   shoulder blades to a ragged hem, out of step with one another; and a lock lies over each
 *   collarbone onto the top's front (longer on her left), so from in front the copper runs on past
 *   her shoulders. The lobes meet one another and the cap in crisp creases: at the town's scale that
 *   is what reads as curls, where lobes blended into one soft solid read as a hood.
 * Whatever a lobe, the cap, the head or the torso hides is left out. Below the shoulders' pivots
 * the side ringlets lie behind her arms and the front locks inside them, so the arms swing free of
 * the hair and a reaching arm comes out from under it. The whole stays inside the walkers' 0.27,
 * and no lobe is under 0.08 across. Returns the pieces, and `covers`: whether a point lies under
 * the hair.
 */
function hair() {
  const s = sculpt([-0.29, 0.38, -0.28], [0.29, 0.96, 0.2], HAIR_GRID),
    e = (c: V3, r: V3, rot?: V3) => ellipsoid(c, r, rot),
    lobes: { c: V3; r: V3; rot: V3; shape: Shape }[] = [];
  /** A ringlet: a lobe at each point, its radius from r, turned to lie along the lock. */
  const ringlet = (p: V3[], r: number[]) =>
    p.forEach((c, i) => {
      const a = new T.Vector3(...p[Math.max(0, i - 1)]),
        b = new T.Vector3(...p[Math.min(p.length - 1, i + 1)]),
        turn = new T.Euler().setFromQuaternion(new T.Quaternion().setFromUnitVectors(UP, a.sub(b).normalize())),
        rr: V3 = [r[i], r[i] * 1.22, r[i] * 0.94],
        rot: V3 = [turn.x, turn.y, turn.z];
      lobes.push({ c, r: rr, rot, shape: e(c, rr, rot) });
    });
  // The cap: the crown over the skull, the nape, and a thin curtain down her back.
  s.add(e([0.004, 0.758, -0.012], [0.166, 0.156, 0.163]));
  s.add(e([0, 0.69, -0.1], [0.15, 0.1, 0.09]), 0.04);
  s.add(e([0, 0.59, -0.128], [0.15, 0.17, 0.055]), 0.04);
  // The parting, on her right: the hair rises from it and sweeps over the crown to her left in
  // broad soft waves, and falls the short way to her right.
  s.add(e([0.052, 0.86, 0.012], [0.118, 0.06, 0.13], [0.05, 0, -0.28]), 0.02);
  s.add(e([0.085, 0.848, -0.1], [0.1, 0.052, 0.07], [0, 0.35, -0.3]), 0.014);
  s.add(e([-0.03, 0.846, -0.125], [0.085, 0.05, 0.062], [0.1, -0.2, 0.1]), 0.014);
  s.add(e([-0.118, 0.832, -0.005], [0.058, 0.052, 0.118], [0, 0, 0.45]), 0.016);
  // The face, carved out from the hairline down past the chin (tilted, so the hairline rises
  // towards her parting); then, laid after the carving so they stay, the wave down over her left
  // temple and the hair's root at the parting, which keeps the hairline one arch.
  s.cut(e([-0.004, 0.735, 0.148], [0.117, 0.126, 0.128], [0, 0, 0.24]), 0.024);
  s.add(e([0.078, 0.852, 0.104], [0.074, 0.033, 0.044], [0.15, 0.35, -0.48]), 0.02);
  s.add(e([-0.072, 0.862, 0.09], [0.05, 0.028, 0.04], [0.2, -0.3, 0.3]), 0.02);
  // A ringlet from each temple, close to the head, widening down past the jaw and on behind the
  // arm, and a second, outer one on each side for the volume; her left (+x) is the fuller side.
  for (const [side, k] of [[1, 1], [-1, 0.93]] as const) {
    const x = (v: number) => side * (side > 0 ? v : v - 0.008);
    ringlet([[x(0.162), 0.809, 0.014], [x(0.2), 0.727, 0], [x(0.2), 0.635, -0.03], [x(0.19), 0.545, -0.085], [x(0.18), 0.47, -0.12]], [0.058, 0.065, 0.066, 0.06, 0.048].map((r) => r * k));
    ringlet([[x(0.146), 0.797, -0.098], [x(0.187), 0.698, -0.105], [x(0.19), 0.602, -0.125]], [0.059, 0.064, 0.06].map((r) => r * k));
  }
  // Three down her back to a ragged hem, the outer two half a curl out of step with the middle one.
  ringlet([[0.006, 0.81, -0.15], [-0.01, 0.715, -0.178], [0.012, 0.62, -0.185], [-0.01, 0.525, -0.18], [0.008, 0.445, -0.165]], [0.058, 0.064, 0.066, 0.062, 0.05]);
  for (const side of [-1, 1])
    ringlet([[side * 0.1, 0.782, -0.128], [side * 0.118, 0.675, -0.155], [side * 0.104, 0.577, -0.165], [side * 0.114, 0.482 + side * 0.008, -0.16]], [0.06, 0.066, 0.064, 0.052]);
  // The locks in front, as in the portrait: on her left a long one over the collarbone onto her
  // chest, on her right a shorter one. Both lie inside the shoulders, clear of the arms.
  ringlet([[0.15, 0.686, 0.044], [0.124, 0.602, 0.094], [0.12, 0.516, 0.114]], [0.056, 0.057, 0.048]);
  ringlet([[-0.146, 0.688, 0.038], [-0.122, 0.61, 0.086]], [0.052, 0.049]);
  /** The hair's distance field: the cap (unless `cap` is false) and every lobe but `skip`. */
  const field = (x: number, y: number, z: number, skip = -1, cap = true) => {
    let d = cap ? s.exact(x, y, z) : 1e3;
    for (let i = 0; i < lobes.length; i++) if (i !== skip) d = Math.min(d, lobes[i].shape.d(x, y, z));
    return d;
  };
  const base = sRGB(ALISON_LOOK.hair),
    copper = (g: T.BufferGeometry) =>
      tint(g, (p, n) => {
        // How far the field opens out along the normal (a distance-field occlusion): the creases
        // between curls and the hair's own underside come out deeper, so the curls read.
        let shut = 0;
        for (const [d, w] of [[0.012, 0.5], [0.028, 0.35], [0.05, 0.2]])
          shut += (w * Math.max(0, d - field(p.x + n.x * d, p.y + n.y * d, p.z + n.z * d))) / d;
        // One copper, in shades (a scale of it keeps its saturation): deeper towards the hem and in
        // the creases, and a little deeper on what faces the sky, where the key light would
        // otherwise bleach the crown to a pale salmon beside curls in copper.
        const k = T.MathUtils.lerp(0.84, 1, T.MathUtils.smoothstep(p.y, 0.44, 0.84)) * (1 - 0.36 * Math.min(1, shut)) * (1 - 0.14 * T.MathUtils.smoothstep(n.y, 0.3, 0.95));
        return [base[0] * k, base[1] * k, base[2] * k];
      });
  // Every triangle that shows: not wholly inside another part of the hair, the head or the torso.
  return {
    pieces: [
      copper(shown(s.mesh(), (x, y, z) => insideBody(x, y, z) || field(x, y, z, -1, false) < -0.004)),
      ...lobes.map((l, i) => copper(shown(lobe(l.r, l.c, l.rot), (x, y, z) => insideBody(x, y, z) || field(x, y, z, i) < -0.004))),
    ],
    covers: (x: number, y: number, z: number) => field(x, y, z) < -0.004,
  };
}

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
export type AlisonProps = { can: T.Group; cup: T.Group; saucer: T.Group; book: T.Group };

/** The watering can's drum: its axis this far ahead of the handle's grip (the can's origin, +z towards the spout). */
const DRUM = 0.141;
/** A 0.07 tube's radius: six-sided, so 0.041 to its corners leaves it 0.071 across its flats. */
const TUBE = 0.041;
/** The middle of the can's rose (the spout's flared end), in the can's frame. */
const ROSE: V3 = [0, 0.004, DRUM + 0.195];
/**
 * Her hand props, each a group of its own in her root (so batching part by part makes each one
 * mesh, and a pose shows only its own), placed by poseAlison. Every joined piece is at least 0.07
 * thick: the can's handle and its spout are 0.07 tubes (the spout flares into its rose), the cup's
 * handle is a 0.07 lug, the saucer stands 0.07 from its foot to its rim, the book's boards are
 * 0.07. Their origins are where they are held: the can's handle at its back, the cup's handle, the
 * saucer's foot, the book's spine.
 */
function createProps(material: Material): AlisonProps {
  const L = ALISON_LOOK;
  const can = new T.Group(),
    cup = new T.Group(),
    saucer = new T.Group(),
    book = new T.Group();
  can.name = 'watering-can';
  cup.name = 'teacup';
  saucer.name = 'saucer';
  book.name = 'book';
  // The can, level: a zinc drum, a loop handle on its back (held at its rearmost point, the
  // origin) and a spout from its foot, forward and a little up, flaring into the rose.
  part(can, [
    paint(lathe([[0, -0.09], [0.064, -0.09], [0.07, -0.076], [0.07, 0.04], [0.061, 0.055], [0, 0.055]], 10).translate(0, 0, DRUM), L.zinc, [-0.09, 0.055, 0.9, 1.04]),
    paint(taper([[0, 0.032, DRUM - 0.062], [0, 0.044, 0.04], [0, 0.028, 0.004], [0, -0.024, 0.002], [0, -0.062, 0.034], [0, -0.066, DRUM - 0.062]], [TUBE, TUBE, TUBE, TUBE, TUBE, TUBE], 6, 6), shade(L.zinc, 0.9)),
    paint(taper([[0, -0.054, DRUM + 0.04], [0, -0.034, DRUM + 0.105], [0, -0.012, DRUM + 0.165], ROSE], [TUBE, TUBE, TUBE, 0.062], 5, 6), shade(L.zinc, 0.96)),
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
  // The book, open: two boards with their pages, each 0.07 thick and 0.15 long, meeting at the
  // spine (the origin, along z) in a shallow V, the pages up and the cloth cover below and round them.
  const pages = sRGB(L.pages),
    cover = sRGB(L.cover),
    leaf = (s: number) =>
      tint(new T.BoxGeometry(0.11, 0.07, 0.15), (_, n) => (n.y > 0.5 ? pages : cover))
        .translate(s * 0.058, -0.035, 0)
        .rotateZ(s * 0.22);
  part(book, [leaf(-1), leaf(1)], material, 'paint', 'book');
  for (const g of [can, cup, saucer, book]) g.visible = false;
  return { can, cup, saucer, book };
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
  root.add(props.can, props.cup, props.saucer, props.book);
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
export const ALISON_POSES = ['stand', 'walk', 'water', 'sit', 'sip', 'telescope', 'read'] as const;
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
 * draws each shoulder in, up and forward (the shoulder blade sliding round as an arm reaches out).
 */
function lean(j: AlisonJoints, a: number, reach: V3 = [0, 0, 0]) {
  j.body.rotation.set(a, 0, 0);
  j.body.position.set(0, HIP - HIP * Math.cos(a), -HIP * Math.sin(a));
  j.arms.forEach((arm, k) => arm.position.set(...leaned([(k ? 1 : -1) * (SHOULDER.x - reach[0]), SHOULDER.y + reach[1], reach[2]], a)));
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
const smooth = T.MathUtils.smoothstep,
  TAU = Math.PI * 2;

/** The 'water' pose: her lean, how far her shoulders reach in, up and forward, the can's grip in her -x hand, and its tilt (spout down) and turn (towards her middle). */
const WATER = { lean: 0.14, reach: [0.01, 0.015, 0.04] as V3, grip: [-0.125, 0.636, 0.26] as V3, tilt: 0.62, yaw: 0.25 };
/** The 'sip' pose: her lean and reach, the saucer's foot where her +x hand holds it, in front of her, and her lips (the cup's axis there, before the lean). */
const SIP = { lean: 0.05, reach: [0.012, 0, 0.035] as V3, saucer: [0.03, 0.468, 0.214] as V3, lips: [0, 0.655, 0.178] as V3 };
/** The 'read' pose: her lean and reach, the book's spine where she holds it, and its tilt (the pages up and a little towards her). */
const READ = { lean: 0.05, reach: [0.012, 0, 0.03] as V3, book: [0, 0.478, 0.215] as V3, tilt: -0.2 };
/** The 'telescope' pose's stoop (from the hips) and how far her shoulders reach in, up and forward. */
const SCOPE = { lean: 0.26, reach: [0.015, 0.02, 0.05] as V3 };
/**
 * Where a hand holds each prop, in the prop's own frame: the can's handle and the cup's lug in her
 * -x hand (hand 0), the saucer's near rim in her +x hand (hand 1), the book's near corners in both.
 */
export const ALISON_HOLDS = {
  can: [0, 0, 0] as V3,
  cup: [0, 0, 0] as V3,
  saucer: [0.066, 0.03, -0.038] as V3,
  book: [[-0.118, -0.012, -0.045], [0.118, -0.012, -0.045]] as [V3, V3],
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

/**
 * Pose her for `name` at `phase` (0..1, looping), from nothing else: every joint and prop that any
 * pose moves is set on each call, so poses never leak into one another, and the same arguments
 * always give the same pose. Returns `lift`: her root's height over the floor under her (standing
 * and walking, her lowest sole touches it; seated, her thighs rest on a seat `seat` high,
 * ALISON.seat by default). Place her root at the floor plus lift.
 * - 'stand': at ease.
 * - 'walk': one stride a phase (two steps), the residents' gait: ALISON.stride units a phase.
 *   `amount` (1 by default) scales the gait, so 0 is 'stand' and a walk can ease in and out.
 * - 'water': standing, the can held out in her -x hand by its handle and tipped, so its rose hangs
 *   over a border in front of her (ALISON.rose), swaying gently along it; her other hand on her hip.
 * - 'sit': on a seat, hands on her thighs.
 * - 'sip': seated, the saucer held in front of her in her +x hand, the cup lifted from it to her
 *   lips and down again in her -x hand (on the saucer from 0.88 round to 0.12, at her lips from
 *   0.4 to 0.6).
 * - 'telescope': standing, stooped a little to the eyepiece (ALISON_TELESCOPE), both hands on the tube.
 * - 'read': seated, an open book held by its near corners.
 */
export function poseAlison(j: AlisonJoints, props: AlisonProps, name: AlisonPose, phase: number, opts: { seat?: number; amount?: number } = {}) {
  const u = ((phase % 1) + 1) % 1;
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
  if (name === 'sit' || name === 'sip' || name === 'read') {
    // Thighs level and a little apart, shins hanging just forward of plumb, sitting up.
    lift = Math.max(0.11, opts.seat ?? SEAT) + THIGH_R - HIP;
    j.legs.forEach((leg, k) => leg.rotation.set(-Math.PI / 2, 0, (k ? 1 : -1) * 0.07));
    j.knees.forEach((knee) => knee.rotation.set(Math.PI / 2 - 0.12, 0, 0));
    lean(j, -0.03);
  }
  if (name === 'walk') {
    // The residents' own walk, one stride a phase; the elbows fold a little more as each arm swings forward.
    const amount = T.MathUtils.clamp(opts.amount ?? 1, 0, 1);
    j.root.userData.gait = { phase: u * TAU, amount };
    animateResident(j.root, 0, 0, false);
    lift = -j.root.userData.sole;
    j.arms.forEach((arm, k) => j.elbows[k].rotation.set(-0.12 - 0.04 * amount - 0.5 * Math.max(0, -arm.rotation.x), 0, 0));
  } else if (name === 'water') {
    const sway = Math.sin(u * TAU),
      can = props.can;
    lean(j, WATER.lean, WATER.reach);
    reach(j, 0, [WATER.grip[0] + 0.014 * sway, WATER.grip[1] + 0.006 * Math.sin(u * TAU * 2), WATER.grip[2]], [-0.8, -0.6, -0.2]);
    can.visible = true;
    alisonHand(j, 0, can.position);
    can.rotation.set(WATER.tilt + 0.05 * Math.sin(u * TAU * 2), WATER.yaw + 0.1 * sway, 0, 'YXZ');
    // Her other hand rests on her hip, its elbow out.
    reach(j, 1, leaned([0.19, 0.455, 0.03], WATER.lean), [0.9, -0.1, -0.5]);
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
    const S = ALISON_TELESCOPE;
    lean(j, SCOPE.lean, SCOPE.reach);
    // A short stance: her -x foot a little back.
    j.legs[0].rotation.set(0.09, 0, 0);
    j.legs[1].rotation.set(-0.05, 0, 0);
    lift = -Math.min(sole(0.09, 0), sole(-0.05, 0));
    for (const k of [0, 1] as const) reach(j, k, S.grips[k], [(k ? 1 : -1) * 0.9, -0.4, -0.3]);
  } else if (name === 'read') {
    const book = props.book;
    lean(j, READ.lean, READ.reach);
    book.visible = true;
    book.position.set(...READ.book);
    book.rotation.set(READ.tilt, 0, 0, 'XYZ');
    book.updateMatrix();
    for (const k of [0, 1] as const) {
      const corner = tmp.set(...ALISON_HOLDS.book[k]).applyMatrix4(book.matrix);
      reach(j, k, [corner.x, corner.y, corner.z], [(k ? 1 : -1) * 0.8, -0.4, -0.4]);
    }
  }
  j.root.userData.lift = lift;
  return { lift };
}
/** Where the 'water' pose's rose (the middle of the spout's flared end) is at phase 0, in her frame. */
const WATER_ROSE = ((): V3 => {
  const g = () => new T.Group(),
    j: AlisonJoints = { root: g(), body: g(), legs: [g(), g()], knees: [g(), g()], arms: [g(), g()], elbows: [g(), g()] },
    props: AlisonProps = { can: g(), cup: g(), saucer: g(), book: g() };
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
