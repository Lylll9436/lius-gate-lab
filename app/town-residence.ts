import * as T from 'three';
import * as plan from './town-plan';
import { palette, type TownContext } from './town-shared';
import type { SurfaceKind } from './city-materials';
import type { Kit, Piece } from './town-kit';
import type { Nature } from './town-nature';
import type { Props } from './town-props';

/**
 * The Visiting PhD Residence's materials: a warm pale limestone (paler and calmer than the blonde
 * sandstone of the homes beside it), a darker granite base, slim dark-bronze frames, warm oak fins
 * and soffit, a toned-down champagne brass for the handrails and the door pull, and clear glass
 * balustrades. Each no more saturated than its palette family.
 */
export const RESIDENCE_LOOK = {
  stone: '#e2d6bc',
  dressing: '#ece4d1',
  reveal: '#d3c6a8',
  base: '#a29a89',
  bronze: '#4f453b',
  timber: '#b0855b',
  brass: '#cbb790',
  balustrade: '#a9cbd3',
  lobby: '#d4ba8a',
  paving: '#d8cdb6',
  gravel: '#b4ad9e',
};
/** The block's levels (local y): base course, first floor, roof terrace, top-floor roof, its coping. */
export const RESIDENCE_LEVELS = { base: 0.3, first: 2.02, terrace: 3.5, top: 4.95, coping: 5.2 };

/* ------------------------------------------------------------------ */
/* The Visiting PhD Residence                                          */
/* ------------------------------------------------------------------ */
export function createResidence(ctx: TownContext, kit: Kit, nature: Nature, props: Props) {
  const { material } = ctx;
  const { box, chamfered, cluster, frameRing, prism } = kit;
  const { topiary } = nature;
  const { cycleHoop } = props;
  const L = RESIDENCE_LOOK;

  /** A box between two corners (local x0..x1, y0..y1, z0..z1). */
  function block(g: T.Object3D, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: string, kind: SurfaceKind, opts: { bevel?: number } = {}) {
    return box(g, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, colour, kind, opts);
  }
  /** A chamfered piece between two corners, for a cluster. */
  const piece = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Piece => ({
    geometry: chamfered(x1 - x0, y1 - y0, z1 - z0),
    at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  });
  /**
   * A cladding panel 0.05 thick (from 0.01 inside the face to 0.04 out), its edges chamfered 0.02
   * so that two panels part in a V joint about 0.07 across (a plain chamfered block of that
   * thickness bevels only 0.0125, a hairline that crawls when the camera pans).
   */
  const panel = (x0: number, x1: number, y0: number, y1: number): Piece => ({
    geometry: prism([[-(x1 - x0) / 2, -(y1 - y0) / 2], [(x1 - x0) / 2, -(y1 - y0) / 2], [(x1 - x0) / 2, (y1 - y0) / 2], [-(x1 - x0) / 2, (y1 - y0) / 2]], 0.05, 0.02, -0.025),
    at: [(x0 + x1) / 2, (y0 + y1) / 2, 0.015],
  });
  /** The parts of a..b left between the cuts. */
  function spans(a: number, b: number, cuts: [number, number][]) {
    const out: [number, number][] = [];
    let at = a;
    for (const [c0, c1] of [...cuts].sort((p, q) => p[0] - q[0])) {
      if (c0 > at) out.push([at, Math.min(c0, b)]);
      at = Math.max(at, c1);
    }
    if (at < b) out.push([at, b]);
    return out.filter(([p, q]) => q - p > 0.05);
  }
  /**
   * Large-format limestone panels on a face (g's x along it, y up, +z out), 0.04 proud with 0.03
   * V joints, over x0..x1 and y0..y1 round the `holes` ([x0, x1, y0, y1] each): rows break at the
   * holes' heads and sills and are never taller than about 0.75, panels never wider than 1.1.
   */
  function clad(list: Piece[], x0: number, x1: number, y0: number, y1: number, holes: [number, number, number, number][] = []) {
    const J = 0.015,
      ys = [...new Set([y0, y1, ...holes.flatMap((h) => [h[2], h[3]]).filter((y) => y > y0 && y < y1)])].sort((a, b) => a - b);
    for (let i = 0; i + 1 < ys.length; i++) {
      const n = Math.max(1, Math.round((ys[i + 1] - ys[i]) / 0.75)),
        rh = (ys[i + 1] - ys[i]) / n;
      for (let r = 0; r < n; r++) {
        const a = ys[i] + rh * r,
          b = a + rh,
          mid = (a + b) / 2;
        for (const [p, q] of spans(x0, x1, holes.filter((h) => mid > h[2] && mid < h[3]).map((h): [number, number] => [h[0], h[1]]))) {
          const m = Math.max(1, Math.round((q - p) / 1.1)),
            pw = (q - p) / m;
          for (let k = 0; k < m; k++) list.push(panel(p + pw * k + J, p + pw * (k + 1) - J, a + J, b - J));
        }
      }
    }
  }
  /**
   * A pane of glass on g's face (+z out of it), centred at (x, y, z): its own plane, so batch()
   * gives it its own glint and its night light (one light per `group`).
   */
  function pane(g: T.Object3D, x: number, y: number, z: number, w: number, h: number, group: string, colour = palette.glass) {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), material(colour, 'glass'));
    m.position.set(x, y, z);
    m.userData.windowGroup = group;
    g.add(m);
    return m;
  }
  /** A slim dark-bronze frame (0.06 face, `deep` out of the face at z) round an opening w x h about (x, y); it casts nothing. */
  function bronzeFrame(g: T.Object3D, x: number, y: number, z: number, w: number, h: number, deep = 0.07, face = 0.07) {
    frameRing(g, x, y, z, w, h, face, deep, L.bronze, 'iron');
    const m = g.children[g.children.length - 1] as T.Mesh;
    m.castShadow = false;
    m.userData.noShadow = true;
    return m;
  }
  /**
   * A face group on the block (local +z out of the wall, x along it), at (x, z) turned by ry.
   * The sides: ry -PI/2 (x toward the front) on the south (-x) side, PI/2 (x toward the back) on the north.
   */
  function faceAt(shell: T.Object3D, x: number, z: number, ry: number) {
    const g = new T.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    shell.add(g);
    g.updateMatrix();
    return g;
  }

  /**
   * The Visiting PhD Residence (front +z, w along x, d along z; site.w 4.6, site.d 4.2): a small
   * contemporary apartment house, quietly upscale, in the town's chunky toy language. Two full
   * storeys of pale limestone and a set-back top floor under a crisp overhanging roof slab, all on
   * a darker granite base. The front is a limestone frame in two bays: the ground floor has the
   * ground flat's floor-to-ceiling window (behind a low planter) and the recessed entrance (warm
   * lobby glass under a cantilevered canopy, its oak body under a limestone cap); the first floor
   * a projecting balcony with a glass balustrade and a slim champagne-brass handrail before full
   * glazing, and a window behind oak fins. On the roof terrace: a glass balustrade, a light pergola
   * (bronze frame, oak slats) and planters of clipped shrubs. The sides and back are clad in
   * large-format limestone panels (V joints) with deep-set windows. In front, a paved forecourt
   * inside a low limestone wall: a bench, two cycle hoops and planters. No lettering or numbers.
   * Night: one light per flat (window groups `visiting-phd-<flat>`), the lobby lit late.
   */
  function buildResidence(shell: T.Group, site: plan.Site) {
    const hw = site.w / 2,
      hd = site.d / 2,
      { base: B, first: F1, terrace: TR, top: TOP, coping: COPE } = RESIDENCE_LEVELS;
    const stone: Piece[] = [], // the limestone cladding and dressings, each panel a shade of its own (batch tone)
      dress: Piece[] = [], // the paler copings and bands
      bronze: Piece[] = [], // mullions, shoe rails, pergola frame: cast nothing
      brass: Piece[] = [],
      oak: Piece[] = [];
    const g = (id: string) => `${site.id}-${id}`;

    /* -------------------------------------------------------------- */
    /* Masses                                                          */
    /* -------------------------------------------------------------- */
    // The base course: dark granite, 0.06 proud all round, the forecourt paving up to it.
    block(shell, -hw - 0.06, hw + 0.06, 0, B, -hd - 0.06, hd + 0.06, L.base, 'stone');
    // The block's core (its front face 0.2 back, behind the limestone frame), cut for the recessed
    // entrance in the right-hand bay (x 0.52..1.96, up to the first floor's band).
    const EX0 = 0.52,
      EX1 = 1.96,
      ER = hd - 0.4; // the entrance's glass line, 0.4 back from the piers' faces
    block(shell, -hw, hw, B, TR, -hd, ER, L.stone, 'stone');
    block(shell, -hw, EX0, B, TR, ER, hd - 0.2, L.stone, 'stone');
    block(shell, EX1, hw, B, TR, ER, hd - 0.2, L.stone, 'stone');
    block(shell, EX0, EX1, 1.82, TR, ER, hd - 0.2, L.stone, 'stone');
    // The set-back top floor: 1.15 back from the front and 0.95 in from the south side (toward
    // the row and the opening camera), so the terrace wraps that corner and the block steps down
    // toward the homes; 0.25 in from the north side and the back. Its glazed front stands 0.12
    // behind its end piers.
    const TXS = -hw + 0.95,
      TXN = hw - 0.25,
      TZ0 = -hd + 0.2,
      TZ1 = hd - 1.15;
    block(shell, TXS, TXN, TR, TOP, TZ0, TZ1 - 0.12, L.stone, 'stone');
    // The top floor's roof: a slab overhanging 0.15 at the sides and back and 0.47 over the glazed
    // front (the floor's eave: batch() shades the glass under it). On it a crisp limestone coping
    // round a field of pale grey gravel, a rooflight over the stair and a small plant room.
    const R0 = TXS - 0.15,
      R1 = TXN + 0.15,
      RZ0 = TZ0 - 0.15,
      RZ1 = TZ1 + 0.35,
      slabTop = TOP + 0.12,
      C = 0.16;
    const roof = block(shell, R0, R1, TOP, slabTop, RZ0, RZ1, L.dressing, 'stone', { bevel: 0.03 });
    roof.userData.roof = true;
    roof.userData.eaveY = TOP;
    dress.push(piece(R0, R1, slabTop - 0.01, COPE, RZ1 - C, RZ1), piece(R0, R1, slabTop - 0.01, COPE, RZ0, RZ0 + C));
    for (const [a, b] of [[R0, R0 + C], [R1 - C, R1]]) dress.push(piece(a, b, slabTop - 0.01, COPE, RZ0 + C, RZ1 - C));
    const gravel = block(shell, R0 + C, R1 - C, slabTop - 0.01, slabTop + 0.03, RZ0 + C, RZ1 - C, L.gravel, 'stone', { bevel: 0 });
    gravel.userData.band = true; // a surface, not an overhang
    {
      // The rooflight: a bronze kerb round flat glass, lit with the top flat at night.
      const x = (R0 + R1) / 2 - 0.55,
        z = -0.95,
        y = slabTop + 0.03;
      bronze.push(piece(x - 0.5, x + 0.5, y, y + 0.12, z - 0.4, z - 0.32), piece(x - 0.5, x + 0.5, y, y + 0.12, z + 0.32, z + 0.4));
      for (const s of [-1, 1]) bronze.push(piece(x + s * 0.46 - 0.04, x + s * 0.46 + 0.04, y, y + 0.12, z - 0.32, z + 0.32));
      const light = block(shell, x - 0.42, x + 0.42, y + 0.06, y + 0.1, z - 0.32, z + 0.32, palette.glass, 'glass', { bevel: 0 });
      light.userData.windowGroup = g('top');
      light.userData.noShadow = true;
      // The plant room: a small limestone box with a bronze louvre on its north face.
      const px = R1 - 0.75,
        pz = -1.2;
      stone.push(piece(px - 0.45, px + 0.45, y, y + 0.42, pz - 0.36, pz + 0.36));
      dress.push(piece(px - 0.49, px + 0.49, y + 0.42, y + 0.48, pz - 0.4, pz + 0.4));
      for (let k = 0; k < 3; k++) bronze.push(piece(px + 0.44, px + 0.51, y + 0.1 + k * 0.1, y + 0.17 + k * 0.1, pz - 0.26, pz + 0.26));
    }

    /* -------------------------------------------------------------- */
    /* The front: a limestone frame in two bays                        */
    /* -------------------------------------------------------------- */
    const FZ = hd - 0.2, // the core's front face
      MX0 = 0.2,
      MX1 = EX0; // the middle pier
    // Piers (corner and middle), in large-format panels with V joints between them.
    for (const [x0, x1] of [[-hw, -hw + 0.34], [MX0, MX1], [EX1, hw]] as const)
      for (const [y0, y1] of [[B, 1.06], [1.06, 1.82], [2.02, 2.72], [2.72, 3.42]])
        stone.push(piece(x0 + 0.015, x1 - 0.015, y0 + 0.015, y1 - 0.015, FZ, hd + 0.02));
    // The bands round the block: the first floor's (1.82-2.02) and the roof's (3.42-3.62), 0.06 proud.
    for (const [y0, y1] of [[1.82, 2.02], [3.42, 3.62]]) {
      dress.push(piece(-hw - 0.06, hw + 0.06, y0, y1, hd - 0.2, hd + 0.08));
      dress.push(piece(-hw - 0.06, hw + 0.06, y0, y1, -hd - 0.06, -hd + 0.2));
      for (const s of [-1, 1]) dress.push(piece(s > 0 ? hw - 0.2 : -hw - 0.06, s > 0 ? hw + 0.06 : -hw + 0.2, y0, y1, -hd, hd));
    }

    // Ground floor, left bay: the ground flat's floor-to-ceiling window, three lights.
    {
      const x0 = -hw + 0.34,
        x1 = MX0,
        w = x1 - x0,
        y0 = B,
        y1 = 1.82,
        cx = (x0 + x1) / 2,
        cy = (y0 + y1) / 2;
      bronzeFrame(shell, cx, cy, FZ, w - 0.02, y1 - y0 - 0.02, 0.09, 0.07);
      for (let k = 0; k < 3; k++) pane(shell, x0 + (w * (k + 0.5)) / 3, cy, FZ + 0.03, w / 3, y1 - y0, g('ground'));
      for (const k of [1, 2]) bronze.push(piece(x0 + (w * k) / 3 - 0.035, x0 + (w * k) / 3 + 0.035, y0, y1, FZ, FZ + 0.08));
    }
    // Ground floor, right bay: the recessed entrance. Its glass screen at ER: a door and a side
    // light in bronze, warm lobby glass lit late; a brass pull; the recess's jambs are the piers
    // and the core, its ceiling the floor above. A step in front of the base course.
    {
      const y0 = B,
        y1 = 1.82,
        w = EX1 - EX0,
        cy = (y0 + y1) / 2,
        door = 0.74,
        split = EX0 + 0.06 + door;
      bronzeFrame(shell, (EX0 + EX1) / 2, cy, ER, w, y1 - y0, 0.08, 0.07);
      const lobby = [
        pane(shell, (EX0 + split) / 2, cy, ER + 0.03, split - EX0, y1 - y0, g('lobby'), L.lobby),
        pane(shell, (split + EX1) / 2, cy, ER + 0.03, EX1 - split, y1 - y0, g('lobby'), L.lobby),
      ];
      for (const p of lobby) p.userData.windowLit = 1;
      bronze.push(piece(split - 0.04, split + 0.04, y0, y1, ER, ER + 0.09)); // the door's closing stile
      bronze.push(piece(EX0, EX1, 1.5, 1.57, ER, ER + 0.09)); // the transom over the door
      brass.push(piece(split - 0.17, split - 0.1, 0.72, 1.32, ER + 0.09, ER + 0.16)); // the pull
      block(shell, EX0 - 0.1, EX1 + 0.1, 0, 0.15, hd + 0.06, hd + 0.42, L.base, 'stone');
      // The canopy: cantilevered 0.6 out over the step, an oak body under a limestone cap, its
      // oak edge the part the town's camera sees (its soffit faces the ground).
      const c0 = EX0 - 0.16,
        c1 = hw + 0.06;
      stone.push(piece(c0, c1, 1.93, 2.0, hd, hd + 0.62));
      oak.push(piece(c0 + 0.02, c1 - 0.02, 1.78, 1.93, hd, hd + 0.6));
    }
    // First floor, left bay: full glazing (two doors) behind a projecting balcony with a glass
    // balustrade on a bronze shoe and a champagne-brass handrail.
    {
      const x0 = -hw + 0.34,
        x1 = MX0,
        w = x1 - x0,
        y0 = F1,
        y1 = 3.42,
        cx = (x0 + x1) / 2,
        cy = (y0 + y1) / 2;
      bronzeFrame(shell, cx, cy, FZ, w - 0.02, y1 - y0 - 0.02, 0.09, 0.07);
      for (let k = 0; k < 2; k++) pane(shell, x0 + (w * (k + 0.5)) / 2, cy, FZ + 0.03, w / 2, y1 - y0, g('balcony'));
      bronze.push(piece(cx - 0.04, cx + 0.04, y0, y1, FZ, FZ + 0.08));
      bronze.push(piece(x0, x1, 3.0, 3.07, FZ, FZ + 0.08)); // a transom: doors under fanlights
      // The balcony: a limestone slab 0.62 out, a little wider than the bay.
      const b0 = x0 - 0.08,
        b1 = x1 + 0.08,
        out = hd + 0.62;
      block(shell, b0, b1, 1.86, F1, hd, out, L.dressing, 'stone', { bevel: 0.03 });
      const G = 0.07,
        top = F1 + 0.52;
      const glass = (x: number, z: number, w: number, d: number) => {
        const m = block(shell, x - w / 2, x + w / 2, F1 + 0.06, top, z - d / 2, z + d / 2, L.balustrade, 'glass', { bevel: 0 });
        m.userData.window = 'clear';
        m.userData.noShadow = true;
        return m;
      };
      glass((b0 + b1) / 2, out - 0.07, b1 - b0 - 0.14, G);
      for (const x of [b0 + 0.07, b1 - 0.07]) glass(x, (hd + 0.2 + out - 0.07) / 2, G, out - 0.07 - hd - 0.2);
      // The shoe (a bronze channel the glass stands in) and the handrail on the glass's top edge.
      bronze.push(piece(b0 + 0.03, b1 - 0.03, F1, F1 + 0.08, out - 0.11, out - 0.03));
      brass.push(piece(b0 + 0.03, b1 - 0.03, top - 0.01, top + 0.06, out - 0.105, out - 0.035));
      for (const x of [b0 + 0.07, b1 - 0.07]) {
        bronze.push(piece(x - 0.04, x + 0.04, F1, F1 + 0.08, hd + 0.2, out - 0.03));
        brass.push(piece(x - 0.035, x + 0.035, top - 0.01, top + 0.06, hd + 0.2, out - 0.035));
      }
    }
    // First floor, right bay: a tall window behind a screen of six oak fins.
    {
      const x0 = EX0,
        x1 = EX1,
        w = x1 - x0 - 0.2,
        cx = (x0 + x1) / 2,
        y0 = F1 + 0.1,
        y1 = 3.32,
        cy = (y0 + y1) / 2;
      bronzeFrame(shell, cx, cy, FZ, w, y1 - y0, 0.09, 0.07);
      pane(shell, cx, cy, FZ + 0.03, w, y1 - y0, g('fins'));
      // The reveal round it: limestone strips in the bay's depth.
      stone.push(piece(x0, x0 + 0.1, F1, 3.42, FZ, hd), piece(x1 - 0.1, x1, F1, 3.42, FZ, hd));
      stone.push(piece(x0 + 0.1, x1 - 0.1, F1, y0 - 0.0, FZ, hd), piece(x0 + 0.1, x1 - 0.1, y1, 3.42, FZ, hd));
      for (let k = 0; k < 6; k++) {
        const x = x0 + 0.1 + ((x1 - x0 - 0.2) * k) / 5;
        oak.push(piece(x - 0.045, x + 0.045, F1, 3.42, hd - 0.02, hd + 0.2));
      }
    }

    /* -------------------------------------------------------------- */
    /* The roof terrace and the top floor                              */
    /* -------------------------------------------------------------- */
    {
      // Solid limestone parapets with crisp copings: along the whole south side (the terrace wraps
      // round there) and at the front's north end; a glass balustrade on a bronze shoe with a
      // champagne-brass rail along the front between them.
      const p0 = TR + 0.12,
        p1 = TR + 0.6;
      stone.push(piece(-hw, -hw + 0.2, p0, p1, -hd, hd));
      dress.push(piece(-hw - 0.04, -hw + 0.24, p1, p1 + 0.08, -hd - 0.04, hd + 0.04));
      stone.push(piece(hw - 0.2, hw, p0, p1, TZ1, hd));
      dress.push(piece(hw - 0.24, hw + 0.04, p1, p1 + 0.08, TZ1 - 0.02, hd + 0.04));
      const gx0 = -hw + 0.2,
        gx1 = hw - 0.2,
        gz = hd - 0.1,
        top = TR + 0.6;
      const glass = block(shell, gx0, gx1, p0 + 0.04, top, gz - 0.035, gz + 0.035, L.balustrade, 'glass', { bevel: 0 });
      glass.userData.window = 'clear';
      glass.userData.noShadow = true;
      bronze.push(piece(gx0, gx1, TR + 0.1, TR + 0.18, gz - 0.04, gz + 0.04));
      brass.push(piece(gx0, gx1, top - 0.01, top + 0.06, gz - 0.035, gz + 0.035));
      // The top floor's glazed front (four lights) between limestone end piers, under the roof's
      // deep eave; its sides each have one window (in the side group below).
      const fz = TZ1 - 0.12,
        g0 = TXS + 0.32,
        g1 = TXN - 0.32,
        gw = g1 - g0,
        cy = (TR + TOP) / 2;
      stone.push(piece(TXS, g0, TR, TOP, fz, TZ1), piece(g1, TXN, TR, TOP, fz, TZ1));
      bronzeFrame(shell, (g0 + g1) / 2, cy, fz, gw, TOP - TR, 0.09, 0.07);
      for (let k = 0; k < 4; k++) pane(shell, g0 + (gw * (k + 0.5)) / 4, cy, fz + 0.03, gw / 4, TOP - TR, g('top'));
      for (const k of [1, 2, 3]) bronze.push(piece(g0 + (gw * k) / 4 - 0.035, g0 + (gw * k) / 4 + 0.035, TR, TOP, fz, fz + 0.08));
      // Oak decking over the terrace: the front's strip and the south side's.
      oak.push(piece(-hw + 0.2, hw - 0.2, TR - 0.02, TR + 0.04, fz + 0.01, hd - 0.2));
      oak.push(piece(-hw + 0.2, TXS, TR - 0.02, TR + 0.04, -hd + 0.2, fz + 0.01));
      // The pergola over the terrace's south-front corner: three slim bronze posts (the top floor's
      // front carries its fourth corner), a bronze frame and oak slats across it, under the roof's
      // eave where it reaches.
      const px0 = -hw + 0.32,
        px1 = MX1,
        pz0 = fz,
        pz1 = hd - 0.3,
        ph = TR + 1.1;
      for (const [x, z] of [[px0, pz1], [px1, pz1], [px0, pz0]] as const) bronze.push(piece(x - 0.04, x + 0.04, TR, ph, z - 0.04, z + 0.04));
      bronze.push(piece(px0 - 0.04, px1 + 0.04, ph, ph + 0.09, pz1 - 0.05, pz1 + 0.05));
      bronze.push(piece(px0 - 0.05, px0 + 0.05, ph, ph + 0.09, pz0 - 0.04, pz1));
      bronze.push(piece(px1 - 0.04, px1 + 0.04, ph, ph + 0.09, fz, pz1));
      bronze.push(piece(px0, TXS, ph, ph + 0.09, pz0 - 0.04, pz0 + 0.04));
      for (let k = 0; k < 7; k++) {
        const x = px0 + 0.12 + ((px1 - px0 - 0.24) * k) / 6;
        oak.push(piece(x - 0.04, x + 0.04, ph + 0.09, ph + 0.17, x < TXS ? pz0 - 0.1 : fz, pz1 + 0.12));
      }
      // Planters: a long limestone trough along the front's north half with three clipped shrubs,
      // and a square one on the south strip with one.
      const t0 = MX1 + 0.1,
        t1 = hw - 0.25;
      block(shell, t0, t1, TR, TR + 0.32, hd - 0.6, hd - 0.22, L.stone, 'stone');
      for (let k = 0; k < 3; k++) topiary(shell, t0 + ((t1 - t0) * (k + 0.5)) / 3, TR + 0.46, hd - 0.41, 0.2, 1, 1, 0.85, 0.9);
      const qx = (-hw + 0.2 + TXS) / 2,
        qz = -hd + 0.75;
      block(shell, qx - 0.25, qx + 0.25, TR, TR + 0.34, qz - 0.25, qz + 0.25, L.stone, 'stone');
      topiary(shell, qx, TR + 0.52, qz, 0.23, 1, 1, 1.0, 1);
    }

    /* -------------------------------------------------------------- */
    /* Sides and back: large-format limestone panels, deep-set windows  */
    /* -------------------------------------------------------------- */
    {
      /** A deep-set window on a face: a limestone reveal 0.14 proud with a sill, the bronze frame and the pane behind. */
      const deepWindow = (face: T.Object3D, panels: Piece[], x: number, y0: number, y1: number, w: number, group: string) => {
        const x0 = x - w / 2,
          x1 = x + w / 2;
        panels.push(
          piece(x0 - 0.12, x0, y0 - 0.02, y1 + 0.12, -0.01, 0.14),
          piece(x1, x1 + 0.12, y0 - 0.02, y1 + 0.12, -0.01, 0.14),
          piece(x0, x1, y1, y1 + 0.12, -0.01, 0.14),
        );
        dressings.push([face, piece(x0 - 0.16, x1 + 0.16, y0 - 0.14, y0 - 0.02, -0.01, 0.2)]);
        bronzeFrame(face, x, (y0 + y1) / 2, 0, w, y1 - y0, 0.07, 0.07);
        pane(face, x, (y0 + y1) / 2, 0.02, w, y1 - y0, group);
        return [x0 - 0.12, x1 + 0.12, y0 - 0.14, y1 + 0.12] as [number, number, number, number];
      };
      const dressings: [T.Object3D, Piece][] = [];
      // The main block's sides: one window a storey toward the front, panels over the rest
      // between the bands (the base course below, the bands at 1.82 and 3.42).
      for (const { face, front } of [
        { face: faceAt(shell, -hw, 0, -Math.PI / 2), front: 1 }, // south: face x toward the front
        { face: faceAt(shell, hw, 0, Math.PI / 2), front: -1 }, // north: face x toward the back
      ]) {
        // A wide window toward the front (the living room) and a narrow one toward the back.
        const panels: Piece[] = [],
          wx = front * 0.8,
          bx = -front * 1.15,
          upper = g(front > 0 ? 'balcony' : 'fins');
        const low = [deepWindow(face, panels, wx, 0.62, 1.58, 0.84, g('ground')), deepWindow(face, panels, bx, 0.62, 1.58, 0.56, g('ground'))],
          high = [deepWindow(face, panels, wx, 2.24, 3.2, 0.84, upper), deepWindow(face, panels, bx, 2.24, 3.2, 0.56, upper)];
        clad(panels, -hd, hd, B, 1.82, low);
        clad(panels, -hd, hd, 2.02, 3.42, high);
        cluster(face, panels, L.stone, 'stone');
      }
      // The top floor's sides: one window each in a deep reveal, panels round it.
      for (const s of [-1, 1]) {
        const f = faceAt(shell, s < 0 ? TXS : TXN, 0, (s * Math.PI) / 2),
          // face x runs toward the front on the south side, toward the back on the north
          a = s < 0 ? TZ0 : -(TZ1 - 0.12),
          b = s < 0 ? TZ1 - 0.12 : -TZ0,
          panels: Piece[] = [];
        const hole = deepWindow(f, panels, (a + b) / 2, TR + 0.3, TOP - 0.28, 0.8, g('top'));
        clad(panels, a, b, TR, TOP, [hole]);
        cluster(f, panels, L.stone, 'stone');
      }
      // The back (the coast side): two windows a storey, panels over the rest.
      {
        const back = faceAt(shell, 0, -hd, Math.PI),
          panels: Piece[] = [],
          holes: [number, number, number, number][] = [];
        for (const [y0, y1] of [[0.62, 1.58], [2.24, 3.2]])
          for (const x of [-1.1, 1.1])
            holes.push(deepWindow(back, panels, x, y0, y1, 0.74, y0 < 2 ? g('ground') : g(x < 0 ? 'fins' : 'balcony')));
        clad(panels, -hw, hw, B, 1.82, holes);
        clad(panels, -hw, hw, 2.02, 3.42, holes);
        cluster(back, panels, L.stone, 'stone');
        const top = faceAt(shell, 0, TZ0, Math.PI),
          topPanels: Piece[] = [];
        clad(topPanels, -TXN, -TXS, TR, TOP);
        cluster(top, topPanels, L.stone, 'stone');
      }
      for (const [face, p] of dressings) cluster(face, [p], L.dressing, 'stone');
    }

    /* -------------------------------------------------------------- */
    /* The forecourt                                                   */
    /* -------------------------------------------------------------- */
    {
      // Paving from the base course to a low limestone wall on the boundary (0.15 inside the
      // pavement at the south end, where the ring road comes closest); the path to the entrance
      // runs on through the wall's gap to the pavement.
      const wz = hd + 1.6,
        fx0 = -hw - 0.06, // in line with the base course: nothing of it in the gap toward the row
        fx1 = hw + 0.75,
        gap0 = EX0 + 0.04,
        gap1 = EX1 - 0.04;
      block(shell, fx0, fx1, 0, 0.06, hd + 0.06, wz - 0.08, L.paving, 'paving');
      // The path through the gap, out to the pavement (ending 0.05 short of it, as the homes' do).
      const world = (lx: number, lz: number): plan.XZ => [site.x + lz * Math.sin(site.rotation) + lx * Math.cos(site.rotation), site.z + lz * Math.cos(site.rotation) - lx * Math.sin(site.rotation)];
      // Out to where the pavement is furthest (the road bends away north), so the path meets it
      // along the whole width; nearer, it runs on under the pavement's raised slab.
      const reach = Math.max(...[gap0, gap1].map((x) => {
        const [px, pz] = world(x, wz);
        return plan.distanceToStreets(px, pz) - plan.PAVEMENT_WIDTH + 0.05;
      }));
      if (reach > 0.1) block(shell, gap0, gap1, 0, 0.06, wz - 0.1, wz + reach, L.paving, 'paving');
      for (const [x0, x1] of [[fx0, gap0 - 0.04], [gap1 + 0.04, fx1]]) {
        stone.push(piece(x0 + 0.02, x1 - 0.02, 0, 0.4, wz - 0.08, wz + 0.08));
        dress.push(piece(x0, x1, 0.4, 0.47, wz - 0.12, wz + 0.12));
      }
      // A low planter before the ground flat's window, its shrubs clipped below the sill.
      const pl0 = -hw + 0.3,
        pl1 = MX0 - 0.05;
      block(shell, pl0, pl1, 0, 0.38, hd + 0.18, hd + 0.62, L.stone, 'stone');
      for (let k = 0; k < 3; k++) topiary(shell, pl0 + ((pl1 - pl0) * (k + 0.5)) / 3, 0.5, hd + 0.4, 0.19, 1, 1.15, 0.7, 0.95);
      // A bench before it: a limestone block with an oak top, facing the street.
      const bz = hd + 1.02;
      stone.push(piece(-1.55, -0.35, 0, 0.32, bz - 0.17, bz + 0.17));
      oak.push(piece(-1.6, -0.3, 0.32, 0.4, bz - 0.2, bz + 0.2));
      // Two cycle hoops on the forecourt's north end, square to the front.
      for (const x of [hw + 0.1, hw + 0.48]) {
        const h = new T.Group();
        h.position.set(x, 0.06, hd + 0.95);
        h.rotation.y = Math.PI / 2;
        shell.add(h);
        cycleHoop(h, 0, 0, 0);
      }
    }

    cluster(shell, stone, L.stone, 'stone');
    cluster(shell, dress, L.dressing, 'stone');
    cluster(shell, bronze, L.bronze, 'iron', { shadow: false });
    cluster(shell, brass, L.brass, 'brass', { shadow: false });
    cluster(shell, oak, L.timber, 'wood');
  }
  return { buildResidence };
}
export type Residence = ReturnType<typeof createResidence>;
