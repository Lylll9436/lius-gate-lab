import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as plan from './town-plan';
import {
  palette,
  hash,
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
  const { box, cone, groundY } = kit;
  /**
   * The paddock's own colours, judged after the 0.72 grade: the dyke takes the beach boulders'
   * greys and the hay a dull straw (HSV s 0.45; a paler one read as an egg in the trough).
   */
  const PADDOCK = { stone: ['#b9b6a2', '#9da394'], cope: '#a3aaa0', hay: '#c4a86c' };
  /**
   * Highland coats: a muted ginger-russet (HSV s ≤ 0.61, no louder than the wood and the red
   * sandstone), a paler back and fringe, a dark belly and legs, a dark muzzle.
   */
  const COAT = { coat: '#ab6a42', light: '#c58a5c', dark: '#7a4b31', calf: '#b97a4c', muzzle: '#4f423a' };
  /** The paddock, its gate and hay rack, and the herd in it. */
  function highlandPaddock(g: T.Object3D) {
    dyke(g);
    fieldGate(g);
    hayRack(g);
    for (const animal of plan.herd) highlandCow(g, animal);
  }
  /** Hang the hem of a lump: vertices below `below` drop by a hashed amount up to `drop`; coincident corners drop together. */
  function shag(geo: T.BufferGeometry, below: number, drop: number) {
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < below) p.setY(i, y - drop * hash(Math.round(x * 97) * 7 + Math.round(y * 89) * 13 + Math.round(z * 83) * 3));
    }
    return geo;
  }
  /**
   * The coat's two-tone paint, after paintCanopy: a warm, paler back, a darker belly and creases
   * where the lumps meet. Lumps are [x, y, z, r, sx, sy, sz]; the value ramp starts at 0.8, not
   * 0.45, because the batch bake already darkens the belly.
   */
  function paintCoat(geos: T.BufferGeometry[], lumps: number[][], tone: string, y0: number, y1: number) {
    const base = new T.Color(tone), top = new T.Color(COAT.light), under = new T.Color(COAT.dark), c = new T.Color();
    geos.forEach((geo, k) => {
      const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), out = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), v = sstep(y, y0, y1);
        let f = mix(0.8, 1.05, sstep(v, 0.12, 0.88));
        lumps.forEach(([lx, ly, lz, r, sx, sy, sz], j) => {
          if (j === k) return;
          const gap = Math.hypot((x - lx) / sx, (y - ly) / sy, (z - lz) / sz) - r;
          if (gap > 0) f *= 1 - 0.14 * (1 - sstep(gap, 0, 0.3 * r));
        });
        c.copy(base).lerp(under, 0.3 * (1 - v)).lerp(top, 0.22 * sstep(v, 0.55, 1) * Math.max(0, n.getY(i)));
        out.set([c.r * f, c.g * f, c.b * f], i * 3);
      }
      geo.setAttribute('color', new T.BufferAttribute(out, 3));
    });
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
   * A Highland cow (local +z is the nose, about 1.65 nose to tail and 0.95 at the withers): a shaggy
   * barrel with shoulder and rump lumps on short legs, a head with a fringe over the eyes, a
   * dark muzzle and long upswept horns (nubs on a calf), and a tufted tail. Every part is
   * 'fabric'. The head and tail hang from their own pivots, so they can move.
   */
  function highlandCow(g: T.Object3D, spec: plan.HerdMember) {
    const calf = spec.scale < 0.8,
      tone = calf ? COAT.calf : COAT.coat;
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
    // Barrel, shoulder and rump: one coat, painted across the three lumps, with a ragged hem
    // that hangs over the tops of the legs. The shoulder and rump lumps stay inside the barrel's
    // outline seen from above and only lift its back line at the withers and the hips.
    const lumps = [[0, 0.58, 0, 0.44, 0.85, 0.74, 1.3], [0, 0.72, 0.3, 0.3, 0.9, 0.85, 1.0], [0, 0.7, -0.36, 0.3, 0.9, 0.8, 0.95]];
    const body = lumps.map(([x, y, z, r, sx, sy, sz]) => shag(new T.IcosahedronGeometry(r, 1), -0.06, 0.13).scale(sx, sy, sz).translate(x, y, z));
    paintCoat(body, lumps, tone, 0.3, 0.95);
    body.forEach((geo) => coat(geo));
    for (const sx of [-0.2, 0.2]) for (const sz of [-0.34, 0.34]) box(cow, sx, 0.15, sz, 0.17, 0.3, 0.17, COAT.dark, 'fabric'); // short legs; the bake darkens the feet
    const head = new T.Group();
    head.name = spec.id + '-head';
    head.position.set(0, 0.72, 0.5);
    cow.add(head);
    box(head, 0, -0.02, 0.22, 0.38, 0.34, 0.4, tone, 'fabric', { bevel: 0.1 }); // skull
    box(head, 0, -0.13, 0.44, 0.32, 0.2, 0.16, COAT.muzzle, 'fabric', { bevel: 0.06 }); // muzzle
    const f = calf ? 1.2 : 1;
    // The fringe over the eyes, drooping forward with a ragged hem (no separate locks: pointed
    // ones below it read as fangs over the muzzle).
    const fringe = shag(new T.IcosahedronGeometry(0.2, 1), -0.02, 0.12).scale(1.3 * f, 0.6 * f, 0.85 * f),
      forelock = new T.Color(tone).lerp(new T.Color(COAT.light), 0.45).getStyle(),
      bud = new T.Color(palette.trim).lerp(new T.Color(tone), 0.35).getStyle();
    const lock = coat(paintByHeight(fringe, forelock, (y) => mix(0.88, 1.04, sstep(y, -0.12, 0.12))), head);
    lock.position.set(0, 0.11, 0.35);
    lock.rotation.x = 0.3;
    for (const s of [-1, 1]) {
      box(head, s * 0.25, 0.04, 0.16, 0.18, 0.06, 0.1, tone, 'fabric', { rz: -s * 0.35 }); // ears, drooping out under the horns
      // A calf's horn buds: small, muted and well back on the crown, behind the fringe, so they
      // never sit where eyes would be.
      if (calf) cone(head, s * 0.12, 0.16, 0.07, 0.03, 0.07, bud, 'fabric', 6, 0).rotation.z = -s * 0.4;
      else horn(head, [[0.15, 0.12, 0.14], [0.42, 0.17, 0.24], [0.55, 0.38, 0.28], [0.59, 0.5, 0.29]].map(([x, y, z]) => new T.Vector3(s * x, y, z)), 0.065, palette.trim, palette.woodDark);
    }
    const tail = new T.Group();
    tail.name = spec.id + '-tail';
    tail.position.set(0, 0.8, -0.6);
    cow.add(tail);
    box(tail, 0, -0.21, 0, 0.07, 0.42, 0.07, tone, 'fabric').userData.noShadow = true; // strand: like the tuft it casts no shadow, so a tail is one mesh
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
    // A grazing head drops (from 0.72) as well as dips, so the muzzle comes down to about 0.05
    // over the grass instead of hanging over its own shadow.
    head.position.y = spec.eating ? 0.72 : 0.72 - 0.12 * s;
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
   * The hay rack against the west wall: an open trough of hay on four legs. (A pantile hat on it
   * caught the sun as the brightest thing in the paddock, and the horns of the cow at the rack
   * crossed it on screen.)
   */
  function hayRack(g: T.Object3D) {
    const { x, z } = plan.hayRack;
    const rack = new T.Group();
    rack.position.set(x, plan.terrainHeight(x, z), z);
    rack.rotation.y = Math.PI / 2; // local x runs along the wall (world z); local +z, the feeding side, faces the paddock
    g.add(rack);
    for (const sx of [-0.42, 0.42]) for (const sz of [-0.18, 0.18]) box(rack, sx, 0.275, sz, 0.1, 0.55, 0.1, palette.woodDark, 'wood');
    box(rack, 0, 0.42, 0, 1.0, 0.28, 0.5, palette.wood, 'wood'); // trough 0.28-0.56
    // The trough heaped with hay: a low, faceted pile inside its rim with a tufted top (shag()
    // hangs a hem, so the pile is flipped for it).
    const hay = shag(new T.IcosahedronGeometry(0.42, 1).rotateX(Math.PI), 0, 0.4).rotateX(Math.PI).scale(1.05, 0.3, 0.55);
    hay.computeVertexNormals();
    paintByHeight(hay, PADDOCK.hay, (y) => mix(0.8, 1.0, sstep(y, -0.12, 0.24)));
    const mound = new T.Mesh(hay, material('#ffffff', 'foliage'));
    mound.position.y = 0.56;
    mound.userData.noShadow = true;
    mound.receiveShadow = true;
    rack.add(mound);
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
  return { highlandPaddock, shag, paintCoat, horn, highlandCow, headPose, tailPose, dyke, fieldGate, hayRack, blackfaceSheep, standingStoneRing };
}
