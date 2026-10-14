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
    for (const line of H.lines) {
      const [px, pz] = line.pile;
      eye(p, px, 0.44, pz, 0.19); // 0.06 under the pile top, its inner edge clear of the pile
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
   * A Scottish creel, about 1.6x real like the crates: a D-shaped net body on a flat base, 0.46
   * long (local z) x 0.34 wide x 0.285 tall, its netted ends in shade; three rubber-coated hoops
   * stand 0.035 proud of the vault as ribs, and a white entrance ring sits in the +z end.
   */
  let creelBody: T.BufferGeometry | undefined;
  function creel(g: T.Object3D, x: number, y: number, z: number, ry: number, net: string) {
    if (!creelBody) {
      const base = new T.BoxGeometry(0.34, 0.115, 0.44).translate(0, 0.0575, 0),
        vault = new T.CylinderGeometry(0.17, 0.17, 0.44, 8, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 0.115, 0),
        merged = mergeGeometries([base, vault])!,
        n = merged.getAttribute('normal'),
        tone = new Float32Array(n.count * 3);
      for (let k = 0; k < n.count; k++) tone.fill(Math.abs(n.getZ(k)) > 0.9 ? 0.72 : n.getY(k) < 0.3 ? 0.9 : 1, k * 3, k * 3 + 3);
      merged.setAttribute('color', new T.BufferAttribute(tone, 3));
      creelBody = merged;
    }
    const c = new T.Group();
    c.position.set(x, y, z);
    c.rotation.y = ry;
    g.add(c);
    const body = new T.Mesh(creelBody, material(net, 'fabric'));
    body.castShadow = body.receiveShadow = true;
    c.add(body);
    for (const hz of [-0.19, 0, 0.19]) {
      // Paint, not iron: thin arcs keep iron's specular off them.
      const hoop = new T.Mesh(new T.TorusGeometry(0.175, 0.035, 4, 6, Math.PI), material('#3a3f44', 'paint'));
      hoop.position.set(0, 0.115, hz);
      hoop.castShadow = hoop.receiveShadow = true;
      c.add(hoop);
    }
    cylinder(c, 0, 0.17, 0.225, 0.07, 0.07, 0.03, palette.white, 'paint').rotation.x = Math.PI / 2;
  }
  /** A beach detail's root at shore coordinates (i, w), standing 0.01 into the sand. */
  const onShore = (i: number, w: number) => {
    const [x, z] = plan.shoreAt(i, w);
    return new T.Vector3(x, shoreHeight(w) - 0.01, z);
  };
  /**
   * The working quay on the hut side of the pier: a stack of five creels and one more beside it,
   * two orange floats and a coil of rope on the dry sand, its end trailing toward the water.
   */
  function quay(g: T.Object3D) {
    const S = plan.shoreProps,
      [blue, green, orange] = palette.creel;
    const stack = new T.Group();
    stack.position.copy(onShore(S.creelStack.i, S.creelStack.w));
    stack.rotation.y = plan.shoreTurn(S.creelStack.i); // local +z out to sea
    g.add(stack);
    // Two on the sand, two more each sunk 0.03 into a crown below, one on top across both.
    const tiers: [number, number, number, number, string][] = [
      [-0.2, 0, 0, 0, blue], [0.2, 0, 0.02, 0, green],
      [-0.18, 0.255, 0.01, 0.05, orange], [0.21, 0.255, -0.02, -0.05, blue],
      [0, 0.51, 0, 0.1, green],
    ];
    for (const [x, y, z, ry, net] of tiers) creel(stack, x, y, z, ry, net);
    const lone = onShore(S.creel.i, S.creel.w);
    creel(g, lone.x, lone.y, lone.z, plan.shoreTurn(S.creel.i) + S.creel.turn, blue);
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
   * A net hung to dry over a bar between two posts on the upper beach, on the dinghy side of the
   * pier: its long side hangs toward the sea with a few small orange floats on the hem, the short
   * side behind. The sheet wraps the bar on a circle 0.015 clear of it, so the bar never shows
   * through; both hangs splay out as they fall, so they face the sky rather than standing as a
   * flat board, and fall in loose folds to ragged hems of uneven length. It is a solid veil:
   * cut-out mesh holes shrink below a pixel at the zooms the town is mostly seen at and twinkle
   * there as it pans. Its back faces are built in, so it batches with the other cloth instead of
   * needing a two-sided program of its own.
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
    // The sheet: 14 columns along the bar and 10 rows across it, from the seaward hem (row 0) up
    // and over the bar (rows 3-7, at 45 degree steps round it) and down to the landward hem.
    // It is 1.05 long and pushed toward the `from` post, so the bar shows bare toward the other.
    const R = 0.06,
      length = 1.05,
      along = (u: number) => (u - 0.5) * length - 0.12,
      sheet = new T.PlaneGeometry(1.3, 1, 13, 9),
      pos = sheet.getAttribute('position'),
      tone = new Float32Array(pos.count * 3);
    // A hang f of the way down (f 1 at the hem): it leaves the bar, splays out by `spread` and
    // folds by up to 0.03 as it falls, to a hem `long` below the bar, less where the hem lifts.
    const hang = (u: number, f: number, long: number, lift: number, spread: number, phase: number): [number, number] => [
      R + spread * f ** 1.3 + 0.03 * f * Math.sin(2 * Math.PI * 3.2 * u + phase),
      0.95 - f * (long - lift * (0.5 + 0.5 * Math.sin(2 * Math.PI * (1.3 * u + phase)))) * (0.8 + 0.2 * Math.sin(Math.PI * u)),
    ];
    const at = (u: number, row: number): [number, number, number] => {
      if (row <= 2) {
        const f = 1 - row / 3,
          [out, y] = hang(u, f, 0.74, 0.24, 0.15, 0.4);
        return [-out, y, f];
      }
      if (row <= 7) {
        const a = ((row - 5) * Math.PI) / 4;
        return [R * Math.sin(a), 0.95 + R * Math.cos(a), 0];
      }
      const f = (row - 7) / 2,
        [out, y] = hang(u, f, 0.5, 0.12, 0.11, 2.1);
      return [out, y, f];
    };
    for (let k = 0; k < pos.count; k++) {
      const ix = k % 14,
        row = Math.floor(k / 14),
        u = ix / 13,
        [across, y, f] = at(u, row);
      pos.setXYZ(k, along(u), y, across);
      tone.fill(1.04 - 0.08 * f, k * 3, k * 3 + 3); // a little lighter over the fold; the batch's contact bake darkens the hems
    }
    sheet.setAttribute('color', new T.BufferAttribute(tone, 3));
    sheet.computeVertexNormals();
    // The other side: the same sheet wound the other way round with its normals reversed.
    const back = sheet.clone(),
      index = back.getIndex()!,
      normal = back.getAttribute('normal');
    for (let k = 0; k < index.count; k += 3) {
      const a = index.getX(k + 1);
      index.setX(k + 1, index.getX(k + 2));
      index.setX(k + 2, a);
    }
    for (let k = 0; k < normal.count; k++) normal.setXYZ(k, -normal.getX(k), -normal.getY(k), -normal.getZ(k));
    const net = new T.Mesh(mergeGeometries([sheet, back])!, material(palette.net, 'fabric'));
    net.receiveShadow = true;
    net.userData.noShadow = true; // a thin sheet ghosts in the shadow map
    frame.add(net);
    // Floats on the seaward hem, hanging just below it.
    const blob = lump(0.055);
    for (const u of [0.1, 0.32, 0.55, 0.78, 0.93]) {
      const [across, y] = at(u, 0),
        float = new T.Mesh(blob, material(palette.tramOrange, 'enamel'));
      float.position.set(along(u), y - 0.03, across);
      float.receiveShadow = true;
      frame.add(float);
    }
  }
  /** The icosahedron as a smooth little lump: detail 0, but with sphere normals. */
  function lump(r: number) {
    const geo = new T.IcosahedronGeometry(r, 0),
      p = geo.getAttribute('position'),
      n = geo.getAttribute('normal');
    for (let k = 0; k < p.count; k++) n.setXYZ(k, p.getX(k) / r, p.getY(k) / r, p.getZ(k) / r);
    return geo;
  }
  /**
   * A clump of wrack s across 0.34 (96 triangles): three low lumps round the middle, their long
   * axes pointing out, and three flat fronds crossing under them. Nothing reaches past 0.17 s.
   */
  function wrack(g: T.Object3D, x: number, y: number, z: number, s: number, seed: number, colours: [string, string]) {
    const [weed, kelp] = colours;
    for (let k = 0; k < 3; k++) {
      const a = seed + (k * Math.PI * 2) / 3,
        blob = new T.Mesh(lump(1), material(k === 1 ? kelp : weed, 'foliage'));
      blob.position.set(x + Math.cos(a) * 0.05 * s, y, z + Math.sin(a) * 0.05 * s);
      blob.scale.set(0.12 * s, 0.045 * s, 0.09 * s);
      blob.rotation.y = -a; // local x along the radius
      blob.userData.noShadow = true;
      g.add(blob);
      // A frond 0.3 s long, each one 0.004 above the last so the crossing tops never meet.
      box(g, x, y + 0.01 + 0.004 * k, z, 0.3 * s, 0.02, 0.1 * s, k === 1 ? weed : kelp, 'foliage', { ry: -(seed + Math.PI / 6 + (k * Math.PI) / 3) }).userData.noShadow = true;
    }
  }
  /** The sand's height out from the outline at a world point (its distance from the outline). */
  const sandAt = (x: number, z: number) => shoreHeight(plan.distanceToPolyline([x, z], plan.islandOutline, true));
  /**
   * The strand on the dinghy side of the pier: rock pools ringed by wet rocks on the wet sand
   * round the boulder at sample 42, clumps of wrack (older and browner on the strand line up the
   * beach), a bleached driftwood log, and weed on the piles that stand in the tide (pier-local).
   */
  function strand(g: T.Object3D, p: T.Object3D) {
    const S = plan.shoreProps,
      rockGreys = ['#717b75', '#646f69'];
    S.rockPools.forEach((pool, n) => {
      const [x, z] = plan.shoreAt(pool.i, pool.w),
        y = shoreHeight(pool.w);
      // A matte bed, the shelf's turquoise in the middle paling to the shallows' at its ragged rim.
      const bed = new T.CircleGeometry(pool.r, 9).rotateX(-Math.PI / 2),
        bp = bed.getAttribute('position'),
        tone = new Float32Array(bp.count * 3),
        deep = new T.Color('#5fb8c8').multiplyScalar(0.85),
        rim = new T.Color('#a8d8cf');
      for (let k = 1; k < bp.count; k++) {
        const jitter = 0.88 + 0.24 * hash(n * 31 + ((k - 1) % 9));
        bp.setXYZ(k, bp.getX(k) * jitter, 0, bp.getZ(k) * jitter);
      }
      for (let k = 0; k < bp.count; k++) tone.set((k === 0 ? deep : rim).toArray(), k * 3);
      bed.setAttribute('color', new T.BufferAttribute(tone, 3));
      const bedMesh = new T.Mesh(bed, material('#ffffff', 'stone'));
      bedMesh.position.set(x, y + 0.008, z);
      bedMesh.receiveShadow = true;
      bedMesh.userData.ground = true;
      bedMesh.userData.noShadow = true;
      g.add(bedMesh);
      // Five wet rocks round it, unevenly spaced, 40% sunk, darker at the foot.
      for (let k = 0; k < 5; k++) {
        const a = n * 1.7 + (k * Math.PI * 2) / 5 + (hash(n * 17 + k) - 0.5) * 0.8,
          r = 0.1 + 0.06 * hash(n * 23 + k * 3),
          geo = lump(r),
          rp = geo.getAttribute('position'),
          shade = new Float32Array(rp.count * 3);
        for (let q = 0; q < rp.count; q++) shade.fill(0.85 + 0.17 * T.MathUtils.smoothstep(rp.getY(q), -r * 0.2, r), q * 3, q * 3 + 3);
        geo.setAttribute('color', new T.BufferAttribute(shade, 3));
        const rock = new T.Mesh(geo, material(rockGreys[(n + k) % 2], 'stone'));
        rock.position.set(x + Math.cos(a) * (pool.r + 0.03), y + 0.11 * r, z + Math.sin(a) * (pool.r + 0.03));
        rock.scale.set(1.25, 0.55, 1);
        rock.rotation.y = Math.PI / 2 - a; // the long axis runs round the pool, not out from it
        rock.receiveShadow = true;
        rock.userData.noShadow = true;
        g.add(rock);
      }
    });
    const weed = palette.weed,
      kelp = palette.kelp,
      dry = '#' + new T.Color(palette.kelp).multiplyScalar(0.9).getHexString();
    S.wrack.forEach((w, n) => {
      const [x, z] = plan.shoreAt(w.i, w.w);
      wrack(g, x, shoreHeight(w.w), z, w.s, hash(n * 7 + 5) * Math.PI * 2, w.w < 1.8 ? [dry, dry] : [weed, kelp]);
    });
    // Wrack at the feet of the two piles that stand in the wet sand (pier-local).
    plan.harbour.pileWrack.forEach(([lx, lz], n) => {
      const [wx, wz] = plan.pierPoint(lx, lz);
      wrack(p, lx, sandAt(wx, wz), lz, 0.8, n * 2.1 + 0.4, [weed, kelp]);
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
    // Driftwood on the strand line: a bleached log, thick end at `from` with a root flare, and a
    // stub branch 0.3 along it, raised 50 degrees toward the thin end in the log's own plane.
    const D = S.driftwood,
      [fx, fz] = plan.shoreAt(D.from.i, D.from.w),
      [tx, tz] = plan.shoreAt(D.to.i, D.to.w),
      y = (shoreHeight(D.from.w) + shoreHeight(D.to.w)) / 2 + 0.07,
      from = new T.Vector3(fx, y, fz),
      along = new T.Vector3(tx - fx, 0, tz - fz),
      length = along.length(),
      up = new T.Vector3(0, 1, 0);
    along.normalize();
    const log = cylinder(g, 0, 0, 0, 0.075, 0.095, length, palette.driftwood, 'wood');
    log.position.copy(from).addScaledVector(along, length / 2);
    log.quaternion.setFromUnitVectors(up, along);
    const branch = along.clone().multiplyScalar(Math.cos(T.MathUtils.degToRad(50))).addScaledVector(up, Math.sin(T.MathUtils.degToRad(50))),
      stub = cylinder(g, 0, 0, 0, 0.035, 0.05, 0.34, palette.driftwood, 'wood');
    stub.position.copy(from).addScaledVector(along, 0.3).addScaledVector(branch, 0.17);
    stub.quaternion.setFromUnitVectors(up, branch);
    const root = new T.Mesh(new T.IcosahedronGeometry(0.15, 0), material(palette.driftwood, 'wood'));
    root.position.copy(from);
    root.scale.set(0.7, 0.9, 1.1);
    root.rotation.y = Math.atan2(along.x, along.z) + Math.PI / 2; // short along the log, wide across it: a knob, not a point
    root.castShadow = root.receiveShadow = true;
    g.add(root);
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
    box(rock, Math.sin(face) * 0.71, 2.42, Math.cos(face) * 0.71, 0.26, 0.36, 0.2, '#2d3838', 'glass', { ry: face }); // window, lit at night
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
