import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as plan from './town-plan';
import { palette, hash, WATER, type TownContext } from './town-shared';
import { shoreHeight } from './town-ground';
import type { Kit } from './town-kit';
import type { Props } from './town-props';

/* ------------------------------------------------------------------ */
/* Pier, harbour and lighthouse                                        */
/* ------------------------------------------------------------------ */
export function createHarbour(ctx: TownContext, kit: Kit, props: Props) {
  const { material, lamps, animated } = ctx;
  const { box, cylinder, strut, cone, sphere, bollard, rope, eye, coilPoints, hullShape, hullSolid, pitchedRoof, windowAt, lampGlass } = kit;
  const { lamp } = props;
  function pierAndHarbour(g: T.Object3D) {
    const [sx, sz] = plan.pier.start,
      [dx, dz] = plan.pier.dir;
    const heading = Math.atan2(dx, dz);
    const p = new T.Group();
    p.position.set(sx, 0, sz);
    p.rotation.y = heading;
    g.add(p);
    const L = plan.pier.length,
      W = plan.pier.width;
    // A chunky deck: a stone landing on the grass, two stringers, wobbly two-tone planks and fat
    // piles that stand 0.3 proud as bollards. Pier-local +x is (dz, -dx), +z runs out to sea.
    const plank = [palette.wood, '#94613a'], dark = palette.woodDark;
    box(p, 0, 0.1, -0.35, W + 0.3, 0.2, 0.7, palette.stoneDark, 'stone'); // stone landing on the grass
    for (const side of [-1, 1]) box(p, side * 0.62, 0.03, (L + 0.2) / 2, 0.16, 0.14, L + 0.2, dark, 'wood'); // stringers
    const count = Math.round((L + 0.2) / 0.42), pitch = (L + 0.2) / count; // 15 planks
    for (let k = 0; k < count; k++)
      box(p, (hash(k * 5 + 1) - 0.5) * 0.06, 0.15 + (hash(k * 5 + 2) - 0.5) * 0.02, (k + 0.5) * pitch, W + 0.12, 0.1, pitch - 0.045, plank[k % 2], 'wood', { ry: (hash(k * 5 + 3) - 0.5) * 0.05 });
    for (let z = 0.9; z < L + 0.2; z += 1.3) for (const side of [-1, 1]) cylinder(p, side * 0.72, -0.05, z, 0.14, 0.15, 1.1, dark, 'wood', 18); // piles 0.3 proud = bollards
    const lastPile = 0.9 + 1.3 * Math.floor((L + 0.2 - 0.9) / 1.3); // 6.1
    // Lamps stand on the boards (y 0.2), with the pier-local position passed straight through.
    lamp(p, 0.42, 0.45, 1.8, 0.2);
    lamp(p, -0.38, L - 0.45, 1.8, 0.2);
    cylinder(p, 0.72, 1.45, lastPile, 0.035, 0.04, 1.9, palette.metal, 'iron', 18); // flagpole on the seaward pile
    box(p, 0.33, 2.12, lastPile, 0.75, 0.5, 0.04, palette.blueDoor, 'fabric'); // cloth
    for (const s of [-1, 1]) box(p, 0.33, 2.12, lastPile + 0.03, 0.82, 0.09, 0.02, palette.white, 'fabric', { rz: s * 0.588 }); // saltire
    box(p, 1.25, 0.3, 1.5, 0.6, 0.6, 0.6, plank[0], 'wood', { ry: 0.2 }); // crates 0.55-0.7 of a person
    box(p, 1.28, 0.85, 1.48, 0.5, 0.5, 0.5, palette.gold, 'paint', { ry: -0.15 });
    cylinder(p, 2.85, 0.3, 1.6, 0.24, 0.22, 0.6, plank[0], 'wood', 18); // barrel with two hoops
    for (const y of [0.12, 0.48]) cylinder(p, 2.85, y, 1.6, 0.255, 0.255, 0.05, palette.metal, 'iron', 18);
    // A harbour master's hut on a plinth at the landward end: steep pantile roof, chimney,
    // a plain chunky door and a lifebuoy on the side wall.
    const hut = new T.Group();
    hut.position.set(W / 2 + 1.15, 0, 0.1);
    hut.rotation.y = -0.2;
    p.add(hut);
    box(hut, 0, 0.15, 0, 1.7, 0.3, 1.5, palette.stoneDark, 'stone'); // plinth
    box(hut, 0, 0.95, 0, 1.5, 1.3, 1.3, palette.render, 'paint'); // walls 0.30..1.60
    pitchedRoof(hut, 0, 1.6, 0, 2.0, 1.8, 0.95, palette.pantile, { ridgeColor: palette.pantileLight }); // 0.25 overhang, rise 37%
    box(hut, 0.42, 2.2, -0.3, 0.34, 0.8, 0.34, palette.red, 'stone'); // chimney
    box(hut, 0.42, 2.65, -0.3, 0.44, 0.1, 0.44, palette.trimRed, 'stone');
    cylinder(hut, 0.42, 2.78, -0.3, 0.08, 0.09, 0.16, palette.brick, 'stone', 18);
    // The wall is only 1.5 wide: a small window without sill or lintel keeps clear of the door jamb.
    windowAt(hut, -0.43, 1.0, 0.65, 0.38, 0.5, { sill: false, lintel: false });
    box(hut, 0.32, 0.8, 0.67, 0.52, 1.0, 0.1, palette.blueDoor, 'enamel'); // own door leaf on the plinth, no door() panels
    for (const s of [-1, 1]) box(hut, 0.32 + s * 0.36, 0.86, 0.67, 0.14, 1.12, 0.14, palette.trim, 'stone');
    box(hut, 0.32, 1.44, 0.68, 0.86, 0.16, 0.16, palette.trim, 'stone');
    sphere(hut, 0.5, 0.8, 0.73, 0.045, palette.brass, 'brass', 12);
    const ring = new T.Mesh(new T.TorusGeometry(0.17, 0.055, 8, 16), material(palette.flowers[0], 'enamel'));
    ring.position.set(0.78, 0.95, 0.1);
    ring.rotation.y = Math.PI / 2;
    ring.castShadow = true;
    hut.add(ring);
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
    mooring(p, moor, pitch);
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
  function mooring(p: T.Object3D, moor: typeof plan.harbour.dinghy, pitch: number) {
    const H = plan.harbour,
      up = new T.Vector3(0, 1, 0);
    // The eyes round the pile heads are wet and worn darker than the lines: a pale ring there
    // framed the pier-head lamp's lantern like a halo at the default view.
    const pileEye = '#' + new T.Color(palette.rope).multiplyScalar(0.3).getHexString();
    for (const line of H.lines) {
      const [px, pz] = line.pile;
      eye(p, px, 0.44, pz, 0.19, pileEye); // 0.06 under the pile top, its inner edge clear of the pile
      const end = new T.Vector3(...line.fairlead).applyAxisAngle(up, moor.turn).add(new T.Vector3(moor.x, WATER, moor.z)),
        axis = new T.Vector3(px, 0.44, pz),
        h = new T.Vector3(px - end.x, 0, pz - end.z).normalize(),
        out = end.clone().addScaledVector(h, 0.25),
        ring = axis.clone().addScaledVector(h, -0.19),
        mid = out.clone().lerp(ring, 0.5);
      mid.y -= 0.05;
      rope(p, [end, out, mid, ring, axis]);
    }
    // The planks' own jitter, so the bollard stands on its plank (14) and the coil on 12 and 13.
    const plankTop = (z: number) => 0.2 + (hash(Math.floor(z / pitch) * 5 + 2) - 0.5) * 0.02;
    const [bx, bz] = H.headBollard,
      [cx, cz] = H.berthCoil;
    bollard(p, bx, plankTop(bz), bz);
    eye(p, bx, 0.36, bz, 0.135); // round the waist, under the head's flare
    const lead = new T.Vector3(bx - cx, 0, bz - cz).normalize(),
      // The coil's underside lies on plank 12 (top 0.194) and 0.01 into plank 13 (0.204).
      coil = coilPoints(cx, 0.199, cz, 0.06, 0.19, 3, Math.atan2(-lead.x, lead.z)),
      last = coil[coil.length - 1],
      lift = last.clone().addScaledVector(lead, 0.2).setY(0.29),
      head = new T.Vector3(bx, 0.36, bz),
      onEye = head.clone().addScaledVector(lift.clone().setY(0.36).sub(head).normalize(), 0.135);
    rope(p, [new T.Vector3(cx, 0.144, cz), ...coil, lift, onEye, head], palette.ropeBlue);
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
    rock.position.set(x, 0, z);
    g.add(rock);
    // Four dark, rounded boulders that stand clear of the water, with a gentle ramp (0.85 to 1.02,
    // paler on top); batch()'s contact bake supplies the wet, darker foot. The big one under the
    // tower sits lower, so it meets the plinth below its cap (at most 0.6 up) instead of cutting
    // through the cream ring at the tower's foot.
    ([[0, -0.5, 0, 1.6, 1.25, 0.8, 1.1, '#6b7670'], [1.35, -0.3, 0.7, 1.0, 1.2, 0.8, 1.0, '#646f69'], [-1.25, -0.35, -0.45, 1.1, 1.1, 0.8, 1.2, '#717b75'], [0.4, -0.4, -1.4, 0.9, 1.3, 0.8, 1.0, '#646f69']] as const).forEach(([bx, by, bz, r, sx, sy, sz, c], i) => {
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
    // A fat striped drum: the gallery is wider than the shaft and the lantern sits on the deck.
    const white = palette.white, red = palette.boat, cream = palette.tramCream, iron = palette.metal, face = 0.8;
    cylinder(rock, 0, 0.45, 0, 1.05, 1.2, 0.5, palette.plinth, 'stone', 24); // plinth 0.20-0.70
    // The cap is a trim band, not an overhang. As a slab, batch() would bake it as an eave over the whole
    // shaft (whose foot it sleeves) and, through its square box, over the plinth's diagonals only.
    cylinder(rock, 0, 0.74, 0, 1.0, 1.08, 0.08, cream, 'stone', 24).userData.ground = true; // cap
    cylinder(rock, 0, 2.15, 0, 0.68, 0.9, 2.9, white, 'paint', 24); // shaft 0.70-3.60: painted masonry, so matte
    const shaftR = (y: number) => 0.9 - (0.22 * (y - 0.7)) / 2.9;
    for (const [y0, y1] of [[1.6, 2.1], [2.75, 3.25]]) cylinder(rock, 0, (y0 + y1) / 2, 0, shaftR(y1) + 0.03, shaftR(y0) + 0.03, y1 - y0, red, 'enamel', 24); // 0.03 proud
    box(rock, Math.sin(face) * 0.78, 1.02, Math.cos(face) * 0.78, 0.42, 0.62, 0.25, palette.greenDoor, 'enamel', { ry: face }); // door
    box(rock, Math.sin(face) * 0.71, 2.42, Math.cos(face) * 0.71, 0.26, 0.36, 0.2, '#2d3838', 'glass', { ry: face }).userData.window = 'beacon'; // window, lit all night
    cylinder(rock, 0, 3.72, 0, 1.0, 0.7, 0.24, cream, 'stone', 24); // corbel 3.60-3.84
    cylinder(rock, 0, 3.92, 0, 1.02, 1.02, 0.16, iron, 'iron', 24); // gallery deck 3.84-4.00 (wider than shaft)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      box(rock, Math.cos(a) * 0.94, 4.17, Math.sin(a) * 0.94, 0.08, 0.34, 0.08, iron, 'iron');
    }
    const rail = new T.Mesh(new T.TorusGeometry(0.94, 0.05, 8, 32), material(iron, 'iron'));
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 4.34;
    rail.castShadow = true;
    rock.add(rail);
    const glass = lampGlass();
    const lanternRoom = new T.Mesh(new T.CylinderGeometry(0.56, 0.56, 0.8, 24), glass);
    lanternRoom.position.y = 4.4; // 4.00-4.80, sits on the deck
    rock.add(lanternRoom);
    lamps.push(lanternRoom);
    for (let i = 0; i < 4; i++) box(rock, Math.cos((i * Math.PI) / 2) * 0.56, 4.4, Math.sin((i * Math.PI) / 2) * 0.56, 0.1, 0.8, 0.1, iron, 'iron'); // mullions off the camera axis
    cylinder(rock, 0, 4.85, 0, 0.66, 0.66, 0.1, iron, 'iron', 24);
    const dome = new T.Mesh(new T.SphereGeometry(0.64, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), material(red, 'enamel'));
    dome.scale.y = 0.85;
    dome.position.y = 4.9;
    dome.castShadow = dome.receiveShadow = true;
    rock.add(dome);
    sphere(rock, 0, 5.52, 0, 0.12, palette.brass, 'brass', 18);
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
    pivot.position.set(x, 4.4, z);
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
