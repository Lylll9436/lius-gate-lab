import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import { palette, type TownContext } from './town-shared';
import type { Kit } from './town-kit';
import type { Nature } from './town-nature';
import type { Props } from './town-props';
import { muted } from './town-homes';

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */
export function createBuildings(ctx: TownContext, kit: Kit, nature: Nature, props: Props) {
  const { material, lamps, clocks, animated } = ctx;
  const { box, cylinder, cone, sphere, strut, slabRoof, frameRing, door, plinth, lampGlass, ivy } = kit;
  const { topiary } = nature;
  const { bench } = props;
  /**
   * LIU'S GATE: a Glasgow triumphal arch in blonde and red sandstone with bronze accents, built in
   * Clash's secondary and tertiary structure (the ashlar is the shader's). Front +z, the opening
   * along z. Heights: plinth 0-0.45, base course to 0.57, banded rustication (four chamfered
   * courses) on the piers to the impost belt (2.31-2.45, the springing); an engaged Tuscan column
   * on each pier and face, on a pedestal (to 1.41), its capital under the architrave (3.95); the
   * archivolt (alternate red and cream voussoirs inside a cream moulding, 0.95-1.48) and a scroll
   * keystone rising into the entablature; bronze wreaths in the spandrels and on the side faces;
   * a coffered soffit; the entablature (architrave, red frieze, dentils, a corona 1.0 out from the
   * middle at 4.44-4.61); the attic (4.61-5.41) framing a blank bronze tablet between cream end
   * blocks over the columns; a stepped crowning pedestal (to 6.03) between two cast-bronze lamp
   * standards whose globes are the night lamps. Every member is at least 0.07 thick (most 0.12 or
   * more). Everything stays inside x 2.38, z 1.0 and y 6.47 (check-town), so the hit box and the
   * chapter's framing barely move.
   */
  function buildGate(shell: T.Group) {
    const W = 2.2,
      D = 1.5,
      F = D / 2, // the faces
      r = 0.95,
      foot = 0.45,
      spring = 2.45,
      b = 0.1,
      blonde = palette.blonde,
      dress = palette.trim,
      red = palette.red,
      bronze = palette.bronze,
      colX = 1.84, // the engaged columns' axes, a little into the faces
      colZ = F - 0.03,
      pierX = (r - 0.04 + W + 0.04) / 2, // the rusticated piers' middle (0.91 to 2.24)
      pierW = W - r + 0.08,
      faces = [1, -1] as const,
      polar = (a: number, R: number): [number, number] => [Math.cos(a) * R, Math.sin(a) * R],
      /** An annulus sector about the springing's middle, R0 to R1 from a0 to a1, n steps. */
      band = (R0: number, R1: number, a0: number, a1: number, n: number): [number, number][] => [
        ...Array.from({ length: n + 1 }, (_, k) => polar(a0 + ((a1 - a0) * k) / n, R1)),
        ...Array.from({ length: n + 1 }, (_, k) => polar(a1 - ((a1 - a0) * k) / n, R0)),
      ],
      /** A w x h x d block about its middle, the edges round its +-z faces chamfered by c (a face's trim). */
      slab = (w: number, h: number, d: number, c: number) => prism([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], d, c, -d / 2);
    /**
     * A w x h x d block about its middle, its plan extruded upward so that every horizontal edge is
     * chamfered by c and its upright corners are cut by c: a course or a moulding that reads from
     * every side (a slab's chamfers run only round its front and back, so its sides kept sharp,
     * invisible joints).
     */
    const ledge = (w: number, h: number, d: number, c: number) => {
      const key = [w, h, d, c].map((n) => n.toFixed(4)).join('|');
      let g = ledges.get(key);
      if (!g) {
        const x = w / 2,
          z = d / 2;
        g = prism([[-x + c, -z], [x - c, -z], [x, -z + c], [x, z - c], [x - c, z], [-x + c, z], [-x, z - c], [-x, -z + c]], h, c, -h / 2)
          .clone()
          .rotateX(-Math.PI / 2);
        ledges.set(key, g);
      }
      return g;
    };
    /** One dressed stone (each its own shade in the bake). */
    const stoneAt = (x: number, y: number, z: number, w: number, h: number, d: number, c: number, colour = dress, kind: SurfaceKind = 'stone') => {
      const m = new T.Mesh(ledge(w, h, d, c), material(colour, kind));
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      shell.add(m);
      return m;
    };
    // Battered plinths; their corners at (2.35, 0.9) stay inside the causeway sector (21.0 degrees,
    // under 21.8). Under each column pedestal the plinth breaks forward to z 0.99 (x 1.56-2.12, so
    // within 2.34 of the middle: on the island, inside the pool's inner coping at 2.4), 0.01 lower
    // than the plinth so the two tops never share a plane.
    for (const sx of [-1, 1]) {
      box(shell, sx * 1.6, foot / 2, 0, 1.5, foot, D + 0.3, palette.plinth, 'ashlar', { taper: 0.05 });
      for (const sz of faces) box(shell, sx * colX, 0.22, sz * 0.745, 0.56, 0.44, 0.49, palette.plinth, 'ashlar', { taper: 0.04 });
    }
    // One solid arch mass (piers, spandrels and the entablature's core) as a bevelled extrusion, so
    // no light shows between its parts; its top hides under the cornice.
    const body = new T.Shape();
    body.moveTo(-W, foot);
    body.lineTo(-r, foot);
    body.lineTo(-r, spring);
    body.absarc(0, spring, r, Math.PI, 0, true);
    body.lineTo(r, foot);
    body.lineTo(W, foot);
    body.lineTo(W, 4.3);
    body.lineTo(-W, 4.3);
    body.closePath();
    const mass = new T.Mesh(
      new T.ExtrudeGeometry(body, { depth: D - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 16 }),
      material(blonde, 'ashlar'),
    );
    mass.position.z = -F + b;
    mass.castShadow = mass.receiveShadow = true;
    shell.add(mass);
    // The piers: a moulded base course, four courses of banded rustication (0.435 tall, each
    // chamfered 0.055 all round, so a V channel parts them) wrapping the faces, the outer sides and
    // the reveals, and an impost belt at the springing.
    for (const sx of [-1, 1]) {
      stoneAt(sx * pierX, 0.51, 0, pierW + 0.04, 0.12, D + 0.12, 0.03);
      const c0 = 0.57,
        ch = (2.31 - c0) / 4;
      for (let i = 0; i < 4; i++) stoneAt(sx * pierX, c0 + ch * (i + 0.5), 0, pierW, ch, D + 0.08, 0.055, blonde);
      stoneAt(sx * pierX, 2.38, 0, pierW + 0.1, 0.14, D + 0.18, 0.035).userData.band = true;
    }
    // Engaged Tuscan columns, one on each pier and face: a pedestal (base, die and cap, standing on
    // the plinth's break), a square plinth, the torus, a shaft tapering over its upper two thirds,
    // an astragal and echinus turned in one half-round (its open back is in the wall), the abacus.
    const COLUMN = new T.LatheGeometry(
      (
        [
          [0, 1.41], [0.225, 1.41], [0.24, 1.44], [0.225, 1.475], [0.19, 1.49],
          [0.185, 1.53], [0.182, 2.3], [0.165, 3.64],
          [0.187, 3.655], [0.192, 3.685], [0.172, 3.7],
          [0.172, 3.72], [0.215, 3.77], [0.232, 3.81], [0, 3.81],
        ] as [number, number][]
      ).map(([x, y]) => new T.Vector2(x, y)),
      12,
      -Math.PI / 2,
      Math.PI,
    );
    const columns: Piece[] = [];
    for (const sx of [-1, 1])
      for (const sz of faces) {
        const x = sx * colX,
          back = sz * 0.55, // every pedestal piece reaches back into the rustication
          out = (front: number) => (back + sz * front) / 2;
        stoneAt(x, 0.51, out(0.97), 0.56, 0.12, 0.42, 0.03);
        stoneAt(x, 0.9, out(0.93), 0.48, 0.66, 0.38, 0.035, blonde);
        stoneAt(x, 1.28, out(0.97), 0.56, 0.1, 0.42, 0.03);
        stoneAt(x, 1.37, out(0.95), 0.48, 0.08, 0.4, 0.02);
        stoneAt(x, 3.88, out(0.97), 0.52, 0.14, 0.42, 0.03);
        columns.push({ geometry: COLUMN, at: [x, 0, sz * colZ], rotation: [0, sz > 0 ? 0 : Math.PI, 0] });
      }
    cluster(shell, columns, dress, 'stone');
    // The archivolt on each face: eight voussoirs (0.95-1.34, 0.06 proud), cream and red in turn from
    // the springing, butting in chamfered V joints, inside a continuous cream moulding (1.34-1.48,
    // 0.1 proud) that stands on the impost belt; a keystone, wider than its slot, rises in front of
    // the architrave, a scroll rolled under its foot and an oval boss on its face.
    const ring = band(1.34, 1.48, 0, Math.PI, 24),
      keyShape: [number, number][] = [[-0.165, 0.91], [0.165, 0.91], [0.3, 1.62], [-0.3, 1.62]],
      keystones: Piece[] = [];
    for (const sz of faces) {
      for (let i = 0; i < 9; i++) {
        if (i === 4) continue;
        const a0 = (i * Math.PI) / 9,
          a1 = ((i + 1) * Math.PI) / 9,
          v = new T.Mesh(prism([polar(a0, r), polar(a0, 1.34), polar(a1, 1.34), polar(a1, r)], 0.2, 0.025), material(i % 2 ? red : dress, 'stone'));
        v.position.set(0, spring, sz > 0 ? F - 0.14 : -F - 0.06);
        v.castShadow = v.receiveShadow = true;
        shell.add(v);
      }
      const moulding = new T.Mesh(prism(ring, 0.24, 0.03), material(dress, 'stone'));
      moulding.position.set(0, spring, sz > 0 ? F - 0.14 : -F - 0.1);
      moulding.castShadow = moulding.receiveShadow = true;
      shell.add(moulding);
      keystones.push(
        { geometry: prism(keyShape, 0.33, 0.025), at: [0, spring, sz > 0 ? F - 0.14 : -F - 0.19] },
        { geometry: new T.CylinderGeometry(0.055, 0.055, 0.26, 12), at: [0, spring + 0.99, sz * (F + 0.18)], rotation: [0, 0, Math.PI / 2] },
        { geometry: new T.IcosahedronGeometry(0.1, 2).scale(1, 1.3, 0.5), at: [0, spring + 1.28, sz * (F + 0.19)] },
      );
    }
    cluster(shell, keystones, dress, 'stone');
    // A coffered soffit (seen past the springing, up the haunches): transverse ribs at the faces and
    // the middle, four longitudinal ribs, 0.07 deep, so each coffer is a recessed panel.
    const soffit: Piece[] = [];
    for (const [z, w] of [[-0.55, 0.12], [0, 0.09], [0.55, 0.12]]) soffit.push({ geometry: prism(band(0.88, 0.96, 0, Math.PI, 18), w, 0.015, -w / 2), at: [0, spring, z] });
    for (let k = 1; k < 5; k++) {
      const a = (k * Math.PI) / 5,
        [x, y] = polar(a, 0.915);
      soffit.push({ geometry: slab(0.09, 0.08, 1.1, 0.015), at: [x, spring + y, 0], rotation: [0, 0, a - Math.PI / 2] });
    }
    cluster(shell, soffit, dress, 'stone');
    // Bronze wreaths on cream roundels: in both spandrels of each face and on the side faces. Each
    // wreath is a ring of fourteen soft leafy swells round a domed boss, pressed flat to read as relief.
    const wreath = (() => {
      const g = new T.TorusGeometry(0.14, 0.042, 8, 56),
        p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          y = p.getY(i),
          u = Math.atan2(y, x),
          cx = Math.cos(u) * 0.14,
          cy = Math.sin(u) * 0.14,
          k = 1 + 0.06 * Math.sin(u * 14);
        p.setXYZ(i, cx + (x - cx) * k, cy + (y - cy) * k, p.getZ(i) * k * 0.75);
      }
      g.computeVertexNormals();
      return g;
    })();
    const roundels: Piece[] = [],
      wreaths: Piece[] = [],
      disc = new T.CylinderGeometry(0.2, 0.2, 0.05, 28),
      boss = new T.IcosahedronGeometry(0.07, 2).scale(1, 1, 0.6);
    for (const sz of faces)
      for (const sx of [-1, 1]) {
        roundels.push({ geometry: disc, at: [sx * 1.36, 3.56, sz * (F + 0.025)], rotation: [Math.PI / 2, 0, 0] });
        wreaths.push({ geometry: wreath, at: [sx * 1.36, 3.56, sz * (F + 0.075)] }, { geometry: boss, at: [sx * 1.36, 3.56, sz * (F + 0.06)] });
      }
    for (const sx of [-1, 1]) {
      roundels.push({ geometry: disc, at: [sx * (W + 0.025), 3.2, 0], rotation: [0, 0, Math.PI / 2] });
      wreaths.push({ geometry: wreath, at: [sx * (W + 0.075), 3.2, 0], rotation: [0, Math.PI / 2, 0] }, { geometry: boss, at: [sx * (W + 0.06), 3.2, 0], rotation: [0, Math.PI / 2, 0] });
    }
    cluster(shell, roundels, dress, 'stone');
    cluster(shell, wreaths, bronze, 'brass');
    // The entablature: an architrave over the capitals, a red sandstone frieze, a dentil course on
    // its band (0.12 blocks about every 0.3, as on the archive) and the corona (1.0 out from the
    // middle, 2.38 at the ends), whose eave shades the frieze; thinner steps only added lines.
    stoneAt(0, 4.01, 0, 4.58, 0.12, 1.76, 0.03).userData.band = true;
    stoneAt(0, 4.17, 0, 4.52, 0.2, 1.68, 0.03, red);
    stoneAt(0, 4.355, 0, 4.5, 0.17, 1.72, 0.03).userData.band = true;
    const dentils: Piece[] = [],
      dentil = slab(0.12, 0.12, 0.12, 0.02);
    for (let i = 0; i < 16; i++) for (const sz of faces) dentils.push({ geometry: dentil, at: [-2.25 + i * 0.3, 4.38, sz * 0.885] });
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) dentils.push({ geometry: dentil, at: [sx * 2.25, 4.38, -0.6 + i * 0.3] });
    cluster(shell, dentils, dress, 'stone')!.userData.band = true;
    stoneAt(0, 4.525, 0, 4.76, 0.17, 2.0, 0.045);
    // The attic: a base moulding, the die (ashlar), cream end blocks over the columns, and in a cream
    // frame on each face a blank bronze tablet (no lettering); the attic cornice.
    stoneAt(0, 4.655, 0, 4.24, 0.09, 1.64, 0.025).userData.band = true;
    box(shell, 0, 4.97, 0, 4.08, 0.54, 1.52, blonde, 'ashlar', { segments: 2 });
    for (const sx of [-1, 1]) stoneAt(sx * colX, 4.97, 0, 0.48, 0.54, 1.6, 0.035);
    // The tablet is a shallow cushion (its face bowed 0.035 forward), so its upper half takes the sky
    // and its lower half the paving: a flat bronze face read as a dark slot in the frame.
    const cushion = new T.BoxGeometry(2.16, 0.3, 0.06, 1, 8, 1),
      cp = cushion.getAttribute('position');
    for (let i = 0; i < cp.count; i++) if (cp.getZ(i) > 0) cp.setZ(i, cp.getZ(i) + 0.035 * (1 - (cp.getY(i) / 0.15) ** 2));
    cushion.computeVertexNormals();
    const frames: Piece[] = [];
    for (const sz of faces) {
      for (const dy of [-0.185, 0.185]) frames.push({ geometry: slab(2.3, 0.07, 0.09, 0.02), at: [0, 4.97 + dy, sz * 0.765] });
      for (const sx of [-1, 1]) frames.push({ geometry: slab(0.07, 0.44, 0.09, 0.02), at: [sx * 1.115, 4.97, sz * 0.765] });
      const tablet = new T.Mesh(cushion, material(bronze, 'brass'));
      tablet.position.set(0, 4.97, sz * 0.79);
      tablet.rotation.y = sz > 0 ? 0 : Math.PI;
      tablet.castShadow = tablet.receiveShadow = true;
      shell.add(tablet);
    }
    cluster(shell, frames, dress, 'stone');
    stoneAt(0, 5.325, 0, 4.32, 0.17, 1.7, 0.04).userData.band = true; // 0.09 proud: no deep eave over the tablet
    // The stepped crowning pedestal: a step, an ashlar die, a cap and a blocking course.
    stoneAt(0, 5.455, 0, 2.0, 0.09, 1.12, 0.025);
    box(shell, 0, 5.68, 0, 1.6, 0.36, 0.84, blonde, 'ashlar');
    stoneAt(0, 5.905, 0, 1.74, 0.09, 0.98, 0.025);
    stoneAt(0, 5.99, 0, 1.46, 0.08, 0.72, 0.02);
    // Two cast-bronze lamp standards on the attic cornice over the columns: a square foot, a turned
    // baluster (foot ring, waist, knop, neck, collar) and a cup holding the globe (the night lamp),
    // crowned by a cap and a knob.
    const STANDARD = new T.LatheGeometry(
      (
        [
          [0, 5.49], [0.15, 5.49], [0.15, 5.53], [0.12, 5.55], [0.09, 5.59], [0.07, 5.65],
          [0.1, 5.71], [0.11, 5.745], [0.1, 5.78], [0.062, 5.83], [0.056, 5.9], [0.082, 5.915],
          [0.082, 5.94], [0.125, 5.96], [0.165, 6.0], [0.17, 6.02], [0.12, 6.02], [0, 6.0],
        ] as [number, number][]
      ).map(([x, y]) => new T.Vector2(x, y)),
      16,
    );
    const CAP = new T.LatheGeometry(
      ([[0, 6.35], [0.1, 6.35], [0.1, 6.37], [0.068, 6.4], [0.035, 6.415], [0.046, 6.435], [0.028, 6.455], [0, 6.462]] as [number, number][]).map(([x, y]) => new T.Vector2(x, y)),
      16,
    );
    const standards: Piece[] = [];
    for (const sx of [-1, 1]) {
      const x = sx * colX;
      standards.push(
        { geometry: ledge(0.36, 0.08, 0.36, 0.02), at: [x, 5.45, 0] },
        { geometry: STANDARD, at: [x, 0, 0] },
        { geometry: CAP, at: [x, 0, 0] },
      );
      const globe = new T.Mesh(new T.SphereGeometry(0.2, 16, 12), lampGlass());
      globe.position.set(x, 6.18, 0);
      shell.add(globe);
      lamps.push(globe);
    }
    cluster(shell, standards, bronze, 'brass');
    shell.userData.landmark = "LIU'S GATE";
    shell.userData.openingWidth = r * 2;
  }

  /*
   * The civic kit (the Town Hall and the Research Studio), on the archive's `prism`. `upright`
   * extrudes a plan upward, every edge round its top and bottom chamfered, so stacked courses part
   * in V joints seen from any side; `ledgeAt` is such a block about its middle. `parts` merges many
   * dressings into one mesh in g's space, and `tone` gives each part a shade of its own (within
   * +-tone/2, through vertex colours the bake multiplies in), as separate dressed stones get, for
   * no extra mesh. None of these are axis-aligned boxes, so the bake's concave-corner pass ignores
   * them and the walls behind keep their own corner shading.
   */
  type Part = { geometry: T.BufferGeometry; matrix: T.Matrix4 };
  const uprights = new Map<string, T.BufferGeometry>();
  function upright(points: [number, number][], h: number, c: number, y0 = 0) {
    const key = [...points.flat(), h, c, y0].map((n) => n.toFixed(4)).join('|');
    let g = uprights.get(key);
    if (!g) {
      g = prism(points.map(([x, z]): [number, number] => [x, -z]), h, c, y0).clone().rotateX(-Math.PI / 2);
      uprights.set(key, g);
    }
    return g;
  }
  /** A w x d plan about the origin, its upright corners cut by `cut` (square at 0). */
  const footprint = (w: number, d: number, cut = 0): [number, number][] => {
    const x = w / 2,
      z = d / 2;
    return cut > 0
      ? [[-x + cut, -z], [x - cut, -z], [x, -z + cut], [x, z - cut], [x - cut, z], [-x + cut, z], [-x, z - cut], [-x, -z + cut]]
      : [[-x, -z], [x, -z], [x, z], [-x, z]];
  };
  /** A w x h x d block about its middle, chamfered by c round its top and bottom and cut by c at its upright corners. */
  const ledgeAt = (w: number, h: number, d: number, c: number) => upright(footprint(w, d, c), h, c, -h / 2);
  const placed = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(1, 1, 1));
  const IDENTITY = new T.Matrix4();
  /** An annulus R0..R1 extruded from z 0 to `depth`, its edges chamfered by c. */
  const annuli = new Map<string, T.BufferGeometry>();
  function annulus(R0: number, R1: number, depth: number, c: number, segments = 24) {
    const key = [R0, R1, depth, c, segments].join('|');
    let g = annuli.get(key);
    if (!g) {
      const s = new T.Shape(),
        hole = new T.Path();
      s.absarc(0, 0, R1, 0, Math.PI * 2, false);
      hole.absarc(0, 0, R0, 0, Math.PI * 2, true);
      s.holes.push(hole);
      g = new T.ExtrudeGeometry(s, { depth: depth - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelOffset: -c, bevelSegments: 1, curveSegments: segments }).translate(0, 0, c);
      annuli.set(key, g);
    }
    return g;
  }
  function parts(g: T.Object3D, list: Part[], colour: string, kind: SurfaceKind, opts: { shadow?: boolean; tone?: number } = {}) {
    if (!list.length) return undefined;
    const tone = opts.tone ?? 0,
      mid = new T.Vector3();
    const geometries = list.map(({ geometry, matrix }) => {
      const p = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
      for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
      if (tone) {
        p.computeBoundingBox();
        p.boundingBox!.getCenter(mid);
        const k = 1 + tone * (plan.hash(mid.x * 12.9898 + mid.y * 78.233 + mid.z * 37.719) - 0.5);
        p.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(p.getAttribute('position').count * 3).fill(k), 3));
      }
      return p;
    });
    const m = new T.Mesh(mergeGeometries(geometries)!, material(colour, kind));
    geometries.forEach((p) => p.dispose());
    const shadow = opts.shadow ?? true;
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (!shadow) m.userData.noShadow = true;
    g.add(m);
    return m;
  }
  /** An arch's band between radii R0 and R1 over its springing's middle (n steps). */
  const archBand = (R0: number, R1: number, n: number): [number, number][] => [
    ...Array.from({ length: n + 1 }, (_, k): [number, number] => [Math.cos((k * Math.PI) / n) * R1, Math.sin((k * Math.PI) / n) * R1]),
    ...Array.from({ length: n + 1 }, (_, k): [number, number] => [Math.cos(((n - k) * Math.PI) / n) * R0, Math.sin(((n - k) * Math.PI) / n) * R0]),
  ];
  /** Evenly spaced stations from `from` to `to`, about `step` apart. */
  const stations = (from: number, to: number, step: number) => {
    const n = Math.max(1, Math.round((to - from) / step));
    return Array.from({ length: n + 1 }, (_, k) => from + ((to - from) * k) / n);
  };
  /**
   * An opening a course of rustication stops at: its centre cx, the height `floor` it starts from
   * (its sill's bed), its springing s, and the outer radius R of its voussoirs (its jambs' outer
   * edge below the springing); over the crown the keystone (kw half-wide) keeps a slot open.
   */
  type Opening = { cx: number; floor: number; s: number; R: number; kw: number };
  const cutAt = (o: Opening, y: number) => (y <= o.s ? o.R : Math.max(o.kw, Math.sqrt(Math.max(0, o.R * o.R - (y - o.s) ** 2))));
  /** Heights up an opening's side between y0 and y1: its ends, and more over the arch. */
  function sideHeights(o: Opening, y0: number, y1: number) {
    const kink = o.s + Math.sqrt(Math.max(0, o.R * o.R - o.kw * o.kw)),
      ys = [y0, y1, o.s, kink, ...Array.from({ length: 9 }, (_, k) => o.s + ((k + 1) / 10) * (kink - o.s))];
    return [...new Set(ys.filter((y) => y >= y0 && y <= y1).map((y) => +y.toFixed(5)))].sort((a, b) => a - b);
  }
  /**
   * One course of banded rustication on a face (local +z out of it, x along it) from a to b and
   * y0 to y1: `proud` out of the wall, its edges chamfered by c so that the courses part in V
   * joints, cut round the openings (a course under their floor runs on, notched for them; the
   * others stop at their jambs and voussoirs, so the joints meet the stone round the arch).
   */
  function rusticCourse(out: Part[], g: T.Object3D, a: number, b: number, y0: number, y1: number, openings: Opening[], proud = 0.06, c = 0.045) {
    const inside = openings.filter((o) => o.cx > a && o.cx < b && o.floor < y1).sort((p, q) => p.cx - q.cx);
    const add = (pts: [number, number][]) => out.push({ geometry: prism(pts, proud + 0.04, c, -0.04), matrix: g.matrix.clone() });
    if (!inside.length) return add([[a, y0], [b, y0], [b, y1], [a, y1]]);
    if (inside.every((o) => o.floor > y0)) {
      const pts: [number, number][] = [[a, y0], [b, y0], [b, y1]];
      for (const o of [...inside].reverse()) {
        const ys = sideHeights(o, o.floor, y1);
        for (const y of [...ys].reverse()) pts.push([o.cx + cutAt(o, y), y]);
        for (const y of ys) pts.push([o.cx - cutAt(o, y), y]);
      }
      pts.push([a, y1]);
      return add(pts);
    }
    const ends: (Opening | number)[] = [a, ...inside, b];
    for (let i = 0; i + 1 < ends.length; i++) {
      const L = ends[i],
        R = ends[i + 1],
        ysL = typeof L === 'number' ? [y0, y1] : sideHeights(L, y0, y1),
        ysR = typeof R === 'number' ? [y0, y1] : sideHeights(R, y0, y1),
        xL = (y: number) => (typeof L === 'number' ? L : L.cx + cutAt(L, y)),
        xR = (y: number) => (typeof R === 'number' ? R : R.cx - cutAt(R, y));
      if (Math.min(...ysR.map(xR)) - Math.max(...ysL.map(xL)) < 0.1) continue;
      add([...ysR.map((y): [number, number] => [xR(y), y]), ...[...ysL].reverse().map((y): [number, number] => [xL(y), y])]);
    }
  }
  /** An L-shaped quoin round the corner (cx, cz) (sx, sz its outward signs): arms ax along x and az along z, q proud of both faces, 0.04 into the wall. */
  const quoin = (cx: number, cz: number, sx: number, sz: number, ax: number, az: number, q: number, y0: number, h: number, c: number) =>
    upright(
      [
        [cx - sx * ax, cz - sz * 0.04],
        [cx - sx * ax, cz + sz * q],
        [cx + sx * q, cz + sz * q],
        [cx + sx * q, cz - sz * az],
        [cx - sx * 0.04, cz - sz * az],
        [cx - sx * 0.04, cz - sz * 0.04],
      ],
      h,
      c,
      y0,
    );
  /** A triangular pediment's raking cornice: a chevron band `thick` deep (vertical) under a slope that rises `rise` over the half-span `half`. */
  const chevron = (half: number, rise: number, thick: number, depth: number, c = 0.02) => {
    const k = rise / half,
      inner = rise - thick;
    return prism([[-half, 0], [-inner / k, 0], [0, inner], [inner / k, 0], [half, 0], [0, rise]], depth, c);
  };

  /**
   * The Town Hall (the 'About' chapter's subject and the tallest building): a Glasgow burgh hall
   * in blonde sandstone under a copper roof, built in Clash's secondary and tertiary structure (the
   * ashlar is the shader's). The block (walls 0.5-4.8): a moulded plinth course; a ground storey of
   * banded rustication (six V-jointed courses, 0.64-2.78) between L-shaped quoins, its arched
   * windows in jambs, voussoirs and keystones that rise into the string course (2.78-3.0, the upper
   * windows' sill band); an upper storey of pilasters with bases and capitals, its windows in
   * eared architraves under pediments; a modillion cornice (4.6-4.96) whose corona shades the
   * frieze; a parapet with dies and ball finials hiding the copper roof's eaves (front and rear),
   * the gables with oculi under the verges, two stone dormers with bull's-eye lights, copper
   * cresting and ball finials on the ridge. The tower (0.4-2.9 in z, 0.6 proud of the front): its
   * rusticated base framing the arched door in an aedicule (engaged Tuscan columns, an entablature
   * and a pediment); quoins up to the window stage, the arched window in a stone surround; a
   * moulded cornice (6.0-6.22); the clock stage between quoined corner piers, each clock in a
   * moulded ring with keystones; a modillion cornice and a parapet with corner pinnacles; a
   * louvred belfry; a copper spire with hip rolls and four lucarnes, the finial and the vane. The
   * clocks' hands, the vane, the windows' panes (their centres seed their night lights) and the
   * bounds (x 4.03, z -2.88 to 4.05, y 13.3) stay as they were, so the hit box and the chapter's
   * framing do not move (check-town).
   */
  function buildHall(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d,
      E = w / 2, // the side walls
      F = d / 2, // the front wall
      tw = 2.5,
      TX = tw / 2,
      tz = F + 0.6 - TX, // the tower stands 0.6 proud of the front (z 0.4 to 2.9)
      TF = tz + TX, // its front face
      blonde = palette.blonde,
      dress = palette.trim,
      G0 = 0.64, // the ground storey's rustication, from the plinth course ...
      G1 = 2.78, // ... to the string course's bed
      NC = 6,
      ch = (G1 - G0) / NC,
      SQ = Math.SQRT1_2;
    const dressings: Part[] = [], // trim sandstone, each piece a shade of its own
      rustic: Part[] = [], // the rusticated courses, a shade deeper than the walls, so the base reads heavier
      parapetDies: Part[] = [], // the parapets' blonde dies
      bars: Part[] = [], // glazing bars: cast nothing
      copper: Part[] = [],
      rolls: Part[] = [], // copper-light rolls, cresting and balls
      dark: Part[] = []; // the belfry's and lucarnes' dark openings
    const faceAt = (x: number, z: number, ry: number) => {
      const g = new T.Group();
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      g.updateMatrix();
      shell.add(g);
      return g;
    };
    const on = (g: T.Object3D, m: T.Matrix4) => g.matrix.clone().multiply(m);
    const glassOf = (o: T.Object3D) => o instanceof T.Mesh && (o.material as T.Material).userData?.surfaceKind === 'glass';

    plinth(shell, w, d, palette.plinth, { height: 0.5 });
    plinth(shell, tw, tw, palette.plinth, { z: tz, height: 0.52, blocks: true });
    box(shell, 0, 2.65, 0, w, 4.3, d, blonde, 'ashlar');
    // The moulded plinth course (0.12 proud, its weathered top a chamfer) round the block, and
    // round the tower's projection up to the door.
    dressings.push({ geometry: upright(footprint(w + 0.24, d + 0.24, 0.05), 0.14, 0.04, 0.5), matrix: IDENTITY });
    for (const s of [-1, 1])
      dressings.push({
        geometry: upright([[s * 0.76, TF - 0.04], [s * 0.76, TF + 0.1], [s * (TX + 0.1), TF + 0.1], [s * (TX + 0.1), F], [s * (TX - 0.04), F], [s * (TX - 0.04), TF - 0.04]], 0.12, 0.035, 0.52),
        matrix: IDENTITY,
      });

    const front = faceAt(0, F, 0),
      east = faceAt(E, 0, Math.PI / 2),
      west = faceAt(-E, 0, -Math.PI / 2),
      towerFront = faceAt(0, TF, 0),
      towerEast = faceAt(TX, 0, Math.PI / 2),
      towerWest = faceAt(-TX, 0, -Math.PI / 2),
      rear = faceAt(0, -F, Math.PI);

    /**
     * An arched window on a face (local +z out of it): a painted frame, the pane where windowAt put
     * it (0.06 out; its centre seeds its night light), glazing bars (a mullion, a transom at the
     * springing and two head bars), and a dressed surround: jambs, imposts, voussoirs, a keystone
     * rising `key` over them, and a sill on a drip bed. Returns the pane.
     */
    function archedWindow(g: T.Group, x: number, y: number, ww: number, h: number, jamb: number, key: number, brackets = false) {
      const r = ww / 2,
        f = 0.08,
        s = y + h / 2,
        R0 = r + f,
        R1 = R0 + jamb,
        foot = y - h / 2 - f,
        deep = 0.16,
        ring = frameRing(g, x, y, 0.02, ww, h, f, 0.1, dress, 'paint', true),
        glass = new T.Mesh(new T.ShapeGeometry(ring(0.01), 8), material(palette.glass, 'glass'));
      glass.position.set(x, y, 0.06);
      g.add(glass);
      const bar = (bw: number, bh: number) => new T.BoxGeometry(bw, bh, 0.04);
      bars.push(
        { geometry: bar(0.07, h + r), matrix: on(g, placed(x, y + r / 2, 0.09)) },
        { geometry: bar(ww, 0.07), matrix: on(g, placed(x, s, 0.09)) },
        ...[-1, 1].map((k): Part => ({ geometry: bar(0.07, r), matrix: on(g, placed(x + (k * r * SQ) / 2, s + (r * SQ) / 2, 0.09, 0, 0, (-k * Math.PI) / 4)) })),
      );
      for (const v of voussoirs(R0, R1, deep, [0, 0, 0])) dressings.push({ geometry: v.geometry, matrix: on(g, placed(x, s, 0)) });
      dressings.push({ geometry: keystone(R0 - 0.03, R1 + key, 0.18, 0.3, deep + 0.04), matrix: on(g, placed(x, s, 0)) });
      for (const k of [-1, 1]) {
        dressings.push(
          { geometry: chamfered(jamb, s - 0.12 - foot, deep), matrix: on(g, placed(x + k * (R0 + jamb / 2), (foot + s - 0.12) / 2, deep / 2)) },
          { geometry: chamfered(jamb + 0.06, 0.12, deep + 0.04), matrix: on(g, placed(x + k * (R0 + jamb / 2), s - 0.06, (deep + 0.04) / 2)) },
        );
        if (brackets) dressings.push({ geometry: chamfered(0.13, 0.15, 0.18), matrix: on(g, placed(x + k * (R1 - 0.1), foot - 0.235, 0.09)) });
      }
      dressings.push(
        { geometry: chamfered(2 * (R1 + 0.03), 0.09, 0.26), matrix: on(g, placed(x, foot - 0.045, 0.13)) },
        { geometry: chamfered(2 * R1 - 0.06, 0.07, 0.18), matrix: on(g, placed(x, foot - 0.125, 0.09)) },
      );
      return glass;
    }
    /**
     * An upper-storey window (piano nobile) on a face: a painted frame with a meeting rail and a
     * middle bar, the pane where windowAt put it, an architrave standing on the string course with
     * lugs at its head, and a triangular pediment whose apex stays under the cornice's bed (4.6).
     */
    function nobileWindow(g: T.Group, x: number) {
      const y = 3.55,
        ww = 0.85,
        h = 0.95,
        f = 0.09,
        ring = frameRing(g, x, y, 0.02, ww, h, f, 0.1, dress, 'paint'),
        glass = new T.Mesh(new T.ShapeGeometry(ring(0.01), 8), material(palette.glass, 'glass'));
      glass.position.set(x, y, 0.06);
      g.add(glass);
      bars.push({ geometry: new T.BoxGeometry(ww, 0.07, 0.04), matrix: on(g, placed(x, y, 0.09)) }, { geometry: new T.BoxGeometry(0.07, h, 0.04), matrix: on(g, placed(x, y, 0.09)) });
      const head = y + h / 2 + f, // the frame's head, 4.115
        aw = ww + 2 * f;
      frameRing(g, x, (3.0 + head) / 2, 0, aw, head - 3.0, 0.12, 0.15, dress, 'stone', false, true);
      const top = head + 0.12;
      for (const k of [-1, 1]) dressings.push({ geometry: chamfered(0.09, 0.2, 0.15), matrix: on(g, placed(x + k * (aw / 2 + 0.165), top - 0.1, 0.075)) });
      dressings.push(
        { geometry: chamfered(1.5, 0.08, 0.24), matrix: on(g, placed(x, top + 0.04, 0.12)) },
        { geometry: prism([[-0.66, 0], [0.66, 0], [0, 0.24]], 0.14, 0.02), matrix: on(g, placed(x, top + 0.08, 0)) },
        { geometry: chevron(0.72, 0.262, 0.091, 0.22), matrix: on(g, placed(x, top + 0.08, 0)) },
      );
      return glass;
    }

    // Rustication: six courses on every face and the tower's base, between the quoins, round the
    // windows and the door. The quoins' arms alternate long
    // and short from course to course; the courses stop at them.
    const lower = (cx: number): Opening => ({ cx, floor: 0.685, s: 2.075, R: 0.73, kw: 0.15 }),
      doorway: Opening = { cx: 0, floor: 0.52, s: 2.02, R: 0.75, kw: 0.14 };
    for (let i = 0; i < NC; i++) {
      const y0 = G0 + i * ch,
        y1 = y0 + ch,
        fa = i % 2 ? 0.36 : 0.62,
        sa = i % 2 ? 0.62 : 0.36;
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) dressings.push({ geometry: quoin(sx * E, sz * F, sx, sz, fa, sa, 0.12, y0, ch, 0.05), matrix: IDENTITY });
      rusticCourse(rustic, front, TX, E - fa, y0, y1, [lower(2.54)]);
      rusticCourse(rustic, front, -(E - fa), -TX, y0, y1, [lower(-2.54)]);
      for (const g of [east, west]) rusticCourse(rustic, g, -(F - sa), F - sa, y0, y1, [lower(-0.95), lower(0.95)]);
      rusticCourse(rustic, rear, -(E - fa), E - fa, y0, y1, []);
      rusticCourse(rustic, towerFront, -(TX + 0.06), TX + 0.06, y0, y1, [doorway]);
      rusticCourse(rustic, towerEast, -(TF + 0.06), -F, y0, y1, []);
      rusticCourse(rustic, towerWest, F, TF + 0.06, y0, y1, []);
    }
    // Two bays a side and on each gable end: arched windows below the string course, pedimented
    // ones above. The east side's front arch (seen from the overview and the chapter) keeps a dim
    // lamp all night.
    for (const sx of [-1, 1]) {
      archedWindow(front, sx * 2.54, 1.5, 0.85, 1.15, 0.225, 0.13);
      nobileWindow(front, sx * 2.54);
      for (const z of [-0.95, 0.95]) {
        const pane = archedWindow(sx > 0 ? east : west, z, 1.5, 0.85, 1.15, 0.225, 0.13);
        if (sx === 1 && z === -0.95) pane.userData.nightLight = true;
        nobileWindow(sx > 0 ? east : west, z);
      }
    }
    // The string course (the upper windows' sill band): a bed and a weathered course, round the
    // block and round the tower.
    const around = (hx: number, zf: number, c: number): [number, number][] => [[-hx, tz - TX], [hx, tz - TX], [hx, zf - c], [hx - c, zf], [-hx + c, zf], [-hx, zf - c]];
    parts(
      shell,
      [
        { geometry: upright(footprint(w + 0.16, d + 0.16, 0.03), 0.08, 0.025, G1), matrix: IDENTITY },
        { geometry: upright(footprint(w + 0.32, d + 0.32, 0.05), 0.14, 0.045, G1 + 0.08), matrix: IDENTITY },
        { geometry: upright(around(TX + 0.08, TF + 0.08, 0.03), 0.08, 0.025, G1), matrix: IDENTITY },
        { geometry: upright(around(TX + 0.16, TF + 0.16, 0.05), 0.14, 0.045, G1 + 0.08), matrix: IDENTITY },
      ],
      dress,
      'stone',
    );
    // Pilasters on the upper storey, standing on the string course: at the corners and either side
    // of the tower, each a base, a shaft, a necking and a capital under the cornice's bed.
    const pilaster = (x: number, z: number, pw: number, pd: number) =>
      dressings.push(
        { geometry: ledgeAt(pw + 0.1, 0.12, pd + 0.1, 0.03), matrix: placed(x, 3.06, z) },
        { geometry: ledgeAt(pw, 1.26, pd, 0.03), matrix: placed(x, 3.75, z) },
        { geometry: ledgeAt(pw + 0.05, 0.06, pd + 0.05, 0.02), matrix: placed(x, 4.41, z) },
        { geometry: ledgeAt(pw + 0.13, 0.16, pd + 0.13, 0.035), matrix: placed(x, 4.52, z) },
      );
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) pilaster(sx * 3.6, sz * 2.2, 0.45, 0.45);
      pilaster(sx * 1.475, F, 0.45, 0.3);
    }
    // The cornice: a bed (4.6-4.68), modillions under the corona (0.11 wide, about 0.38 apart) and
    // the corona (4.78-4.96, 0.32 proud), a mesh of its own so that its eave shades the frieze.
    const modillion = chamfered(0.11, 0.1, 0.22);
    dressings.push({ geometry: upright(footprint(w + 0.16, d + 0.16, 0.03), 0.08, 0.025, 4.6), matrix: IDENTITY });
    for (const x of stations(-E + 0.2, E - 0.2, 0.38)) {
      if (Math.abs(x) > TX + 0.12) dressings.push({ geometry: modillion, matrix: placed(x, 4.73, F + 0.15) });
      dressings.push({ geometry: modillion, matrix: placed(x, 4.73, -F - 0.15) });
    }
    for (const z of stations(-F + 0.2, F - 0.2, 0.38)) for (const sx of [-1, 1]) dressings.push({ geometry: modillion, matrix: placed(sx * (E + 0.15), 4.73, z, 0, Math.PI / 2) });
    parts(shell, [{ geometry: upright(footprint(w + 0.64, d + 0.64, 0.08), 0.18, 0.045, 4.78), matrix: IDENTITY }], dress, 'stone');
    // The parapet over the front and rear cornice (behind it the roof's eaves): a base, a blonde
    // die and a coping, with dies over the pilasters and balls on the corner dies.
    const parapet = (x0: number, x1: number, sz: number, dies: number[]) => {
      const L = x1 - x0,
        cx = (x0 + x1) / 2,
        z = sz * (F + 0.13);
      dressings.push({ geometry: ledgeAt(L, 0.08, 0.3, 0.025), matrix: placed(cx, 5.0, z) }, { geometry: ledgeAt(L + 0.04, 0.1, 0.3, 0.03), matrix: placed(cx, 5.35, z) });
      parapetDies.push({ geometry: ledgeAt(L - 0.04, 0.26, 0.2, 0.02), matrix: placed(cx, 5.17, z) });
      for (const x of dies) {
        dressings.push({ geometry: ledgeAt(0.52, 0.52, 0.38, 0.03), matrix: placed(x, 5.22, z) }, { geometry: ledgeAt(0.6, 0.08, 0.46, 0.025), matrix: placed(x, 5.52, z) });
        if (Math.abs(x) > 3)
          dressings.push(
            { geometry: new T.CylinderGeometry(0.08, 0.1, 0.1, 10), matrix: placed(x, 5.61, z) },
            { geometry: new T.IcosahedronGeometry(0.14, 2), matrix: placed(x, 5.79, z) },
          );
      }
    };
    for (const sx of [-1, 1]) parapet(sx > 0 ? TX : -E - 0.12, sx > 0 ? E + 0.12 : -TX, 1, [sx * 1.49, sx * 3.6]);
    parapet(-E - 0.12, E + 0.12, -1, [-3.6, 0, 3.6]);
    // The copper roof: its eaves (0.05) hide behind the parapets; the verges (0.3) overhang the gables.
    slabRoof(shell, 0, 4.8, 0, w, d, 2.2, palette.copper, { eave: 0.05, verge: 0.3, thick: 0.22, ridge: palette.copperLight, gable: blonde });
    // Ridge cresting (copper-light diamonds) and ball finials over the gables.
    for (const x of stations(-3.4, 3.4, 0.4)) rolls.push({ geometry: prism([[0, 0], [0.075, 0.09], [0, 0.18], [-0.075, 0.09]], 0.07, 0.015, -0.035), matrix: placed(x, 7.33, 0) });
    for (const sx of [-1, 1])
      rolls.push(
        { geometry: new T.CylinderGeometry(0.07, 0.09, 0.14, 10), matrix: placed(sx * 3.82, 7.4, 0) },
        { geometry: new T.IcosahedronGeometry(0.13, 2), matrix: placed(sx * 3.82, 7.58, 0) },
      );
    // An oculus in each gable, under the verge: a moulded ring and four keystones round a round light.
    for (const g of [east, west]) {
      dressings.push({ geometry: annulus(0.31, 0.43, 0.14, 0.03), matrix: on(g, placed(0, 5.85, -0.02)) });
      for (let k = 0; k < 4; k++) dressings.push({ geometry: keystone(0.4, 0.55, 0.14, 0.2, 0.18), matrix: on(g, placed(0, 5.85, -0.02, 0, 0, (k * Math.PI) / 2)) });
    }
    // The tower: an ashlar shaft (0.5-8.85).
    box(shell, 0, 4.675, tz, tw, 8.35, tw, blonde, 'ashlar', { segments: 2 });
    // The door, smaller now, in its own arched surround on the rusticated base; its fanlight is lit
    // late (at today's colour, 0.8), as the tower window is, so the hall's front shows a lit
    // entrance and tower all evening in its chapter, not three panes on a dark block.
    const beforeDoor = shell.children.length;
    door(shell, 0, 0.52, TF, 1.1, 1.5, palette.greenDoor, { arched: true, landing: 0.25, width: 2.0 });
    for (const o of shell.children.slice(beforeDoor)) if (glassOf(o)) o.userData.windowLit = 0.8;
    // The aedicule: engaged Tuscan columns on the rustication (a plinth, a torus, a tapering shaft,
    // an astragal, the echinus and a square abacus), an entablature breaking forward over them
    // (architrave, frieze, cornice) and a pediment under the tower window's sill.
    const COLUMN = new T.LatheGeometry(
      (
        [
          [0, 0.52], [0.19, 0.52], [0.19, 0.6], [0.165, 0.625], [0.14, 0.66], [0.135, 1.7], [0.118, 2.56],
          [0.138, 2.58], [0.124, 2.605], [0.124, 2.62], [0.17, 2.68], [0.178, 2.72], [0, 2.72],
        ] as [number, number][]
      ).map(([x, y]) => new T.Vector2(x, y)),
      12,
      -Math.PI / 2,
      Math.PI,
    );
    for (const sx of [-1, 1])
      dressings.push(
        { geometry: COLUMN, matrix: placed(sx * 0.97, 0, TF + 0.06) },
        { geometry: ledgeAt(0.44, 0.08, 0.33, 0.02), matrix: placed(sx * 0.97, 0.56, TF + 0.085) },
        { geometry: ledgeAt(0.42, 0.06, 0.32, 0.02), matrix: placed(sx * 0.97, 2.75, TF + 0.1) },
      );
    dressings.push(
      { geometry: ledgeAt(2.4, 0.12, 0.3, 0.025), matrix: placed(0, G1 + 0.06, TF + 0.13) },
      { geometry: ledgeAt(2.34, 0.08, 0.26, 0.02), matrix: placed(0, G1 + 0.16, TF + 0.11) },
      { geometry: ledgeAt(2.6, 0.12, 0.4, 0.035), matrix: placed(0, G1 + 0.26, TF + 0.18) },
      { geometry: prism([[-1.15, 0], [1.15, 0], [0, 0.35]], 0.2, 0.02), matrix: placed(0, G1 + 0.32, TF + 0.06) },
      { geometry: chevron(1.3, 0.395, 0.14, 0.38, 0.025), matrix: placed(0, G1 + 0.32, TF - 0.02) },
    );
    // Quoins up the tower's front corners to its cornice, and the window stage's arched window
    // (lit late) in its surround, the sill on two brackets, the keystone rising into the cornice.
    for (let i = 0; i < 6; i++)
      for (const sx of [-1, 1]) dressings.push({ geometry: quoin(sx * TX, TF, sx, 1, i % 2 ? 0.3 : 0.5, i % 2 ? 0.44 : 0.3, 0.08, 3.0 + i * 0.5, 0.5, 0.045), matrix: IDENTITY });
    archedWindow(towerFront, 0, 4.65, 0.8, 1.2, 0.22, 0.13, true).userData.windowLit = 0.8;
    // The tower's cornice: a bed and a corona (a mesh of its own: an eave).
    dressings.push({ geometry: ledgeAt(tw + 0.16, 0.08, tw + 0.16, 0.025), matrix: placed(0, 6.04, tz) });
    parts(shell, [{ geometry: ledgeAt(tw + 0.44, 0.14, tw + 0.44, 0.04), matrix: placed(0, 6.15, tz) }], dress, 'stone');
    // The clock stage between quoined piers clasping the corners (blocks alternately 0.36 and 0.3
    // square, V-jointed), under the crown.
    const pier = (8.85 - 6.22) / 6;
    for (let i = 0; i < 6; i++)
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) dressings.push({ geometry: ledgeAt(i % 2 ? 0.3 : 0.36, pier, i % 2 ? 0.3 : 0.36, 0.04), matrix: placed(sx * TX, 6.22 + pier * (i + 0.5), tz + sz * TX) });
    // Four clocks at 70% of the face: an iron rim, a cream dial that glows after dusk like the
    // windows, four iron markers, a fixed brass hub and iron hands that keep Glasgow time; each in a
    // moulded stone ring with a keystone above and below.
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const face = new T.Group();
      face.position.set(0, 0, tz);
      face.rotation.y = side;
      face.updateMatrix();
      shell.add(face);
      dressings.push({ geometry: annulus(0.95, 1.07, 0.14, 0.03, 32), matrix: on(face, placed(0, 7.75, TX - 0.02)) });
      for (const k of [0, 1]) dressings.push({ geometry: keystone(0.97, 1.2, 0.16, 0.24, 0.18), matrix: on(face, placed(0, 7.75, TX - 0.02, 0, 0, k * Math.PI)) });
      // The dial is a flat glass face 0.004 proud of the rim: a dial with sides showed a strip of
      // its upward side above the rim, and that caught the glass glint as a pale ring on the shaded clocks.
      const rim = new T.Mesh(new T.CylinderGeometry(0.95, 0.95, 0.096, 24), material(palette.metal, 'iron'));
      rim.rotation.x = Math.PI / 2;
      rim.position.set(0, 7.75, tw / 2 + 0.048);
      rim.castShadow = rim.receiveShadow = true;
      face.add(rim);
      const dial = new T.Mesh(new T.CircleGeometry(0.85, 24), material(palette.white, 'glass'));
      dial.position.set(0, 7.75, tw / 2 + 0.1);
      dial.userData.flatGlass = true; // an even cream face under the glass glint, not a window's gradient
      dial.userData.window = 'dial'; // lit at exactly today's glow all night
      face.add(dial);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        box(face, Math.sin(a) * 0.66, 7.75 + Math.cos(a) * 0.66, tw / 2 + 0.105, 0.1, 0.2, 0.03, palette.metal, 'iron', { rz: -a });
      }
      const hub = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.05, 12), material(palette.brass, 'brass'));
      hub.rotation.x = Math.PI / 2;
      hub.position.set(0, 7.75, tw / 2 + 0.16); // static, so it batches with the tower
      face.add(hub);
      const hands = new T.Group();
      hands.position.set(0, 7.75, tw / 2 + 0.14);
      hands.userData.keepSeparate = true;
      face.add(hands);
      const hour = new T.Group(),
        minute = new T.Group();
      hands.add(hour, minute);
      box(hour, 0, 0.2, 0, 0.09, 0.45, 0.02, palette.ink, 'iron');
      box(minute, 0, 0.3, 0, 0.07, 0.65, 0.02, palette.ink, 'iron');
      clocks.push({ hour, minute });
      // The belfry's louvred opening on this face: a dark arched recess, four copper louvres, a
      // stone arch, jambs and a sill.
      const louvreAt = (m: T.Matrix4) => on(face, m);
      dressings.push(
        { geometry: prism(archBand(0.28, 0.4, 10), 0.12, 0.02), matrix: louvreAt(placed(0, 9.95, 0.78)) },
        { geometry: keystone(0.3, 0.46, 0.12, 0.18, 0.15), matrix: louvreAt(placed(0, 9.95, 0.78)) },
        { geometry: chamfered(0.8, 0.08, 0.22), matrix: louvreAt(placed(0, 9.31, 0.85)) },
        ...[-1, 1].map((k): Part => ({ geometry: chamfered(0.12, 0.6, 0.12), matrix: louvreAt(placed(k * 0.34, 9.65, 0.84)) })),
      );
      dark.push({ geometry: prism([[-0.28, 0], [0.28, 0], ...Array.from({ length: 9 }, (_, k): [number, number] => [Math.cos((k * Math.PI) / 8) * 0.28, 0.6 + Math.sin((k * Math.PI) / 8) * 0.28])], 0.03, 0.005), matrix: louvreAt(placed(0, 9.35, 0.8)) });
      for (const y of [9.48, 9.64, 9.8, 9.96]) copper.push({ geometry: chamfered(0.56, 0.07, 0.14), matrix: louvreAt(placed(0, y, 0.86, 0.55)) });
      // A lucarne on this face of the spire: a copper body, a gabled copper roof and a dark light.
      copper.push(
        { geometry: chamfered(0.34, 0.34, 0.47), matrix: louvreAt(placed(0, 11.03, 0.685)) },
        { geometry: prism([[-0.24, 0], [0.24, 0], [0, 0.2]], 0.53, 0.015), matrix: louvreAt(placed(0, 11.2, 0.42)) },
      );
      dark.push({ geometry: chamfered(0.18, 0.2, 0.03), matrix: louvreAt(placed(0, 11.02, 0.92)) });
    }
    // The crown: a bed, modillions and a corona (an eave), a parapet between pedestals at the
    // corners, each carrying a pinnacle (a turned stone shaft under a copper cap and a ball).
    dressings.push({ geometry: ledgeAt(tw + 0.46, 0.08, tw + 0.46, 0.025), matrix: placed(0, 8.89, tz) });
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      for (const u of stations(-1.0, 1.0, 0.33)) dressings.push({ geometry: chamfered(0.1, 0.1, 0.2), matrix: placed(0, 0, tz, 0, side).multiply(placed(u, 8.98, 1.5)) });
    parts(shell, [{ geometry: ledgeAt(tw + 0.78, 0.16, tw + 0.78, 0.045), matrix: placed(0, 9.11, tz) }], dress, 'stone');
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      dressings.push(
        { geometry: chamfered(2.12, 0.26, 0.14), matrix: placed(0, 0, tz, 0, side).multiply(placed(0, 9.32, 1.43)) },
        { geometry: chamfered(2.16, 0.08, 0.22), matrix: placed(0, 0, tz, 0, side).multiply(placed(0, 9.49, 1.43)) },
      );
    const PINNACLE = new T.LatheGeometry(
      ([[0, 9.68], [0.16, 9.68], [0.16, 9.72], [0.115, 9.76], [0.105, 10.04], [0.145, 10.07], [0.145, 10.12], [0, 10.12]] as [number, number][]).map(([x, y]) => new T.Vector2(x, y)),
      12,
    );
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * 1.28,
          z = tz + sz * 1.28;
        dressings.push(
          { geometry: ledgeAt(0.44, 0.43, 0.44, 0.03), matrix: placed(x, 9.405, z) },
          { geometry: ledgeAt(0.5, 0.06, 0.5, 0.02), matrix: placed(x, 9.65, z) },
          { geometry: PINNACLE, matrix: placed(x, 0, z) },
        );
        cone(shell, x, 10.37, z, 0.21, 0.5, palette.copper, 'copper', 4);
        rolls.push({ geometry: new T.IcosahedronGeometry(0.06, 1), matrix: placed(x, 10.66, z) });
      }
    // The belfry (9.19-10.39) with corner pilasters, its cornice and blocking course; the spire
    // (10.62-12.57) with copper-light rolls up its hips; the finial and the vane.
    box(shell, 0, 9.79, tz, 1.6, 1.2, 1.6, blonde, 'ashlar');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) dressings.push({ geometry: ledgeAt(0.24, 1.2, 0.24, 0.03), matrix: placed(sx * 0.8, 9.79, tz + sz * 0.8) });
    dressings.push({ geometry: ledgeAt(1.86, 0.07, 1.86, 0.02), matrix: placed(0, 10.585, tz) });
    parts(shell, [{ geometry: ledgeAt(2.0, 0.16, 2.0, 0.04), matrix: placed(0, 10.47, tz) }], dress, 'stone');
    cone(shell, 0, 10.62 + 0.975, tz, 1.3, 1.95, palette.copper, 'copper', 4);
    {
      const apex = new T.Vector3(0, 12.57, tz),
        up = new T.Vector3(0, 1, 0);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const foot = new T.Vector3(sx * 0.919, 10.62, tz + sz * 0.919),
            run = apex.clone().sub(foot),
            q = new T.Quaternion().setFromUnitVectors(up, run.clone().normalize());
          rolls.push({ geometry: new T.CylinderGeometry(0.05, 0.05, run.length() - 0.05, 8), matrix: new T.Matrix4().compose(foot.clone().addScaledVector(run, 0.5), q, new T.Vector3(1, 1, 1)) });
        }
    }
    sphere(shell, 0, 12.55, tz, 0.09, palette.brass, 'brass');
    cylinder(shell, 0, 12.55, tz, 0.035, 0.05, 1.2, palette.bronze, 'brass'); // starts inside the spire
    sphere(shell, 0, 13.2, tz, 0.1, palette.brass, 'brass');
    const vane = new T.Group();
    vane.position.set(0, 12.85, tz);
    vane.userData.keepSeparate = true;
    shell.add(vane);
    box(vane, 0.42, 0, 0, 0.75, 0.5, 0.04, palette.blueDoor, 'fabric');
    animated.push({
      object: vane,
      update(time) {
        vane.rotation.y = Math.sin(time * 0.3) * 0.8 + Math.sin(time * 0.07) * 1.5;
      },
    });
    // Two stone dormers on the front slope over the bays: a dressed front with a bull's-eye light in
    // a moulded ring under a pediment, copper cheeks and a copper roof running back into the slope.
    const dormers: T.Mesh[] = [];
    for (const sx of [-1, 1]) {
      const x = sx * 2.54,
        z = 1.8;
      dressings.push(
        { geometry: chamfered(0.92, 0.88, 0.14), matrix: placed(x, 5.89, z - 0.07) },
        { geometry: annulus(0.2, 0.28, 0.1, 0.02), matrix: placed(x, 5.89, z - 0.02) },
        { geometry: chamfered(1.04, 0.07, 0.22), matrix: placed(x, 6.365, z - 0.06) },
        { geometry: prism([[-0.46, 0], [0.46, 0], [0, 0.2]], 0.12, 0.015), matrix: placed(x, 6.4, z - 0.14) },
        { geometry: chevron(0.54, 0.235, 0.09, 0.2), matrix: placed(x, 6.4, z - 0.16) },
      );
      copper.push(
        { geometry: chamfered(0.82, 0.8, 1.0), matrix: placed(x, 5.93, z - 0.64) },
        { geometry: prism([[-0.5, 0], [0.5, 0], [0, 0.27]], 1.0, 0.02), matrix: placed(x, 6.36, z - 1.16) },
      );
      const disc = new T.Shape();
      disc.absarc(0, 0, 0.205, 0, Math.PI * 2, false);
      const pane = new T.Mesh(new T.ShapeGeometry(disc, 12), material(palette.glass, 'glass'));
      pane.position.set(x, 5.89, z + 0.01);
      dormers.push(pane);
    }
    // Forecourt planters, grounded, each with a clipped topiary ball.
    for (const sx of [-1, 1]) {
      box(shell, sx * 1.85, 0.25, d / 2 + 1.15, 0.7, 0.5, 0.7, palette.plinth, 'stone', { taper: 0.04 });
      topiary(shell, sx * 1.85, 0.85, d / 2 + 1.15, 0.38, 2);
    }
    parts(shell, dressings, dress, 'stone', { tone: 0.05 });
    parts(shell, rustic, '#d3b683', 'stone', { tone: 0.05 });
    parts(shell, parapetDies, blonde, 'stone', { tone: 0.05 });
    parts(shell, bars, dress, 'paint', { shadow: false });
    parts(shell, copper, palette.copper, 'copper');
    parts(shell, rolls, palette.copperLight, 'copper');
    parts(shell, dark, palette.ink, 'paint', { shadow: false });
    // The gable oculi's and the dormers' lights come last, so the older panes keep their night lights.
    for (const g of [east, west]) {
      const disc = new T.Shape();
      disc.absarc(0, 0, 0.32, 0, Math.PI * 2, false);
      const pane = new T.Mesh(new T.ShapeGeometry(disc, 16), material(palette.glass, 'glass'));
      pane.position.set(0, 5.85, 0.02);
      g.add(pane);
    }
    for (const pane of dormers) shell.add(pane);
  }

  function buildStudio(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d,
      white = '#eef0ea';
    // A low kerb-stone plinth under two volumes. A: a glass box in a chunky white frame (corner
    // posts, two bands, sharp mullions) under a green roof garden. B: a rendered block 0.3 behind
    // A's front with punched windows on its front and on the +x face seen at overview.
    plinth(shell, w, d, palette.kerb, { height: 0.35 });
    const aw = 3.4,
      ah = 4.0,
      ax = -1.1;
    const glassBox = box(shell, ax, 2.35, 0, aw - 0.24, ah, d - 0.24, palette.studioGlass, 'glass');
    glassBox.userData.paneSpan = true; // one gentle glint over both storeys
    // The studio works late. One 3.2 x 4 sheet of glass at a window's full glow reads as a lampshade, so it keeps 0.8.
    glassBox.userData.windowLit = 0.8;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) box(shell, ax + sx * (aw / 2 - 0.11), 2.35, sz * (d / 2 - 0.11), 0.22, ah, 0.22, white, 'paint');
    // The front bands stop at the door surround (0.83 either side of it) instead of crossing the door.
    const run = aw / 2 - 0.83;
    for (const yb of [0.46, 2.35]) {
      box(shell, ax, yb, -(d / 2 - 0.11), aw, 0.22, 0.22, white, 'paint');
      for (const sx of [-1, 1]) box(shell, ax + sx * (aw / 2 - run / 2), yb, d / 2 - 0.11, run, 0.22, 0.22, white, 'paint');
      box(shell, ax - aw / 2 + 0.11, yb, 0, 0.22, 0.22, d, white, 'paint');
    }
    for (const sz of [-1, 1]) for (const mx of [-aw / 6, aw / 6]) box(shell, ax + mx, 2.35, sz * (d / 2 - 0.11), 0.14, ah, 0.14, white, 'paint', { bevel: 0 });
    box(shell, ax - aw / 2 + 0.11, 2.35, 0, 0.14, ah, 0.14, white, 'paint', { bevel: 0 });
    // Mackintosh's studio window (the Glasgow School of Art's north front), on the front and the
    // back of the glass box: in each bay a slim white mullion down the middle of each storey, and
    // under the coping a grid of small squares two rows deep and four across. The bars stand just
    // proud of the glass and cast nothing (a thin caster ghosts in the shadow map). The grid's bars
    // are a glass-tinted white and sit where the glint is brightest and the coping's eave shade
    // falls, only on the upper storey, so far off they fade into the glass rather than crawl as a
    // fine bright pattern when the camera pans (on both storeys and in white they added about half
    // again to the face's sub-pixel flicker at overview). Every bar is 0.07, coc-guide's least for a
    // tertiary detail: at overview a thinner bar is under a pixel wide and crawls. As built the bars
    // add nothing at the opening bearing and about a tenth on the faces the Rotate bearings turn to
    // the camera, nearly all of it the mullions' own edges. The glass box itself is unchanged, so
    // its glint (paneSpan) and its night light stay as they are, and the bars show dark over the
    // lit glass at night.
    {
      const bar = (x: number, y: number, z: number, w: number, h: number, colour = white) => {
          const m = box(shell, x, y, z, w, h, 0.035, colour, 'paint', { bevel: 0 });
          m.castShadow = false;
          m.userData.noShadow = true;
        },
        slim = 0.07,
        grid = '#d0dbdf', // the head grid's bars: a glass-tinted white, so the fine grid stays faint far off
        bays = [
          [ax - aw / 2 + 0.22, ax - aw / 6 - 0.07],
          [ax - aw / 6 + 0.07, ax + aw / 6 - 0.07],
          [ax + aw / 6 + 0.07, ax + aw / 2 - 0.22],
        ],
        storeys = [[0.57, 2.24], [2.46, 4.35]]; // between the bands, and up to the coping
      for (const sz of [-1, 1])
        bays.forEach(([x0, x1], i) =>
          storeys.forEach(([y0, y1], j) => {
            if (sz === 1 && i === 1 && j === 0) return; // the entrance
            const z = sz * ((d - 0.24) / 2 + 0.0205),
              cx = (x0 + x1) / 2,
              q = (x1 - x0) / 4,
              foot = sz === 1 && i === 1 ? 2.68 : y0; // over the entrance, from the door's lintel up
            bar(cx, (foot + y1) / 2, z, slim, y1 - foot);
            if (j === 0) return; // the head grid only under the coping
            for (const k of [1, 2]) bar(cx, y1 - k * q, z, x1 - x0, slim, grid);
            for (const s of [-1, 1]) bar(cx + s * q, y1 - q, z, slim, 2 * q, grid);
          }),
        );
    }
    // B, the rendered block (0.35-3.35), in Clash's secondary and tertiary structure: a stone base
    // course; render panels parted by V joints (proud 0.05, a shade apart) round its punched
    // windows, each a slim metal frame with mullions in a crisp white reveal (0.16 proud) on a
    // projecting metal sill; a moulded coping (a set-back band under a projecting slab) and a
    // parapet with a metal cap. The panes stay where windowAt put them (0.06 out; their centres
    // seed their night lights), narrower now, so the render reads between them.
    const metalCap = '#8a949b', // aluminium caps, sills and frames: a muted neutral grey
      timber = palette.wood,
      render: Part[] = [], // the render panels, each a shade of its own
      trims: Part[] = [], // white: reveals' copings, parapets, the canopy's fascia
      metal: Part[] = [], // caps, sills, frames (cast)
      mullions: Part[] = [], // the windows' mullions: cast nothing
      fine: Part[] = [], // the rooflight's and the panels' bars: cast nothing
      wood: Part[] = [],
      faceAt = (x: number, z: number, ry: number) => {
        const g = new T.Group();
        g.position.set(x, 0, z);
        g.rotation.y = ry;
        g.updateMatrix();
        shell.add(g);
        return g;
      },
      on = (g: T.Object3D, m: T.Matrix4) => g.matrix.clone().multiply(m);
    box(shell, 1.6, 1.85, 0, 2.4, 3.0, d - 0.6, palette.render, 'paint');
    const bFront = faceAt(0, (d - 0.6) / 2, 0),
      side = faceAt(2.8, 0, Math.PI / 2),
      bBack = faceAt(0, -(d - 0.6) / 2, Math.PI);
    parts(shell, [{ geometry: upright([[0.6, -2.36], [2.86, -2.36], [2.86, 2.36], [0.6, 2.36]], 0.27, 0.025, 0.35), matrix: IDENTITY }], '#b7ab93', 'stone');
    /** A punched window on a face (local +z out of it): the pane, a slim metal frame, mullions into `lights`, a white reveal and a metal sill. */
    const punched = (g: T.Group, x: number, y: number, ww: number, h: number, lights: number) => {
      const ring = frameRing(g, x, y, 0, ww, h, 0.07, 0.09, palette.metal, 'iron'),
        glass = new T.Mesh(new T.ShapeGeometry(ring(0.01), 8), material(palette.glass, 'glass'));
      glass.position.set(x, y, 0.06);
      g.add(glass);
      frameRing(g, x, y, 0, ww + 0.14, h + 0.14, 0.12, 0.16, white, 'paint');
      for (let k = 1; k < lights; k++) mullions.push({ geometry: new T.BoxGeometry(0.07, h, 0.04), matrix: on(g, placed(x - ww / 2 + (k * ww) / lights, y, 0.08)) });
      metal.push({ geometry: chamfered(ww + 0.42, 0.07, 0.22), matrix: on(g, placed(x, y - h / 2 - 0.19 - 0.035, 0.11)) });
    };
    for (const y of [1.25, 2.5]) {
      punched(bFront, 1.6, y, 1.5, 0.72, 2);
      punched(side, 0, y, 3.2, 0.72, 4);
    }
    /** Render panels on a face between x0 and x1, row by row (y0, y1, the reveals' spans to skip), none wider than 1.25. */
    const panels = (g: T.Group, x0: number, x1: number, rows: [number, number, [number, number][]][]) => {
      for (const [y0, y1, holes] of rows)
        for (const [a, b] of spans(x0, x1, holes)) {
          if (b - a < 0.1) continue;
          const n = Math.ceil((b - a) / 1.25),
            pw = (b - a) / n;
          for (let k = 0; k < n; k++) render.push({ geometry: chamfered(pw - 0.03, y1 - y0 - 0.03, 0.09), matrix: on(g, placed(a + pw * (k + 0.5), (y0 + y1) / 2, 0.005)) });
        }
    };
    const rows = (hole: [number, number][]): [number, number, [number, number][]][] => [
      [0.62, 1.8, hole],
      [1.8, 1.95, []],
      [1.95, 3.05, hole],
      [3.05, 3.35, []],
    ];
    panels(bFront, 0.6, 2.85, rows([[0.66, 2.54]]));
    panels(side, -2.3, 2.3, rows([[-1.79, 1.79]]));
    panels(bBack, -2.85, -0.6, rows([]));
    // The coping: a band set back under a slab (an eave over the head panels), and a parapet with a metal cap.
    box(shell, 1.6, 3.41, 0, 2.5, 0.12, d - 0.5, white, 'paint');
    box(shell, 1.62, 3.53, 0, 2.66, 0.12, d - 0.34, white, 'paint');
    trims.push(
      { geometry: ledgeAt(2.35, 0.22, 0.12, 0.02), matrix: placed(1.775, 3.7, 2.37) },
      { geometry: ledgeAt(2.35, 0.22, 0.12, 0.02), matrix: placed(1.775, 3.7, -2.37) },
      { geometry: ledgeAt(0.12, 0.22, 4.86, 0.02), matrix: placed(2.89, 3.7, 0) },
    );
    metal.push(
      { geometry: ledgeAt(2.39, 0.05, 0.18, 0.015), matrix: placed(1.775, 3.835, 2.37) },
      { geometry: ledgeAt(2.39, 0.05, 0.18, 0.015), matrix: placed(1.775, 3.835, -2.37) },
      { geometry: ledgeAt(0.18, 0.05, 4.92, 0.015), matrix: placed(2.89, 3.835, 0) },
    );
    // B's roof: two timber planters of clipped topiary, a small plant room with a louvred grille and
    // a metal cap, and a vent stack under a cowl.
    for (const dz of [-1.3, 1.3]) {
      wood.push({ geometry: ledgeAt(0.8, 0.34, 0.5, 0.03), matrix: placed(2.2, 3.76, dz) }, { geometry: ledgeAt(0.88, 0.06, 0.58, 0.02), matrix: placed(2.2, 3.96, dz) });
      topiary(shell, 2.2, 4.07, dz, 0.34, 1, 1.15, 0.75, 0.85);
    }
    box(shell, 1.15, 3.9, -0.15, 0.8, 0.62, 0.7, white, 'paint');
    metal.push({ geometry: ledgeAt(0.9, 0.05, 0.8, 0.015), matrix: placed(1.15, 4.235, -0.15) });
    for (let k = 0; k < 4; k++) metal.push({ geometry: chamfered(0.08, 0.07, 0.5), matrix: placed(1.57, 3.73 + k * 0.11, -0.15, 0, 0, 0.5) });
    cylinder(shell, 1.2, 3.84, 1.0, 0.09, 0.09, 0.5, metalCap, 'iron');
    cylinder(shell, 1.2, 4.12, 1.0, 0.15, 0.15, 0.06, metalCap, 'iron');
    cone(shell, 1.2, 4.2, 1.0, 0.16, 0.1, metalCap, 'iron', 12);
    // A's roof slab: a coping moulded as a band set back under a projecting slab (the glass box's
    // eave, which says where its underside is), a parapet with a metal cap round the lawn, and on
    // the lawn a roof garden: two timber planters of low hedge, a timber deck, a rooflight (a white
    // kerb under tilted glass in an aluminium frame, lit late like the glass box below), two
    // framed solar panels on their rails and two clipped shrubs.
    box(shell, ax, 4.41, 0, aw + 0.16, 0.12, d + 0.16, white, 'paint');
    const coping = box(shell, ax, 4.56, 0, aw + 0.3, 0.18, d + 0.3, white, 'paint');
    coping.userData.roof = true;
    coping.userData.eaveY = 4.47;
    box(shell, ax, 4.71, 0, aw - 0.2, 0.22, d - 0.2, palette.canopy[1], 'grass');
    for (const sz of [-1, 1]) {
      trims.push({ geometry: ledgeAt(aw + 0.3, 0.24, 0.14, 0.02), matrix: placed(ax, 4.77, sz * ((d + 0.3) / 2 - 0.07)) });
      metal.push({ geometry: ledgeAt(aw + 0.34, 0.06, 0.2, 0.015), matrix: placed(ax, 4.92, sz * ((d + 0.3) / 2 - 0.07)) });
      trims.push({ geometry: ledgeAt(0.14, 0.24, d + 0.02, 0.02), matrix: placed(ax + sz * ((aw + 0.3) / 2 - 0.07), 4.77, 0) });
      metal.push({ geometry: ledgeAt(0.2, 0.06, d + 0.06, 0.015), matrix: placed(ax + sz * ((aw + 0.3) / 2 - 0.07), 4.92, 0) });
    }
    for (const x of [ax - 1.05, ax + 0.35]) {
      wood.push({ geometry: ledgeAt(1.0, 0.26, 0.42, 0.03), matrix: placed(x, 4.95, 1.55) }, { geometry: ledgeAt(1.08, 0.05, 0.5, 0.015), matrix: placed(x, 5.105, 1.55) });
      for (const u of [-0.24, 0.24]) topiary(shell, x + u, 5.07, 1.55, 0.22, 1, 1, 0.85, 0.9);
    }
    wood.push({ geometry: ledgeAt(1.3, 0.05, 1.0, 0.012), matrix: placed(ax - 0.25, 4.84, 0.35) });
    for (const [x, z] of [[ax - 1.25, 0.35], [ax + 1.25, 0.75]]) topiary(shell, x, 5.0, z, 0.2, 1);
    box(shell, ax - 0.9, 4.91, -1.2, 1.0, 0.18, 0.8, white, 'paint');
    metal.push({ geometry: ledgeAt(1.04, 0.05, 0.84, 0.015), matrix: placed(ax - 0.9, 5.03, -1.2, -0.2) });
    const rooflight = box(shell, ax - 0.9, 5.07, -1.2, 0.9, 0.04, 0.72, palette.studioGlass, 'glass', { rx: -0.2 });
    rooflight.userData.windowLit = 0.8;
    fine.push({ geometry: new T.BoxGeometry(0.07, 0.03, 0.72), matrix: placed(ax - 0.9, 5.1, -1.2, -0.2) });
    for (let i = 0; i < 2; i++) {
      const z = -1.4 + i * 1.3,
        tilt = 0.35,
        n = new T.Vector3(0, Math.cos(tilt), Math.sin(tilt));
      box(shell, ax + 0.85, 4.89, z, 0.9, 0.14, 0.2, palette.metal, 'iron');
      box(shell, ax + 0.85, 4.98, z, 1.1, 0.08, 0.8, '#2f4e66', 'enamel', { rx: tilt }); // glossy panel, no night glow
      metal.push({ geometry: ledgeAt(1.2, 0.05, 0.9, 0.012), matrix: placed(ax + 0.85 - n.x * 0.06, 4.98 - n.y * 0.06, z - n.z * 0.06, tilt) });
      for (const u of [-0.183, 0.183]) fine.push({ geometry: new T.BoxGeometry(0.07, 0.02, 0.8), matrix: placed(ax + 0.85 + u, 4.98 + n.y * 0.045, z + n.z * 0.045, tilt) });
    }
    // The entrance: a deep white canopy (1.5) with a fascia round its edge on two slender iron posts
    // (base plates and caps) standing on the apron, clear of the bench and the bike rack; a blue door
    // with steps down from the plinth, and a grounded apron with a bench.
    box(shell, ax, 2.79, d / 2 + 0.75, 2.8, 0.14, 1.5, white, 'paint');
    trims.push(
      { geometry: ledgeAt(2.8, 0.3, 0.1, 0.02), matrix: placed(ax, 2.74, d / 2 + 1.45) },
      ...[-1, 1].map((sx): Part => ({ geometry: ledgeAt(0.1, 0.3, 1.4, 0.02), matrix: placed(ax + sx * 1.35, 2.74, d / 2 + 0.75) })),
    );
    for (const sx of [-1, 1]) {
      const x = ax + sx * 1.25,
        z = d / 2 + 1.25;
      cylinder(shell, x, 1.39, z, 0.055, 0.055, 2.66, palette.metal, 'iron');
      metal.push({ geometry: ledgeAt(0.2, 0.04, 0.2, 0.01), matrix: placed(x, 0.08, z) }, { geometry: ledgeAt(0.18, 0.05, 0.18, 0.012), matrix: placed(x, 2.695, z) });
    }
    door(shell, ax, 0.35, d / 2 - 0.12, 1.3, 2.1, '#3f6f8f', { surround: palette.metal, landing: 0.37, width: 2.0 });
    // A stylised Mackintosh rose in relief on the door's panel, below the canopy's shade where the
    // chapter sees it: an upright oval ring round an inner rose-pink ring and heart, set a little
    // high like the rose's furled centre, over a two-by-two grid of small squares. Abstract geometry
    // in the frame's white and a muted rose that casts nothing. No stem (a ring on a stem with a
    // crossbar of leaves reads as a sign) and no wide oval (round a dark heart it reads as an eye).
    {
      const panel = d / 2 - 0.02, // the leaf's recessed centre panel
        cy = 1.32,
        rose = muted('#f18fb0', 0.45),
        relief = (m: T.Mesh, x: number, y: number, sx = 1, sy = 1) => {
          m.position.set(x, y, panel + 0.012);
          m.scale.set(sx, sy, 1);
          m.castShadow = false;
          m.receiveShadow = true;
          m.userData.noShadow = true;
          shell.add(m);
          return m;
        };
      relief(new T.Mesh(new T.TorusGeometry(0.15, 0.02, 4, 18), material(white, 'paint')), ax, cy, 0.9, 1);
      relief(new T.Mesh(new T.TorusGeometry(0.085, 0.018, 4, 14), material(rose, 'paint')), ax, cy + 0.02, 0.9, 1);
      relief(new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.024, 10), material(rose, 'paint')), ax, cy + 0.035, 1, 1).rotation.x = Math.PI / 2;
      for (const x of [-0.045, 0.045]) for (const y of [-0.25, -0.34]) box(shell, ax + x, cy + y, panel + 0.012, 0.065, 0.065, 0.024, white, 'paint', { bevel: 0 }).userData.noShadow = true;
    }
    box(shell, ax, 0.03, d / 2 + 1.2, 3.2, 0.06, 1.8, palette.pavement, 'paving'); // from the plinth foot, like the path
    bench(shell, ax - 0.85, 0.06, d / 2 + 1.85);
    parts(shell, render, palette.render, 'paint', { tone: 0.03 });
    parts(shell, trims, white, 'paint');
    parts(shell, metal, metalCap, 'iron');
    parts(shell, wood, timber, 'wood');
    parts(shell, mullions, palette.metal, 'iron', { shadow: false });
    parts(shell, fine, metalCap, 'iron', { shadow: false });
  }

  /*
   * The archive's detail kit. A chamfered block is an extruded outline with one 45-degree bevel (a
   * box is 28 triangles this way, a rounded box 108), so the many small dressings stay cheap and
   * still catch a soft line of light on every edge. `cluster` merges repeated small parts (glazing
   * bars, dentils, pipe ears) into one mesh, so they batch with their family rather than adding a
   * batch of their own.
   */
  const prisms = new Map<string, T.BufferGeometry>(),
    ledges = new Map<string, T.BufferGeometry>();
  /** An extruded outline (x, y points) from z0 to z0 + depth, its edges chamfered by c (shared per shape). */
  function prism(points: [number, number][], depth: number, c = 0.02, z0 = 0) {
    const key = [...points.flat(), depth, c, z0].map((n) => n.toFixed(4)).join('|');
    let geometry = prisms.get(key);
    if (!geometry) {
      geometry = new T.ExtrudeGeometry(new T.Shape(points.map(([x, y]) => new T.Vector2(x, y))), {
        depth: depth - 2 * c,
        bevelEnabled: true,
        bevelThickness: c,
        bevelSize: c,
        bevelOffset: -c,
        bevelSegments: 1,
      }).translate(0, 0, z0 + c);
      prisms.set(key, geometry);
    }
    return geometry;
  }
  /** A w x h x d block about its middle, chamfered by a quarter of its thinnest side (at most 0.025). */
  const chamfered = (w: number, h: number, d: number) =>
    prism([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], d, Math.min(0.025, 0.25 * Math.min(w, h, d)), -d / 2);
  function block(g: T.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, colour: string, kind: SurfaceKind) {
    const m = new T.Mesh(chamfered(w, h, d), material(colour, kind));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  type V3 = [number, number, number];
  type Piece = { geometry: T.BufferGeometry; at: V3; rotation?: V3 };
  /** Parts as one mesh in g's space; thin ones cast nothing (a thin caster ghosts in the shadow map). */
  function cluster(g: T.Object3D, pieces: Piece[], colour: string, kind: SurfaceKind, shadow = true) {
    if (!pieces.length) return undefined;
    const m4 = new T.Matrix4(),
      q = new T.Quaternion(),
      one = new T.Vector3(1, 1, 1);
    const parts = pieces.map(({ geometry, at, rotation = [0, 0, 0] }) =>
      (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(m4.compose(new T.Vector3(...at), q.setFromEuler(new T.Euler(...rotation)), one)),
    );
    const m = new T.Mesh(mergeGeometries(parts)!, material(colour, kind));
    parts.forEach((p) => p.dispose());
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (!shadow) m.userData.noShadow = true;
    g.add(m);
    return m;
  }
  /**
   * An arch's voussoirs between radii R0 and R1, `deep` out of the wall, about the springing's
   * middle; the crown is left for a keystone. They butt, so each joint is the V of two chamfers:
   * an open gap between them read as a crack.
   */
  function voussoirs(R0: number, R1: number, deep: number, at: V3, n = 7): Piece[] {
    const out: Piece[] = [];
    for (let i = 0; i < n; i++) {
      if (i === (n - 1) / 2) continue;
      const a0 = (i * Math.PI) / n,
        a1 = ((i + 1) * Math.PI) / n,
        p = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
      out.push({ geometry: prism([p(a0, R0), p(a0, R1), p(a1, R1), p(a1, R0)], deep, 0.018), at });
    }
    return out;
  }
  /** A tapered keystone from radius r0 up to r1 above the springing's middle, `deep` out of the wall. */
  const keystone = (r0: number, r1: number, foot: number, head: number, deep: number) =>
    prism([[-foot / 2, r0], [foot / 2, r0], [head / 2, r1], [-head / 2, r1]], deep, 0.022);
  /** A tapered hopper head, wide at the top, with a rim. */
  const hopperGeometry = (() => {
    const g = new T.BoxGeometry(0.2, 0.24, 0.19),
      p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setXYZ(i, p.getX(i) * 0.55, p.getY(i), p.getZ(i) * 0.55);
    g.computeVertexNormals();
    return g;
  })();
  /**
   * An archive window on a wall face at z (local +z out of the wall): the glass set back near the
   * wall in a slim iron frame, cast-iron glazing bars (a mullion, a transom at the springing and
   * two head bars, so the arch is a fan of four lights), and a deep sandstone surround (0.2 proud,
   * so the reveal reads): plain jambs, imposts on the string course's line, six voussoirs and a
   * tapered keystone, and a sill whose front overhangs a narrower bed, a drip line under its lip.
   * Everything stays within 0.70 of the middle and between 0.88 and 3.2 high for a 0.9 x 1.3
   * window at 1.75 (the ivy's keep boxes), and at most 0.24 out of the wall (the keystone, the
   * sill and the imposts): on the side walls that is the cornice's reach, so the building's
   * bounds, hit box and framing stay as they were. Returns the pane (night lights).
   */
  function archWindow(g: T.Object3D, x: number, y: number, z: number, w: number, h: number) {
    const r = w / 2,
      f = 0.07,
      spring = y + h / 2,
      R0 = r + f,
      R1 = R0 + 0.17,
      jamb = 0.15,
      deep = 0.2,
      foot = y - h / 2 - f;
    const ring = frameRing(g, x, y, z + 0.02, w, h, f, 0.1, palette.metal, 'iron', true);
    // The pane stays where windowAt put it (0.06 out): its centre seeds its night light.
    const glass = new T.Mesh(new T.ShapeGeometry(ring(0.01), 8), material(palette.glass, 'glass'));
    glass.position.set(x, y, z + 0.06);
    g.add(glass);
    const bar = (bw: number, bh: number) => new T.BoxGeometry(bw, bh, 0.04);
    cluster(
      g,
      [
        { geometry: bar(0.07, h + r), at: [x, y + r / 2, z + 0.09] },
        { geometry: bar(w, 0.07), at: [x, spring, z + 0.09] },
        ...[-1, 1].map((s): Piece => ({ geometry: bar(0.07, r), at: [x + (s * r * Math.SQRT1_2) / 2, spring + (r * Math.SQRT1_2) / 2, z + 0.09], rotation: [0, 0, (-s * Math.PI) / 4] })),
      ],
      palette.metal,
      'iron',
      false,
    );
    const stone: Piece[] = [
      ...voussoirs(R0, R1, deep, [x, spring, z]),
      { geometry: keystone(R0 - 0.03, R1 + 0.1, 0.18, 0.28, deep + 0.04), at: [x, spring, z] },
      { geometry: chamfered(2 * (R0 + jamb + 0.02), 0.09, 0.24), at: [x, foot - 0.045, z + 0.12] }, // sill
      { geometry: chamfered(2 * (R0 + jamb) - 0.06, 0.06, 0.17), at: [x, foot - 0.12, z + 0.085] }, // its bed, under the drip
    ];
    for (const s of [-1, 1]) {
      stone.push({ geometry: chamfered(jamb, spring - 0.12 - foot, deep), at: [x + s * (R0 + jamb / 2), (foot + spring - 0.12) / 2, z + deep / 2] });
      stone.push({ geometry: chamfered(jamb + 0.06, 0.12, deep + 0.04), at: [x + s * (R0 + jamb / 2), spring - 0.06, z + (deep + 0.04) / 2] });
    }
    cluster(g, stone, palette.brickLight, 'stone');
    return glass;
  }
  /** [a, b] less the cuts, as the pieces longer than 0.05. */
  function spans(a: number, b: number, cuts: [number, number][]) {
    let out: [number, number][] = [[a, b]];
    for (const [c0, c1] of cuts)
      out = out.flatMap(([s0, s1]): [number, number][] => (c1 <= s0 || c0 >= s1 ? [[s0, s1]] : [[s0, c0], [c1, s1]].filter(([u, v]) => v - u > 0.05) as [number, number][]));
    return out;
  }

  function buildArchive(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d;
    // Red brick walls (0.45-3.65) on a rusticated, battered plinth (the rear is seen at overview),
    // a chamfered plinth course (0.43-0.57, its weathered top 0.1 proud) and a two-member cornice:
    // a corona 0.22 proud over the pier capitals and a cymatium 0.24 proud (inside the plinth's 0.25,
    // so the building's bounds, hit box and framing stay as they were).
    plinth(shell, w, d, palette.plinth, { height: 0.45, blocks: true });
    box(shell, 0, 2.05, 0, w, 3.2, d, palette.brick, 'stone');
    box(shell, 0, 0.5, 0, w + 0.42, 0.14, d + 0.42, palette.blonde, 'stone', { taper: 0.11 }).userData.band = true;
    box(shell, 0, 3.71, 0, w + 0.44, 0.12, d + 0.44, palette.trim, 'stone');
    block(shell, 0, 3.81, 0, w + 0.48, 0.08, d + 0.48, palette.trim, 'stone').userData.band = true; // the corona's eave shades the wall, not this
    // Blonde piers: fat corners, and two intermediates on the front and rear framing the hoist bay;
    // each stands on a base block, is belted by the string course (2.28-2.40) and carries a capital
    // (a necking ring, then the block) under the cornice.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        box(shell, sx * 3.0, 2.05, sz * 2.3, 0.5, 3.2, 0.5, palette.brickLight, 'stone');
        box(shell, sx * 1.05, 2.05, sz * (d / 2 + 0.05), 0.45, 3.2, 0.2, palette.brickLight, 'stone');
        block(shell, sx * 3.0, 0.66, sz * 2.3, 0.58, 0.32, 0.58, palette.brickLight, 'stone');
        block(shell, sx * 3.0, 2.34, sz * 2.3, 0.56, 0.12, 0.56, palette.brickLight, 'stone');
        block(shell, sx * 3.0, 3.37, sz * 2.3, 0.55, 0.06, 0.55, palette.trim, 'stone');
        block(shell, sx * 3.0, 3.54, sz * 2.3, 0.6, 0.22, 0.6, palette.trim, 'stone');
        block(shell, sx * 1.05, 0.66, sz * (d / 2 + 0.06), 0.53, 0.32, 0.26, palette.brickLight, 'stone');
        block(shell, sx * 1.05, 2.34, sz * (d / 2 + 0.06), 0.51, 0.12, 0.24, palette.brickLight, 'stone');
        block(shell, sx * 1.05, 3.37, sz * (d / 2 + 0.05), 0.5, 0.06, 0.24, palette.trim, 'stone');
        block(shell, sx * 1.05, 3.54, sz * (d / 2 + 0.06), 0.55, 0.22, 0.28, palette.trim, 'stone');
      }
    // The four faces (local +z out of the wall, x along it): the front (+z), the rear (seen at
    // overview, a secondary front), the south wall (+x, the ivy wall) and the north wall.
    const face = (x: number, z: number, ry: number) => {
      const g = new T.Group();
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      shell.add(g);
      return g;
    };
    const front = face(0, d / 2, 0),
      rear = face(0, -d / 2, Math.PI),
      south = face(w / 2, 0, Math.PI / 2),
      north = face(-w / 2, 0, -Math.PI / 2);
    // Arched, iron-framed windows. One front window is lit late (today's colour, 0.8), so the
    // chapter's subject shows a lit front all evening; the rear's middle window (the face the
    // overview sees) keeps a dim lamp all night.
    for (const x of [-2.01, 2.01]) {
      const pane = archWindow(front, x, 1.75, 0, 0.9, 1.3);
      if (x > 0) pane.userData.windowLit = 0.8;
    }
    for (const x of [-2.01, 0, 2.01]) {
      const pane = archWindow(rear, x, 1.75, 0, 0.9, 1.3);
      if (x === 0) pane.userData.nightLight = true;
    }
    for (const side of [south, north]) for (const z of [-0.95, 0.95]) archWindow(side, z, 1.75, 0, 0.9, 1.3);
    // Ivy on the south wall (seen from the overview and in the archive's chapter), over its back
    // half (this face's +x; the front is -x): it climbs from the plinth between the two arched
    // windows and round the back one, runs along the plinth under them and along under the
    // cornice, and never reaches a window (frame, sill or keystone, plus 0.06), a corner pier or
    // the cornice. Its front edge is ragged, so the front half stays bare brick.
    ivy(south, {
      areas: [[-0.5, 0, 2.03, 0.8], [-0.3, 0, 0.3, 3.6], [1.6, 0, 2.03, 3.2], [-0.7, 3.2, 2.03, 3.6]],
      keep: [[0.25, 0.87, 1.65, 3.26], [-1.65, 0.87, -0.25, 3.26], [2.03, 0, 3, 5], [-3, 0, -2.03, 5], [-3, 3.62, 3, 5]],
      plinth: { h: 0.45, proud: 0.25, batter: 0.047 },
      seed: 7,
    });
    // On every face: the string course on the window imposts' line (2.28-2.40, 0.07 proud) between
    // the openings and the piers' belts, and under the cornice a bed band (0.05 proud) and a dentil
    // course (0.12 blocks every 0.27 or so, 0.1 proud) between the capitals; over the door they
    // stop for the keystone and the hoist beam. Each face's courses are one mesh.
    for (const [g, L, piers, openings] of [
      [front, w, [-1.05, 1.05], [[-2.01, 0.7], [2.01, 0.7], [0, 0.82]]],
      [rear, w, [-1.05, 1.05], [[-2.01, 0.7], [0, 0.7], [2.01, 0.7]]],
      [south, d, [], [[-0.95, 0.7], [0.95, 0.7]]],
      [north, d, [], [[-0.95, 0.7], [0.95, 0.7]]],
    ] as [T.Group, number, number[], [number, number][]][]) {
      const corner = L / 2 - 0.1,
        pierCuts: [number, number][] = [[-corner - 0.22, -corner + 0.22], [corner - 0.22, corner + 0.22], ...piers.map((p): [number, number] => [p - 0.19, p + 0.19])],
        capitalCuts: [number, number][] = [[-corner - 0.3, -corner + 0.3], [corner - 0.3, corner + 0.3], ...piers.map((p): [number, number] => [p - 0.275, p + 0.275])];
      const course: Piece[] = spans(-L / 2, L / 2, [...pierCuts, ...openings.map(([c, half]): [number, number] => [c - half, c + half])]).map(([a, b]) => ({
          geometry: chamfered(b - a, 0.12, 0.09),
          at: [(a + b) / 2, 2.34, 0.025],
        })),
        cornice: Piece[] = [];
      for (const [a, b] of spans(-L / 2, L / 2, [...capitalCuts, ...(g === front ? [[-0.2, 0.2] as [number, number]] : [])])) {
        cornice.push({ geometry: chamfered(b - a, 0.08, 0.07), at: [(a + b) / 2, 3.42, 0.015] });
        const n = Math.max(1, Math.floor((b - a - 0.24) / 0.27) + 1),
          step = n > 1 ? (b - a - 0.24) / (n - 1) : 0;
        for (let i = 0; i < n; i++) cornice.push({ geometry: chamfered(0.12, 0.19, 0.12), at: [n > 1 ? a + 0.12 + i * step : (a + b) / 2, 3.555, 0.04] });
      }
      cluster(g, course, palette.brickLight, 'stone');
      cluster(g, cornice, palette.trim, 'stone');
    }
    // Cast-iron rainwater goods, clear of the windows and the ivy: an eaves gutter on the cornice
    // along the north wall (tooth 0's low edge), and on the north and rear walls outlet spouts under
    // the cornice into hopper heads, with downpipes held by ears and kicked out in a shoe over the
    // plinth course. The rear pipes stand in the corners of the intermediate piers, beside the
    // middle window's sill; the north ones between the windows and the corner piers.
    box(shell, -(w / 2 + 0.18), 3.91, 0, 0.12, 0.12, d + 0.64, palette.metal, 'iron');
    for (const [g, xs] of [[rear, [-0.755, 0.755]], [north, [-1.85, 1.85]]] as [T.Group, number[]][]) {
      const iron: Piece[] = [];
      for (const x of xs) {
        iron.push(
          { geometry: new T.CylinderGeometry(0.035, 0.035, 0.2, 8), at: [x, 3.42, 0.1], rotation: [Math.PI / 2, 0, 0] },
          { geometry: hopperGeometry, at: [x, 3.24, 0.095] },
          { geometry: new T.BoxGeometry(0.23, 0.05, 0.21), at: [x, 3.36, 0.095] },
          { geometry: new T.CylinderGeometry(0.045, 0.045, 2.45, 8), at: [x, 1.9, 0.065] },
          { geometry: new T.CylinderGeometry(0.045, 0.045, 0.21, 8), at: [x, 0.68, 0.125], rotation: [-0.7, 0, 0] },
        );
        for (const y of [1.25, 2.35])
          iron.push({ geometry: new T.CylinderGeometry(0.06, 0.06, 0.07, 12), at: [x, y, 0.065] }, { geometry: new T.BoxGeometry(0.17, 0.07, 0.03), at: [x, y, 0.018] });
      }
      cluster(g, iron, palette.metal, 'iron', false);
    }
    // The centre hoist bay: a double door at dock height under a fanlight, a dock with side steps,
    // the hoist beam and block, crates.
    {
      const z = d / 2,
        y0 = 0.45,
        dw = 1.3,
        spring = y0 + 1.95, // the string course's line
        leaf = dw / 2,
        green = palette.greenDoor;
      // Two leaves, each a slab under a raised frame (stiles and three rails, 0.04 proud) round two
      // fielded panels, a meeting bead between them and a transom at the springing.
      const enamel: Piece[] = [{ geometry: new T.BoxGeometry(0.07, spring - y0, 0.06), at: [0, (y0 + spring) / 2, z + 0.13] }];
      for (const s of [-1, 1]) {
        const lx = (s * leaf) / 2,
          inner = leaf - 0.22;
        enamel.push({ geometry: chamfered(leaf - 0.01, spring - y0, 0.1), at: [lx, (y0 + spring) / 2, z + 0.05] });
        for (const e of [-1, 1]) enamel.push({ geometry: new T.BoxGeometry(0.11, spring - y0, 0.04), at: [lx + e * (leaf / 2 - 0.055), (y0 + spring) / 2, z + 0.12] });
        for (const [y, h] of [[y0 + 0.08, 0.16], [y0 + 0.85, 0.12], [spring - 0.06, 0.12]]) enamel.push({ geometry: new T.BoxGeometry(inner, h, 0.04), at: [lx, y, z + 0.12] });
        for (const [y1, y2] of [[y0 + 0.16, y0 + 0.79], [y0 + 0.91, spring - 0.12]]) enamel.push({ geometry: chamfered(inner - 0.08, y2 - y1 - 0.08, 0.03), at: [lx, (y1 + y2) / 2, z + 0.115] });
      }
      enamel.push({ geometry: chamfered(dw, 0.1, 0.12), at: [0, spring, z + 0.07] });
      cluster(shell, enamel, green, 'enamel');
      sphere(shell, -0.09, y0 + 0.95, z + 0.17, 0.045, palette.brass, 'brass');
      sphere(shell, 0.09, y0 + 0.95, z + 0.17, 0.045, palette.brass, 'brass');
      // The fanlight: a half-round light in an iron frame with four radial bars round a hub.
      const fan = new T.Shape();
      fan.absarc(0, 0, 0.6, 0, Math.PI, false);
      fan.closePath();
      // Its mesh stays where the old door's fanlight was (0.05 higher, 0.06 out), as its centre
      // seeds its night light; the light itself is drawn down to the springing.
      const fanlight = new T.Mesh(new T.ShapeGeometry(fan, 10).translate(0, -0.05, 0), material(palette.glass, 'glass'));
      fanlight.position.set(0, spring + 0.05, z + 0.06);
      shell.add(fanlight);
      const arc = (r0: number, r1: number, n = 12): [number, number][] => [
        ...Array.from({ length: n + 1 }, (_, i): [number, number] => [Math.cos((i * Math.PI) / n) * r1, Math.sin((i * Math.PI) / n) * r1]),
        ...Array.from({ length: n + 1 }, (_, i): [number, number] => [Math.cos(((n - i) * Math.PI) / n) * r0, Math.sin(((n - i) * Math.PI) / n) * r0]),
      ];
      const iron: Piece[] = [
        { geometry: prism(arc(0.57, 0.66), 0.1, 0.015), at: [0, spring, z + 0.02] },
        { geometry: prism(arc(0, 0.15, 6).slice(0, 7).concat([[0, 0]]), 0.05, 0.012), at: [0, spring, z + 0.07] },
        ...[1, 2, 3, 4].map((k): Piece => {
          const a = (k * Math.PI) / 5;
          return { geometry: new T.BoxGeometry(0.07, 0.44, 0.04), at: [Math.cos(a) * 0.37, spring + Math.sin(a) * 0.37, z + 0.09], rotation: [0, 0, a - Math.PI / 2] };
        }),
        // strap hinges on the leaves' outer stiles
        ...[-1, 1].flatMap((s) => [y0 + 0.4, spring - 0.45].map((y): Piece => ({ geometry: new T.BoxGeometry(0.34, 0.07, 0.02), at: [s * (leaf - 0.2), y, z + 0.15] }))),
      ];
      // The surround: jambs, imposts, seven voussoirs with a keystone on which the hoist beam rests.
      cluster(
        shell,
        [
          ...voussoirs(leaf, leaf + 0.17, 0.28, [0, spring, z]),
          { geometry: keystone(leaf - 0.03, 0.93, 0.2, 0.32, 0.34), at: [0, spring, z] },
          ...[-1, 1].flatMap((s): Piece[] => [
            { geometry: chamfered(0.17, spring - 0.12 - y0, 0.28), at: [s * (leaf + 0.085), (y0 + spring - 0.12) / 2, z + 0.14] },
            { geometry: chamfered(0.25, 0.12, 0.32), at: [s * (leaf + 0.085), spring - 0.06, z + 0.16] },
          ]),
        ],
        palette.brickLight,
        'stone',
      );
      // The dock: a plinth-stone body under a pale coping with a timber fender, two side steps down
      // to the lawn (inside the old dock's footprint and bounds); then the hoist beam and block, hung
      // in an iron stirrup and stayed back to the cornice by a rod, with a hook below.
      box(shell, 0, 0.185, z + 0.54, 2.2, 0.37, 0.78, palette.plinth, 'stone');
      block(shell, 0, 0.41, z + 0.57, 2.28, 0.08, 0.86, palette.blonde, 'stone');
      box(shell, 0, 0.2, z + 0.99, 1.9, 0.16, 0.12, palette.woodDark, 'wood');
      box(shell, -1.24, 0.15, z + 0.62, 0.28, 0.3, 0.66, palette.plinth, 'stone');
      box(shell, -1.52, 0.075, z + 0.62, 0.28, 0.15, 0.66, palette.plinth, 'stone');
      box(shell, 0, 3.45, z + 0.45, 0.24, 0.24, 1.0, palette.woodDark, 'wood');
      box(shell, 0, 3.18, z + 0.85, 0.2, 0.3, 0.2, palette.metal, 'iron');
      iron.push(
        ...[-1, 1].map((s): Piece => ({ geometry: new T.BoxGeometry(0.05, 0.32, 0.12), at: [s * 0.145, 3.45, z + 0.85] })),
        { geometry: new T.BoxGeometry(0.34, 0.05, 0.12), at: [0, 3.595, z + 0.85] },
        { geometry: new T.CylinderGeometry(0.035, 0.035, 0.36, 8), at: [0, 3.39, z + 0.85], rotation: [0, 0, Math.PI / 2] },
        { geometry: new T.BoxGeometry(0.07, 0.1, 0.07), at: [0, 2.99, z + 0.85] },
        { geometry: new T.TorusGeometry(0.06, 0.035, 6, 10, Math.PI * 1.4), at: [0, 2.88, z + 0.85], rotation: [0, Math.PI / 2, -Math.PI * 0.2] },
        { geometry: new T.BoxGeometry(0.16, 0.12, 0.02), at: [0, 3.79, z + 0.25] },
      );
      cluster(shell, iron, palette.metal, 'iron', false);
      const rod = strut(shell, new T.Vector3(0, 3.55, z + 0.82), new T.Vector3(0, 3.8, z + 0.25), 0.035, palette.metal, 'iron');
      rod.castShadow = false;
      rod.userData.noShadow = true;
      box(shell, 1.55, 0.3, z + 0.55, 0.6, 0.6, 0.6, palette.wood, 'wood');
      box(shell, 1.5, 0.84, z + 0.5, 0.48, 0.48, 0.48, '#b47a48', 'wood', { ry: 0.35 });
    }
    // A real sawtooth: three teeth across x with their ridges along z, each glazed on its tall face.
    const Wr=w+0.3, bw=Wr/3, R=1.35, f=0.15, Dr=d+0.8, rb=0.04, y0=3.85;
    // The glazing's foot and head, its run along z, and the slope.
    const yg0 = y0 + (f + R) / 2 + 0.05 - (R - f - 0.25) / 2,
      yg1 = yg0 + R - f - 0.25,
      run = Dr - 0.6,
      slope = Math.atan2(R - f, bw),
      glazing: Piece[] = [],
      lead: Piece[] = [],
      collars: Piece[] = [],
      // The ridge capping's profile (0.31 wide, its foot 0.08 under its middle, a half-ellipse 0.12
      // high on its shoulders), grown by g for a collar.
      capping = (g: number): [number, number][] => [
        [-0.155 - g, -0.08],
        [0.155 + g, -0.08],
        ...Array.from({ length: 9 }, (_, k): [number, number] => [Math.cos((k * Math.PI) / 8) * (0.155 + g), 0.03 + Math.sin((k * Math.PI) / 8) * (0.12 + g)]),
      ];
    for(let i=0;i<3;i++){ const x0=-Wr/2+i*bw, s=new T.Shape(); s.moveTo(x0,0); s.lineTo(x0+bw,0); s.lineTo(x0+bw,R); s.lineTo(x0,f); s.closePath();
      const t=new T.Mesh(new T.ExtrudeGeometry(s,{depth:Dr-2*rb,bevelEnabled:true,bevelThickness:rb,bevelSize:rb,bevelOffset:-rb,bevelSegments:1}),material(palette.slate,'slate'));
      t.position.set(0,y0,-Dr/2+rb); t.castShadow=t.receiveShadow=true; shell.add(t);
      t.userData.roof = true; t.userData.eaveY = y0; // a tooth's box drops to the cornice top: the eave bake measures from there
      // North light faces local +x (world +z, seen at overview). The three light one roof hall, so at night they are one
      // light (windowGroup), never three bands of different lamps side by side.
      box(shell,x0+bw+0.035,y0+(f+R)/2+0.05,0,0.07,R-f-0.25,Dr-0.6,palette.glass,'glass').userData.windowGroup = 'city-archive-north-lights';
      // Patent glazing: six lights between seven bars (0.07 wide, 0.03 proud), a sill and a head
      // rail, all in lead grey: dark iron bars on the bright glass shimmered at overview. Under the
      // sill a lead upstand, dressed over the next tooth's slates (or the cornice).
      const xg = x0 + bw;
      for (let k = 0; k <= 6; k++) glazing.push({ geometry: new T.BoxGeometry(0.03, yg1 - yg0 + 0.04, 0.07), at: [xg + 0.085, (yg0 + yg1) / 2, -run / 2 + (k * run) / 6] });
      for (const y of [yg0, yg1]) glazing.push({ geometry: new T.BoxGeometry(0.1, 0.08, run + 0.07), at: [xg + 0.05, y, 0] });
      const low = i < 2 ? y0 + f - 0.02 : y0;
      lead.push({ geometry: new T.BoxGeometry(0.05, yg0 - low, run + 0.1), at: [xg + 0.025, (low + yg0) / 2, 0] });
      if (i < 2) lead.push({ geometry: new T.BoxGeometry(0.34, 0.03, run + 0.1), at: [xg + 0.17 * Math.cos(slope) - 0.012 * Math.sin(slope), y0 + f + 0.17 * Math.sin(slope) + 0.012 * Math.cos(slope), 0], rotation: [0, 0, slope] });
      else lead.push({ geometry: new T.BoxGeometry(0.09, 0.025, run + 0.1), at: [xg + 0.045, y0 + 0.0125, 0] });
      // The ridge: a round-topped capping over the glazing's head (one profile, so one soft
      // silhouette: a roll on a flat capping drew two edges a pixel apart that shimmered at
      // overview) with joint collars; slate-light verges along both gable slopes.
      const ridge = new T.Mesh(prism(capping(0), Dr + 0.04, 0.02, -(Dr + 0.04) / 2), material(palette.slateLight, 'slate'));
      ridge.position.set(xg - 0.075, y0 + R + 0.03, 0);
      ridge.castShadow = ridge.receiveShadow = true;
      shell.add(ridge);
      for (let k = 1; k < 9; k++) collars.push({ geometry: prism(capping(0.016), 0.08, 0.012, -0.04), at: [xg - 0.075, y0 + R + 0.03, -(Dr + 0.04) / 2 + (k * (Dr + 0.04)) / 9] });
      for (const sz of [-1, 1]) {
        const v = block(shell, x0 + bw / 2 - 0.035 * Math.sin(slope), y0 + (f + R) / 2 + 0.035 * Math.cos(slope), sz * (Dr / 2 - 0.05), Math.hypot(bw, R - f) - 0.12, 0.09, 0.12, palette.slateLight, 'slate');
        v.rotation.z = slope;
      } }
    cluster(shell, glazing, palette.lead, 'iron', false);
    cluster(shell, lead, palette.lead, 'iron');
    cluster(shell, collars, palette.slateLight, 'slate');
    // A fat stack rising through the first tooth in a lead collar dressed to the slope: a blonde
    // band, a crown corbelled out in two chunky brick courses (0.07 each, so each top catches a
    // line of light), a weathered sandstone cap with a drip and two chimney pots (the taller one's
    // rim at 8.1, the old cap's height, so the bounds stay put).
    cylinder(shell, -2.5, 5.5, -1.8, 0.41, 0.48, 3.3, palette.brick, 'stone');
    // (The collar is matte: in iron's finish its sunlit top read as a pale washer.)
    cylinder(shell, -2.5, y0 + f + ((R - f) * (-2.5 + Wr / 2)) / bw + 0.02, -1.8, 0.6, 0.6, 0.05, palette.lead, 'slate').rotation.z = slope;
    cylinder(shell, -2.5, 6.4, -1.8, 0.47, 0.47, 0.18, palette.brickLight, 'stone');
    for (const [y, r, h] of [[7.22, 0.48, 0.14], [7.37, 0.55, 0.16]]) cylinder(shell, -2.5, y, -1.8, r, r, h, palette.brick, 'stone');
    cylinder(shell, -2.5, 7.52, -1.8, 0.5, 0.61, 0.14, palette.plinth, 'stone');
    cluster(
      shell,
      [[-0.21, 0.45], [0.21, 0.35]].flatMap(([dx, h]): Piece[] => [
        { geometry: new T.CylinderGeometry(0.12, 0.16, h, 14), at: [-2.5 + dx, 7.59 + h / 2, -1.8] },
        { geometry: new T.CylinderGeometry(0.145, 0.145, 0.06, 14), at: [-2.5 + dx, 7.62 + h, -1.8] },
      ]),
      palette.pantile,
      'pantile',
    );
  }
  return { buildGate, buildHall, buildStudio, buildArchive };
}
