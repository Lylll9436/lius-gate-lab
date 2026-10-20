import * as T from 'three';
import * as plan from './town-plan';
import type { Season } from './glasgow-sun';
import { palette, hash, type TownContext } from './town-shared';
import type { SurfaceKind } from './city-materials';
import type { Bay, Kit, Piece } from './town-kit';
import { bakeRamp, type Nature } from './town-nature';

/** A colour with its HSL saturation cut by `k` (0..1): window-box blooms and painted boxes stay calmer than the beds. */
export function muted(hex: string, k: number) {
  const c = new T.Color(hex), hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return '#' + c.setHSL(hsl.h, hsl.s * (1 - k), hsl.l).getHexString();
}
/**
 * What the window boxes hold through the year: a leafy mound (`leaf`, lime `top`) with blooms from
 * palette.flowers, muted, from spring to autumn (daffodil yellow and primrose white in spring,
 * geranium red and pink in summer, pansy purple and gold in autumn), and in winter dark evergreen
 * sprigs with a few tufts of winter heather.
 */
type V3 = [number, number, number];
const [RED, YELLOW, PINK, WHITE, PURPLE] = palette.flowers;
export const WINDOW_BOX: Record<Season, { leaf: string; top: string; blooms: string[]; sprigs: number }> = {
  spring: { leaf: '#5b8a34', top: '#93bb3a', blooms: [YELLOW, WHITE, YELLOW, PINK, YELLOW].map((c) => muted(c, 0.3)), sprigs: 0 },
  summer: { leaf: '#4f7f2e', top: '#86b234', blooms: [RED, PINK, WHITE, RED, PURPLE].map((c) => muted(c, 0.3)), sprigs: 0 },
  autumn: { leaf: '#5a7634', top: '#8a9a3e', blooms: [PURPLE, YELLOW, PURPLE, WHITE].map((c) => muted(c, 0.3)), sprigs: 0 },
  winter: { leaf: '#3f6236', top: '#5e7f45', blooms: ['#b48aa2', '#b48aa2'], sprigs: 2 },
};
/** The cottage (plan.cottages index) with ivy on its blank +x gable. */
export const IVY_COTTAGE = 0;
/** A small smooth blob (20 triangles): a window-box bloom, heather tuft or trailing leaf. */
const blobGeometry = (() => {
  const g = new T.IcosahedronGeometry(1, 0);
  g.setAttribute('normal', g.getAttribute('position').clone());
  g.normalizeNormals();
  return g;
})();

/**
 * Each terrace home's back green (the lawn between its back wall and the beach) has a washing line,
 * in the home's own frame (front +z): two T-posts `back` behind the wall face, `half` either side of
 * the home's middle (well inside its 2.6 width, so never in a gap between homes), and two lines
 * `spread` either side of the crossbars' middle, `height` up. From the People chapter (and its idle
 * drift) the home hides it all: posts 0.95 out and 1.4 back peeked past a home's corner into the gap
 * beside it, a pole with a crossbar and a cloth that read like a little sign.
 */
export const WASHING = { back: 1.15, half: 0.6, height: 1.45, spread: 0.15 };
type Garment = 'sheet' | 'towel' | 'shirt' | 'cloth';
/**
 * What hangs on each home's lines (by its seed): [line (-1 the beach side, 1 the house side), what,
 * x along the line, colour, stripe]. Muted colours, each within a palette family (white, sandstone,
 * glass, brass, heather, hedge); the two lines' pieces never overlap along the line.
 */
const LAUNDRY: [number, Garment, number, string, string?][][] = [
  [[-1, 'sheet', -0.22, '#ece6d8'], [-1, 'towel', 0.33, '#cf9a80', '#b07a64'], [1, 'shirt', 0.12, '#a9bccb']],
  [[-1, 'towel', -0.33, '#d8bc7c', '#b39858'], [-1, 'sheet', 0.2, '#dfe3d6'], [1, 'shirt', -0.22, '#efe9dc'], [1, 'cloth', 0.36, '#c9b8a8', '#a08878']],
  [[-1, 'shirt', -0.27, '#b7a6bf'], [-1, 'sheet', 0.26, '#e8e0d0'], [1, 'towel', 0, '#9fb3a0', '#7f977f']],
];

/* ------------------------------------------------------------------ */
/* Homes: the terrace row and the cottages                             */
/* ------------------------------------------------------------------ */
export function createHomes(ctx: TownContext, kit: Kit, nature: Nature) {
  const { material, season, animated } = ctx;
  const { box, cylinder, cone, sphere, slabRoof, frameRing, quoins, plinth, bayOutline, cantedPrism, bayFaces, sash, bayRoof, ivy, prism, chamfered, cluster, rod, slopeFrame, stack } = kit;
  const { hedge, flowerBed } = nature;
  /** A blob of radius r, squashed to `squash` of its height, that casts no shadow. */
  function blob(g: T.Object3D, x: number, y: number, z: number, r: number, colour: string, squash = 0.75) {
    const m = new T.Mesh(blobGeometry, material(colour, 'foliage'));
    m.position.set(x, y, z);
    m.scale.set(r, r * squash, r);
    m.rotation.y = hash(x * 17 + z * 5) * 3;
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.noShadow = true;
    g.add(m);
    return m;
  }
  /**
   * A window box on a face (local +z out of the wall): a painted timber box `length` long and
   * `depth` deep from its back at z, its foot at y, holding a leafy mound and the season's planting
   * (WINDOW_BOX). It stands in front of the window frame and below the glass: seen from the town's
   * camera (42.6 degrees down) the planting's tops fall below the glass's foot.
   */
  function windowBox(g: T.Object3D, x: number, y: number, z: number, length: number, depth: number, paint: string, seed: number) {
    const H = 0.12,
      look = WINDOW_BOX[season],
      zc = z + depth / 2;
    box(g, x, y + H / 2, zc, length, H, depth, paint, 'paint');
    bakeRamp(box(g, x, y + H + 0.015, zc, length - 0.05, 0.07, depth - 0.035, '#ffffff', 'foliage', { bevel: 0.03 }), look.leaf, 0.85, 1.05, look.top, 0.4);
    // Fewer, fatter blooms read as flowers; a row of small ones reads as beads. Each stays inside
    // the box's front face (r at most 0.55 of its depth).
    const n = Math.max(3, Math.round(length / 0.17)),
      top = y + H + 0.04,
      big = Math.min(0.064, depth * 0.52);
    for (let i = 0; i < n; i++) {
      const r = big * (0.85 + 0.15 * hash(seed + i * 5)),
        along = ((i + 0.5) / n - 0.5) * (length - 2 * big - 0.02) + (hash(seed + i * 11) - 0.5) * 0.03,
        across = (hash(seed + i * 7) - 0.5) * Math.max(0, depth - 2 * r - 0.01);
      if (look.sprigs && i % 2 === 0) {
        // Winter: a little dark conifer sprig between the heather tufts.
        const sprig = cone(g, x + along, top + 0.045, zc + across, r * 0.8, 0.15, '#3a5a34', 'foliage', 6, hash(seed + i));
        sprig.castShadow = false;
        sprig.userData.noShadow = true;
      } else blob(g, x + along, top + 0.01 * hash(seed + i * 3), zc + across, r, look.blooms[(seed + i) % look.blooms.length]);
    }
  }
  /** A piece of cloth hung from y = 0 (its top edge on the line): a thin slab with soft vertical folds, casting nothing. */
  function cloth(g: T.Object3D, x: number, z: number, w: number, h: number, colour: string, folds: number, y = 0) {
    const geo = new T.BoxGeometry(w, h, 0.025, folds, 1, 1),
      p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 0.016 * Math.sin((p.getX(i) / w + 0.5) * Math.PI * folds));
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, material(colour, 'fabric'));
    m.position.set(x, y - h / 2 - 0.004, z);
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.noShadow = true;
    g.add(m);
    return m;
  }
  /**
   * The back green's washing: two painted T-posts (part of the home) and, between their crossbars,
   * two lines with the home's LAUNDRY. The lines and the washing are one group pivoting on the
   * crossbars' middle, so the frame loop sways it by turning that one group a little (no vertex is
   * moved), and takes it all in, lines and all, while it rains (as a Glasgow back court's ropes were
   * put up on washing day). It casts nothing, like the drying net on the beach.
   */
  function washingLine(shell: T.Group, d: number, seed: number) {
    const { back, half, height: H, spread } = WASHING,
      z = -(d / 2 + back),
      pole = '#8f8270'; // weathered paint, between the lawn and the stone in value
    for (const s of [-1, 1]) {
      box(shell, s * half, (H + 0.07) / 2, z, 0.08, H + 0.07, 0.08, pole, 'paint');
      box(shell, s * half, H, z, 0.07, 0.07, 2 * spread + 0.12, pole, 'paint');
    }
    const wash = new T.Group();
    wash.name = 'washing';
    wash.position.set(0, H, z);
    wash.userData.keepSeparate = true;
    shell.add(wash);
    for (const s of [-1, 1]) {
      // Each end buried in a crossbar; a gentle sag between.
      const curve = new T.QuadraticBezierCurve3(new T.Vector3(-half, 0, s * spread), new T.Vector3(0, -0.07, s * spread), new T.Vector3(half, 0, s * spread)),
        line = new T.Mesh(new T.TubeGeometry(curve, 8, 0.012, 4), material('#e9e4d8', 'fabric'));
      line.castShadow = false;
      line.userData.noShadow = true;
      wash.add(line);
    }
    const sag = (x: number) => -0.07 * (1 - (x / half) ** 2);
    for (const [s, what, x, colour, stripe] of LAUNDRY[seed % LAUNDRY.length]) {
      const lz = s * spread,
        y = sag(x);
      if (what === 'sheet') cloth(wash, x, lz, 0.5, 0.48, colour, 4, y);
      else if (what === 'towel' || what === 'cloth') {
        const [w, h] = what === 'towel' ? [0.28, 0.44] : [0.24, 0.3];
        cloth(wash, x, lz, w, h, colour, 2, y);
        box(wash, x, y - h + 0.08, lz, w + 0.004, 0.05, 0.03, stripe ?? colour, 'fabric').userData.noShadow = true;
      } else {
        // A shirt pegged by its shoulders: the body and two sleeves hanging out and down.
        cloth(wash, x, lz, 0.32, 0.36, colour, 2, y);
        for (const side of [-1, 1]) {
          const sleeve = box(wash, x + side * 0.2, y - 0.1, lz, 0.12, 0.17, 0.022, colour, 'fabric', { rz: side * 0.5 });
          sleeve.castShadow = false;
          sleeve.userData.noShadow = true;
        }
      }
    }
    wash.traverse((o) => { if (o instanceof T.Mesh) o.castShadow = false; });
    const phase = seed * 1.7;
    const update = (time: number, _night: number, rain = 0) => {
      // Taken in once the rain sets in: hidden, and shrunk to its pivot so Inspect's copy (which
      // follows the group's pose, not its visibility) is taken in with it.
      const dry = rain < 0.25;
      wash.visible = dry;
      wash.scale.setScalar(dry ? 1 : 1e-3);
      // A breeze off the sea: a slight lean toward the house and a slow, uneven sway.
      wash.rotation.x = -0.05 + 0.06 * Math.sin(time * 1.1 + phase) + 0.025 * Math.sin(time * 2.6 + phase * 2);
    };
    update(0, 0, 0);
    animated.push({ object: wash, update });
  }
  /* ---------------------------------------------------------------- */
  /* Dressings: windows, doors, skews and rainwater goods               */
  /* ---------------------------------------------------------------- */
  /** A tapered keystone, 0.16 at its foot and 0.22 at its head, 0.28 tall from 0.04 under the head of the opening, 0.21 out. */
  const KEYSTONE = prism([[-0.08, -0.04], [0.08, -0.04], [0.11, 0.24], [-0.11, 0.24]], 0.21, 0.02);
  /** A railing newel's ball finial, and a downpipe's socket. */
  const BALL = new T.IcosahedronGeometry(0.05, 1),
    SOCKET = new T.CylinderGeometry(0.06, 0.06, 0.07, 8);
  /**
   * A dressed sash window on a face (local +z out of the wall face at z), its opening w x h about
   * (x, y): the sash (sash(): a slim painted frame 0.07 proud, two panes and a meeting rail, one
   * light at night as `group`) set back in a stone architrave 0.11 wide and 0.13 proud, so its
   * reveal reads; a sill 0.2 proud on two corbels; and a lintel 0.17 proud over it, with a tapered
   * keystone 0.04 prouder still if asked. The architrave is a mesh of its own; the sill, corbels,
   * lintel and keystone go into `stone` (one cluster per face). Returns the panes.
   */
  function dressedWindow(g: T.Object3D, x: number, y: number, z: number, w: number, h: number,
    o: { frame: string; dress: string; group: string; keystone?: boolean; corbels?: boolean }, stone: Piece[]) {
    const before = g.children.length;
    sash(g, x, y, z, w, h, o.frame, { group: o.group, deep: 0.07 });
    const panes = g.children.slice(before).filter((p) => p.userData.sashPane);
    frameRing(g, x, y, z, w + 0.1, h + 0.1, 0.11, 0.13, o.dress, 'stone');
    const half = w / 2 + 0.16,
      foot = y - h / 2 - 0.16,
      head = y + h / 2 + 0.16;
    stone.push({ geometry: chamfered(2 * half + 0.12, 0.1, 0.2), at: [x, foot - 0.05, z + 0.1] });
    if (o.corbels !== false) for (const s of [-1, 1]) stone.push({ geometry: chamfered(0.1, 0.12, 0.13), at: [x + s * (half - 0.03), foot - 0.16, z + 0.065] });
    stone.push({ geometry: chamfered(2 * half + 0.12, 0.17, 0.17), at: [x, head + 0.085, z + 0.085] });
    if (o.keystone) stone.push({ geometry: KEYSTONE, at: [x, head, z] });
    return panes;
  }
  /**
   * Steps from a door's sill y (on the plinth, `landing` deep in front of it) down to the ground at
   * x on the wall face at z: each a stone riser under a tread of `tread` stone whose nosing overhangs
   * it 0.04 at the front and 0.03 at each end. Returns each step's [top, front] (from z).
   */
  function steps(g: T.Object3D, x: number, y: number, z: number, landing: number, width: number, tread: string) {
    const n = Math.max(1, Math.round(y / 0.14)),
      treads: Piece[] = [],
      out: [number, number][] = [];
    for (let i = 1; i < n; i++) {
      const top = y - (i * y) / n,
        front = landing + i * 0.3,
        wide = width + i * 0.08;
      box(g, x, (top - 0.05) / 2, z + (front - 0.05) / 2, wide, top - 0.05, front + 0.05, palette.plinth, 'stone');
      treads.push({ geometry: chamfered(wide + 0.06, 0.06, front + 0.09), at: [x, top - 0.03, z + (front - 0.01) / 2] });
      out.push([top, front]);
    }
    cluster(g, treads, tread, 'stone');
    return out;
  }
  /**
   * A Glasgow main door on the wall face at z, its opening w x h over the sill y (the plinth's
   * landing): a four-panel enamelled leaf (raised stiles and rails round two fielded panels) under
   * a painted transom and a three-light fanlight; a stone doorpiece of two pilasters on bases, with
   * capitals carrying a frieze and a cornice hood 0.32 proud (within the old surround's reach, so
   * the bay beside it keeps its clearance); and the steps, between simple cast-iron railings (a
   * newel with a ball on each step, a sloping handrail and one baluster), which go into `iron`.
   */
  function mainDoor(g: T.Object3D, x: number, y: number, z: number, w: number, h: number, colour: string, dress: string, iron: Piece[], group: string) {
    const leaf = h - 0.44,
      fan = h - leaf - 0.08;
    const enamel: Piece[] = [{ geometry: chamfered(w - 0.02, leaf, 0.08), at: [x, y + leaf / 2, z + 0.05] }];
    for (const s of [-1, 1]) enamel.push({ geometry: chamfered(0.11, leaf, 0.04), at: [x + s * (w / 2 - 0.065), y + leaf / 2, z + 0.11] });
    for (const [at, tall] of [[0.08, 0.16], [0.61, 0.1], [leaf - 0.05, 0.1]]) enamel.push({ geometry: chamfered(w - 0.24, tall, 0.04), at: [x, y + at, z + 0.11] });
    for (const [y0, y1] of [[0.16, 0.56], [0.66, leaf - 0.1]]) enamel.push({ geometry: chamfered(w - 0.3, y1 - y0 - 0.06, 0.03), at: [x, y + (y0 + y1) / 2, z + 0.105] });
    cluster(g, enamel, colour, 'enamel');
    sphere(g, x + w / 2 - 0.065, y + 0.62, z + 0.17, 0.045, palette.brass, 'brass');
    cluster(g, [
      { geometry: chamfered(w, 0.08, 0.1), at: [x, y + leaf + 0.04, z + 0.05] },
      ...[-1, 1].map((s): Piece => ({ geometry: chamfered(0.07, fan, 0.05), at: [x + (s * w) / 6, y + leaf + 0.08 + fan / 2, z + 0.065] })),
    ], dress, 'paint');
    const pane = new T.Mesh(new T.PlaneGeometry(w, fan + 0.01), material(palette.glass, 'glass'));
    pane.position.set(x, y + leaf + 0.08 + fan / 2, z + 0.035);
    pane.userData.sashPane = true;
    pane.userData.windowGroup = group;
    g.add(pane);
    const stone: Piece[] = [];
    for (const s of [-1, 1]) {
      const px = x + s * (w / 2 + 0.09);
      stone.push(
        { geometry: chamfered(0.24, 0.16, 0.26), at: [px, y + 0.08, z + 0.13] },
        { geometry: chamfered(0.18, h - 0.16, 0.2), at: [px, y + 0.16 + (h - 0.16) / 2, z + 0.1] },
        { geometry: chamfered(0.24, 0.1, 0.26), at: [px, y + h + 0.05, z + 0.13] },
      );
    }
    stone.push(
      { geometry: chamfered(w + 0.42, 0.16, 0.22), at: [x, y + h + 0.18, z + 0.11] },
      { geometry: chamfered(w + 0.56, 0.11, 0.32), at: [x, y + h + 0.315, z + 0.16] },
    );
    cluster(g, stone, dress, 'stone');
    const [[t1, f1], [t2, f2]] = steps(g, x, y, z, 0.25, 1.0, dress),
      z0 = z + f1 - 0.25, // the top newel, on the first step behind its nosing
      z1 = z + (f1 + f2) / 2 - 0.02; // the foot newel, on the second
    for (const s of [-1, 1]) {
      const rx = x + s * 0.5,
        top0 = y + 0.53,
        top1 = t2 + 0.42,
        mid = (z0 + z1) / 2;
      iron.push(
        { geometry: chamfered(0.09, top0 - t1, 0.09), at: [rx, (t1 + top0) / 2, z0] },
        { geometry: BALL, at: [rx, top0 + 0.04, z0] },
        { geometry: chamfered(0.09, top1 - t2, 0.09), at: [rx, (t2 + top1) / 2, z1] },
        { geometry: BALL, at: [rx, top1 + 0.04, z1] },
        rod([rx, top0 - 0.05, z0], [rx, top1 - 0.04, z1], 0.035),
        rod([rx, t1, mid], [rx, (top0 + top1) / 2 - 0.045, mid], 0.035),
      );
    }
  }
  /**
   * A cast-iron downpipe (into `iron`): from a gutter's outlet at `from` a short drop, a swan neck
   * at 45 degrees to `wall` (the pipe's line by the wall), the pipe down to the plinth course and a
   * shoe kicked out by `kick`; sockets with holdfast ears every 0.75 reach `ear` back to the wall.
   */
  function downpipe(iron: Piece[], from: V3, wall: [number, number], kick: [number, number], ear: [number, number]) {
    const [gx, gy, gz] = from,
      [wx, wz] = wall,
      run = Math.hypot(wx - gx, wz - gz),
      y1 = gy - 0.12,
      y2 = y1 - run;
    // Each length runs a radius past its bends, so the joints close without elbows.
    const ux = (wx - gx) / Math.max(run, 1e-6),
      uz = (wz - gz) / Math.max(run, 1e-6),
      e = 0.03;
    iron.push(
      rod([gx, gy + 0.02, gz], [gx, y1 - e, gz], 0.04),
      rod([gx - ux * e, y1 + e, gz - uz * e], [wx + ux * e, y2 - e, wz + uz * e], 0.04),
      rod([wx, y2 + e, wz], [wx, 0.56, wz], 0.045),
      rod([wx, 0.6, wz], [wx + kick[0], 0.48, wz + kick[1]], 0.045),
    );
    for (let y = y2 - 0.4; y > 0.9; y -= 0.75)
      iron.push(
        { geometry: SOCKET, at: [wx, y, wz] },
        { geometry: chamfered(0.07 + Math.abs(ear[0]), 0.06, 0.07 + Math.abs(ear[1])), at: [wx + ear[0] / 2, y, wz + ear[1] / 2] },
      );
  }
  /**
   * Scottish skews on a gabled roof whose ridge runs along x through g's origin, its slates' face
   * falling `pitch` per unit to +-z from `apex` on the ridge line: on each gable a stone coping
   * `thick` deep and `width` across (its outer face at +-`edge`) lies on the slates from `from` to
   * `to` out, ending on a skewputt (a block `putt` long under the coping's foot, 0.03 wider each side,
   * its level top just over the coping's lowest edge and its foot sunk in the slates, so it stops the
   * coping without standing up from the roof like an ear); apex stones cap the ridge on the gables in
   * `apexAt`.
   */
  function skews(stone: Piece[], o: { edge: number; width: number; thick: number; from: number; to: number; putt: number; apex: number; pitch: number; apexAt: number[] }) {
    const a = Math.atan(o.pitch),
      hyp = Math.hypot(1, o.pitch),
      cx = o.edge - o.width / 2,
      m = (o.from + o.to) / 2,
      len = (o.to - o.from) * hyp,
      p0 = o.to - 0.03,
      p1 = o.to + o.putt,
      top = o.apex - p1 * o.pitch + o.thick * hyp + 0.05,
      foot = o.apex - p1 * o.pitch - 0.05;
    for (const gx of [-1, 1])
      for (const s of [-1, 1])
        stone.push(
          { geometry: chamfered(o.width, o.thick, len), at: [gx * cx, o.apex - m * o.pitch + (o.thick / 2) * Math.cos(a), s * (m + (o.thick / 2) * Math.sin(a))], rotation: [s * a, 0, 0] },
          { geometry: chamfered(o.width + 0.06, top - foot, p1 - p0), at: [gx * cx, (top + foot) / 2, (s * (p0 + p1)) / 2] },
        );
    for (const gx of o.apexAt) stone.push({ geometry: chamfered(o.width + 0.04, 0.26, 0.36), at: [gx * cx, o.apex + 0.08, 0] });
  }
  /** Ridge-tile collars along a ridge on x (its cap 0.16 x 0.26, centred at y), at each of `xs`. */
  const collars = (xs: number[], y: number): Piece[] => xs.map((x) => ({ geometry: chamfered(0.08, 0.2, 0.3), at: [x, y, 0] }));
  /**
   * A cast-iron rooflight on a slope frame (slopeFrame: +y up the slope, +z out of it): a frame
   * 0.47 x 0.62 and 0.08 high round one pane (a glazing bar down its middle read, lit or dark, as
   * two stripes: a sign, not a window). Its pane is one light with the attic's gable window.
   */
  function rooflight(f: T.Object3D, group: string) {
    cluster(f, [
      ...[-1, 1].map((s): Piece => ({ geometry: chamfered(0.07, 0.62, 0.08), at: [s * 0.2, 0, 0.04] })),
      ...[-1, 1].map((s): Piece => ({ geometry: chamfered(0.33, 0.07, 0.08), at: [0, s * 0.275, 0.04] })),
    ], palette.metal, 'iron', { shadow: false });
    const pane = new T.Mesh(new T.PlaneGeometry(0.36, 0.5), material(palette.glass, 'glass'));
    pane.position.z = 0.03;
    pane.userData.noShadow = true; // tilted, its box is over 0.3 every way: it would cast, as a batch of its own
    pane.userData.windowGroup = group;
    f.add(pane);
  }

  /** Each home's chimney cans (heights, of a 0.33 can) by its seed: tenement stacks carry a row. */
  const CANS = [[1, 1.14, 0.94], [1.08, 0.92, 1.02], [0.96, 1.12]];
  function buildTerrace(shell: T.Group, site: plan.Site, variant: 'villa' | 'red-tenement' | 'gabled-house', seed: number) {
    const w = site.w,
      d = site.d;
    // Squat walls under a big roof: a 0.42 plinth and 2.6 of wall, so the roof is about 43% of the height.
    const P = 0.42,
      h = 2.6,
      top = P + h,
      roofY = top + 0.2; // 3.22: on the cornice
    const red = variant === 'red-tenement';
    const stone = variant === 'villa' ? palette.blonde : red ? palette.red : palette.pale;
    const dress = variant === 'villa' ? palette.trim : red ? palette.trimRed : palette.blonde;
    const base = red ? palette.plinthRed : palette.plinth;
    const doorColor = variant === 'villa' ? palette.greenDoor : red ? palette.blueDoor : palette.redDoor;
    plinth(shell, w, d, base, { height: P, proud: 0.25 });
    box(shell, 0, P + h / 2, 0, w, h, d, stone, 'ashlar');
    quoins(shell, w, d, P, top, dress, { front: 0.25, corners: 'front' });
    box(shell, 0, top + 0.1, 0, w + 0.3, 0.2, d + 0.3, dress, 'stone');
    // The signature bay: a Glasgow canted sandstone bay in the 1.06 slot between the left quoins
    // and the doorpiece. Its cheeks meet the wall at 67 degrees (the slot is too narrow for 45),
    // so from any bearing the front and a cheek read as two tones meeting at an angle. On every
    // storey the front has a sash window (0.46 glass in the 0.6 front, slim frames and one meeting
    // rail) and each cheek a single 0.30 light whose frame stands only 0.06 proud, so the bay reads
    // as glass, not a stack of frames (0.36 and 0.20 lights under 0.08 frames kept about half the
    // old box bays' glass), and the door-side frame keeps stone clear of the lintel end. Each home's bay differs in its
    // top: Pengyuan's villa bay is one storey under a stone balustrade, Yunlong's rises two
    // storeys to the main eave, Qin's two under its own slate roof.
    // Window groups (stable ids, read by the night lights; each group is one light, drawn from
    // its first pane, the front's lower one): `<id>-bay-0` the ground storey (kept lit late) and
    // `<id>-bay-1` the upper storey (Yunlong's and Qin's two-storey bays only).
    const first = shell.children.length; // from here to the bay's top, everything is bay (tagged at the end)
    const bay: Bay = { x: -0.68, z0: d / 2, root: 1.06, depth: 0.55, cant: 0.23 },
      faces = bayFaces(shell, bay);
    const storey = (n: number, y: number, h: number) => faces.forEach(({ face, arris }) =>
      sash(face, arris * 0.07, y, 0, arris ? 0.3 : 0.46, h, dress,
        { group: `${site.id}-bay-${n}`, lit: n === 0, single: arris !== 0, deep: arris ? 0.06 : 0.08 }));
    cantedPrism(shell, bay, 0, P, base, 'stone', 0.06); // footing on the plinth line
    cantedPrism(shell, bay, 0.56, 0.68, dress, 'stone', 0.06).userData.band = true; // sill course; frames sit on it
    cantedPrism(shell, bay, P, 1.76, stone, 'ashlar'); // ground storey
    storey(0, 1.2, 0.86); // glass 0.77-1.63, frames 0.69-1.71
    // A window box on the front's sill course, in front of the frame and under the glass's foot
    // (0.765); painted like the door. Inside z 2.85, as everything above 0.7 on the bay is.
    windowBox(faces[0].face, 0, 0.6, 0.085, 0.58, 0.105, muted(doorColor, 0.25), seed * 13 + 3);
    if (variant === 'villa') {
      // The West End main-door villa: a cornice (its cap, front at z 2.74) under a stone balustrade.
      cantedPrism(shell, bay, 1.76, 1.96, dress, 'stone', 0.09).userData.bayCap = true;
      // Dies 0.04 inside each front angle, along its bisector, so their outer corners end flush with the
      // cornice. Each carries a ball sunk 0.02 into its top.
      const [, fl, fr] = bayOutline(bay),
        a = Math.atan2(bay.depth, bay.cant + Math.hypot(bay.depth, bay.cant)); // 0.587
      for (const [[x, z], s] of [[fl, -1], [fr, 1]] as const) {
        const cx = x - s * 0.04 * Math.sin(a),
          cz = z - 0.04 * Math.cos(a);
        box(shell, cx, 2.18, cz, 0.18, 0.44, 0.18, dress, 'stone', { ry: s * a }); // 1.96-2.40
        sphere(shell, cx, 2.45, cz, 0.07, dress, 'stone'); // 2.38-2.52
      }
      // A coping stops 0.04 short of each front angle, so its ends stay inside the die; a cheek's coping
      // runs 0.03 past its root, into the wall (left) or the lintel's end (right). One centred baluster
      // per face stands under it.
      for (const { face, length, arris } of faces) {
        box(face, -arris * 0.035, 2.29, 0, arris ? length - 0.01 : length - 0.08, 0.1, 0.16, dress, 'stone'); // 2.24-2.34
        cylinder(face, 0, 2.1, 0, 0.042, 0.055, 0.28, dress, 'stone', 8); // 1.96-2.24
      }
      // No window on the wall behind the balustrade: the main eave (lower edge at y 2.90, 0.55 out)
      // hides the wall above about 2.37 from the People bearing and 2.19 from the overview, so any
      // sash there shows only as a strip cut off by the roof (and a lit sliver at night).
    } else {
      // Two storeys. The red bay rises to the wallhead: the main eave caps it and its cornice stops
      // under the eave lip. Qin's stops lower, under its own piended slate roof below the gable window.
      const upper = red ? 2.78 : 2.64;
      cantedPrism(shell, bay, 1.76, 1.9, dress, 'stone', 0.07).userData.band = true; // string course
      cantedPrism(shell, bay, 1.9, upper, stone, 'ashlar');
      if (red) storey(1, 2.33, 0.7); // frames 1.90-2.76
      else storey(1, 2.25, 0.54); // frames 1.90-2.60
      cantedPrism(shell, bay, upper, upper + (red ? 0.18 : 0.16), dress, 'stone', 0.1).userData.bayCap = true; // front at z 2.75
      // Its eave at z 2.77, just past the cornice; the apex (3.22) dies into the main cornice under the gable window.
      if (!red) bayRoof(shell, bay, 2.8, 0.42, palette.slate);
    }
    for (const o of shell.children.slice(first)) o.traverse((m) => { m.userData.bay = true; }); // batch()'s bay-cap rule
    /*
     * The dressings (Glasgow sandstone detail in chunky proportions; see MAINTENANCE). Stone in the
     * shell's plan goes into `trim`, the plinth course into `course`, all cast iron (gutters,
     * downpipes, the railings) into `iron`: one mesh each, the iron casting nothing.
     */
    const trim: Piece[] = [],
      course: Piece[] = [],
      iron: Piece[] = [];
    // A moulded plinth course: a chamfered band 0.1 deep capping the plinth (0.24 proud of the wall,
    // 0.03 past the plinth's battered top), round the bay and across the door as its threshold.
    cantedPrism(shell, bay, P - 0.07, P + 0.03, base, 'stone', 0.12).userData.band = true;
    for (const s of [-1, 1]) course.push({ geometry: chamfered(0.3, 0.1, d + 0.48), at: [s * (w / 2 + 0.09), P - 0.02, 0] });
    course.push({ geometry: chamfered(w + 0.48, 0.1, 0.3), at: [0, P - 0.02, -(d / 2 + 0.09)] });
    for (const [x0, x1] of [[-(w / 2 + 0.24), -1.29], [-0.07, w / 2 + 0.24]]) course.push({ geometry: chamfered(x1 - x0, 0.1, 0.3), at: [(x0 + x1) / 2, P - 0.02, d / 2 + 0.09] });
    cluster(shell, course, base, 'stone');
    // The door on the plinth's landing; its steps come down to the ground at d/2 + 0.85.
    const doorX = 0.52;
    mainDoor(shell, doorX, P, d / 2, 0.7, 1.75, doorColor, dress, iron, `${site.id}-bay-0`);
    // Sides: one dressed sash each (and a gable sash under a side gable), a string course through the
    // lintels, and under the cornice a bed mould and a dentil course, stopping short of the front
    // quoins. The rear has the string course only.
    for (const side of [-1, 1]) {
      const face = new T.Group();
      face.position.x = (side * w) / 2;
      face.rotation.y = (side * Math.PI) / 2;
      shell.add(face);
      const front = -side, // the face's local x toward the front
        dressing: Piece[] = [],
        run = (a: number, b: number, y: number, tall: number, out: number) =>
          dressing.push({ geometry: chamfered(Math.abs(b - a), tall, out + 0.03), at: [(a + b) / 2, y, (out - 0.03) / 2] });
      // (At 1.36 and 3.81: a pane's night light is drawn from where it stands, and at 1.35 and 3.8 two
      // of these drew the all-night lamp's look, crowding the deliberate few; see town-batch.)
      dressedWindow(face, side * 0.6, 1.36, 0, 0.66, 0.92, { frame: dress, dress, group: `${site.id}-side-${side > 0 ? 'b' : 'a'}`, keystone: true }, dressing);
      if (variant !== 'gabled-house') dressedWindow(face, 0, 3.81, 0, 0.46, 0.54, { frame: dress, dress, group: `${site.id}-gable-${side > 0 ? 'b' : 'a'}`, corbels: false }, dressing);
      run(-front * (d / 2 + 0.07), front * 1.69, 2.04, 0.12, 0.09); // string course, 1.98-2.10
      run(-front * (d / 2), front * 1.84, 2.84, 0.08, 0.06); // bed mould, 2.80-2.88
      for (let i = 0; i < 12; i++) dressing.push({ geometry: chamfered(0.12, 0.12, 0.13), at: [front * (-1.95 + (i * 3.65) / 11), 2.95, 0.035] });
      cluster(face, dressing, dress, 'stone');
    }
    trim.push({ geometry: chamfered(w + 0.14, 0.12, 0.12), at: [0, 2.04, -(d / 2 + 0.03)] });
    // The roof: slate, with ridge-tile collars, stone skews and skewputts on the gables, a fat stack
    // with cans and lead flashings, a cast-iron rooflight, and gutters with downpipes.
    if (variant === 'gabled-house') {
      // Qin's gable faces the street: the roof's ridge runs front to back, its eaves on the sides.
      const r = new T.Group();
      r.rotation.y = Math.PI / 2;
      shell.add(r);
      const half = (w + 0.3) / 2,
        pitch = 1.6 / half,
        top2 = slabRoof(r, 0, roofY, 0, d, w + 0.3, 1.6, palette.slate, { eave: 0.2, verge: 0.3, gable: stone }),
        copes: Piece[] = [];
      // The front's cornice gets a bed mould and dentils over the door, between the bay roof and the quoins.
      trim.push({ geometry: chamfered(1.08, 0.08, 0.09), at: [0.56, 2.84, d / 2 + 0.015] });
      for (const x of [0.12, 0.42, 0.72, 1.02]) trim.push({ geometry: chamfered(0.12, 0.12, 0.13), at: [x, 2.95, d / 2 + 0.035] });
      const gableStone: Piece[] = [];
      dressedWindow(shell, 0, 3.72, d / 2, 0.46, 0.52, { frame: dress, dress, group: `${site.id}-gable`, corbels: false }, gableStone);
      cluster(shell, gableStone, dress, 'stone');
      skews(copes, { edge: d / 2 + 0.32, width: 0.26, thick: 0.1, from: 0.1, to: 1.4, putt: 0.2, apex: top2, pitch, apexAt: [-1, 1] });
      copes.push({ geometry: new T.IcosahedronGeometry(0.1, 1), at: [-(d / 2 + 0.17), top2 + 0.29, 0] }); // a ball finial on the street gable
      cluster(r, copes, stone, 'stone');
      cluster(r, collars([-1.54, -1.12, -0.7, -0.28, 0.14, 0.56, 0.98], top2 - 0.03), palette.slateLight, 'slate');
      stack(shell, 0, -(d / 2 - 0.5), top2 - 0.8, top2 + 0.5, { colour: stone, dress, heights: CANS[seed % CANS.length], ridge: 'z', apex: top2, pitch });
      rooflight(slopeFrame(shell, 0.75, 0.35, Math.PI / 2, top2, pitch), `${site.id}-gable`);
      // Gutters on both eaves (the slates' edge runs into them), each with a downpipe at the front,
      // down the side over the quoins, and one at the back.
      const gx = half + 0.2 + 0.11,
        gy = roofY - 0.2 * pitch + 0.13;
      for (const s of [-1, 1]) {
        iron.push({ geometry: chamfered(0.13, 0.11, d + 0.64), at: [s * gx, gy, 0] });
        downpipe(iron, [s * gx, gy - 0.055, 1.98], [s * 1.415, 1.98], [s * 0.09, 0], [-s * 0.05, 0]);
        downpipe(iron, [s * gx, gy - 0.055, -1.9], [s * 1.345, -1.9], [s * 0.09, 0], [-s * 0.04, 0]);
      }
    } else {
      const pitch = 1.8 / ((d + 0.3) / 2),
        top2 = slabRoof(shell, 0, roofY, 0, w, d + 0.3, 1.8, palette.slate, { eave: 0.4, verge: 0.15, gable: stone }),
        cx = seed % 2 ? -(w / 2 - 0.35) : w / 2 - 0.35,
        copes: Piece[] = [];
      stack(shell, cx, 0, top2 - 0.9, top2 + 0.55, { colour: stone, dress, heights: CANS[seed % CANS.length], ridge: 'x', apex: top2, pitch });
      // Skews on both side gables; the apex stone only where the stack does not stand.
      skews(copes, { edge: w / 2 + 0.17, width: 0.26, thick: 0.1, from: 0.1, to: 2.33, putt: 0.18, apex: top2, pitch, apexAt: [-Math.sign(cx)] });
      cluster(shell, copes, stone, 'stone');
      cluster(shell, collars([-1.05, -0.63, -0.21, 0.21, 0.63, 1.05].filter((x) => Math.abs(x - cx) > 0.5), top2 - 0.03), palette.slateLight, 'slate');
      rooflight(slopeFrame(shell, -Math.sign(cx) * 0.42, 1.3, 0, top2, pitch), `${site.id}-gable-${cx > 0 ? 'a' : 'b'}`);
      // Gutters along both eaves (the slates' edge runs into them; their top under 3.12, as the
      // bay check asks of everything that far out), a downpipe at the front's right corner over the
      // quoins, clear of the doorpiece, and one at each back corner.
      const gz = (d + 0.3) / 2 + 0.4 + 0.11,
        gy = roofY - 0.4 * pitch + 0.13;
      for (const s of [-1, 1]) iron.push({ geometry: chamfered(w + 0.34, 0.11, 0.13), at: [0, gy, s * gz] });
      downpipe(iron, [1.24, gy - 0.055, gz], [1.24, d / 2 + 0.11], [0, 0.09], [0, -0.05]);
      for (const s of [-1, 1]) downpipe(iron, [s * 1.2, gy - 0.055, -gz], [s * 1.2, -(d / 2 + 0.055)], [0, -0.09], [0, 0.04]);
    }
    cluster(shell, trim, dress, 'stone');
    cluster(shell, iron, palette.metal, 'iron', { shadow: false });
    // Front garden, sized to the room in front of the pavement (about 1.9 for every house in the row):
    // a flower mound before the bay, a hedge with a gap at the door, and a path from the steps.
    const fx = site.x + (Math.sin(site.rotation) * d) / 2,
      fz = site.z + (Math.cos(site.rotation) * d) / 2;
    const room = plan.distanceToStreets(fx, fz) - plan.PAVEMENT_WIDTH - 0.05;
    if (room >= 1.2) flowerBed(shell, bay.x, 0, d / 2 + 0.9, 1.0, 0.4, seed * 31);
    if (room >= 1.75) hedge(shell, -0.1, 0, d / 2 + Math.min(1.4, room - 0.35), w - 0.5, 0, 0.55, { at: doorX + 0.1, width: 1.0 });
    if (room - 0.85 >= 0.2) box(shell, doorX, 0.03, d / 2 + (0.85 + room) / 2, 0.8, 0.06, room - 0.85, palette.plaza, 'paving');
    // The back green: a washing line behind the home, inside its own width.
    washingLine(shell, d, seed);
  }

  /**
   * A cottage's ledged and braced door on the wall face at z, its opening w x h over the sill y: a
   * painted timber frame 0.07 round a boarded leaf (two ledges and a brace in the leaf's paint,
   * iron strap hinges and a latch), in stone margins (jambs and a lintel); its step (if the sill
   * stands above the ground) has a pale nosed tread.
   */
  function cottageDoor(g: T.Object3D, x: number, y: number, z: number, w: number, h: number, colour: string, margin: string, stone: Piece[], iron: Piece[], o: { landing: number; width: number; margins?: boolean }) {
    frameRing(g, x, y + (h - 0.07) / 2, z, w - 0.14, h - 0.07, 0.07, 0.11, palette.trim, 'paint', false, true);
    const lw = w - 0.14,
      wood: Piece[] = [
        { geometry: chamfered(lw, h - 0.07, 0.06), at: [x, y + (h - 0.07) / 2, z + 0.04] },
        ...[0.26, h - 0.42].map((ly): Piece => ({ geometry: chamfered(lw - 0.06, 0.11, 0.04), at: [x, y + ly, z + 0.09] })),
      ];
    const dx = lw - 0.24,
      dy = h - 0.42 - 0.26 - 0.11;
    wood.push({ geometry: chamfered(0.1, Math.hypot(dx, dy), 0.035), at: [x, y + (0.26 + h - 0.42) / 2, z + 0.088], rotation: [0, 0, -Math.atan2(dx, dy)] });
    cluster(g, wood, colour, 'wood');
    for (const ly of [0.26, h - 0.42]) iron.push({ geometry: chamfered(0.34, 0.07, 0.025), at: [x - lw / 2 + 0.17, y + ly, z + 0.12] });
    iron.push({ geometry: chamfered(0.07, 0.15, 0.04), at: [x + lw / 2 - 0.1, y + h * 0.5, z + 0.1] });
    if (o.margins !== false) {
      for (const s of [-1, 1]) stone.push({ geometry: chamfered(0.18, h, 0.2), at: [x + s * (w / 2 + 0.09), y + h / 2, z + 0.1] });
      stone.push({ geometry: chamfered(w + 0.5, 0.2, 0.22), at: [x, y + h + 0.1, z + 0.11] });
    }
    if (y > 0.05) steps(g, x, y, z, o.landing, o.width, palette.trim);
  }
  /** The cottage (plan.cottages index) with a gabled porch at its door, and the one with a lean-to on its +x gable. */
  const PORCH = 1,
    LEAN_TO = 4;
  function buildCottage(g: T.Object3D, c: (typeof plan.cottages)[number], index: number) {
    const root = new T.Group();
    root.position.set(c.x, plan.terrainHeight(c.x, c.z), c.z);
    root.rotation.y = c.rotation;
    g.add(root);
    // Squat walls on a battered plinth under a steep (49 degree) slab roof, alternating slate and
    // red pantile, with a fat gable chimney. The wall is 2.0 so the door head clears the eave soffit.
    // The slate cottages are harled (render, the walls' own buff), the pantile ones coursed rubble;
    // both have stone quoins and margins, the harled ones in a darker dressed buff.
    const w = 2.8, d = 2.4, P = 0.3, h = 2.0, top = P + h;
    const pan = index % 2 === 1,
      wallKind: SurfaceKind = pan ? 'ashlar' : 'paint',
      dress = pan ? palette.trim : palette.plinth,
      roof = pan ? palette.pantile : palette.slate,
      roofRidge = pan ? palette.pantileLight : palette.slateLight,
      pitch = 1.4 / (d / 2);
    plinth(root, w, d, palette.plinth, { height: P, proud: 0.2 });
    box(root, 0, P + h / 2, 0, w, h, d, c.color, wallKind);
    const ridge = slabRoof(root, 0, top, 0, w, d, 1.4, roof, { eave: 0.25, verge: 0.25, inset: 0, ridge: roofRidge, gable: c.color, gableKind: wallKind });
    const doorColour = [palette.greenDoor, palette.blueDoor, palette.redDoor][index % 3];
    const stone: Piece[] = [],
      iron: Piece[] = [];
    // Quoins on the front corners: five 0.36 courses, long and short by turns, 0.05 proud.
    for (const sx of [-1, 1])
      for (let i = 0; i < 5; i++) {
        const long = i % 2 === 0,
          lx = long ? 0.4 : 0.28,
          lz = long ? 0.28 : 0.4;
        stone.push({ geometry: chamfered(lx, 0.36, lz), at: [sx * (w / 2 + 0.05 - lx / 2), P + 0.18 + i * 0.41, d / 2 + 0.05 - lz / 2] });
      }
    // The window: a sash in a stone margin on a sill, one light at night.
    const before = root.children.length;
    sash(root, -0.65, 1.2, d / 2, 0.62, 0.74, palette.trim, { group: `cottage-${index}`, deep: 0.07 });
    if (c.nightLight) for (const p of root.children.slice(before)) if (p.userData.sashPane) p.userData.nightLight = true; // a dim lamp left on all night (town-batch)
    frameRing(root, -0.65, 1.2, d / 2, 0.72, 0.84, 0.1, 0.11, dress, 'stone');
    stone.push({ geometry: chamfered(1.04, 0.09, 0.18), at: [-0.65, 0.635, d / 2 + 0.09] });
    // A window box on the sill (top 0.68), against the margin's face (d/2 + 0.11), under the glass (foot 0.825).
    windowBox(root, -0.65, 0.681, d / 2 + 0.115, 0.84, 0.13, muted(doorColour, 0.25), index * 11 + 5);
    // The door: at the wall, or (PORCH) in a gabled porch 0.6 deep, its roof running back into the eave.
    let doorFront = d / 2;
    if (index === PORCH) {
      const pw = 1.1,
        pd = 0.6,
        eave = 1.8;
      plinth(root, pw, pd, palette.plinth, { x: 0.6, z: d / 2 + pd / 2, height: P, proud: 0.1 });
      box(root, 0.6, P + (eave - P) / 2, d / 2 + pd / 2, pw, eave - P, pd, c.color, wallKind);
      const r = new T.Group();
      r.position.set(0.6, 0, d / 2 + pd / 2);
      r.rotation.y = Math.PI / 2;
      root.add(r);
      slabRoof(r, 0, eave, 0, pd, pw, 0.45, roof, { eave: 0.12, verge: 0.12, thick: 0.12, inset: 0, ridge: roofRidge, gable: c.color, gableKind: wallKind });
      doorFront = d / 2 + pd;
      cottageDoor(root, 0.6, P, doorFront, 0.5, 1.15, doorColour, dress, stone, iron, { landing: 0.12, width: 0.66 });
    } else cottageDoor(root, 0.6, P, d / 2, 0.75, 1.5, doorColour, dress, stone, iron, { landing: 0.2, width: 1.0 });
    // A lean-to store on the +x gable (LEAN_TO): its walls rise to the gable under a slab falling
    // 0.55 a unit, a boarded door in its front.
    if (index === LEAN_TO) {
      const x0 = w / 2,
        out = 1.0,
        half = 0.75,
        low = 1.45,
        high = 2.0;
      plinth(root, out, 2 * half, palette.plinth, { x: x0 + out / 2, height: 0.2, proud: 0.08 });
      const walls = new T.Mesh(prism([[x0 - 0.05, 0], [x0 + out, 0], [x0 + out, low], [x0 - 0.05, high + 0.03]], 2 * half, 0.03, -half), material(c.color, wallKind));
      walls.castShadow = walls.receiveShadow = true;
      root.add(walls);
      const slope = (high - low) / out,
        a = Math.atan(slope),
        u0 = [x0 - 0.04, high + 0.02],
        u1 = [x0 + out + 0.22, low - 0.22 * slope],
        len = Math.hypot(u1[0] - u0[0], u1[1] - u0[1]),
        lid = box(root, (u0[0] + u1[0]) / 2 + 0.06 * Math.sin(a), (u0[1] + u1[1]) / 2 + 0.06 * Math.cos(a), 0, len, 0.12, 2 * half + 0.3, roof, pan ? 'pantile' : 'slate', { rz: -a });
      lid.userData.roof = true;
      lid.userData.eaveY = low;
      cottageDoor(root, x0 + 0.5, 0.2, half, 0.5, 1.0, muted(doorColour, 0.35), dress, stone, iron, { landing: 0, width: 0, margins: false });
    }
    stack(root, -(w / 2 - 0.35), 0, ridge - 0.8, ridge + 0.45, { colour: c.color, kind: wallKind, dress, heights: pan ? [1, 1.12] : [1.06], ridge: 'x', apex: ridge, pitch });
    // Skews and skewputts on both gables, an apex stone on the one without the stack.
    skews(stone, { edge: w / 2 + 0.27, width: 0.26, thick: 0.09, from: 0.1, to: 1.24, putt: 0.16, apex: ridge, pitch, apexAt: [1] });
    // Ivy on one cottage's blank +x gable (the cottage south of the row, whose gable faces the
    // People chapter): rooted in a narrow stem at the plinth, it spreads over the wall and up into
    // the gable's peak, kept off both corners and inside the gable under the verge. Here the front
    // is the face's -x.
    if (index === IVY_COTTAGE) {
      const face = new T.Group();
      face.position.x = w / 2;
      face.rotation.y = Math.PI / 2;
      root.add(face);
      ivy(face, {
        areas: [[0, 0, 0.45, 0.85], [-0.6, 0.65, 0.95, 1.75], [-0.3, 1.7, 0.75, 2.45], [0, 2.4, 0.45, 2.8]],
        keep: [[-3, 0, -1.06, 5], [1.06, 0, 3, 5], [-3, 3.0, 3, 5]],
        plinth: { h: P, proud: 0.2, batter: P * 0.105 },
        seed: 11,
      });
    }
    // Front garden sized to the room before the pavement: a hedge with a gap at the door, stone gate
    // piers in the gap with a boarded gate, and a path from the step.
    const fx = c.x + (Math.sin(c.rotation) * d) / 2,
      fz = c.z + (Math.cos(c.rotation) * d) / 2;
    const room = plan.distanceToStreets(fx, fz) - plan.PAVEMENT_WIDTH - 0.05;
    const hz = d / 2 + (index === PORCH ? Math.min(1.45, room - 0.35) : Math.min(1.0, room - 0.35));
    if (room > 1.25) {
      hedge(root, 0, 0, hz, w, 0, 0.45, { at: 0.6, width: 0.9 });
      for (const s of [-1, 1]) {
        box(root, 0.6 + s * 0.5, 0.31, hz, 0.22, 0.62, 0.22, palette.plinth, 'stone');
        stone.push({ geometry: chamfered(0.3, 0.08, 0.3), at: [0.6 + s * 0.5, 0.66, hz] });
      }
      cluster(root, [
        { geometry: chamfered(0.74, 0.34, 0.05), at: [0.6, 0.3, hz] },
        ...[0.13, 0.49].map((y): Piece => ({ geometry: chamfered(0.78, 0.08, 0.07), at: [0.6, y, hz] })),
      ], muted(doorColour, 0.35), 'wood');
    }
    const start = doorFront + (index === PORCH ? 0.42 : 0.5),
      L = Math.min(room, 1.6) + d / 2 - start + (index === PORCH ? 0.3 : 0);
    if (L >= 0.2) box(root, 0.6, 0.035, start + L / 2, 0.7, 0.07, L, palette.plaza, 'paving');
    cluster(root, stone, dress, 'stone');
    cluster(root, iron, palette.metal, 'iron', { shadow: false });
  }
  return { buildTerrace, buildCottage };
}
