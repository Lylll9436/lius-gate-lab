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
  const { box, cylinder, cone, sphere, strut, slabRoof, frameRing, windowAt, door, plinth, lampGlass, ivy } = kit;
  const { topiary } = nature;
  const { bench } = props;
  /**
   * LIU'S GATE: a Glasgow triumphal arch in blonde and red sandstone with bronze accents, built in
   * Clash's secondary and tertiary structure (the ashlar is the shader's). Front +z, the opening
   * along z. Heights: plinth 0-0.45, base course to 0.57, banded rustication (five chamfered
   * courses) on the piers to the impost belt (2.31-2.45, the springing); an engaged Tuscan column
   * on each pier and face, on a pedestal (to 1.33), its capital under the architrave (3.95); the
   * archivolt (alternate red and cream voussoirs inside a cream moulding, 0.95-1.48) and a scroll
   * keystone rising into the entablature; bronze wreaths in the spandrels and on the side faces;
   * a coffered soffit; the entablature (two-fascia architrave, red frieze, dentils, a corona 1.0
   * out from the middle at 4.44-4.55); the attic (4.61-5.43) framing a blank bronze tablet between
   * red end blocks over the columns; a stepped crowning pedestal (to 5.95) between two cast-bronze
   * lamp standards whose globes are the night lamps. Everything stays inside x 2.38, z 1.0 and
   * y 6.45 (check-town), so the hit box and the chapter's framing barely move.
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
    // The piers: a moulded base course, five courses of banded rustication (each chamfered 0.055,
    // so a V channel parts them; 0.35 tall, like the ashlar's courses, so nothing shimmers) wrapping
    // the faces, the outer sides and the reveals, and a two-step impost belt at the springing.
    for (const sx of [-1, 1]) {
      stoneAt(sx * pierX, 0.51, 0, pierW + 0.04, 0.12, D + 0.12, 0.03);
      const c0 = 0.57,
        ch = (2.31 - c0) / 5;
      for (let i = 0; i < 5; i++) stoneAt(sx * pierX, c0 + ch * (i + 0.5), 0, pierW, ch, D + 0.08, 0.055, blonde);
      stoneAt(sx * pierX, 2.345, 0, pierW + 0.06, 0.07, D + 0.14, 0.02).userData.band = true;
      stoneAt(sx * pierX, 2.415, 0, pierW + 0.12, 0.07, D + 0.2, 0.025).userData.band = true;
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
          k = 1 + 0.1 * Math.sin(u * 14);
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
    // The entablature: a two-fascia architrave over the capitals, a red sandstone frieze, a bed
    // moulding, a dentil course on its band (0.12 blocks about every 0.3, as on the archive), the
    // corona (1.0 out from the middle, 2.38 at the ends) and a cyma on top.
    stoneAt(0, 3.98, 0, 4.56, 0.06, 1.7, 0.02).userData.band = true;
    stoneAt(0, 4.04, 0, 4.6, 0.06, 1.74, 0.02).userData.band = true;
    stoneAt(0, 4.17, 0, 4.52, 0.2, 1.68, 0.03, red);
    stoneAt(0, 4.295, 0, 4.62, 0.05, 1.78, 0.015).userData.band = true;
    stoneAt(0, 4.38, 0, 4.46, 0.12, 1.66, 0.02).userData.band = true;
    const dentils: Piece[] = [],
      dentil = slab(0.12, 0.12, 0.12, 0.02);
    for (let i = 0; i < 16; i++) for (const sz of faces) dentils.push({ geometry: dentil, at: [-2.25 + i * 0.3, 4.38, sz * 0.885] });
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) dentils.push({ geometry: dentil, at: [sx * 2.25, 4.38, -0.6 + i * 0.3] });
    cluster(shell, dentils, dress, 'stone')!.userData.band = true;
    stoneAt(0, 4.495, 0, 4.76, 0.11, 2.0, 0.03);
    stoneAt(0, 4.58, 0, 4.68, 0.06, 1.92, 0.02).userData.band = true;
    // The attic: a base moulding, the die (ashlar), red end blocks over the columns, and in a cream
    // frame on each face a blank bronze tablet (no lettering); a cap moulding and the attic cornice.
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
    stoneAt(0, 5.275, 0, 4.24, 0.07, 1.64, 0.02).userData.band = true;
    stoneAt(0, 5.36, 0, 4.36, 0.1, 1.72, 0.03).userData.band = true; // 0.1 proud: no deep eave over the tablet
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
    // Two bronze urns flanking the crowning pedestal: a foot, a round bowl, a lid and a knob.
    const URN = new T.LatheGeometry(
      (
        [
          [0, 5.47], [0.11, 5.47], [0.11, 5.5], [0.08, 5.52], [0.052, 5.56], [0.062, 5.59], [0.11, 5.63],
          [0.14, 5.69], [0.145, 5.74], [0.13, 5.8], [0.1, 5.83], [0.112, 5.85], [0.112, 5.87], [0.08, 5.88],
          [0.075, 5.92], [0.04, 5.95], [0.05, 5.98], [0.035, 6.01], [0, 6.02],
        ] as [number, number][]
      ).map(([x, y]) => new T.Vector2(x, y)),
      16,
    );
    const standards: Piece[] = [];
    for (const sx of [-1, 1]) {
      const x = sx * colX;
      standards.push(
        { geometry: ledge(0.36, 0.08, 0.36, 0.02), at: [x, 5.45, 0] },
        { geometry: STANDARD, at: [x, 0, 0] },
        { geometry: CAP, at: [x, 0, 0] },
        { geometry: ledge(0.28, 0.06, 0.28, 0.015), at: [sx * 1.3, 5.44, 0] },
        { geometry: URN, at: [sx * 1.3, 0, 0] },
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

  function buildHall(shell: T.Group, site: plan.Site) {
    // A squat two-bay block (walls 0.5 to 4.3) under a copper roof, and a fat clock tower that
    // stands 0.6 proud of the front over the arched entrance (tower z 0.4 to 2.9).
    const w = site.w,
      d = site.d,
      tw = 2.5,
      tz = d / 2 + 0.6 - tw / 2;
    plinth(shell, w, d, palette.plinth, { height: 0.5 });
    plinth(shell, tw, tw, palette.plinth, { z: tz, height: 0.52, blocks: true });
    box(shell, 0, 2.4, 0, w, 3.8, d, palette.blonde, 'ashlar');
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) box(shell, sx * 3.6, 2.4, sz * 2.2, 0.45, 3.8, 0.45, palette.trim, 'stone'); // corner pilasters
      box(shell, sx * 1.475, 2.4, d / 2, 0.45, 3.8, 0.3, palette.trim, 'stone'); // tower-flank pilasters
    }
    box(shell, 0, 2.9, 0, w + 0.3, 0.2, d + 0.3, palette.trim, 'stone'); // string course
    box(shell, 0, 4.4, 0, w + 0.3, 0.2, d + 0.3, palette.trim, 'stone'); // cornice
    // Eave 0.3, not 0.35: a longer front slab's upper corner pokes 0.03 through the tower face
    // (z 2.9) as a thin copper line under the tower window.
    slabRoof(shell, 0, 4.5, 0, w, d + 0.3, 2.2, palette.copper, { eave: 0.3, verge: 0.3, thick: 0.22, ridge: palette.copperLight, gable: palette.blonde });
    // Two bays a side: arched windows below the string course, plain ones above. The rear has masses only.
    for (const sx of [-1, 1]) {
      windowAt(shell, sx * 2.54, 1.5, d / 2, 0.85, 1.15, { arched: true });
      windowAt(shell, sx * 2.54, 3.55, d / 2, 0.85, 0.95, { sill: false, lintel: false });
      const face = new T.Group();
      face.position.x = (sx * w) / 2;
      face.rotation.y = (sx * Math.PI) / 2;
      shell.add(face);
      for (const z of [-0.95, 0.95]) {
        const pane = windowAt(face, z, 1.5, 0, 0.85, 1.15, { arched: true });
        // The east side's front arch (seen from the overview and the chapter) keeps a dim lamp all night.
        if (sx === 1 && z === -0.95) pane.userData.nightLight = true;
        windowAt(face, z, 3.55, 0, 0.85, 0.95, { sill: false, lintel: false });
      }
    }
    // The tower: buttresses with pyramid caps either side of the arched door, a mullioned window above.
    box(shell, 0, 4.675, tz, tw, 8.35, tw, palette.blonde, 'ashlar', { segments: 2 });
    for (const sx of [-1, 1]) {
      box(shell, sx * 1.2, 3.05, tz + 1.2, 0.5, 5.1, 0.5, palette.trim, 'stone');
      cone(shell, sx * 1.2, 5.8, tz + 1.2, 0.4, 0.4, palette.trim, 'stone', 4);
    }
    // The fanlight and the tower window are lit late (at today's colour, 0.8), so the hall's front
    // shows a lit entrance and tower all evening in its chapter, not three panes on a dark block.
    const beforeDoor = shell.children.length,
      glassOf = (o: T.Object3D) => o instanceof T.Mesh && (o.material as T.Material).userData?.surfaceKind === 'glass';
    door(shell, 0, 0.52, tz + tw / 2, 1.3, 2.2, palette.greenDoor, { arched: true, landing: 0.25, width: 2.0 });
    for (const o of shell.children.slice(beforeDoor)) if (glassOf(o)) o.userData.windowLit = 0.8;
    windowAt(shell, 0, 4.65, tz + tw / 2, 0.8, 1.2, { arched: true, mullion: true }).userData.windowLit = 0.8;
    box(shell, 0, 6.1, tz, tw + 0.3, 0.2, tw + 0.3, palette.trim, 'stone');
    // Four clocks at 70% of the face: an iron rim, a cream dial that glows after dusk like the
    // windows, four iron markers, a fixed brass hub and iron hands that keep Glasgow time.
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const face = new T.Group();
      face.position.set(0, 0, tz);
      face.rotation.y = side;
      shell.add(face);
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
    }
    // The crown: a cornice, four pinnacles, a copper spire (9.05 to 12.05), a finial and a flag.
    box(shell, 0, 8.95, tz, tw + 0.36, 0.2, tw + 0.36, palette.trim, 'stone');
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        cylinder(shell, sx * 1.25, 9.35, tz + sz * 1.25, 0.16, 0.18, 0.6, palette.trim, 'stone');
        cone(shell, sx * 1.25, 9.9, tz + sz * 1.25, 0.26, 0.5, palette.copper, 'copper', 4);
      }
    cone(shell, 0, 10.55, tz, 1.41, 3.0, palette.copper, 'copper', 4);
    cylinder(shell, 0, 12.55, tz, 0.035, 0.05, 1.2, palette.bronze, 'brass'); // starts 0.1 inside the apex
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
    // Forecourt planters, grounded, each with a clipped topiary ball.
    for (const sx of [-1, 1]) {
      box(shell, sx * 1.85, 0.25, d / 2 + 1.15, 0.7, 0.5, 0.7, palette.plinth, 'stone', { taper: 0.04 });
      topiary(shell, sx * 1.85, 0.85, d / 2 + 1.15, 0.38, 2);
    }
  }

  function buildStudio(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d,
      white = '#eef0ea';
    // A low kerb-stone plinth under two volumes. A: a glass box in a chunky white frame (corner
    // posts, two bands, sharp mullions) under a green roof slab. B: a rendered block 0.3 behind A's
    // front with metal-framed ribbon windows on its front and on the +x face seen at overview.
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
    box(shell, 1.6, 1.85, 0, 2.4, 3.0, d - 0.6, palette.render, 'paint');
    const side = new T.Group();
    side.position.x = 2.8;
    side.rotation.y = Math.PI / 2;
    shell.add(side);
    for (const y of [1.25, 2.5]) {
      windowAt(shell, 1.6, y, (d - 0.6) / 2, 1.9, 0.72, { frame: palette.metal, lintel: false });
      windowAt(side, 0, y, 0, 3.6, 0.72, { frame: palette.metal, lintel: false });
    }
    // The green roof slab: a white coping, a lawn 0.17 proud, three shrub lumps and two tilted panels.
    // The coping is an eave for the glass box. At exactly 0.3 thick its float bounds miss the bake's
    // flat-slab test (<= 0.3), so it says where its underside is.
    const coping = box(shell, ax, 4.5, 0, aw + 0.3, 0.3, d + 0.3, white, 'paint');
    coping.userData.roof = true;
    coping.userData.eaveY = 4.35;
    box(shell, ax, 4.71, 0, aw - 0.2, 0.22, d - 0.2, palette.canopy[1], 'grass');
    for (const [x, y, z] of [[ax - 0.9, 4.95, -1.3], [ax - 1.0, 4.95, 0.6], [ax + 0.8, 4.92, 1.7]]) {
      const lump = new T.Mesh(new T.IcosahedronGeometry(0.32, 1), material(palette.hedge, 'foliage'));
      lump.position.set(x, y, z);
      lump.castShadow = lump.receiveShadow = true;
      shell.add(lump);
    }
    for (let i = 0; i < 2; i++) {
      box(shell, ax + 0.85, 4.89, -1.4 + i * 1.3, 0.9, 0.14, 0.2, palette.metal, 'iron');
      box(shell, ax + 0.85, 4.98, -1.4 + i * 1.3, 1.1, 0.08, 0.8, '#2f4e66', 'enamel', { rx: 0.35 }); // glossy panel, no night glow
    }
    // B's coping (top 3.59) with two planters of clipped topiary.
    box(shell, 1.6, 3.47, 0, 2.6, 0.24, d - 0.4, white, 'paint');
    for (const dz of [-1.2, 1.2]) {
      box(shell, 2.0, 3.77, dz, 0.8, 0.36, 0.5, '#b7ab93', 'stone');
      topiary(shell, 2.0, 4.05, dz, 0.34, 1, 1.15, 0.75, 0.85);
    }
    // The entrance: a white canopy on posts from the ground, a blue door with steps down from the
    // plinth, and a grounded apron with a bench.
    box(shell, ax, 2.7, d / 2 + 0.6, 2.6, 0.22, 1.2, white, 'paint');
    for (const sx of [-1, 1]) cylinder(shell, ax + sx * 1.1, 1.3, d / 2 + 1.05, 0.08, 0.08, 2.6, palette.metal, 'iron');
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
