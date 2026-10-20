import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as plan from './town-plan';
import { palette, hash, WATER, type TownContext } from './town-shared';
import { shoreHeight } from './town-ground';
import type { Kit } from './town-kit';
import type { Props } from './town-props';
import type { SurfaceKind } from './city-materials';

/**
 * The lighthouse's colours: the Northern Lighthouse Board's buff on the dressings, copes and
 * gallery (the town's plinth sandstone), a pale grey granite platform (a neutral, s 0.12), the
 * white tower and harled walls, the red bands and dome, black iron and a dark glass for the
 * small stair windows.
 */
/** The lantern glazing's radius. */
const LANTERN = 0.62;
const LIGHT = { buff: palette.plinth, granite: '#b9b1a3', white: palette.white, red: palette.boat, iron: palette.metal, glass: '#2d3838' };
/** The hut's roof: rise over its 1.3 depth, eave and verge overhangs, slab thickness. */
const HUT_ROOF = { rise: 0.8, eave: 0.22, verge: 0.2, thick: 0.14 };
/** A lathe profile point: radius, height and whether the shading breaks there (an arris). */
type Turn = [number, number, boolean?];

/* ------------------------------------------------------------------ */
/* Pier, harbour and lighthouse                                        */
/* ------------------------------------------------------------------ */
export function createHarbour(ctx: TownContext, kit: Kit, props: Props) {
  const { material, lamps, animated } = ctx;
  const { box, cylinder, strut, cone, sphere, bollard, rope, eye, coilPoints, hullShape, hullSolid, slabRoof, frameRing, lampGlass } = kit;
  const { lamp } = props;
  /**
   * A turned part: the profile (bottom to top, outside first) swept round y as a LatheGeometry, so
   * batch() measures its surface pattern round its circumference. A repeated point is an arris
   * (LatheGeometry averages normals across a step otherwise). `phi` is [start, length] for a part
   * that stops short of a full turn (the base course round the door case).
   */
  function turn(g: T.Object3D, profile: Turn[], colour: string, kind: SurfaceKind, segments = 32, phi: [number, number] = [0, Math.PI * 2]) {
    const pts: T.Vector2[] = [];
    profile.forEach(([r, y, sharp], i) => {
      pts.push(new T.Vector2(r, y));
      if (sharp && i > 0 && i < profile.length - 1) pts.push(new T.Vector2(r, y));
    });
    const m = new T.Mesh(new T.LatheGeometry(pts, segments, phi[0], phi[1]), material(colour, kind));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  /**
   * A ring of wall from radius r0 to r1, `tall` high from y, round the whole circle but for a gap
   * of half-angle `gap` about bearing `at` (bearings point along (sin a, cos a)): a bevelled
   * extrusion, so its ends are closed and its arrises catch the light.
   */
  function wallRing(g: T.Object3D, r0: number, r1: number, y: number, tall: number, at: number, gap: number, colour: string, kind: SurfaceKind) {
    // Shape space (x, y) turns to (x, -z) when the extrusion is stood up, so bearing a is shape angle a - PI/2.
    const from = at + gap - Math.PI / 2,
      to = at + Math.PI * 2 - gap - Math.PI / 2,
      shape = new T.Shape();
    shape.absarc(0, 0, r1, from, to, false);
    shape.absarc(0, 0, r0, to, from, true);
    shape.closePath();
    const b = Math.min(0.03, tall / 3),
      geo = new T.ExtrudeGeometry(shape, { depth: tall - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments: 28 })
        .rotateX(-Math.PI / 2)
        .translate(0, y + b, 0);
    const m = new T.Mesh(geo, material(colour, kind));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function pierAndHarbour(g: T.Object3D) {
    const [sx, sz] = plan.pier.start,
      [dx, dz] = plan.pier.dir;
    const heading = Math.atan2(dx, dz);
    const p = new T.Group();
    p.name = 'pier';
    p.position.set(sx, 0, sz);
    p.rotation.y = heading;
    g.add(p);
    const L = plan.pier.length,
      W = plan.pier.width;
    // A chunky timber pier on fat piles: wobbly two-tone planks on two stringers, the stringers on a
    // headstock across each pair of piles, X-bracing between the piles along both sides and across
    // under each headstock, and the piles standing 0.3 proud of the boards as bollards, with
    // chamfered tops. The deck stands 0.65 up (0.45 higher than the first deck), so the piles and
    // the bracing show above the water. Pier-local +x is (dz, -dx), +z runs out to sea.
    const D = plan.PIER_DECK,
      deck = D.deck,
      up = deck - 0.2; // what the deck rose by: every part that stands on it rises as much
    const plank = [palette.wood, '#94613a'], dark = palette.woodDark;
    const count = Math.round((L + 0.2) / 0.42), pitch = (L + 0.2) / count; // 15 planks
    for (let k = 0; k < count; k++)
      box(p, (hash(k * 5 + 1) - 0.5) * 0.06, deck - 0.05 + (hash(k * 5 + 2) - 0.5) * 0.02, (k + 0.5) * pitch, W + 0.12, 0.1, pitch - 0.045, plank[k % 2], 'wood', { ry: (hash(k * 5 + 3) - 0.5) * 0.05 }).userData.pierFrame = true;
    // Stringers and headstocks are long, flat and turned with the pier: bands, so batch() does not
    // take their boxes for eaves over everything under the deck.
    for (const side of [-1, 1]) Object.assign(box(p, side * 0.62, deck - 0.17, (L + 0.2) / 2, 0.16, 0.14, L + 0.2, dark, 'wood').userData, { band: true, pierFrame: true });
    const pileTop = deck + 0.3,
      pile: Turn[] = [[0.15, -0.6], [0.14, pileTop - 0.05], [0.125, pileTop - 0.015, true], [0.09, pileTop], [0, pileTop + 0.005]];
    for (const z of D.piles) {
      for (const side of [-1, 1]) {
        const m = turn(p, pile, dark, 'wood', 16);
        m.position.set(side * D.pileX, 0, z);
        m.userData.pierFrame = true;
      }
      Object.assign(box(p, 0, deck - 0.31, z, 2 * D.pileX + 0.36, 0.14, 0.16, dark, 'wood').userData, { band: true, pierFrame: true }); // headstock, its ends 0.04 past the piles
    }
    // X-bracing: 0.08 x 0.1 timbers, the second of each pair 0.07 further in (or back), so the two
    // never share a face where they cross. Along the sides they cross between neighbouring piles
    // (turned about x); across, under each headstock, between the pair (turned about z).
    // The braces run from just under the stringers (so each X hangs off the deck) to the waterline.
    const high = deck - 0.2,
      low = -0.06,
      span = D.piles[1] - D.piles[0] - 0.16,
      along = Math.hypot(span, high - low),
      tilt = Math.atan2(high - low, span),
      across = 2 * D.pileX - 0.2,
      athwart = Math.hypot(across, high - low),
      lean = Math.atan2(high - low, across);
    // A pile a mooring line is made fast to keeps the brace that rises to it inboard, so the line
    // drops past the bracing's outer face instead of through it.
    const tied = (x: number, z: number) => plan.harbour.lines.some(({ pile: [px, pz] }) => Math.abs(px - x) < 0.01 && Math.abs(pz - z) < 0.01);
    for (let k = 0; k + 1 < D.piles.length; k++)
      for (const side of [-1, 1])
        for (const s of [1, -1]) {
          // s 1 rises toward the bay's far pile, -1 toward its near one; one is inboard (n 1), never both.
          const risingIn = tied(side * D.pileX, D.piles[k + 1]) && !tied(side * D.pileX, D.piles[k]),
            n = (s > 0) === risingIn ? 1 : 0;
          Object.assign(box(p, side * (D.pileX + 0.18 - 0.07 * n), (high + low) / 2, (D.piles[k] + D.piles[k + 1]) / 2, 0.08, 0.1, along, plank[1], 'wood', { rx: -s * tilt }).userData, { band: true, pierFrame: true, brace: true });
        }
    for (const z of D.piles)
      for (const [n, s] of [[0, 1], [1, -1]])
        Object.assign(box(p, 0, (high + low) / 2, z - 0.12 - 0.09 * n, athwart, 0.1, 0.08, plank[1], 'wood', { rz: s * lean }).userData, { band: true, pierFrame: true, brace: true });
    const lastPile = D.piles[D.piles.length - 1]; // 6.1
    // The quay head the deck lands on: an ashlar block on the grass, cope stones along its sides and
    // its landward corners (a hair proud, with open joints), and steps down to the grass between them.
    {
      const Q = D.quay,
        [x0, x1] = Q.x,
        paving = deck - 0.06,
        quay = new T.Group();
      quay.name = 'harbour-quay';
      p.add(quay);
      box(quay, (x0 + x1) / 2, (paving - 0.1) / 2, (Q.z + 0.04) / 2, x1 - x0, paving + 0.1, 0.04 - Q.z, palette.stoneDark, 'ashlar');
      const cope = (cx: number, cz: number, along: number, across: number, alongX: boolean) =>
        (box(quay, cx, deck - 0.06, cz, alongX ? along : across, 0.12, alongX ? across : along, palette.trim, 'stone').userData.band = true);
      // Side copes from 0.05 proud of the landward face to where the deck begins (z 0), each 0.05
      // proud of its side; landward copes on the corners either side of the steps.
      const run = 0.05 - Q.z;
      for (const [x, s] of [[x0, -1], [x1, 1]] as const)
        for (let i = 0; i < 2; i++) cope(x - s * 0.1, Q.z - 0.05 + (run / 2) * (i + 0.5), run / 2 - 0.03, 0.3, false);
      const gap = Q.width / 2;
      for (const [a, b] of [[x0 + 0.25, -gap], [gap, x1 - 0.25]]) cope((a + b) / 2, Q.z + 0.1, b - a - 0.03, 0.3, true);
      for (let k = 0; k < Q.steps; k++) {
        const top = paving - ((k + 1) * paving) / (Q.steps + 1);
        box(quay, 0, (top - 0.05) / 2, Q.z - ((k + 1) * Q.tread) / 2 + 0.05, Q.width + k * 0.04, top + 0.05, (k + 1) * Q.tread + 0.1, palette.stoneDark, 'stone');
      }
      for (const x of [x0 + 0.42, x1 - 0.42]) bollard(quay, x, paving, -0.32);
    }
    // The ladder down to the water on the pier head's end: two iron stiles from under the water to
    // 0.3 over the boards (hand-holds) and round rungs 0.2 apart.
    {
      const { x: lx, half } = D.ladder,
        lz = L + 0.2 + 0.05;
      for (const s of [-1, 1]) box(p, lx + s * half, (deck + 0.3 - 0.3) / 2, lz, 0.07, deck + 0.6, 0.08, palette.metal, 'iron');
      for (let y = -0.05; y < deck + 0.3; y += 0.2) strut(p, new T.Vector3(lx - half, y, lz), new T.Vector3(lx + half, y, lz), 0.035, palette.metal, 'iron').userData.noShadow = true;
    }
    // Lamps stand on the boards, with the pier-local position passed straight through.
    lamp(p, 0.42, 0.45, 1.8, deck);
    lamp(p, -0.38, L - 0.45, 1.8, deck);
    cylinder(p, 0.72, 1.45 + up, lastPile, 0.035, 0.04, 1.9, palette.metal, 'iron', 18); // flagpole on the seaward pile
    box(p, 0.33, 2.12 + up, lastPile, 0.75, 0.5, 0.04, palette.blueDoor, 'fabric'); // cloth
    for (const s of [-1, 1]) box(p, 0.33, 2.12 + up, lastPile + 0.03, 0.82, 0.09, 0.02, palette.white, 'fabric', { rz: s * 0.588 }); // saltire
    // Crates 0.55-0.7 of a person and a barrel on the sand beside the deck, clear of its bracing.
    box(p, 1.42, 0.3, 1.5, 0.6, 0.6, 0.6, plank[0], 'wood', { ry: 0.2 });
    box(p, 1.45, 0.85, 1.48, 0.5, 0.5, 0.5, palette.gold, 'paint', { ry: -0.15 });
    cylinder(p, 2.85, 0.3, 1.6, 0.24, 0.22, 0.6, plank[0], 'wood', 18); // barrel with two hoops
    for (const y of [0.12, 0.48]) cylinder(p, 2.85, y, 1.6, 0.255, 0.255, 0.05, palette.metal, 'iron', 18);
    // A harbour master's hut on a plinth at the landward end: harled walls, a steep pantile roof on
    // two slabs over harled gables, white barge boards and a finial at each apex, a gable-end
    // chimney with a cope and a pot, a ledged-and-braced door in a painted frame over a step, a
    // framed sash window on a sill, and a red-and-white lifebuoy on the side wall.
    const hut = new T.Group();
    hut.name = 'harbour-hut';
    hut.position.set(W / 2 + 1.15, 0, 0.1);
    hut.rotation.y = -0.2;
    p.add(hut);
    box(hut, 0, 0.15, 0, 1.7, 0.3, 1.5, palette.stoneDark, 'ashlar'); // plinth
    box(hut, 0, 0.95, 0, 1.5, 1.3, 1.3, palette.render, 'paint'); // walls 0.30..1.60
    const R = HUT_ROOF,
      ridgeTop = slabRoof(hut, 0, 1.6, 0, 1.5, 1.3, R.rise, palette.pantile, { eave: R.eave, verge: R.verge, thick: R.thick, ridge: palette.pantileLight });
    const gable = new T.ExtrudeGeometry(new T.Shape([new T.Vector2(-0.64, 0), new T.Vector2(0.64, 0), new T.Vector2(0, R.rise - 0.02)]), { depth: 0.12, bevelEnabled: false });
    for (const side of [-1, 1]) {
      const m = new T.Mesh(gable, material(palette.render, 'paint'));
      m.rotation.y = Math.PI / 2;
      m.position.set(side * 0.75 - (side > 0 ? 0.12 : 0), 1.6, 0);
      m.castShadow = m.receiveShadow = true;
      hut.add(m);
    }
    {
      // The barge boards hang under each slab's verge, laid in the slab's own frame (as slabRoof lays it).
      const a = Math.atan2(R.rise, 0.65),
        len = (0.65 + R.eave + R.thick * Math.sin(a)) / Math.cos(a),
        yc = 1.6 + R.rise - ((0.65 + R.eave - R.thick * Math.sin(a)) / 2) * Math.tan(a) + (Math.cos(a) * R.thick) / 2;
      for (const side of [-1, 1]) {
        const slope = new T.Group();
        slope.position.set(0, yc, (side * (0.65 + R.eave)) / 2);
        slope.rotation.x = side * a;
        hut.add(slope);
        for (const end of [-1, 1]) box(slope, end * (0.75 + R.verge - 0.04), -(R.thick / 2 + 0.06), 0, 0.08, 0.14, len - 0.02, palette.white, 'paint');
      }
      // A turned finial on each apex, one piece 0.35 tall, so it casts with the other painted parts.
      for (const end of [-1, 1])
        turn(hut, [[0.045, ridgeTop - 0.05], [0.045, ridgeTop + 0.12], [0.06, ridgeTop + 0.14], [0.07, ridgeTop + 0.2], [0.06, ridgeTop + 0.26], [0.03, ridgeTop + 0.29], [0, ridgeTop + 0.3]], palette.white, 'paint', 8).position.x = end * (0.75 + R.verge - 0.04);
    }
    const stackTop = ridgeTop + 0.33;
    box(hut, 0.5, (1.5 + stackTop) / 2, 0, 0.36, stackTop - 1.5, 0.4, palette.render, 'paint'); // gable-end stack
    box(hut, 0.5, stackTop + 0.04, 0, 0.46, 0.08, 0.5, palette.trim, 'stone').userData.band = true;
    cylinder(hut, 0.5, stackTop + 0.24, 0, 0.085, 0.1, 0.32, palette.pantile, 'pantile', 12); // the pot, 0.32 tall (so it casts)
    // The door: a ledged-and-braced blue leaf (three ledges, two braces rising from the hinge side)
    // in a cream frame, a round brass knob, and a stone step down from the plinth.
    const doorX = 0.32,
      doorTop = 1.28;
    box(hut, doorX, (0.3 + doorTop) / 2, 0.67, 0.46, doorTop - 0.3, 0.1, palette.blueDoor, 'enamel');
    for (const y of [0.42, 0.79, 1.16]) box(hut, doorX, y, 0.735, 0.4, 0.08, 0.04, palette.blueDoor, 'enamel');
    for (const [y0, y1] of [[0.46, 0.75], [0.83, 1.12]]) box(hut, doorX, (y0 + y1) / 2, 0.73, 0.07, Math.hypot(0.3, y1 - y0) - 0.02, 0.03, palette.blueDoor, 'enamel', { rz: Math.atan2(0.3, y1 - y0) });
    sphere(hut, doorX - 0.15, 0.8, 0.77, 0.04, palette.brass, 'brass', 12);
    for (const s of [-1, 1]) box(hut, doorX + s * 0.28, 0.85, 0.7, 0.1, 1.1, 0.14, palette.trim, 'paint');
    box(hut, doorX, 1.45, 0.71, 0.66, 0.12, 0.16, palette.trim, 'paint');
    box(hut, doorX, 0.075, 0.875, 0.62, 0.15, 0.25, palette.stoneDark, 'stone');
    // The window: a cream frame proud of the wall, the glass 0.07 back with a meeting rail, a sill.
    frameRing(hut, -0.4, 1.0, 0.63, 0.34, 0.44, 0.08, 0.12, palette.trim, 'paint');
    const pane = new T.Mesh(new T.PlaneGeometry(0.36, 0.46), material(palette.glass, 'glass'));
    pane.position.set(-0.4, 1.0, 0.68);
    hut.add(pane);
    box(hut, -0.4, 1.0, 0.7, 0.36, 0.07, 0.04, palette.trim, 'paint');
    box(hut, -0.4, 0.71, 0.72, 0.56, 0.08, 0.18, palette.trim, 'stone').userData.band = true;
    // The lifebuoy: a red ring with four white quarters (each a short, slightly fatter arc).
    const buoyRing = new T.Group();
    buoyRing.position.set(0.78, 0.95, 0.1);
    buoyRing.rotation.y = Math.PI / 2;
    hut.add(buoyRing);
    const ring = new T.Mesh(new T.TorusGeometry(0.17, 0.055, 8, 16), material(palette.flowers[0], 'enamel'));
    ring.castShadow = true;
    buoyRing.add(ring);
    for (let k = 0; k < 4; k++) {
      const quarter = new T.Mesh(new T.TorusGeometry(0.17, 0.062, 8, 3, 0.34), material(palette.white, 'enamel'));
      quarter.rotation.z = (k * Math.PI) / 2 + Math.PI / 4 - 0.17;
      quarter.userData.noShadow = true;
      buoyRing.add(quarter);
    }
    // Two chunky channel buoys, a red can and a green cone, flanking the pier head: out past both
    // foam lines in the bay's shallows, and at least 0.5 clear of the boat's loop.
    const marks = [[2.0, 5.7, palette.boat, 'can'], [-2.6, 5.9, palette.greenDoor, 'cone']] as const;
    for (const [i, [lx, lz, colour, top]] of marks.entries()) {
      const buoy = new T.Group();
      buoy.position.set(sx + dz * lx + dx * lz, WATER, sz - dx * lx + dz * lz);
      buoy.userData.keepSeparate = true;
      g.add(buoy);
      cylinder(buoy, 0, 0.05, 0, 0.3, 0.34, 0.4, colour, 'enamel', 18); // float -0.15..0.25
      cylinder(buoy, 0, 0.12, 0, 0.325, 0.33, 0.1, palette.white, 'enamel', 18); // white band, about 0.015 proud
      if (top === 'can') box(buoy, 0, 0.45, 0, 0.26, 0.4, 0.26, colour, 'enamel');
      else cone(buoy, 0, 0.47, 0, 0.22, 0.44, colour, 'enamel', 18, 0);
      const glow = lampGlass();
      const lampMesh = new T.Mesh(new T.SphereGeometry(0.08, 12, 8), glow);
      lampMesh.position.y = top === 'can' ? 0.72 : 0.76;
      buoy.add(lampMesh);
      lamps.push(lampMesh);
      animated.push({
        object: buoy,
        update(time) {
          buoy.position.y = WATER + Math.sin(time * 1.3 + i * 2) * 0.03;
          buoy.rotation.z = Math.sin(time * 0.9 + i) * 0.08;
        },
      });
    }
    // A dinghy moored alongside the deck, on the side away from the hut, its stern past the foam:
    // a shaped white hull with a blue rubbing band, a visible wooden floor and a seated thwart.
    const moor = plan.harbour.dinghy,
      dinghy = new T.Group();
    dinghy.name = 'harbour-dinghy';
    dinghy.position.set(sx + dx * moor.z + dz * moor.x, WATER, sz + dz * moor.z - dx * moor.x);
    dinghy.rotation.y = heading + moor.turn;
    dinghy.userData.keepSeparate = true;
    g.add(dinghy);
    // The hull's top cap sits 0.005 under the band's, so the two caps don't z-fight on the gunwale.
    hullSolid(dinghy, 0.34, 0.8, 0.72, -0.06, 0.155, 0.04, palette.white, 'enamel'); // -0.06..0.175, waterline 0.06 up
    hullSolid(dinghy, 0.36, 0.81, 0.73, 0.1, 0.02, 0.03, palette.blueDoor, 'enamel'); // rubbing band 0.10..0.18, 0.01 proud
    const floor = new T.Mesh(new T.ShapeGeometry(hullShape(0.27, 0.66, 0.6), 4).rotateX(-Math.PI / 2), material(palette.wood, 'wood'));
    floor.position.y = 0.185;
    floor.receiveShadow = true;
    dinghy.add(floor);
    box(dinghy, 0, 0.23, -0.1, 0.72, 0.07, 0.2, palette.woodDark, 'wood'); // thwart resting on the gunwales
    animated.push({
      object: dinghy,
      update(time) {
        dinghy.position.y = WATER + Math.sin(time * 1.1 + 1) * 0.015;
        dinghy.rotation.x = Math.sin(time * 0.8) * 0.02;
      },
    });
    mooring(p, moor, pitch, deck);
    quay(g);
    dryingNet(g);
    strand(g, p);
  }
  /**
   * The dinghy's lines and the boat's empty berth, pier-local. Each line runs from a fairlead
   * buried in the dinghy's hull (taken at its rest pose), out level through the side, sagging to
   * a rope eye round a pile head on the dinghy's side of the pile, and ends inside the pile. The
   * lines stay put while the dinghy bobs: its buried ends never leave the hull (check-town). The
   * boat never rests, so its berth at the pier head is a bollard with a coiled blue line on the
   * planks beside it; the coil shares the bollard's world x, so the lead between them runs along
   * world z and batch() never takes its box for an eave.
   */
  function mooring(p: T.Object3D, moor: typeof plan.harbour.dinghy, pitch: number, deck: number) {
    const H = plan.harbour,
      up = new T.Vector3(0, 1, 0);
    // The eyes round the pile heads are wet and worn darker than the lines: a pale ring there
    // framed the pier-head lamp's lantern like a halo at the default view.
    const pileEye = '#' + new T.Color(palette.rope).multiplyScalar(0.3).getHexString();
    for (const line of H.lines) {
      const [px, pz] = line.pile;
      eye(p, px, deck + 0.24, pz, 0.19, pileEye); // 0.06 under the pile top, its inner edge clear of the pile
      const end = new T.Vector3(...line.fairlead).applyAxisAngle(up, moor.turn).add(new T.Vector3(moor.x, WATER, moor.z)),
        axis = new T.Vector3(px, deck + 0.24, pz),
        h = new T.Vector3(px - end.x, 0, pz - end.z).normalize(),
        out = end.clone().addScaledVector(h, 0.25),
        ring = axis.clone().addScaledVector(h, -0.19),
        mid = out.clone().lerp(ring, 0.5);
      mid.y -= 0.05;
      rope(p, [end, out, mid, ring, axis]);
    }
    // The planks' own jitter, so the bollard stands on its plank (14) and the coil on 12 and 13.
    const plankTop = (z: number) => deck + (hash(Math.floor(z / pitch) * 5 + 2) - 0.5) * 0.02;
    const [bx, bz] = H.headBollard,
      [cx, cz] = H.berthCoil;
    bollard(p, bx, plankTop(bz), bz);
    eye(p, bx, deck + 0.16, bz, 0.135); // round the waist, under the head's flare
    const lead = new T.Vector3(bx - cx, 0, bz - cz).normalize(),
      // The coil's underside lies on plank 12 (top deck - 0.006) and 0.01 into plank 13 (deck + 0.004).
      coil = coilPoints(cx, deck - 0.001, cz, 0.06, 0.19, 3, Math.atan2(-lead.x, lead.z)),
      last = coil[coil.length - 1],
      lift = last.clone().addScaledVector(lead, 0.2).setY(deck + 0.09),
      head = new T.Vector3(bx, deck + 0.16, bz),
      onEye = head.clone().addScaledVector(lift.clone().setY(deck + 0.16).sub(head).normalize(), 0.135);
    rope(p, [new T.Vector3(cx, deck - 0.056, cz), ...coil, lift, onEye, head], palette.ropeBlue);
  }
  /**
   * A Scottish creel, about 1.6x real like the crates, low and long: a D-shaped net body 0.5 long
   * (local z) x 0.32 wide x 0.22 tall on a flat base frame. The base and three hoops are pale
   * rope-tan; the netting between them is one dark, weathered colour, recessed under the hoops and
   * soft-checked with lighter twine (a vertex pattern, so it never twinkles), so it reads as a
   * see-through cage. (Dark charcoal hoops over solid blue, green and orange panels with a dark
   * round entrance in one end read as banded chests, a pile of luggage.)
   */
  let creelBody: T.BufferGeometry | undefined, creelHoop: T.BufferGeometry | undefined;
  function creel(g: T.Object3D, x: number, y: number, z: number, ry: number) {
    if (!creelBody) {
      const radial = 10,
        rows = 6,
        vault = new T.CylinderGeometry(0.15, 0.15, 0.48, radial, rows, false, Math.PI / 2, Math.PI),
        n = vault.getAttribute('normal'),
        torso = (rows + 1) * (radial + 1),
        tone = new Float32Array(n.count * 3);
      // Twine where the checks meet, the open mesh darker between; the end panels (caps) in shade.
      for (let k = 0; k < n.count; k++) tone.fill(k >= torso ? 0.78 : ((Math.floor(k / (radial + 1)) + (k % (radial + 1))) % 2 ? 0.82 : 1.22), k * 3, k * 3 + 3);
      vault.setAttribute('color', new T.BufferAttribute(tone, 3));
      creelBody = vault.rotateX(Math.PI / 2).translate(0, 0.07, 0);
      creelHoop = new T.TorusGeometry(0.155, 0.016, 4, 8, Math.PI);
    }
    const c = new T.Group();
    c.position.set(x, y, z);
    c.rotation.y = ry;
    g.add(c);
    const body = new T.Mesh(creelBody, material(CREEL.net, 'fabric'));
    body.castShadow = body.receiveShadow = true;
    c.add(body);
    box(c, 0, 0.035, 0, 0.32, 0.07, 0.5, CREEL.frame, 'wood'); // the base frame
    for (const hz of [-0.22, 0, 0.22]) {
      const hoop = new T.Mesh(creelHoop, material(CREEL.frame, 'fabric'));
      hoop.position.set(0, 0.07, hz);
      hoop.castShadow = hoop.receiveShadow = true;
      c.add(hoop);
    }
  }
  /** The creels' colours: a weathered blue-grey netting (HSV s 0.24, under the old creel blue's 0.44) and a rope-tan frame. */
  const CREEL = { net: '#55706f', frame: palette.rope };
  /** A beach detail's root at shore coordinates (i, w), standing 0.01 into the sand. */
  const onShore = (i: number, w: number) => {
    const [x, z] = plan.shoreAt(i, w);
    return new T.Vector3(x, shoreHeight(w) - 0.01, z);
  };
  /**
   * The working quay on the hut side of the pier: creels stacked two high and two wide, square to
   * the shore, one more waiting on the sand beside them, square too, one orange float and a coil of
   * rope on the dry sand, its end trailing toward the water.
   */
  function quay(g: T.Object3D) {
    const S = plan.shoreProps;
    const stack = new T.Group();
    stack.position.copy(onShore(S.creelStack.i, S.creelStack.w));
    stack.rotation.y = plan.shoreTurn(S.creelStack.i); // local +z out to sea
    g.add(stack);
    // Two on the sand, two more on them, each a hair off square, as stacked by hand.
    const tiers: [number, number, number, number][] = [
      [-0.165, 0, 0, 0.02], [0.165, 0, 0.01, -0.015],
      [-0.165, 0.215, -0.01, -0.03], [0.165, 0.215, 0.015, 0.025],
    ];
    for (const [x, y, z, ry] of tiers) creel(stack, x, y, z, ry);
    const lone = onShore(S.creel.i, S.creel.w);
    creel(g, lone.x, lone.y, lone.z, plan.shoreTurn(S.creel.i) + S.creel.turn);
    for (const f of S.floats) {
      const at = onShore(f.i, f.w);
      sphere(g, at.x, at.y + 0.11, at.z, 0.12, palette.tramOrange, 'enamel'); // 0.02 into the sand
    }
    // A coil on the sand: the inner end rises out of the sand at its middle, and the outer end
    // leaves the last turn heading out to sea and dives back in.
    const c = onShore(S.coil.i, S.coil.w).setY(shoreHeight(S.coil.w)),
      seaward = plan.shoreTurn(S.coil.i),
      turns = coilPoints(c.x, c.y, c.z, 0.06, 0.19, 3, -seaward),
      last = turns[turns.length - 1],
      along = new T.Vector3(Math.sin(seaward), 0, Math.cos(seaward));
    rope(g, [new T.Vector3(c.x, c.y - 0.055, c.z), ...turns, last.clone().addScaledVector(along, 0.12), last.clone().addScaledVector(along, 0.22).setY(c.y - 0.055)]);
  }
  /**
   * A bundle of gathered netting along `points` (a smooth curve): a tube `r(u)` thick at u along
   * it (0..1), its colour twisted in faint light and dark strands (±6%), so it reads as heaped
   * mesh or rope, not as cloth. Smooth normals; its ends taper into whatever it hangs from.
   */
  function netBundle(points: T.Vector3[], r: (u: number) => number) {
    const curve = new T.CatmullRomCurve3(points),
      segments = 14,
      sides = 7,
      geo = new T.TubeGeometry(curve, segments, 1, sides, false),
      p = geo.getAttribute('position'),
      tone = new Float32Array(p.count * 3),
      at = new T.Vector3();
    for (let j = 0; j <= segments; j++) {
      const u = j / segments,
        radius = r(u);
      curve.getPointAt(u, at);
      for (let i = 0; i <= sides; i++) {
        const k = j * (sides + 1) + i;
        p.setXYZ(k, at.x + (p.getX(k) - at.x) * radius, at.y + (p.getY(k) - at.y) * radius, at.z + (p.getZ(k) - at.z) * radius);
        tone.fill(1 + 0.06 * Math.sin(Math.PI * 2 * ((2 * i) / sides + u * 3.5)), k * 3, k * 3 + 3);
      }
    }
    geo.setAttribute('color', new T.BufferAttribute(tone, 3));
    return geo;
  }
  /**
   * A fishing net hung to dry over a bar between two posts on the upper beach, on the dinghy side
   * of the pier. The net is heaped over the bar along its cork line (orange floats strung along the
   * top, where a net's floats are) and hangs off it in slack, gathered swags, two seaward (local -z)
   * and one landward, with one end fallen to the sand in a loose heap: rope-like bundles of a pale,
   * grey netting, so it reads as a net from every bearing. (A single sheet with floats on its hem
   * read as a towel on a rail, or from the archive's bearing, edge on, as a flag on a pole; cut-out
   * mesh holes shrink below a pixel at the zooms the town is mostly seen at and twinkle.) The net
   * is cloth that casts nothing, so it batches with the other no-shadow fabric.
   */
  function dryingNet(g: T.Object3D) {
    const F = plan.shoreProps.netFrame,
      [ax, az] = plan.shoreAt(F.from.i, F.from.w),
      [bx, bz] = plan.shoreAt(F.to.i, F.to.w),
      span = Math.hypot(bx - ax, bz - az);
    const frame = new T.Group();
    frame.position.set((ax + bx) / 2, shoreHeight(F.from.w) - 0.01, (az + bz) / 2);
    frame.rotation.y = Math.atan2(az - bz, bx - ax); // local +x runs from -> to, so local -z is out to sea
    g.add(frame);
    for (const s of [-1, 1]) box(frame, (s * span) / 2, 0.525, 0, 0.09, 1.05, 0.09, palette.woodDark, 'wood');
    strut(frame, new T.Vector3(-span / 2, 0.95, 0), new T.Vector3(span / 2, 0.95, 0), 0.045, palette.wood, 'wood');
    const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z),
      bar = 0.95,
      belly = (u: number) => 4 * u * (1 - u),
      parts: T.BufferGeometry[] = [];
    // The heap along the bar's top: the cork line, from near the `from` post to 0.5 (the bar bare beyond).
    const heap = [-0.64, 0.5];
    parts.push(netBundle([-0.66, -0.4, -0.1, 0.2, 0.52].map((x, k) => V(x, bar + 0.04 + 0.01 * Math.sin(k * 2.1), 0.008 * (k % 2 ? 1 : -1))), (u) => 0.065 * (0.55 + 0.45 * Math.sin(Math.PI * u) ** 0.4) * (1 + 0.15 * Math.sin(u * 19))));
    // Slack swags: each from one point on the bar to another, sagging `sag` and swinging `out` off the
    // bar; each is three gathered folds of the net side by side (a full one and two slimmer ones,
    // sagging a little more and less), lumpy along their length, so a swag is a heavy bunch of mesh.
    for (const [n, { a, b, sag, out, r, side }] of [
      { a: -0.6, b: 0.04, sag: 0.46, out: 0.1, r: 0.085, side: -1 },
      { a: -0.06, b: 0.48, sag: 0.32, out: 0.09, r: 0.07, side: -1 },
      { a: -0.44, b: 0.36, sag: 0.27, out: 0.08, r: 0.068, side: 1 },
    ].entries())
      for (const [fold, k0, deeper, wide] of [[0, 0, 1, 1], [1, 0.04, 1.14, 0.62], [2, -0.03, 0.86, 0.66]] as const)
        parts.push(netBundle(Array.from({ length: 7 }, (_, k) => {
          const u = k / 6;
          return V(a + k0 + (b - a) * u, bar + 0.02 - sag * deeper * belly(u) * (1 + 0.15 * (u - 0.5)), side * (0.045 + (out + 0.035 * (fold - 1)) * belly(u)));
        }), (u) => r * wide * (0.4 + 0.6 * Math.sin(Math.PI * u) ** 0.6) * (1 + 0.22 * Math.sin(u * 17 + n * 2.3 + fold * 1.7))));
    // One end fallen to the sand by the `from` post, heaped where it lies.
    for (const [dx, wide] of [[0, 1], [0.05, 0.7]])
      parts.push(netBundle([V(-0.62 + dx, bar + 0.02, -0.04), V(-0.6 + dx, 0.62, -0.12), V(-0.55 + dx, 0.3, -0.17), V(-0.48 + dx, 0.08, -0.2)], (u) => wide * (0.04 + 0.035 * u) * (1 + 0.2 * Math.sin(u * 13 + dx * 40))));
    const pile = lump(1, 1).scale(0.17, 0.06, 0.12).translate(-0.45, 0.04, -0.19);
    parts.push(pile.setAttribute('color', new T.BufferAttribute(new Float32Array(pile.getAttribute('position').count * 3).fill(0.94), 3)));
    const net = new T.Mesh(mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!, material(palette.net, 'fabric'));
    net.receiveShadow = true;
    net.userData.noShadow = true;
    frame.add(net);
    // Floats strung along the cork line on top of the heap.
    const blob = lump(0.045);
    for (const x of [heap[0] + 0.08, -0.32, -0.04, 0.24, heap[1] - 0.04]) {
      const float = new T.Mesh(blob, material(palette.tramOrange, 'enamel'));
      float.position.set(x, bar + 0.11, 0);
      float.receiveShadow = true;
      frame.add(float);
    }
  }
  /** The icosahedron as a smooth little lump: low detail, but with sphere normals. */
  function lump(r: number, detail = 0) {
    const geo = new T.IcosahedronGeometry(r, detail),
      p = geo.getAttribute('position'),
      n = geo.getAttribute('normal');
    for (let k = 0; k < p.count; k++) n.setXYZ(k, p.getX(k) / r, p.getY(k) / r, p.getZ(k) / r);
    return geo;
  }
  /**
   * A clump of wrack s across 0.34: three low lumps of mixed size round the middle, their long
   * axes pointing out, and two or three flat fronds of mixed length lying roughly along `trail`
   * (the strand line), each turned a little its own way, so no clump is a regular star. Nothing
   * reaches past 0.17 s.
   */
  function wrack(g: T.Object3D, x: number, y: number, z: number, s: number, seed: number, trail: number, colours: [string, string]) {
    const [weed, kelp] = colours,
      h = (k: number) => hash(Math.floor(seed * 1000) + k * 7);
    for (let k = 0; k < 3; k++) {
      const a = seed + (k * Math.PI * 2) / 3 + (h(k) - 0.5) * 0.8,
        out = 0.05 * s * (0.5 + 0.5 * h(k + 3)),
        size = 0.75 + 0.25 * h(k + 6),
        blob = new T.Mesh(lump(1), material(k === 1 ? kelp : weed, 'foliage'));
      blob.position.set(x + Math.cos(a) * out, y, z + Math.sin(a) * out);
      blob.scale.set(0.12 * s * size, 0.045 * s, 0.09 * s * size);
      blob.rotation.y = -a; // local x along the radius
      blob.userData.noShadow = true;
      g.add(blob);
    }
    // Fronds 0.18-0.3 s long, slid along themselves by up to the length they lack (so every tip
    // stays within 0.15 s), each 0.004 above the last so the crossing tops never meet.
    const fronds = h(9) < 0.5 ? 2 : 3;
    for (let k = 0; k < fronds; k++) {
      const long = 0.3 * s * (0.6 + 0.4 * h(k + 10)),
        ry = trail + (h(k + 13) - 0.5) * 1.0 + (k * Math.PI) / 2 * (h(k + 16) < 0.3 ? 1 : 0),
        slide = (h(k + 19) - 0.5) * (0.3 * s - long);
      box(g, x + Math.cos(ry) * slide, y + 0.01 + 0.004 * k, z - Math.sin(ry) * slide, long, 0.02, 0.1 * s, k === 1 ? weed : kelp, 'foliage', { ry }).userData.noShadow = true;
    }
  }
  /** The sand's height out from the outline at a world point (its distance from the outline). */
  const sandAt = (x: number, z: number) => shoreHeight(plan.distanceToPolyline([x, z], plan.islandOutline, true));
  /**
   * The strand on the dinghy side of the pier: two rock pools tucked against the boulder at sample
   * 42, so the rock is their rim; two strand lines of wrack (older and browner up the beach), a
   * bleached driftwood log, and weed on the piles that stand in the tide (pier-local).
   */
  function strand(g: T.Object3D, p: T.Object3D) {
    const S = plan.shoreProps;
    // Each pool: a matte bed, a dim grey-teal in the middle shading out to the wet sand at its
    // ragged rim, so it reads as water lying in the sand by the rock. (A pale cyan oval ringed by
    // pebbles read as a puddle with stepping stones, or a paw print.)
    const deep = new T.Color('#6f9e9c'),
      rim = new T.Color(palette.sand).multiplyScalar(0.84);
    S.rockPools.forEach((pool, n) => {
      const [x, z] = plan.shoreAt(pool.i, pool.w),
        y = shoreHeight(pool.w),
        turn = plan.shoreTurn(pool.i), // local x along the shore, +z out to sea
        stretch = [1.15, 0.85]; // a little longer along the shore than across it
      const bed = new T.CircleGeometry(pool.r, 9).rotateX(-Math.PI / 2),
        bp = bed.getAttribute('position'),
        tone = new Float32Array(bp.count * 3);
      for (let k = 1; k < bp.count; k++) {
        const jitter = 0.88 + 0.24 * hash(n * 31 + ((k - 1) % 9));
        bp.setXYZ(k, bp.getX(k) * jitter * stretch[0], 0, bp.getZ(k) * jitter * stretch[1]);
      }
      for (let k = 0; k < bp.count; k++) tone.set((k === 0 ? deep : rim).toArray(), k * 3);
      bed.setAttribute('color', new T.BufferAttribute(tone, 3));
      const bedMesh = new T.Mesh(bed, material('#ffffff', 'stone'));
      bedMesh.position.set(x, y + 0.008, z);
      bedMesh.rotation.y = turn;
      bedMesh.receiveShadow = true;
      bedMesh.userData.ground = true;
      bedMesh.userData.noShadow = true;
      g.add(bedMesh);
    });
    // Strand lines: a flat ribbon of weed lying along the shore, wandering a little up and down
    // the beach, its width swelling and thinning raggedly. (Separate clumps of lumps and fronds
    // read as brown crumbs or dead leaves; knots of darker weed along it, as a twig.)
    const weed = palette.weed,
      kelp = palette.kelp,
      dry = '#' + new T.Color(palette.kelp).multiplyScalar(0.9).getHexString();
    S.wrack.forEach((line, n) => {
      const old = line.w < 1.8,
        colours = [new T.Color(old ? dry : weed), new T.Color(old ? dry : kelp).multiplyScalar(old ? 0.92 : 1)],
        steps = 16,
        position: number[] = [],
        colour: number[] = [],
        index: number[] = [];
      for (let k = 0; k <= steps; k++) {
        const u = k / steps,
          i = line.from + (line.to - line.from) * u,
          w = line.w + 0.04 * Math.sin(u * 7 + n * 2) + 0.02 * Math.sin(u * 19 + n),
          half = (0.03 + 0.055 * Math.sin(Math.PI * u) ** 0.5) * (0.7 + 0.6 * hash(n * 41 + k)),
          [ax, az] = plan.shoreAt(i, w - half),
          [bx, bz] = plan.shoreAt(i, w + half),
          c = colours[0].clone().lerp(colours[1], 0.5 + 0.5 * Math.sin(u * 11 + n));
        position.push(ax, shoreHeight(w - half) + 0.006, az, bx, shoreHeight(w + half) + 0.006, bz);
        colour.push(c.r, c.g, c.b, c.r, c.g, c.b);
        if (k < steps) index.push(2 * k, 2 * k + 2, 2 * k + 1, 2 * k + 1, 2 * k + 2, 2 * k + 3);
      }
      const ribbon = new T.BufferGeometry();
      ribbon.setAttribute('position', new T.Float32BufferAttribute(position, 3));
      ribbon.setAttribute('color', new T.Float32BufferAttribute(colour, 3));
      ribbon.setIndex(index);
      ribbon.computeVertexNormals();
      // Wound to face up whichever way the shore runs.
      if (ribbon.getAttribute('normal').getY(0) < 0) {
        ribbon.setIndex(index.map((_, k) => index[k - (k % 3) + [0, 2, 1][k % 3]]));
        ribbon.computeVertexNormals();
      }
      const strip = new T.Mesh(ribbon, material('#ffffff', 'foliage'));
      strip.receiveShadow = true;
      strip.userData.noShadow = true;
      g.add(strip);
    });
    // Wrack at the feet of the two piles that stand in the wet sand (pier-local).
    plan.harbour.pileWrack.forEach(([lx, lz], n) => {
      const [wx, wz] = plan.pierPoint(lx, lz);
      wrack(p, lx, sandAt(wx, wz), lz, 0.8, n * 2.1 + 0.4, 0, [weed, kelp]); // the tide line runs roughly across the pier
    });
    // Weed sleeves on the six piles that stand in the tide, just proud of each pile's taper.
    for (let z = 3.5; z < plan.pier.length + 0.2; z += 1.3)
      for (const side of [-1, 1]) {
        const sleeve = new T.Mesh(new T.CylinderGeometry(0.152, 0.158, 0.17, 18, 1, true), material(weed, 'foliage'));
        sleeve.position.set(side * 0.72, 0.035, z);
        sleeve.receiveShadow = true;
        sleeve.userData.noShadow = true;
        p.add(sleeve);
      }
    // Driftwood on the strand line: a silvered log, thinning toward `to`, its root end at `from`
    // spread into a low, flattened root plate (a round swelling there read as a bone or a rolling
    // pin), with two short broken branches off one side: one 0.35 along it, raised 50 degrees
    // toward the thin end, and a shorter one 0.7 along, raised 35 degrees and turned 25 degrees
    // aside. Log and branches are one mesh, so they cast with the log rather than opening a
    // no-shadow wood group.
    const D = S.driftwood,
      [fx, fz] = plan.shoreAt(D.from.i, D.from.w),
      [tx, tz] = plan.shoreAt(D.to.i, D.to.w),
      y = (shoreHeight(D.from.w) + shoreHeight(D.to.w)) / 2 + 0.07,
      along = new T.Vector3(tx - fx, 0, tz - fz),
      length = along.length(),
      up = new T.Vector3(0, 1, 0);
    along.normalize();
    const side = new T.Vector3().crossVectors(up, along);
    // The profile up the log's axis (radius, distance from `from`), closed at both ends.
    const profile = [[0, -0.01], [0.1, -0.005], [0.13, 0.04], [0.115, 0.1], [0.092, 0.2], [0.075, length - 0.03], [0.055, length], [0, length]],
      log = new T.LatheGeometry(profile.map(([r, h]) => new T.Vector2(r, h)), 8).applyQuaternion(new T.Quaternion().setFromUnitVectors(up, along)),
      lp = log.getAttribute('position'),
      at = new T.Vector3();
    // The root plate: within 0.22 of `from`, squashed to 0.55 of its height and spread 1.15 to the side.
    for (let k = 0; k < lp.count; k++) {
      at.fromBufferAttribute(lp, k);
      const f = 1 - T.MathUtils.smoothstep(at.dot(along), 0.02, 0.22),
        sideways = at.dot(side);
      at.addScaledVector(side, sideways * 0.15 * f);
      at.y *= 1 - 0.45 * f;
      lp.setXYZ(k, at.x, at.y, at.z);
    }
    log.computeVertexNormals();
    const branch = (t: number, raise: number, turn: number, len: number, r: number) => {
      const dir = along.clone().applyAxisAngle(up, turn).multiplyScalar(Math.cos(T.MathUtils.degToRad(raise))).addScaledVector(up, Math.sin(T.MathUtils.degToRad(raise)));
      return new T.CylinderGeometry(r * 0.8, r, len, 6)
        .translate(0, len / 2, 0)
        .applyQuaternion(new T.Quaternion().setFromUnitVectors(up, dir))
        .translate(along.x * t, 0.04, along.z * t);
    };
    const drift = new T.Mesh(mergeGeometries([log.toNonIndexed(), branch(0.35, 50, 0, 0.2, 0.045).toNonIndexed(), branch(0.7, 35, 0.45, 0.13, 0.032).toNonIndexed()])!, material(palette.driftwood, 'wood'));
    drift.position.set(fx, y, fz);
    drift.castShadow = drift.receiveShadow = true;
    g.add(drift);
  }
  function lighthouse(g: T.Object3D) {
    const [x, z] = plan.lighthouseRock;
    const rock = new T.Group();
    rock.name = 'lighthouse';
    rock.position.set(x, 0, z);
    g.add(rock);
    // Four dark, rounded boulders that stand clear of the water, with a gentle ramp (0.85 to 1.02,
    // paler on top); batch()'s contact bake supplies the wet, darker foot. The big one under the
    // tower sits inside the yard's platform; the two to either side stand out past its foot, so the
    // platform reads as built on the rock, and the fourth is under the landing stair.
    ([[0, -0.5, 0, 1.6, 1.25, 0.8, 1.1, '#6b7670'], [1.62, -0.3, 0.84, 1.0, 1.2, 0.8, 1.0, '#646f69'], [-1.5, -0.35, -0.54, 1.1, 1.1, 0.8, 1.2, '#717b75'], [0.4, -0.4, -1.4, 0.9, 1.3, 0.8, 1.0, '#646f69']] as const).forEach(([bx, by, bz, r, sx, sy, sz, c], i) => {
      const geo = new T.IcosahedronGeometry(r, 1),
        p = geo.getAttribute('position'),
        col = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) col.fill(0.85 + 0.17 * T.MathUtils.smoothstep(by + p.getY(k) * sy, -0.1, 0.6), k * 3, k * 3 + 3);
      geo.setAttribute('color', new T.BufferAttribute(col, 3));
      const s = new T.Mesh(geo, material(c, 'stone'));
      s.position.set(bx, by, bz);
      s.scale.set(sx, sy, sz);
      s.rotation.y = i * 1.3;
      s.castShadow = s.receiveShadow = true;
      rock.add(s);
    });
    const { buff, granite, white, red, iron } = LIGHT,
      L = plan.LIGHTHOUSE,
      face = L.door;
    // The walled yard: a battered granite platform on the rocks (its floor at 0.7) with a buff cope
    // band round its lip, a harled parapet with buff copes, and a gate on the landward side between
    // two piers, from which a stair with cheek walls goes down to the beach.
    const floor = L.floor;
    const drum = new T.Mesh(new T.CylinderGeometry(L.platform[0], L.platform[1], floor + 0.3, 48, 1, true), material(granite, 'ashlar'));
    drum.position.y = (floor - 0.3) / 2;
    drum.castShadow = drum.receiveShadow = true;
    rock.add(drum);
    // The floor is a band, not an eave cap: as a cap it would darken the platform it lies on.
    cylinder(rock, 0, floor - 0.03, 0, L.platform[0] - 0.01, L.platform[0] - 0.01, 0.06, granite, 'stone', 48).userData.band = true;
    turn(rock, [[L.platform[0] - 0.02, floor - 0.12], [L.platform[0] + 0.06, floor - 0.1], [L.platform[0] + 0.075, floor - 0.05], [L.platform[0] + 0.06, floor - 0.005], [L.platform[0] - 0.02, floor + 0.01]], buff, 'stone', 48).userData.band = true;
    const [wallIn, wallOut] = L.wall,
      gateHalf = L.gate / 2 / ((wallIn + wallOut) / 2), // half the gate's opening, as an angle at the wall's middle
      pierHalf = 0.13 / ((wallIn + wallOut) / 2),
      landward = L.landward;
    wallRing(rock, wallIn, wallOut, floor, L.wallTop - floor, landward, gateHalf + pierHalf, white, 'paint');
    wallRing(rock, wallIn - 0.03, wallOut + 0.03, L.wallTop, 0.08, landward, gateHalf + pierHalf, buff, 'stone').userData.band = true;
    for (const s of [-1, 1]) {
      const a = landward + s * (gateHalf + pierHalf),
        r = (wallIn + wallOut) / 2,
        [px, pz] = [Math.sin(a) * r, Math.cos(a) * r];
      box(rock, px, floor + 0.22, pz, 0.26, 0.44, 0.26, white, 'paint', { ry: a });
      box(rock, px, floor + 0.475, pz, 0.32, 0.07, 0.32, buff, 'stone', { ry: a }).userData.band = true;
      cone(rock, px, floor + 0.57, pz, 0.19, 0.12, buff, 'stone', 4, a + Math.PI / 4);
    }
    // The landing stair: four 0.14 risers from the platform's lip to the sand, nested into it, with a
    // harled cheek wall and its cope on either side.
    const stair = new T.Group();
    stair.name = 'lighthouse-stair';
    stair.rotation.y = landward;
    rock.add(stair);
    const lip = L.platform[0] + 0.07,
      rise = floor / 5,
      tread = 0.24;
    for (let k = 0; k < 4; k++) box(stair, 0, (floor - (k + 1) * rise - 0.25) / 2, (lip - 0.2 + lip + (k + 1) * tread) / 2, 0.62, floor - (k + 1) * rise + 0.25, (k + 1) * tread + 0.2, buff, 'stone');
    {
      const top = new T.Vector3(0, floor + 0.2, lip - 0.05),
        foot = new T.Vector3(0, rise + 0.1, lip + 4 * tread + 0.05),
        run = foot.clone().sub(top),
        mid = top.clone().add(foot).multiplyScalar(0.5),
        slope = Math.atan2(-run.y, run.z);
      for (const s of [-1, 1]) {
        box(stair, s * 0.38, mid.y - 0.08, mid.z, 0.14, 0.3, run.length() + 0.1, white, 'paint', { rx: slope });
        box(stair, s * 0.38, mid.y + 0.125, mid.z, 0.19, 0.07, run.length() + 0.14, buff, 'stone', { rx: slope }).userData.band = true;
      }
    }
    // The tower: a painted shaft tapering from 0.9 to 0.66 between the floor and the gallery, on a
    // moulded buff base course (a plinth, a torus and a cavetto into the shaft) that opens for the
    // door case, with the red bands kept.
    const shaftR = (y: number) => 0.9 - (0.22 * (y - 0.7)) / 2.9;
    cylinder(rock, 0, (floor + L.gallery) / 2, 0, shaftR(L.gallery), shaftR(floor), L.gallery - floor, white, 'paint', 32); // painted masonry, so matte
    turn(rock, [[1.1, floor], [1.1, floor + 0.14, true], [1.06, floor + 0.18, true], [1.08, floor + 0.22], [1.06, floor + 0.27], [1.0, floor + 0.29, true], [0.95, floor + 0.32], [0.91, floor + 0.37], [shaftR(floor + 0.44) - 0.01, floor + 0.44]], buff, 'stone', 40, [face + 0.31, Math.PI * 2 - 0.62]);
    for (const [y0, y1] of L.bands) cylinder(rock, 0, (y0 + y1) / 2, 0, shaftR(y1) + 0.03, shaftR(y0) + 0.03, y1 - y0, red, 'enamel', 32); // 0.03 proud
    // The door case: a buff architrave (pilasters, a lintel and a pediment over it) 0.2 proud of the
    // base course, the green leaf in its reveal with a raised rim, and two steps up from the yard.
    const doorCase = new T.Group();
    doorCase.name = 'lighthouse-door';
    doorCase.rotation.y = face;
    rock.add(doorCase);
    const sill = floor + 2 * rise; // 0.98: two 0.14 risers
    box(doorCase, 0, (floor + sill) / 2, 1.0, 0.44, sill - floor, 0.28, buff, 'stone'); // the upper step, in the reveal
    box(doorCase, 0, floor + rise / 2, 1.2, 0.8, rise, 0.18, buff, 'stone'); // the lower step
    box(doorCase, 0, (sill + L.lintel) / 2, 0.86, 0.4, L.lintel - sill, 0.14, palette.greenDoor, 'enamel');
    for (const s of [-1, 1]) box(doorCase, s * 0.165, (sill + L.lintel) / 2, 0.94, 0.07, L.lintel - sill, 0.04, palette.greenDoor, 'enamel'); // stiles
    for (const y of [sill + 0.035, (sill + L.lintel) / 2, L.lintel - 0.035]) box(doorCase, 0, y, 0.94, 0.26, 0.07, 0.04, palette.greenDoor, 'enamel'); // rails
    sphere(doorCase, 0.12, (sill + L.lintel) / 2 - 0.06, 0.98, 0.04, palette.brass, 'brass');
    for (const s of [-1, 1]) box(doorCase, s * 0.29, (floor + L.lintel) / 2, 0.92, 0.14, L.lintel - floor, 0.4, buff, 'stone');
    box(doorCase, 0, L.lintel + 0.05, 0.94, 0.86, 0.1, 0.44, buff, 'stone').userData.band = true;
    {
      // The pediment: a low gable 0.16 high over the lintel, bevelled like a roof, its back in the shaft.
      const gable = new T.Shape([new T.Vector2(-0.45, 0), new T.Vector2(0.45, 0), new T.Vector2(0, 0.16)]),
        geo = new T.ExtrudeGeometry(gable, { depth: 0.46, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelOffset: -0.02, bevelSegments: 1 }),
        m = new T.Mesh(geo, material(buff, 'stone'));
      m.position.set(0, L.lintel + 0.1, 0.7);
      m.castShadow = m.receiveShadow = true;
      doorCase.add(m);
    }
    // Small windows up the stair, each in a buff surround with a sill and a head: the one over the
    // door is the beacon window, lit all night; the others light like the cottages' rooms.
    for (const [a, y, lit] of L.windows) {
      const w = new T.Group(),
        r = shaftR(y);
      w.rotation.y = a;
      rock.add(w);
      frameRing(w, 0, y, r - 0.05, 0.2, 0.3, 0.07, 0.12, buff, 'stone');
      const pane = new T.Mesh(new T.PlaneGeometry(0.22, 0.32), material(LIGHT.glass, 'glass'));
      pane.position.set(0, y, r + 0.012);
      if (lit) pane.userData.window = 'beacon';
      w.add(pane);
      box(w, 0, y - 0.26, r + 0.04, 0.4, 0.08, 0.16, buff, 'stone').userData.band = true;
      box(w, 0, y + 0.27, r + 0.02, 0.36, 0.1, 0.12, buff, 'stone').userData.band = true;
    }
    // The corbelled gallery: twelve buff consoles (an ogee each, from the shaft out to 1.0) carry a
    // moulded cornice whose top is the gallery floor, 0.22 wider than the shaft's foot.
    {
      const profile = new T.Shape([[0.6, 3.28], [0.705, 3.28], [0.725, 3.38], [0.76, 3.5], [0.82, 3.61], [0.9, 3.7], [0.97, 3.77], [0.98, L.gallery + 0.01], [0.6, L.gallery + 0.01]].map(([r, y]) => new T.Vector2(r, y))),
        one = new T.ExtrudeGeometry(profile, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelOffset: -0.015, bevelSegments: 1, curveSegments: 1 }).rotateY(-Math.PI / 2).translate(0.065, 0, 0),
        consoles = mergeGeometries(Array.from({ length: 12 }, (_, k) => one.clone().rotateY(face + Math.PI / 12 + (k * Math.PI) / 6)))!;
      one.dispose();
      const m = new T.Mesh(consoles, material(buff, 'stone'));
      m.castShadow = m.receiveShadow = true;
      rock.add(m);
    }
    turn(rock, [[0.6, L.gallery], [0.96, L.gallery, true], [0.99, L.gallery + 0.03], [1.04, L.gallery + 0.08], [1.08, L.gallery + 0.13, true], [1.08, L.deck, true], [0.66, L.deck]], buff, 'stone', 40);
    // An iron deck plate inside the railing, so the gallery reads as a dark ring round the lantern.
    cylinder(rock, 0, L.deck + 0.02, 0, 1.01, 1.01, 0.04, iron, 'iron', 40).userData.band = true;
    // The gallery railing: sixteen iron stanchions, a mid rail and a fat top rail.
    for (let i = 0; i < 16; i++) {
      const a = face + (i + 0.5) * (Math.PI / 8);
      const post = box(rock, Math.sin(a) * 0.98, L.deck + 0.23, Math.cos(a) * 0.98, 0.075, 0.38, 0.075, iron, 'iron', { ry: a });
      post.castShadow = false;
      post.userData.noShadow = true;
    }
    for (const [y, t] of [[L.deck + 0.23, 0.035], [L.deck + 0.42, 0.045]]) {
      const rail = new T.Mesh(new T.TorusGeometry(0.98, t, 5, 36), material(iron, 'iron'));
      rail.rotation.x = Math.PI / 2;
      rail.position.y = y;
      rail.castShadow = t > 0.04;
      rail.receiveShadow = true;
      if (!rail.castShadow) rail.userData.noShadow = true;
      rock.add(rail);
    }
    // The lantern: an iron pedestal, the glazing (the lamps entry the night loop lights) behind
    // diagonal astragals in a diamond lattice, as Stevenson's lanterns have, an iron frieze, then
    // a red dome with eight standing seams under a ventilator ball and a lightning rod.
    turn(rock, [[0.69, L.deck + 0.04], [0.69, L.deck + 0.09, true], [0.65, L.deck + 0.12, true], [0.65, L.glazing[0] - 0.06, true], [0.68, L.glazing[0] - 0.04], [0.7, L.glazing[0], true], [0.58, L.glazing[0]]], iron, 'iron', 32);
    const [g0, g1] = L.glazing;
    const lanternRoom = new T.Mesh(new T.CylinderGeometry(LANTERN, LANTERN, g1 - g0, 32), lampGlass());
    lanternRoom.position.y = (g0 + g1) / 2;
    rock.add(lanternRoom);
    lamps.push(lanternRoom);
    {
      const bars: T.BufferGeometry[] = [];
      for (const turnWay of [-1, 1])
        for (let k = 0; k < 5; k++) {
          const a0 = face + (k * Math.PI * 2) / 5,
            pts = Array.from({ length: 7 }, (_, j) => {
              const u = j / 6,
                a = a0 + turnWay * u * ((Math.PI * 2) / 5);
              return new T.Vector3(Math.sin(a) * (LANTERN + 0.02), g0 + (g1 - g0) * u, Math.cos(a) * (LANTERN + 0.02));
            });
          bars.push(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 10, 0.05, 4, false).toNonIndexed());
        }
      const lattice = new T.Mesh(mergeGeometries(bars)!, material(iron, 'iron'));
      bars.forEach((b) => b.dispose());
      lattice.receiveShadow = true;
      lattice.userData.noShadow = true;
      rock.add(lattice);
    }
    turn(rock, [[0.64, g1 - 0.02], [0.68, g1 - 0.01, true], [0.7, g1 + 0.02], [0.71, g1 + 0.06, true], [0.58, g1 + 0.06]], iron, 'iron', 32);
    const domeFoot = g1 + 0.13,
      domeArc = (t: number): [number, number] => [0.71 * Math.cos((t * Math.PI) / 2), domeFoot + L.domeRise * Math.sin((t * Math.PI) / 2)];
    turn(rock, [[0.64, g1 + 0.04], [0.8, g1 + 0.06, true], [0.81, g1 + 0.1, true], [0.73, domeFoot, true], ...Array.from({ length: 9 }, (_, j) => domeArc(j / 8))], red, 'enamel', 32);
    {
      const seams = Array.from({ length: 8 }, (_, k) => {
        const a = face + (k * Math.PI) / 4;
        const pts = Array.from({ length: 6 }, (_, j) => {
          const [r, y] = domeArc(0.04 + (0.8 * j) / 5);
          return new T.Vector3(Math.sin(a) * (r + 0.012), y + 0.006, Math.cos(a) * (r + 0.012));
        });
        return new T.TubeGeometry(new T.CatmullRomCurve3(pts), 8, 0.035, 4, false).toNonIndexed();
      });
      const m = new T.Mesh(mergeGeometries(seams)!, material(red, 'enamel'));
      seams.forEach((s) => s.dispose());
      m.receiveShadow = true;
      m.userData.noShadow = true;
      rock.add(m);
    }
    const top = domeFoot + L.domeRise;
    turn(rock, [[0.09, top - 0.06], [0.09, top + 0.08, true], [0.07, top + 0.1], [0, top + 0.1]], iron, 'iron', 12);
    sphere(rock, 0, top + 0.21, 0, 0.13, palette.brass, 'brass', 18); // the ventilator ball
    cylinder(rock, 0, top + 0.42, 0, 0.035, 0.035, 0.2, iron, 'iron', 8).userData.noShadow = true; // the lightning rod
    sphere(rock, 0, top + 0.53, 0, 0.045, palette.brass, 'brass');
    // The beam at night: a cone of light that only adds light. It is brightest by the lamp and
    // gone by its open end, and fades towards its edges (only the side facing the camera is
    // drawn, so the cone shows as one soft layer). It swings slowly either side of the seaward
    // bearing and never turns round over the town.
    const beamLength = 18,
      beamRadius = 3.6;
    const beamMaterial = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.merge([
        T.UniformsLib.fog,
        {
          // Paler than the lantern glass: over the blue sea a warm beige turns pink, a near-white reads as light.
          color: { value: new T.Color('#fff0d4') },
          strength: { value: 0 },
          beamLength: { value: beamLength },
          slope: { value: beamRadius / beamLength },
        },
      ]),
      vertexShader: `
        #include <fog_pars_vertex>
        uniform float beamLength;
        varying vec3 vLocal;
        varying vec3 vAxisX;
        varying vec3 vAxisY;
        varying vec3 vAxisZ;
        varying vec3 vViewPosition;
        void main(){
          vLocal=vec3(position.x/beamLength,position.yz);
          vAxisX=normalMatrix*vec3(1.,0.,0.);
          vAxisY=normalMatrix*vec3(0.,1.,0.);
          vAxisZ=normalMatrix*vec3(0.,0.,1.);
          vec4 mvPosition=modelViewMatrix*vec4(position,1.);
          vViewPosition=-mvPosition.xyz;
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <fog_pars_fragment>
        uniform vec3 color;
        uniform float strength;
        uniform float slope;
        varying vec3 vLocal;
        varying vec3 vAxisX;
        varying vec3 vAxisY;
        varying vec3 vAxisZ;
        varying vec3 vViewPosition;
        void main(){
          // The true cone normal at this pixel (not the faceted mesh's), so the falloff has no streaks.
          vec2 around=normalize(vLocal.yz+1e-6);
          vec3 n=normalize(-slope*vAxisX+around.x*vAxisY+around.y*vAxisZ);
          vec3 toEye=isOrthographic?vec3(0.,0.,1.):normalize(vViewPosition);
          // Full down the middle of the cone, nothing well before its silhouette: with u the
          // distance from the middle as a share of the width, facing^4 = (1-u^2)^2.
          float across=pow(max(dot(n,toEye),0.),4.);
          // From the lantern glass outwards, falling to nothing at the open end.
          float along=clamp(vLocal.x,0.,1.);
          along=smoothstep(.02,.07,along)*pow(1.-along,2.2);
          float a=strength*across*along;
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              a*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
            #else
              a*=1.-smoothstep(fogNear,fogFar,vFogDepth);
            #endif
          #endif
          gl_FragColor=vec4(color,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      fog: true,
      transparent: true,
      depthWrite: false,
      side: T.FrontSide,
      // Additive light; the target's alpha (the composite divides by it) stays as it was.
      blending: T.CustomBlending,
      blendSrc: T.SrcAlphaFactor,
      blendDst: T.OneFactor,
      blendSrcAlpha: T.ZeroFactor,
      blendDstAlpha: T.OneFactor,
    });
    // The apex sits at the lamp and the cone opens along +x.
    const beamGeometry = new T.ConeGeometry(beamRadius, beamLength, 32, 1, true).rotateZ(Math.PI / 2).translate(beamLength / 2, 0, 0);
    const beam = new T.Mesh(beamGeometry, beamMaterial);
    beam.renderOrder = 4; // over the sea (2) and the shore foam (3), under the rain (5)
    const pivot = new T.Group();
    pivot.position.set(x, (L.glazing[0] + L.glazing[1]) / 2, z);
    pivot.add(beam);
    g.add(pivot);
    pivot.userData.keepSeparate = true;
    // Seaward: straight out from the nearest point of the coast. rotation.y = a turns +x to (cos a, -sin a).
    const shore = plan.islandOutline.reduce((best, p) => (Math.hypot(p[0] - x, p[1] - z) < Math.hypot(best[0] - x, best[1] - z) ? p : best));
    const seaward = Math.atan2(shore[1] - z, x - shore[0]),
      swing = T.MathUtils.degToRad(70);
    animated.push({
      object: pivot,
      update(time, night) {
        pivot.visible = night > 0.01;
        pivot.rotation.y = seaward + swing * Math.sin(time * 0.4);
        beamMaterial.uniforms.strength.value = night * 0.3;
      },
    });
  }
  return { pierAndHarbour, lighthouse };
}
