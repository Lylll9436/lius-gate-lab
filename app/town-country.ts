import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as plan from './town-plan';
import {
  palette,
  hash,
  noise2,
  sstep,
  mix,
  paddockRuns,
  type TownContext,
} from './town-shared';
import type { Kit } from './town-kit';
import { paintByHeight, bakeRamp } from './town-nature';

/* ------------------------------------------------------------------ */
/* Highland herd                                                       */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Scottish touches                                                    */
/* ------------------------------------------------------------------ */
export function createCountry(ctx: TownContext, kit: Kit) {
  const { material, animated } = ctx;
  const { box, cone, sphere, groundY } = kit;
  /**
   * The paddock's own colours, judged after the 0.72 grade: the dyke takes the beach boulders'
   * greys; the hay is a straw gold from the brass and gold family (HSV s 0.51, under the gold's
   * 0.68), shading to a deeper straw at the foot and paler at the tops (a pale, even one read
   * as an egg, then as a stone, in the trough).
   */
  const PADDOCK = { stone: ['#b9b6a2', '#9da394'], cope: '#a3aaa0', hay: '#d2ae66', hayShade: '#a9843f', hayPale: '#e2c78a' };
  /**
   * Highland coats, judged after the 0.72 grade: a muted russet (HSV s ≤ 0.61, no louder than
   * the wood and the red sandstone) with paler ginger tips on every lock, a darker russet belly
   * and legs, and a dark muzzle. The calf's coat is a shade lighter, never pink.
   */
  const COAT = { coat: '#a0603f', tips: '#c4935f', dark: '#74472e', calf: '#a66a43', muzzle: '#4f423a' };
  /** The paddock, its gate and hay rack, and the herd in it. */
  function highlandPaddock(g: T.Object3D) {
    dyke(g);
    fieldGate(g);
    hayRack(g);
    for (const animal of plan.herd) highlandCow(g, animal);
  }
  /**
   * A chunky lock (of hair, or a straw): a wedge from a root `w` wide (along `across`) and `t`
   * thick to a chisel tip `len` along `dir`, `point` of the root's width (0.2 when absent), with
   * a crest down its outer face, so one side catches the light and the other falls into shade;
   * `base` colours the root and `tip` the tip. A lock lying on a coat gives the coat's outward
   * normal as `out`: its crest faces that way and its facets are shaded partly toward it, so a
   * coat reads as clumps of hair rather than loose cards. `rootShade` darkens the blunt root
   * faces: a hem lock's root faces up, and a ring of them in the coat's own colour read as a
   * smooth shelf round the barrel; shaded, they read as the depth of the coat. `soft` is how far
   * every facet's normal leans to `out` (0.6 when absent): a forelock's locks lean far, so the
   * fringe shades as one soft mass instead of flat chips with pale faces.
   */
  type Lock = { root: T.Vector3; dir: T.Vector3; across: T.Vector3; len: number; w: number; t: number; base: T.Color; tip: T.Color; point?: number; out?: T.Vector3; rootShade?: number; soft?: number };
  /** Locks as one geometry (eleven flat faces each, wound outward from the wedge's middle). */
  function lockGeometry(locks: Lock[]) {
    const position: number[] = [],
      normal: number[] = [],
      colour: number[] = [],
      d = new T.Vector3(),
      a = new T.Vector3(),
      n = new T.Vector3(),
      middle = new T.Vector3(),
      e1 = new T.Vector3(),
      e2 = new T.Vector3();
    for (const lock of locks) {
      d.copy(lock.dir).normalize();
      a.copy(lock.across).addScaledVector(d, -lock.across.dot(d)).normalize();
      n.crossVectors(a, d);
      if (lock.out && n.dot(lock.out) < 0) {
        a.negate();
        n.negate();
      }
      const end = lock.root.clone().addScaledVector(d, lock.len),
        // Root corners (across, through), the raised crest at the root, the chisel tip and its middle.
        R = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => lock.root.clone().addScaledVector(a, (i * lock.w) / 2).addScaledVector(n, (j * lock.t) / 2)),
        crest = lock.root.clone().addScaledVector(n, lock.t),
        P = [-1, 1].map((i) => end.clone().addScaledVector(a, i * lock.w * (lock.point ?? 0.2))),
        tips = [...P, end];
      middle.copy(lock.root).addScaledVector(d, lock.len * 0.3);
      const faces = [
        [R[3], crest, end], [R[3], end, P[0]], [crest, R[2], P[1]], [crest, P[1], end], // the crested outer face
        [R[0], R[1], P[1]], [R[0], P[1], P[0]], // the inner face
        [R[1], R[2], P[1]], [R[0], R[3], P[0]], // the edges
        [R[0], R[1], R[2]], [R[0], R[2], R[3]], [R[3], R[2], crest], // the root
      ];
      const root = lock.base.clone().multiplyScalar(lock.rootShade ?? 1);
      faces.forEach(([p, q0, r0], f) => {
        e1.subVectors(q0, p);
        e2.subVectors(r0, p);
        e1.cross(e2).normalize();
        const inward = e1.dot(e2.copy(p).add(q0).add(r0).divideScalar(3).sub(middle)) < 0;
        if (inward) e1.negate();
        if (lock.out) e1.addScaledVector(lock.out, lock.soft ?? 0.6).normalize();
        for (const v of inward ? [p, r0, q0] : [p, q0, r0]) {
          const c = tips.includes(v) ? lock.tip : f >= 8 ? root : lock.base;
          position.push(v.x, v.y, v.z);
          normal.push(e1.x, e1.y, e1.z);
          colour.push(c.r, c.g, c.b);
        }
      });
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(position, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(colour, 3));
    return geo;
  }
  /**
   * The shape a coat lies on, round (0, cy, 0) with half-axes ax, ay and az (the nose along +z), its
   * back lifted a little over the shoulders: a loaf rather than an egg. `theta` runs down from the
   * spine (0) to the belly (pi) and `phi` round from the nose (+z, toward +x). Its widest line is
   * the ellipse (ax sin phi, az cos phi), but its top is a spine line SPINE of az long each way, not
   * a pole, so a drape wrapped round it parts along the back (round a pole its locks radiated from
   * one point on the back, like an artichoke).
   */
  type CoatShape = { cy: number; ax: number; ay: number; az: number };
  const backLift = (s: CoatShape, z: number) => s.ay * (1 + 0.12 * Math.exp(-(((z / s.az - 0.45) / 0.35) ** 2)));
  const SPINE = 0.8;
  function coatAt(s: CoatShape, theta: number, phi: number, out: T.Vector3) {
    const h = Math.sin(theta),
      z = s.az * Math.cos(phi) * (SPINE + (1 - SPINE) * h);
    return out.set(s.ax * h * Math.sin(phi), s.cy + backLift(s, z) * Math.cos(theta), z);
  }
  /** The shape's outward normal at (theta, phi), by central differences. */
  const dTheta = new T.Vector3(),
    dPhi = new T.Vector3(),
    probe = new T.Vector3();
  function coatNormal(s: CoatShape, theta: number, phi: number, out: T.Vector3) {
    const e = 1e-3;
    coatAt(s, theta + e, phi, dTheta).sub(coatAt(s, theta - e, phi, probe));
    coatAt(s, theta, phi + e, dPhi).sub(coatAt(s, theta, phi - e, probe));
    out.crossVectors(dTheta, dPhi).normalize();
    coatAt(s, theta, phi, probe);
    if (out.x * probe.x + out.y * (probe.y - s.cy) + out.z * probe.z < 0) out.negate();
    return out;
  }
  /**
   * The barrel under the drapes: the coat's shape drawn in a little, in the coat's own tone a
   * shade darker, darker still toward the belly, so any of it seen between the drapes, and the
   * shade under the belly, reads as more coat.
   */
  function coatCore(s: CoatShape, tone: T.Color) {
    const rows = 10,
      cols = 24,
      inset = 0.96,
      position = new Float32Array((rows + 1) * cols * 3),
      colour = new Float32Array((rows + 1) * cols * 3),
      base = tone.clone().multiplyScalar(0.9),
      under = new T.Color(COAT.dark).multiplyScalar(0.85),
      c = new T.Color(),
      at = new T.Vector3(),
      index: number[] = [];
    for (let r = 0; r <= rows; r++)
      for (let i = 0; i < cols; i++) {
        const theta = (Math.PI * r) / rows,
          k = r * cols + i;
        coatAt(s, theta, (i / cols) * Math.PI * 2, at);
        position.set([at.x * inset, s.cy + (at.y - s.cy) * inset, at.z * inset], k * 3);
        c.copy(base).lerp(under, 0.7 * (1 - sstep((Math.cos(theta) + 1) / 2, 0.15, 0.6)));
        colour.set([c.r, c.g, c.b], k * 3);
      }
    for (let r = 0; r < rows; r++)
      for (let i = 0; i < cols; i++) {
        const a = r * cols + i,
          b = r * cols + ((i + 1) % cols);
        index.push(a, a + cols, b, b, a + cols, b + cols);
      }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(position, 3));
    geo.setAttribute('color', new T.BufferAttribute(colour, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  }
  /** Below this angle from the spine (just above the widest line) a drape stops following the barrel and hangs. */
  const HANG = 1.45;
  /**
   * A point on the coat at (theta, phi), `puff` out along the shape's normal. Past HANG it hangs:
   * straight down from the HANG line by (theta - HANG) ay, splaying out a little (0.1 of its drop)
   * as it falls.
   */
  const outward = new T.Vector3();
  function coatSurface(s: CoatShape, theta: number, phi: number, puff: number, out: T.Vector3) {
    const th = Math.min(theta, HANG);
    coatAt(s, th, phi, out).addScaledVector(coatNormal(s, th, phi, outward), puff);
    if (theta > HANG) {
      const drop = (theta - HANG) * s.ay,
        h = Math.hypot(outward.x, outward.z);
      out.set(out.x + (outward.x / h) * 0.1 * drop, out.y - drop, out.z + (outward.z / h) * 0.1 * drop);
    }
    return out;
  }
  /**
   * One drape of the coat: a band of hair right round the barrel from `top` (radians down from the
   * spine) to a ragged edge of `locks` pointed locks, notched at `edge` and each tip up to `teeth`
   * further down (its length set by hash). Past HANG the band hangs, so a hem's `edge` is its drop
   * in ay. It lies flush at its top and stands `puff` proud at its edge, so each drape laps over
   * the one below and its edge's shadow, not a dark gap, shapes the coat; `spin` (in columns)
   * staggers its locks against the next drape's. Normals are smooth, so a drape shades as one soft
   * fall of hair (flat-shaded locks, each with a pale face and a dark root, read as wood chips).
   * Colour: shaded a little at the top (0.85, tucked under the drape above), paling a touch toward
   * the tips, each lock within ±4%. `back` adds its inner face (for a hem seen under the belly).
   */
  type Drape = { top: number; edge: number; teeth: number; locks: number; puff: number; spin: number; back?: boolean };
  function drape(s: CoatShape, tone: T.Color, seed: number, d: Drape) {
    const cols = d.locks * 4,
      rows = d.edge > HANG ? 7 : 4,
      count = (rows + 1) * cols,
      position = new Float32Array(count * 3),
      colour = new Float32Array(count * 3),
      tips = new T.Color(COAT.tips),
      at = new T.Vector3(),
      c = new T.Color(),
      index: number[] = [];
    for (let i = 0; i < cols; i++) {
      const lock = Math.floor(i / 4),
        shape = [0, 0.55, 1, 0.55][i % 4], // notch, flank, tip, flank
        reach = d.teeth * shape * (0.65 + 0.7 * hash(seed + lock * 13 + 1)),
        phi = ((i + d.spin) / cols) * Math.PI * 2,
        shade = 0.96 + 0.08 * hash(seed + lock * 13 + 2);
      for (let r = 0; r <= rows; r++) {
        const t = r / rows,
          k = r * cols + i;
        coatSurface(s, d.top + (d.edge + reach - d.top) * t, phi, 0.004 + (d.puff - 0.004) * t ** 1.5, at);
        position.set([at.x, at.y, at.z], k * 3);
        c.copy(tone).multiplyScalar(mix(0.85, 1, sstep(t, 0, 0.6)) * shade).lerp(tips, 0.3 * t * t * (0.4 + 0.6 * shape));
        colour.set([c.r, c.g, c.b], k * 3);
      }
    }
    for (let r = 0; r < rows; r++)
      for (let i = 0; i < cols; i++) {
        const a = r * cols + i,
          b = r * cols + ((i + 1) % cols),
          below = a + cols,
          next = b + cols;
        index.push(a, below, b, b, below, next);
      }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(position, 3));
    geo.setAttribute('color', new T.BufferAttribute(colour, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    if (!d.back) return geo;
    // The inner face: the same band wound the other way, its normals reversed, in shade.
    const inner = geo.clone(),
      ii = inner.getIndex()!,
      nn = inner.getAttribute('normal'),
      cc = inner.getAttribute('color');
    for (let k = 0; k < ii.count; k += 3) {
      const a = ii.getX(k + 1);
      ii.setX(k + 1, ii.getX(k + 2));
      ii.setX(k + 2, a);
    }
    for (let k = 0; k < nn.count; k++) {
      nn.setXYZ(k, -nn.getX(k), -nn.getY(k), -nn.getZ(k));
      cc.setXYZ(k, cc.getX(k) * 0.7, cc.getY(k) * 0.7, cc.getZ(k) * 0.7);
    }
    return mergeGeometries([geo, inner])!;
  }
  /** The whole coat: its drapes, top to hem, as one geometry. */
  function shaggyCoat(s: CoatShape, tone: T.Color, seed: number, drapes: Drape[]) {
    return mergeGeometries(drapes.map((d, n) => drape(s, tone, seed + n * 101, d)))!;
  }
  /**
   * The forelock, in two layers that wrap the brow: locks lying flat along the poll from between
   * the horns forward over the brow's rounded edge, and under their tips a fringe hanging from
   * that edge down over the eyes to the muzzle, each lock tapered to a point, overlapping its
   * neighbours, its length, width and splay set by hash (three and four on a cow, three and three
   * shorter ones on a calf); on a cow, a lock down each cheek too. Straight locks rooted on the
   * poll and falling forward either stood up over it as a crest (a hedgehog on the calf) or,
   * laid at the angle that clears the brow, jutted out in front of the face like a comb. Head
   * space: the crown is at y 0.15 and the front face at z 0.42, the edge between them rounded
   * (r 0.1 round y 0.05, z 0.32); the muzzle's top is at y -0.03.
   */
  function forelock(tone: T.Color, seed: number, calf: boolean) {
    const base = tone.clone().lerp(new T.Color(COAT.tips), 0.3),
      tip = tone.clone().lerp(new T.Color(COAT.tips), 0.65),
      locks: Lock[] = [],
      across = new T.Vector3(1, 0, 0),
      layers = [
        // On the poll: flat, from between the horns to just over the brow's edge.
        { count: 3, spread: calf ? 0.085 : 0.09, root: [0.135, 0.06], dir: [0, 1], len: calf ? 0.3 : 0.36, w: 0.13, out: [1, 0] },
        // Down the face: from the brow's edge over the eyes.
        { count: calf ? 3 : 4, spread: calf ? 0.1 : 0.13, root: [0.121, 0.391], dir: [-0.88, 0.45], len: calf ? 0.2 : 0.25, w: calf ? 0.11 : 0.12, out: [0.45, 0.88] },
      ];
    let k = 0;
    for (const layer of layers)
      for (let j = 0; j < layer.count; j++) {
        const h = hash(seed + 40 + ++k * 3),
          h2 = hash(seed + 41 + k * 3),
          u = ((j + 0.5) / layer.count) * 2 - 1;
        locks.push({
          root: new T.Vector3(u * layer.spread + (h - 0.5) * 0.03, layer.root[0], layer.root[1] + (h2 - 0.5) * 0.03),
          dir: new T.Vector3(u * 0.2 + (h2 - 0.5) * 0.14, layer.dir[0], layer.dir[1]),
          across,
          len: layer.len * (0.8 + 0.45 * h),
          w: layer.w * (0.85 + 0.3 * h2),
          t: 0.06,
          base,
          tip,
          point: 0.12,
          out: new T.Vector3(0, layer.out[0], layer.out[1]),
          rootShade: 0.9,
          soft: 2.5,
        });
      }
    if (!calf)
      for (const s of [-1, 1])
        locks.push({ root: new T.Vector3(s * 0.17, 0.15, 0.22), dir: new T.Vector3(s * 0.35, -0.85, 0.4), across: new T.Vector3(0, 0, 1), len: 0.24 * (0.85 + 0.3 * hash(seed + 60 + s)), w: 0.14, t: 0.07, base, tip, point: 0.15, out: new T.Vector3(s, 0, 0), rootShade: 0.9, soft: 2.5 });
    return lockGeometry(locks);
  }
  /** A horn: a tube along a smooth curve, tapering from r0 to a point, cream at the root and dark at the tip. */
  function horn(g: T.Object3D, points: T.Vector3[], r0: number, colour: string, tip: string) {
    const curve = new T.CatmullRomCurve3(points),
      segments = 8,
      sides = 6,
      geo = new T.TubeGeometry(curve, segments, 1, sides, false),
      p = geo.getAttribute('position'),
      out = new Float32Array(p.count * 3),
      root = new T.Color(colour),
      dark = new T.Color(tip),
      c = new T.Color(),
      at = new T.Vector3();
    // TubeGeometry lays out one ring of sides + 1 unit-radius vertices per step along the curve.
    for (let j = 0; j <= segments; j++) {
      const t = j / segments,
        r = mix(r0, 0.004, t ** 1.2);
      curve.getPointAt(t, at);
      c.copy(root).lerp(dark, sstep(t, 0.62, 0.95));
      for (let i = 0; i <= sides; i++) {
        const k = j * (sides + 1) + i;
        p.setXYZ(k, at.x + (p.getX(k) - at.x) * r, at.y + (p.getY(k) - at.y) * r, at.z + (p.getZ(k) - at.z) * r);
        out.set([c.r, c.g, c.b], k * 3);
      }
    }
    geo.setAttribute('color', new T.BufferAttribute(out, 3));
    const m = new T.Mesh(geo, material('#ffffff', 'fabric'));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  /**
   * A Highland cow's build (local +z is the nose, about 1.65 nose to tail and 0.95 at the
   * withers): short dark legs, the coat's shape and its drapes, the head pivot (its rest
   * height and its scale) and the tail pivot.
   */
  const ADULT = {
    legs: { h: 0.3, w: 0.17, x: 0.2, z: 0.34 },
    shape: { cy: 0.58, ax: 0.37, ay: 0.33, az: 0.6 },
    // Three broad drapes over a ragged hem that falls to about 0.3 (its locks' tips to about 0.15).
    drapes: [
      { top: 0.02, edge: 0.6, teeth: 0.22, locks: 12, puff: 0.03, spin: 0 },
      { top: 0.5, edge: 0.96, teeth: 0.24, locks: 14, puff: 0.04, spin: 1.5 },
      { top: 0.86, edge: 1.28, teeth: 0.24, locks: 16, puff: 0.045, spin: 0.75 },
      { top: 1.18, edge: HANG + 0.3 / 0.33, teeth: 0.15 / 0.33, locks: 20, puff: 0.05, spin: 2.5, back: true },
    ] as Drape[],
    head: { y: 0.72, z: 0.5, scale: 1 },
    tail: { y: 0.8, z: -0.6 },
  };
  /**
   * A calf's build, in its own units before the herd's 0.62 scale: leggy (its legs half as long
   * again as an adult's, under a shorter coat), a smaller, rounder barrel and a head a quarter
   * bigger, so the head is large for the body.
   */
  const CALF: typeof ADULT = {
    legs: { h: 0.44, w: 0.13, x: 0.15, z: 0.25 },
    shape: { cy: 0.64, ax: 0.29, ay: 0.25, az: 0.44 },
    // A calf's coat is short: one fringe from the spine over a short hem, so it reads as a calf
    // standing on its long legs, not a bundle of chips.
    drapes: [
      { top: 0.02, edge: 0.88, teeth: 0.18, locks: 12, puff: 0.025, spin: 0 },
      { top: 0.78, edge: HANG + 0.11 / 0.25, teeth: 0.07 / 0.25, locks: 14, puff: 0.035, spin: 1.5, back: true },
    ],
    head: { y: 0.78, z: 0.36, scale: 1.25 },
    tail: { y: 0.74, z: -0.44 },
  };
  /**
   * A Highland cow: a shaggy coat of soft, overlapping drapes over a russet barrel, its ragged hem
   * hanging over the tops of short dark legs; a head with a long forelock falling over the eyes,
   * a dark muzzle and long upswept cream horns with dark tips, and a tufted tail. A calf (scale
   * under 0.8) takes the CALF build, a lighter ginger coat and horn buds. Every part is
   * 'fabric'. The head and tail hang from their own pivots, so they can move.
   */
  function highlandCow(g: T.Object3D, spec: plan.HerdMember) {
    const calf = spec.scale < 0.8,
      build = calf ? CALF : ADULT,
      tone = new T.Color(calf ? COAT.calf : COAT.coat),
      seed = plan.herd.indexOf(spec) * 1000 + 17;
    const cow = new T.Group();
    cow.name = spec.id;
    cow.position.set(spec.x, plan.terrainHeight(spec.x, spec.z), spec.z);
    cow.rotation.y = spec.heading;
    cow.scale.setScalar(spec.scale);
    g.add(cow);
    const coat = (geo: T.BufferGeometry, parent: T.Object3D = cow) => {
      const m = new T.Mesh(geo, material('#ffffff', 'fabric'));
      m.castShadow = m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    coat(coatCore(build.shape, tone));
    coat(shaggyCoat(build.shape, tone, seed, build.drapes));
    const L = build.legs;
    for (const sx of [-L.x, L.x]) for (const sz of [-L.z, L.z]) box(cow, sx, L.h / 2, sz, L.w, L.h, L.w, COAT.dark, 'fabric'); // the bake darkens the feet
    const head = new T.Group();
    head.name = spec.id + '-head';
    head.position.set(0, build.head.y, build.head.z);
    head.scale.setScalar(build.head.scale);
    head.userData.restY = build.head.y;
    cow.add(head);
    box(head, 0, -0.02, 0.22, 0.38, 0.34, 0.4, tone.getStyle(), 'fabric', { bevel: 0.1 }); // skull
    box(head, 0, -0.13, 0.44, 0.32, 0.2, 0.16, COAT.muzzle, 'fabric', { bevel: 0.06 }); // muzzle
    coat(forelock(tone, seed, calf), head);
    const bud = new T.Color(palette.trim).lerp(new T.Color(COAT.tips), 0.6).getStyle();
    for (const s of [-1, 1]) {
      box(head, s * 0.25, 0.04, 0.16, 0.18, 0.06, 0.1, tone.getStyle(), 'fabric', { rz: -s * 0.35 }); // ears, drooping out under the horns
      // A calf's horn buds: small rounded nubs, muted toward the coat's ginger, half sunk in the
      // crown among the forelock's roots (sharp cones there read as a hedgehog's spines, and
      // nubs on bare skull as a pair of eyes).
      if (calf) sphere(head, s * 0.13, 0.15, 0.1, 0.024, bud, 'fabric').scale.set(1, 1.2, 1);
      else horn(head, [[0.15, 0.12, 0.14], [0.42, 0.17, 0.24], [0.55, 0.38, 0.28], [0.59, 0.5, 0.29]].map(([x, y, z]) => new T.Vector3(s * x, y, z)), 0.065, palette.trim, palette.woodDark);
    }
    const tail = new T.Group();
    tail.name = spec.id + '-tail';
    tail.position.set(0, build.tail.y, build.tail.z);
    cow.add(tail);
    box(tail, 0, -0.21, 0, 0.07, 0.42, 0.07, tone.getStyle(), 'fabric').userData.noShadow = true; // strand: like the tuft it casts no shadow, so a tail is one mesh
    coat(paintByHeight(new T.IcosahedronGeometry(0.09, 1).scale(1, 1.4, 1), COAT.dark, () => 1), tail).position.y = -0.45; // tuft
    headPose(spec, head, 0);
    tailPose(spec, tail, 0);
    // Five animated pivots in all: each head, and each adult's tail (the calf's stays still).
    head.userData.keepSeparate = true;
    head.userData.herdPart = 'head';
    animated.push({ object: head, update: (time) => headPose(spec, head, time) });
    if (!calf) {
      tail.userData.keepSeparate = true;
      tail.userData.herdPart = 'tail';
      animated.push({ object: tail, update: (time) => tailPose(spec, tail, time) });
    }
  }
  /**
   * A head's idle at `time`: a slow graze cycle (about 40 s, with long holds) that lowers it to
   * the grass, or for the cow at the rack only to the hay; a chewing bob while it is down, a
   * look about while it is up and a rare ear-flick twitch. Reduced motion holds time 0.
   */
  function headPose(spec: plan.HerdMember, head: T.Object3D, time: number) {
    const { phase } = spec,
      s = sstep(0.5 + 0.5 * Math.sin(time * 0.16 + phase), 0.2, 0.8);
    // A grazing head drops (from its rest height) as well as dips, so the muzzle comes down to
    // about 0.05 over the grass instead of hanging over its own shadow.
    const rest = head.userData.restY as number;
    head.position.y = spec.eating ? rest : rest - 0.12 * s;
    head.rotation.x = (spec.eating ? mix(-0.06, 0.12, s) : mix(-0.08, 0.85, s)) + 0.03 * s * Math.sin(time * 5 + phase);
    // Both start from rest, so the held pose looks straight ahead along the body.
    head.rotation.y = 0.15 * (1 - s) * Math.cos(time * 0.23 + phase);
    head.rotation.z = 0.07 * Math.max(0, Math.sin(time * 0.9 + phase * 3 + 1)) ** 16;
  }
  /** A tail swishes in bursts; at time 0 (and so with reduced motion) every tail hangs still. */
  function tailPose(spec: plan.HerdMember, tail: T.Object3D, time: number) {
    const { phase } = spec;
    tail.rotation.z = 0.35 * Math.sin(time * 2.4 + phase) * sstep(Math.sin(time * 0.31 + phase * 1.7 + Math.PI), 0.55, 0.9);
  }
  /**
   * Dry-stone dykes: battered, rounded blocks about 0.7 long in the two greys (jittered in
   * height and turn), under a row of rounded cope stones set on edge. The top is about 0.5, so
   * the cows read over it.
   */
  function dyke(g: T.Object3D) {
    const wall = plan.paddock.wall;
    paddockRuns().forEach(([x, z, length, ry], r) => {
      const run = new T.Group();
      run.position.set(x, plan.terrainHeight(x, z), z);
      run.rotation.y = ry;
      g.add(run);
      const blocks = Math.max(1, Math.round(length / 0.7)),
        block = length / blocks,
        tops: number[] = [];
      for (let i = 0; i < blocks; i++) {
        const k = r * 17 + i,
          top = 0.35 + (hash(k * 3 + 1) - 0.5) * 0.06;
        tops.push(top);
        box(run, -length / 2 + (i + 0.5) * block, top / 2, 0, block, top, wall, PADDOCK.stone[hash(k * 3 + 3) < 0.5 ? 0 : 1], 'stone', { bevel: 0.06, taper: 0.035, ry: (hash(k * 3 + 2) - 0.5) * 0.06 });
      }
      // Copes about 0.3 long, abutting with no gaps: a finer row with gaps between the stones
      // falls below a pixel at overview zoom and flickers as the camera drifts. Each cope sinks
      // 0.02 into the lower of the blocks under it and stands over the higher; every other one
      // stands 0.0075 prouder, so abutting faces never share a plane.
      const copes = Math.max(1, Math.round(length / 0.3)),
        pitch = length / copes,
        under = (along: number) => tops[Math.min(blocks - 1, Math.max(0, Math.floor((along + length / 2) / block)))];
      for (let i = 0; i < copes; i++) {
        const along = -length / 2 + (i + 0.5) * pitch,
          ends = [under(along - pitch / 2 + 0.01), under(along + pitch / 2 - 0.01)],
          bottom = Math.min(...ends) - 0.02,
          top = Math.max(...ends) + 0.1 + 0.04 * hash(r * 101 + i * 7 + 1);
        box(run, along, (bottom + top) / 2, 0, pitch + 0.01, top - bottom, wall - (i % 2 ? 0.04 : 0.055), PADDOCK.cope, 'stone', { rz: (hash(r * 101 + i * 7) - 0.5) * 0.08 });
      }
    });
  }
  /** A field gate across the gateway: posts at the two wall ends, three rails and a brace on the paddock side. */
  function fieldGate(g: T.Object3D) {
    const P = plan.paddock,
      { x, width } = P.gate,
      z = P.z - P.d / 2;
    const gate = new T.Group();
    gate.position.set(x, plan.terrainHeight(x, z), z);
    g.add(gate);
    for (const s of [-1, 1]) box(gate, (s * width) / 2, 0.4, 0, 0.16, 0.8, 0.16, palette.woodDark, 'wood'); // posts take the wall ends
    for (const y of [0.2, 0.4, 0.6]) box(gate, 0, y, 0, width - 0.1, 0.08, 0.06, palette.wood, 'wood'); // rails, 0.03 into each post
    const run = width - 0.3,
      rise = 0.4;
    box(gate, 0, 0.4, 0.06, Math.hypot(run, rise), 0.07, 0.05, palette.wood, 'wood', { rz: Math.atan2(rise, run) }); // brace, clear of the rails' faces
  }
  /**
   * The hay rack against the west wall: an open trough on four legs, heaped with loose hay, and
   * a small square bale beside it. (A pantile hat on it caught the sun as the brightest thing in
   * the paddock, and the horns of the cow at the rack crossed it on screen.)
   */
  function hayRack(g: T.Object3D) {
    const { x, z } = plan.hayRack;
    const rack = new T.Group();
    rack.position.set(x, plan.terrainHeight(x, z), z);
    rack.rotation.y = Math.PI / 2; // local x runs along the wall (world z); local +z, the feeding side, faces the paddock
    g.add(rack);
    for (const sx of [-0.42, 0.42]) for (const sz of [-0.18, 0.18]) box(rack, sx, 0.275, sz, 0.1, 0.55, 0.1, palette.woodDark, 'wood');
    box(rack, 0, 0.42, 0, 1.0, 0.28, 0.5, palette.wood, 'wood'); // trough 0.28-0.56
    hayMound(rack);
    hayBale(g);
  }
  /**
   * Loose hay heaped over the trough's rim (top 0.56): a soft, lumpy mound, smooth-shaded so it
   * never reads as a cut stone, thatched all over with straws lying every which way in three
   * straw tones and a fringe of straws drooping over the rim.
   */
  function hayMound(rack: T.Object3D) {
    const tones = [PADDOCK.hayShade, PADDOCK.hay, PADDOCK.hayPale].map((c) => new T.Color(c)),
      geo = new T.IcosahedronGeometry(1, 2),
      p = geo.getAttribute('position'),
      n = geo.getAttribute('normal'),
      out = new Float32Array(p.count * 3),
      half = new T.Vector3(0.46, 0.19, 0.22),
      normal = new T.Vector3(),
      c = new T.Color();
    // Broad lumps: the heap's surface at unit direction u, and its outward normal there.
    const lump = (ux: number, uz: number) => 1 + (noise2(ux * 2.2 + 3.1, uz * 2.2 + 7.3) - 0.5) * 0.36;
    const at = (ux: number, uy: number, uz: number, target: T.Vector3) => {
      const k = lump(ux, uz);
      return target.set(half.x * ux * k, 0.56 + half.y * Math.max(uy, -0.4) * k, half.z * uz * k);
    };
    for (let i = 0; i < p.count; i++) {
      const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
      at(ux, uy, uz, normal);
      p.setXYZ(i, normal.x, normal.y, normal.z);
      normal.set(ux / half.x, uy / half.y, uz / half.z).normalize();
      n.setXYZ(i, normal.x, normal.y, normal.z);
      c.copy(tones[0]).lerp(tones[1], 0.35 + 0.5 * sstep(uy, -0.3, 0.6));
      out.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new T.BufferAttribute(out, 3));
    const mound = new T.Mesh(geo, material('#ffffff', 'foliage'));
    mound.userData.noShadow = true;
    mound.receiveShadow = true;
    rack.add(mound);
    const straws: Lock[] = [],
      u = new T.Vector3(),
      root = new T.Vector3(),
      up = new T.Vector3(0, 1, 0);
    const straw = (k: number, ux: number, uy: number, uz: number, droop: number) => {
      u.set(ux, uy, uz).normalize();
      at(u.x, u.y, u.z, root);
      const out = new T.Vector3(u.x / half.x, u.y / half.y, u.z / half.z).normalize(),
        spin = hash(k * 13 + 3) * Math.PI * 2,
        side = new T.Vector3().crossVectors(out, up).normalize(),
        across = new T.Vector3().crossVectors(side, out),
        dir = side.multiplyScalar(Math.cos(spin)).addScaledVector(across, Math.sin(spin)).addScaledVector(up, -droop).normalize(),
        len = 0.16 + 0.1 * hash(k * 13 + 4),
        tone = tones[Math.floor(hash(k * 13 + 5) * 3)];
      straws.push({ root: root.clone().addScaledVector(dir, -len * 0.4).addScaledVector(out, 0.012), dir, across: out.clone().cross(dir), len, w: 0.038, t: 0.02, base: tone.clone().multiplyScalar(0.92), tip: tone, point: 0.25, out });
    };
    // Thatch spread evenly over the heap (a golden-angle spiral, a little jittered).
    for (let k = 0; k < 48; k++) {
      const a = k * 2.39996 + hash(k * 13 + 1) * 0.6,
        rise = 0.12 + (0.86 * (k + 0.5)) / 48,
        r = Math.sqrt(1 - rise * rise);
      straw(k, Math.cos(a) * r, rise, Math.sin(a) * r, 0.15);
    }
    // A fringe drooping over the rim all round.
    for (let k = 0; k < 16; k++) {
      const a = ((k + 0.6 * hash(k * 17 + 900)) / 16) * Math.PI * 2;
      straw(100 + k, Math.cos(a), -0.05, Math.sin(a), 1.4);
    }
    const loose = new T.Mesh(lockGeometry(straws), material('#ffffff', 'foliage'));
    loose.userData.noShadow = true;
    loose.receiveShadow = true;
    rack.add(loose);
  }
  /**
   * A small square bale beside the rack, 0.3 wide, 0.26 high and 0.44 long (along local z): three
   * chunky pressed flakes of straw in the rack hay's own tone, well rounded and each a little off
   * in height, width, turn and shade, so the seams between them are soft and uneven; two thin
   * sisal twines running lengthwise over the top and down the cut ends; and loose straws bristling
   * from the ends and poking up off the top edges, breaking the box's outline. (A single
   * pillow-bevelled block with dark straps across it read as a suitcase; five even flakes with
   * crisp seams, pale tan, as a slatted crate.)
   */
  function hayBale(g: T.Object3D) {
    const { x, z, ry } = plan.hayBale,
      bale = new T.Group(),
      W = 0.3,
      H = 0.26,
      L = 0.44,
      twine = '#b59a6c',
      tones = [PADDOCK.hayShade, PADDOCK.hay, PADDOCK.hayPale].map((c) => new T.Color(c)),
      // A flake's tone: the rack hay, a touch toward the shade (t < 0) or the pale straw (t > 0).
      flakeTone = (t: number) => new T.Color(PADDOCK.hay).lerp(tones[t < 0 ? 0 : 2], Math.abs(t)).getStyle();
    bale.position.set(x, plan.terrainHeight(x, z), z);
    bale.rotation.y = ry;
    g.add(bale);
    let top = 0,
      at = -L / 2;
    for (const f of [
      { l: 0.155, h: H + 0.004, w: W + 0.004, dx: 0.004, turn: 0.035, t: 0.1 },
      { l: 0.14, h: H - 0.01, w: W - 0.008, dx: -0.006, turn: -0.045, t: -0.12 },
      { l: 0.145, h: H, w: W, dx: 0.002, turn: 0.02, t: 0.04 },
    ]) {
      top = Math.max(top, f.h);
      box(bale, f.dx, f.h / 2, at + f.l / 2, f.w, f.h, f.l + 0.004, flakeTone(f.t), 'foliage', { bevel: 0.045, segments: 2, ry: f.turn });
      at += f.l;
    }
    // Twines, lengthwise over the top and down both cut ends, standing just proud of the straw.
    for (const tx of [-0.075, 0.075]) {
      box(bale, tx, top + 0.002, 0, 0.022, 0.008, L + 0.014, twine, 'fabric', { bevel: 0 });
      for (const s of [-1, 1]) box(bale, tx, top / 2, s * (L / 2 + 0.003), 0.022, top + 0.008, 0.008, twine, 'fabric', { bevel: 0 });
    }
    // Short cut straws bristling from each end, mostly outward, a few drooping; and loose ones
    // poking up and out off the top's long edges.
    const straws: Lock[] = [],
      straw = (k: number, root: T.Vector3, dir: T.Vector3, len: number, out: T.Vector3) => {
        const tone = tones[Math.floor(hash(k) * 3)];
        straws.push({ root, dir: dir.normalize(), across: new T.Vector3(1, 0, 0).cross(dir).lengthSq() > 0.01 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, 1), len, w: 0.03, t: 0.016, base: tone.clone().multiplyScalar(0.92), tip: tone, point: 0.25, out, soft: 1.5 });
      };
    for (const s of [-1, 1])
      for (let i = 0; i < 6; i++) {
        const k = (s + 1) * 50 + i * 7 + 720;
        straw(k, new T.Vector3((hash(k + 4) - 0.5) * (W - 0.06), 0.03 + hash(k + 5) * (H - 0.06), s * (L / 2 - 0.02)), new T.Vector3((hash(k + 1) - 0.5) * 0.9, (hash(k + 2) - 0.6) * 0.8, s), 0.065 + 0.04 * hash(k + 3), new T.Vector3(0, 0, s));
      }
    for (const s of [-1, 1])
      for (let i = 0; i < 5; i++) {
        const k = (s + 1) * 50 + i * 7 + 860;
        straw(k, new T.Vector3(s * (W / 2 - 0.03), top - 0.012, -L / 2 + 0.05 + ((i + hash(k + 4)) / 5) * (L - 0.1)), new T.Vector3(s * (0.5 + 0.5 * hash(k + 1)), 0.5 + 0.6 * hash(k + 2), (hash(k + 5) - 0.5) * 1.2), 0.06 + 0.05 * hash(k + 3), new T.Vector3(s, 1, 0).normalize());
      }
    const loose = new T.Mesh(lockGeometry(straws), material('#ffffff', 'foliage'));
    loose.userData.noShadow = true;
    loose.receiveShadow = true;
    bale.add(loose);
  }
  /**
   * A static Scottish Blackface sheep, about 0.66 tall at the fleece: three lumpy cream fleece
   * lumps (a creamy top, a darker belly and creases where they meet, a ragged hem), a black face
   * with curled pale horns and little ears, black legs and a tail. Grazing ones hold the nose to
   * the grass. Everything is 'fabric', so the whole flock batches with the land.
   */
  function blackfaceSheep(g: T.Object3D, spec: plan.SheepSpec, index: number) {
    const root = new T.Group();
    // Stand 0.02 into the built ground under the lowest hoof: the terrain mesh runs a little below
    // the smooth terrainHeight it samples on a hilltop, so a hoof placed by that would float.
    root.position.set(spec.x, Math.min(...plan.sheepFeet(spec).map(([x, z]) => groundY(x, z))) - 0.02, spec.z);
    root.rotation.y = spec.heading;
    g.add(root);
    const face = '#3b3633',
      horn = '#cfc6b0',
      top = new T.Color(palette.white),
      tone = new T.Color('#ece3cf'),
      under = new T.Color('#c9bfa6'),
      c = new T.Color();
    // Fleece: body, shoulders and rump as [x, y, z, r, sx, sy, sz].
    const lumps = [[0, 0.42, 0, 0.24, 1, 0.85, 1.35], [0, 0.47, 0.17, 0.19, 1, 1, 1], [0, 0.46, -0.17, 0.2, 1, 1, 1]];
    const geos = lumps.map(([x, y, z, r, sx, sy, sz], k) => {
      const geo = new T.IcosahedronGeometry(r, 1),
        p = geo.getAttribute('position');
      // A ragged hem: lower vertices pushed down by a hash of their position (shared corners move together).
      for (let i = 0; i < p.count; i++)
        if (p.getY(i) < -0.4 * r) p.setY(i, p.getY(i) - 0.035 * hash(Math.round(p.getX(i) * 997) + Math.round(p.getZ(i) * 613) * 3 + k * 7));
      return geo.scale(sx, sy, sz).rotateY(hash(index * 3 + k) * 0.6).translate(x, y, z);
    });
    for (const geo of geos) {
      const p = geo.getAttribute('position'),
        n = geo.getAttribute('normal'),
        out = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          y = p.getY(i),
          z = p.getZ(i),
          v = sstep(y, 0.24, 0.66);
        let f = mix(0.8, 1.04, sstep(v, 0.1, 0.9)); // from 0.8: the batch bake already darkens the belly
        lumps.forEach(([lx, ly, lz, r, sx, sy, sz], j) => {
          if (geos[j] === geo) return;
          const gap = Math.hypot((x - lx) / sx, (y - ly) / sy, (z - lz) / sz) - r;
          if (gap > 0) f *= 1 - 0.18 * (1 - sstep(gap, 0, 0.3 * r));
        });
        c.copy(tone).lerp(under, 0.4 * (1 - v)).lerp(top, 0.5 * sstep(v, 0.5, 1) * Math.max(0, n.getY(i)));
        out[i * 3] = c.r * f;
        out[i * 3 + 1] = c.g * f;
        out[i * 3 + 2] = c.b * f;
      }
      geo.setAttribute('color', new T.BufferAttribute(out, 3));
    }
    const fleece = new T.Mesh(mergeGeometries(geos)!, material('#ffffff', 'fabric'));
    fleece.castShadow = fleece.receiveShadow = true;
    root.add(fleece);
    for (const [lx, lz] of [[-0.1, 0.18], [0.1, 0.18], [-0.1, -0.18], [0.1, -0.18]]) box(root, lx, 0.13, lz, 0.08, 0.26, 0.08, face, 'fabric'); // legs, into the fleece
    box(root, 0, 0.44, -0.38, 0.08, 0.13, 0.06, palette.white, 'fabric', { rx: -0.35 }); // tail
    // Head: a pivot inside the shoulder lump, nose down to the grass when grazing.
    const head = new T.Group();
    head.position.set(0, spec.grazing ? 0.33 : 0.5, spec.grazing ? 0.31 : 0.3);
    head.rotation.x = spec.grazing ? 1.25 : 0.45;
    root.add(head);
    box(head, 0, 0.02, 0.1, 0.17, 0.19, 0.26, face, 'fabric', { bevel: 0.06 });
    for (const s of [-1, 1]) {
      box(head, s * 0.11, 0.05, 0.03, 0.1, 0.03, 0.05, face, 'fabric', { rz: s * 0.3 }); // ear
      // A curled horn in the side plane: the arc runs back, over the top and forward, open at the cheek.
      const geo = new T.TorusGeometry(0.06, 0.028, 6, 10, 1.5 * Math.PI).rotateZ(1.5 * Math.PI).rotateY(Math.PI / 2);
      const m = new T.Mesh(geo, material(horn, 'fabric'));
      m.position.set(s * 0.1, 0.07, 0.02);
      m.castShadow = m.receiveShadow = true;
      head.add(m);
    }
    return root;
  }
  /**
   * The standing-stone ring: grey slabs a little askew, broad faces to the centre, slightly
   * tapered, buried 0.08, paler and lichen-tinted towards the top; the recumbent lies on its side.
   */
  function standingStoneRing(g: T.Object3D) {
    const greys = ['#8f9a92', '#868f86', '#9aa196'],
      lichen = '#a9ad8c';
    plan.standingStones().forEach((s, k) => {
      const y = groundY(s.x, s.z),
        colour = greys[k % 3];
      const m = s.recumbent
        ? box(g, s.x, y + s.h / 2 - 0.05, s.z, s.w, s.h, 0.38, '#ffffff', 'stone', { bevel: 0.08, ry: s.ry, rz: 0.03 })
        : box(g, s.x, y + s.h / 2 - 0.08, s.z, s.w, s.h, 0.26, '#ffffff', 'stone', {
            bevel: 0.08,
            taper: 0.04,
            ry: s.ry,
            rz: (hash(k * 5 + 3) - 0.5) * 0.12,
            rx: (hash(k * 5 + 4) - 0.5) * 0.08,
          });
      bakeRamp(m, colour, 0.85, 1.02, lichen, 0.25);
    });
  }
  /** The pool's mid-line water as it reads through its pale surface, a shade darker (x 0.85), and the ripple's height. */
  const DUCK_RIPPLE = '#4696ac',
    DUCK_WATER = 0.078;
  /**
   * Mallards on the gate's pool (plan.ducks): a brown hen and a drake with a dark green head in
   * the south-east sector, a lone hen in the south-west. Each is a small rigid group (about 0.32
   * long), its origin the body's centre so the occasional tip toward the water pivots there; the
   * pool's surface cuts the body below the centre. The heading turns about the world's y and the
   * tip about the duck's own x (Euler order YXZ). Every part is matte fabric and casts nothing,
   * so the animated list's batching makes each duck one mesh. They paddle slowly on town time,
   * so reduced motion holds them still, and drift slower without tipping at night (roosting).
   */
  function pondDucks(g: T.Object3D) {
    const looks = {
      hen: { body: '#a98563', head: '#a98563', tail: palette.woodDark, bill: palette.pantile },
      drake: { body: '#cfc6b0', head: palette.greenDoor, tail: '#3b3633', bill: '#d8bd7a' },
    };
    plan.ducks.forEach((spec, i) => {
      const look = looks[spec.look],
        duck = new T.Group();
      duck.name = 'duck-' + i;
      duck.rotation.order = 'YXZ';
      g.add(duck);
      const body = new T.Mesh(new T.IcosahedronGeometry(0.1, 1).scale(1, 0.7, 1.6), material(look.body, 'fabric'));
      const head = new T.Mesh(new T.IcosahedronGeometry(0.06, 1), material(look.head, 'fabric'));
      head.position.set(0, 0.12, 0.11);
      duck.add(body, head);
      const bill = box(duck, 0, 0.105, 0.19, 0.07, 0.035, 0.08, look.bill, 'fabric'),
        tail = cone(duck, 0, 0.05, -0.17, 0.045, 0.09, look.tail, 'fabric', 4);
      tail.rotation.x = -1.2; // tipped back and up
      // The water round the duck: a flat oval a little wider than the body, just over the surface
      // (0.07), in the pool's own mid-line colour a shade darker, so the body sits in the water
      // with a waterline and a soft ring of disturbed water rather than on the pale pool like a
      // sticker. It is part of the duck's one mesh, so it tips with the duck's rare dip.
      const ripple = new T.Mesh(new T.CircleGeometry(1, 18).rotateX(-Math.PI / 2).scale(0.15, 1, 0.22).translate(0, DUCK_WATER - plan.DUCK_REST, -0.01), material(DUCK_RIPPLE, 'fabric'));
      duck.add(ripple);
      for (const m of [body, head, bill, tail, ripple]) {
        m.castShadow = false;
        m.receiveShadow = true;
        m.userData.noShadow = true;
      }
      let u = 0,
        last = 0;
      const update = (time: number, night: number) => {
        // Clamped steps, so a jump in time (a check, a long pause) never sends a duck flying.
        u += Math.min(0.1, Math.max(0, time - last)) * spec.rate * (1 - 0.6 * night);
        last = time;
        const p = plan.duckPose(i, u),
          b = plan.duckBob(i, time, night);
        duck.position.set(p.x, b.y, p.z);
        duck.rotation.set(b.dip, p.heading, 0);
      };
      update(0, 0);
      animated.push({ object: duck, update });
    });
  }
  return { highlandPaddock, lockGeometry, coatCore, shaggyCoat, forelock, horn, highlandCow, headPose, tailPose, dyke, fieldGate, hayRack, hayMound, hayBale, blackfaceSheep, standingStoneRing, pondDucks };
}
