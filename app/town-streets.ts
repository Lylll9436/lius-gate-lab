import * as T from 'three';
import type { SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import type { XZ } from './town-plan';
import {
  palette,
  noise2,
  POOL,
  POOL_GAP,
  PLANTER,
  plazaPlanters,
  type TownContext,
} from './town-shared';
import type { Kit } from './town-kit';
import { BLOOMS, bakeRamp, type Nature } from './town-nature';

/* ------------------------------------------------------------------ */
/* Streets                                                             */
/* ------------------------------------------------------------------ */
export function createStreets(ctx: TownContext, kit: Kit, nature: Nature) {
  const { material, land } = ctx;
  const { box } = kit;
  const { bloom } = nature;
  function ribbon(
    g: T.Object3D,
    points: XZ[],
    width: number,
    y: number,
    color: string,
    kind: SurfaceKind,
    closed: boolean,
    gap?: (x: number, z: number) => boolean,
    shade = 0.03,
  ) {
    const n = points.length,
      count = closed ? n + 1 : n;
    const pos: number[] = [],
      col: number[] = [],
      idx: number[] = [];
    const base = new T.Color(color);
    for (let k = 0; k < count; k++) {
      const i = k % n;
      const p = points[i];
      const a = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)],
        b = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l,
        nz = dx / l;
      const h = plan.terrainHeight(p[0], p[1]);
      pos.push(p[0] + (nx * width) / 2, y + h, p[1] + (nz * width) / 2);
      pos.push(p[0] - (nx * width) / 2, y + h, p[1] - (nz * width) / 2);
      const tone = 1 - shade / 2 + shade * noise2(p[0] * 0.8, p[1] * 0.8);
      const c = base.clone().multiplyScalar(tone);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let k = 0; k < count - 1; k++) {
      // One gap test per segment, at its midpoint.
      const p = points[k % n],
        q = points[(k + 1) % n];
      if (gap && gap((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) continue;
      const a = k * 2,
        b = a + 1,
        c = a + 2,
        d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, material('#ffffff', kind));
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  }
  /**
   * A raised strip with real side faces: a top, two sides from `bottom` to `top`, and an end cap
   * wherever a run starts or stops. `right` is either the second edge polyline or a width, in which
   * case `left` is the centre line. Sides are `side` or the top colour x0.74. Ground-like: no bake.
   */
  function slab(
    g: T.Object3D,
    left: XZ[],
    right: XZ[] | number,
    top: number,
    bottom: number,
    color: string,
    kind: SurfaceKind,
    closed: boolean,
    keep: (k: number) => boolean = () => true,
    side?: string,
  ): T.Mesh {
    if (typeof right === 'number')
      return slab(g, plan.offsetPolyline(left, -right / 2, closed), plan.offsetPolyline(left, right / 2, closed), top, bottom, color, kind, closed, keep, side);
    const n = left.length,
      count = closed ? n : n - 1;
    const pos: number[] = [],
      col: number[] = [];
    const topColor = new T.Color(color),
      sideColor = side ? new T.Color(side) : topColor.clone().multiplyScalar(0.74);
    const at = (p: XZ, y: number) => new T.Vector3(p[0], y + plan.terrainHeight(p[0], p[1]), p[1]);
    const up = new T.Vector3(0, 1, 0);
    // a-b-c-d run round the quad; flip it if it does not face `outward`.
    const quad = (a: T.Vector3, b: T.Vector3, c: T.Vector3, d: T.Vector3, outward: T.Vector3, tone: T.Color) => {
      if (b.clone().sub(a).cross(c.clone().sub(a)).dot(outward) < 0) [b, d] = [d, b];
      for (const v of [a, b, c, a, c, d]) {
        pos.push(v.x, v.y, v.z);
        col.push(tone.r, tone.g, tone.b);
      }
    };
    const kept = (k: number) => (closed ? keep((k + count) % count) : k >= 0 && k < count && keep(k));
    for (let k = 0; k < count; k++) {
      if (!keep(k)) continue;
      const j = (k + 1) % n,
        l0 = left[k],
        l1 = left[j],
        r0 = right[k],
        r1 = right[j];
      const along = new T.Vector3(l1[0] + r1[0] - l0[0] - r0[0], 0, l1[1] + r1[1] - l0[1] - r0[1]).normalize(),
        across = new T.Vector3(r0[0] + r1[0] - l0[0] - l1[0], 0, r0[1] + r1[1] - l0[1] - l1[1]).normalize();
      quad(at(l0, top), at(l1, top), at(r1, top), at(r0, top), up, topColor);
      quad(at(l0, bottom), at(l1, bottom), at(l1, top), at(l0, top), across.clone().negate(), sideColor);
      quad(at(r0, bottom), at(r1, bottom), at(r1, top), at(r0, top), across, sideColor);
      if (!kept(k - 1)) quad(at(l0, bottom), at(r0, bottom), at(r0, top), at(l0, top), along.clone().negate(), sideColor);
      if (!kept(k + 1)) quad(at(l1, bottom), at(r1, bottom), at(r1, top), at(l1, top), along, sideColor);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, material('#ffffff', kind));
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.noShadow = true;
    mesh.userData.ground = true;
    g.add(mesh);
    return mesh;
  }
  function buildStreets() {
    const R = plan.ROAD_WIDTH,
      P = plan.PAVEMENT_WIDTH,
      KERB = 0.18,
      { road: roadY, pavement: pavementY, kerb: kerbY } = plan.levels;
    // Avenues that cross into the ring: direction u, and the ring tangent t at the junction.
    const crossings = plan.avenues
      .filter((a) => a.crossing)
      .map((a) => {
        const length = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]),
          u: XZ = [(a.to[0] - a.from[0]) / length, (a.to[1] - a.from[1]) / length];
        return { ...a, length, u, t: [-u[1], u[0]] as XZ };
      });
    // The ring, densified (plan.ringLine has no points on its straight runs) with exact cut
    // stations where each avenue's road edge and kerb meet it.
    const ring = plan.densify(plan.ringLine, 2);
    for (const a of crossings)
      for (const o of [R / 2, R / 2 + KERB])
        for (const s of [-1, 1]) {
          const p: XZ = [a.to[0] + a.t[0] * o * s, a.to[1] + a.t[1] * o * s];
          if (ring.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)) continue;
          const k = ring.findIndex((q, i) => plan.distanceToSegment(p, q, ring[(i + 1) % ring.length]) < 1e-6);
          if (k >= 0) ring.splice(k + 1, 0, p);
        }
    /** Within `o` of an avenue mouth, along the ring, on the avenue side. */
    const mouth = (o: number) => (x: number, z: number) =>
      crossings.some(
        (a) =>
          Math.abs((x - a.to[0]) * a.t[0] + (z - a.to[1]) * a.t[1]) < o &&
          plan.distanceToSegment([x, z], a.from, a.to) < R / 2 + P + 0.1,
      );
    /** Keep segment k unless its midpoint (between edges a and b) is in the gap. */
    const openAt = (a: XZ[], b: XZ[], gap: (x: number, z: number) => boolean) => (k: number) => {
      const j = (k + 1) % a.length;
      return !gap((a[k][0] + a[j][0] + b[k][0] + b[j][0]) / 4, (a[k][1] + a[j][1] + b[k][1] + b[j][1]) / 4);
    };
    // Ring road, and tram rails under the tram's wheels, unbroken through the junctions.
    ribbon(land, ring, R, roadY, palette.road, 'asphalt', true);
    for (const s of [-1, 1])
      ribbon(land, plan.offsetPolyline(ring, s * 0.42), 0.07, roadY + 0.003, palette.metal, 'iron', true, undefined, 0).userData.noShadow = true;
    // Raised pavements and kerbs on both sides. The kerb's road face is the riser; the pavement's
    // road edge tucks under the kerb. Only the inner side opens at the avenue mouths.
    for (const side of [-1, 1]) {
      const edges = (o0: number, o1: number) => [plan.offsetPolyline(ring, side * o0), plan.offsetPolyline(ring, side * o1)];
      const [pa, pb] = edges(R / 2 + KERB / 2, R / 2 + P),
        [ka, kb] = edges(R / 2, R / 2 + KERB),
        inner = side > 0;
      slab(land, pa, pb, pavementY, -0.02, palette.pavement, 'paving', true, inner ? openAt(pa, pb, mouth(R / 2 + KERB)) : undefined, palette.plazaDark);
      slab(land, ka, kb, kerbY, 0, palette.kerb, 'stone', true, inner ? openAt(ka, kb, mouth(R / 2 + KERB)) : undefined);
    }
    // Avenues: explicit ends. Edges start on the circle r = 5.1, under the plaza's kerb ring;
    // the road abuts the ring road, kerbs return to the ring's kerb line, pavements meet the
    // ring's inner pavement.
    for (const a of crossings) {
      const n: XZ = [-a.u[1], a.u[0]];
      const at = (along: number, o: number): XZ => [a.from[0] + a.u[0] * along + n[0] * o, a.from[1] + a.u[1] * along + n[1] * o];
      const start = (o: number) => Math.sqrt(5.1 ** 2 - o ** 2) - plan.PLAZA_RADIUS,
        edge = (o: number, end: number) => [at(start(o), o), at(end, o)];
      // The road's start corners sit on r = 5.1 too, so no grass shows at the plaza rim.
      ribbon(land, [at(start(R / 2), 0), at(a.length - R / 2, 0)], R, roadY, palette.road, 'asphalt', false);
      for (const side of [-1, 1]) {
        const paveEnd = a.length - (R / 2 + P),
          kerbEnd = a.length - R / 2;
        slab(land, edge(side * (R / 2 + KERB / 2), paveEnd), edge(side * (R / 2 + P), paveEnd), pavementY, -0.02, palette.pavement, 'paving', false, undefined, palette.plazaDark);
        slab(land, edge((side * R) / 2, kerbEnd), edge(side * (R / 2 + KERB), kerbEnd), kerbY, 0, palette.kerb, 'stone', false);
      }
      // Centre dashes, and a zebra across the mouth, where the ring's inner pavement is cut.
      for (let d = 1.6; d < a.length - 3.2; d += 1.6) {
        const [x, z] = at(d, 0);
        box(land, x, roadY + 0.004, z, 0.1 + Math.abs(a.u[0]) * 0.6, 0.006, 0.1 + Math.abs(a.u[1]) * 0.6, palette.roadLine, 'paint');
      }
      for (const o of [-0.54, -0.18, 0.18, 0.54]) {
        const [x, z] = at(a.length - (R / 2 + P / 2), o);
        box(land, x, roadY + 0.004, z, 0.24 + Math.abs(a.u[0]) * 0.66, 0.006, 0.24 + Math.abs(a.u[1]) * 0.66, palette.roadLine, 'paint');
      }
    }
    // The signals' white stop lines (plan.stopLines): across the ring's carriageway before each
    // junction's mouth, over the rails, and across the avenue's outbound lane before its zebra.
    for (const l of plan.stopLines)
      box(land, l.x, roadY + 0.004, l.z, l.length, 0.006, plan.STOP_LINE.width, palette.roadLine, 'paint', { ry: Math.atan2(l.along[0], l.along[1]) });
    // The north avenue is the Town Hall's forecourt: one paved slab from the hall plinth to the
    // plaza rim (z -6.3 to -5.1), its top and sides coloured by facing.
    {
      const e = Math.sqrt(5.1 ** 2 - 9),
        shape = new T.Shape();
      shape.moveTo(-3, 6.3);
      shape.lineTo(3, 6.3);
      shape.lineTo(3, e);
      shape.absarc(0, 0, 5.1, Math.atan2(e, 3), Math.atan2(e, -3), false);
      const geometry = new T.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -0.02, 0);
      const normals = geometry.getAttribute('normal'),
        topColor = new T.Color(palette.pavement),
        sideColor = new T.Color(palette.plazaDark),
        tones: number[] = [];
      for (let i = 0; i < normals.count; i++) tones.push(...(normals.getY(i) > 0.5 ? topColor : sideColor).toArray());
      geometry.setAttribute('color', new T.Float32BufferAttribute(tones, 3));
      const forecourt = new T.Mesh(geometry, material('#ffffff', 'paving'));
      forecourt.receiveShadow = true;
      forecourt.userData.ground = true;
      forecourt.userData.noShadow = true;
      land.add(forecourt);
    }
    // The archive's loading path: from the south avenue's pavement edge (x 1.95) to the dock front
    // (x 5.95), centred on the hoist door (z 9.2), its top 0.02 under the pavement's.
    slab(land, [[1.95, 8.6], [5.95, 8.6]], [[1.95, 9.8], [5.95, 9.8]], 0.08, -0.02, palette.pavement, 'paving', false, undefined, palette.plazaDark);
    // The studio's path: from the east avenue's pavement edge (z -1.95) along the plinth front
    // (x 7.35) to the entrance apron (z -4.5), its top 0.02 under the pavement's.
    slab(land, [[6.1, -4.6], [6.1, -1.95]], [[7.3, -4.6], [7.3, -1.95]], 0.08, -0.02, palette.pavement, 'paving', false, undefined, palette.plazaDark);
    // The plaza: an inner island for the gate, a reflecting pool ring with four causeways,
    // an outer paved ring and a darker border band under a lathed kerb. Pieces meet at shared edges.
    const poolInner = POOL.inner,
      poolOuter = POOL.outer,
      coping = POOL.coping,
      gapAngle = POOL_GAP,
      plazaY = plan.levels.plaza,
      copingTop = plazaY + 0.12,
      // The lawn runs on at y 0 under the whole plaza, so the bed lies just above it to be seen.
      poolBed = plazaY - 0.08;
    const flat = (geometry: T.BufferGeometry, color: string, kind: SurfaceKind, y: number) => {
      const mesh = new T.Mesh(geometry, material(color, kind));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.receiveShadow = true;
      land.add(mesh);
      return mesh;
    };
    /**
     * Lathed stone, ground-like (the batch bake leaves it alone). List the (r, y) profile up the outer
     * face, across the top toward the axis, then down the inner face: LatheGeometry then winds it to
     * face outward. It stays single-sided, so its shadow comes from the far faces and lit faces never
     * shadow themselves (a double-sided sheet streaks with acne). Its open ends are capped.
     */
    const lathe = (profile: XZ[], start: number, span: number, segments: number, colour: string) => {
      const mesh = new T.Mesh(new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), segments, start, span), material(colour, 'stone'));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.ground = true;
      land.add(mesh);
      return mesh;
    };
    // The island disc and the outer ring reach 0.01 under the causeways (same paving, same colour)
    // and the copings: their coarser chords would otherwise open hairline grass cracks at r 2.4 and 4.2.
    flat(new T.CircleGeometry(poolInner - coping + 0.01, 48), palette.plaza, 'paving', plazaY);
    for (let i = 0; i < 4; i++)
      flat(
        new T.RingGeometry(poolInner - coping, poolOuter + coping, 12, 1, (Math.PI / 2) * i - gapAngle, gapAngle * 2),
        palette.plaza,
        'paving',
        plazaY,
      );
    // The paving shader lays these as granite flags in rings, and the darker band as setts (plan.PLAZA_PAVING).
    flat(new T.RingGeometry(poolOuter + coping - 0.01, plan.PLAZA_PAVING.setts, 64), palette.plaza, 'paving', plazaY);
    flat(new T.RingGeometry(plan.PLAZA_PAVING.setts, plan.PLAZA_PAVING.rim, 64), palette.plazaDark, 'paving', plazaY);
    // The kerb ring: a lip toward the plaza, a rounded top and a face down to the grass. It opens
    // (±3) where the hall forecourt meets the plaza; a lathe angle φ lies at world (sin φ, cos φ).
    const kerbEnd = Math.PI - Math.asin(3 / 5.1);
    lathe(
      [[5.22, -0.02], [5.22, kerbY - 0.03], [5.19, kerbY], [5.05, kerbY], [5.02, plazaY + 0.01], [5.02, plazaY]],
      -kerbEnd,
      kerbEnd * 2,
      96,
      palette.kerb,
    );
    for (const phi of [-kerbEnd, kerbEnd])
      box(land, Math.sin(phi) * 5.12, (kerbY - 0.02) / 2, Math.cos(phi) * 5.12, 0.2, kerbY + 0.02, 0.04, palette.kerb, 'stone', { ry: phi - Math.PI / 2 }).userData.ground = true;
    // Pool copings, 0.3 wide with rounded edges (the lathe's smooth normals); a lathe arc from φ
    // lies at world angle π/2 − φ, and the four sectors are symmetric, so the sets coincide.
    const copings: XZ[][] = [
      [[poolOuter + coping, plazaY - 0.02], [poolOuter + coping, copingTop - 0.05], [poolOuter + coping - 0.05, copingTop], [poolOuter + 0.05, copingTop], [poolOuter, copingTop - 0.05], [poolOuter, poolBed]],
      [[poolInner, poolBed], [poolInner, copingTop - 0.05], [poolInner - 0.05, copingTop], [poolInner - coping + 0.05, copingTop], [poolInner - coping, copingTop - 0.05], [poolInner - coping, plazaY - 0.02]],
    ];
    // A pale, matte, see-through surface over a bed that is light at both edges and deeper cyan in the
    // middle. The surface is lit like a pale wall, so it stays thin enough for the cyan bed to show.
    const water = material(palette.poolSurface, 'water').clone();
    water.transparent = true;
    water.opacity = 0.15;
    water.depthWrite = false;
    water.roughness = 0.35;
    water.metalness = 0;
    const bedEdge = new T.Color(palette.poolEdge),
      bedMiddle = new T.Color(palette.poolWater);
    for (let i = 0; i < 4; i++) {
      const start = (Math.PI / 2) * i + gapAngle,
        span = Math.PI / 2 - gapAngle * 2;
      const bedGeometry = new T.RingGeometry(poolInner, poolOuter, 32, 3, start, span),
        p = bedGeometry.getAttribute('position'),
        tones: number[] = [];
      for (let k = 0; k < p.count; k++) {
        const u = T.MathUtils.clamp((Math.hypot(p.getX(k), p.getY(k)) - poolInner) / (poolOuter - poolInner), 0, 1);
        tones.push(...bedEdge.clone().lerp(bedMiddle, Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.6)).toArray());
      }
      bedGeometry.setAttribute('color', new T.Float32BufferAttribute(tones, 3));
      flat(bedGeometry, '#ffffff', 'stone', poolBed);
      const surface = new T.Mesh(new T.RingGeometry(poolInner, poolOuter, 32, 1, start, span), water);
      surface.rotation.x = -Math.PI / 2;
      surface.position.y = plazaY - 0.03;
      surface.name = 'pool-' + i;
      surface.renderOrder = 2;
      land.add(surface);
      for (const profile of copings) lathe(profile, start, span, 32, palette.trim);
      // Where a sector meets a causeway: a cap on each coping, and the causeway's side face over the water.
      for (const a of [start, start + span]) {
        for (const r of [poolInner - coping / 2, poolOuter + coping / 2])
          box(land, Math.cos(a) * r, (copingTop + poolBed) / 2, Math.sin(a) * r, coping, copingTop - poolBed, 0.05, palette.trim, 'stone', { ry: -a }).userData.ground = true;
        const r = (poolInner + poolOuter) / 2;
        box(land, Math.cos(a) * r, (plazaY + poolBed) / 2, Math.sin(a) * r, poolOuter - poolInner, plazaY - poolBed, 0.05, palette.plazaDark, 'stone', { ry: -a }).userData.ground = true;
      }
      // Between the outer coping and the rim: a planter along the ring, a clipped mound and three blooms.
      const { ry, x: px, z: pz } = plazaPlanters()[i],
        tx = Math.cos(ry),
        tz = -Math.sin(ry);
      box(land, px, plazaY + 0.2, pz, PLANTER.w, 0.4, PLANTER.d, palette.stoneDark, 'stone', { ry });
      bakeRamp(box(land, px, plazaY + 0.5, pz, 1.05, 0.26, 0.34, '#ffffff', 'foliage', { bevel: 0.12, segments: 1, ry }), palette.hedge, 0.9, 1.05, palette.hedgeTop, 0.45);
      [BLOOMS[0], BLOOMS[1], BLOOMS[3]].forEach((colour, f) => {
        const t = (f - 1) * 0.32;
        bloom(land, px + tx * t, plazaY + 0.66, pz + tz * t, colour);
      });
    }
  }
  return { ribbon, slab, buildStreets };
}
