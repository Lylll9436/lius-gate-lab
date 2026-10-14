import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  createCityMaterials,
  GROUND_HEIGHT_RANGE,
  type SurfaceKind,
} from './city-materials';
import { createResident } from './city-people';
import { buildings, type BuildingId } from './city-data';
import * as plan from './town-plan';
import type { XZ } from './town-plan';
import type { Season } from './glasgow-sun';
import {
  palette,
  hash,
  noise2,
  sstep,
  mix,
  POOL,
  POOL_GAP,
  PLANTER,
  plazaPlanters,
  bandstandAt,
  CRANE_BASE,
  HOARDING_THICKNESS,
  hoardingWalls,
  paddockRuns,
  WATER,
  type TownContext,
} from './town-shared';
import { createKit } from './town-kit';
import { createBatch } from './town-batch';
import { paintByHeight, BLOOMS, bakeRamp, createNature } from './town-nature';
export { palette } from './town-shared';
export { treeLook, heatherLook } from './town-nature';

/**
 * The town itself: terrain, streets, seven buildings, trees,
 * street furniture, the harbour, the lighthouse and the things that move.
 * Everything is procedural and merged into a few draw calls per surface family.
 */

export type Model = {
  root: T.Group;
  shell: T.Group;
  fade: T.MeshStandardMaterial[];
  center: T.Vector3;
  /** Invisible box for pointer picking, set by the scene. */
  hit?: T.Mesh;
};
export type Walker = { root: T.Group; loop: XZ[]; distance: number; speed: number };

/**
 * The balloon's beat: a ring centred on the island, out over the shore and the sea, so it stays
 * out of every chapter's subject. It does not lap the ring (a lap brought it behind the hero
 * text and the News card once every seven minutes) but swings to and fro along its far side
 * as the opening view sees it, between the open top left and top right of that view, out of
 * frame above the island in between. `middle` and `reach` are angles on the ring (radians),
 * `rate` the swing's pace (radians per second, a swing there and back in about six and a
 * half minutes). It sets off from the north-east end, over the sea.
 */
export const BALLOON = { radius: 32, middle: 3.8, reach: 1.35, rate: 0.016 };

type Point = [number, number, number];

/* ------------------------------------------------------------------ */
/* Ground masks                                                        */
/* ------------------------------------------------------------------ */

/** One RGBA8 grid over ±MASK_EXTENT (0.34 units per texel); texel i runs along x, row j along z. */
export const MASK_EXTENT = 44,
  MASK_SIZE = 256;
/** Separable box blur along rows or columns, with a running sum and clamped edges. */
function boxBlur(src: Float32Array, dst: Float32Array, alongX: boolean, radius = 2) {
  const N = MASK_SIZE,
    width = radius * 2 + 1;
  for (let line = 0; line < N; line++) {
    const at = (k: number) => {
      const c = Math.min(N - 1, Math.max(0, k));
      return alongX ? line * N + c : c * N + line;
    };
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[at(k)];
    for (let k = 0; k < N; k++) {
      dst[at(k)] = sum / width;
      sum += src[at(k + radius + 1)] - src[at(k - radius)];
    }
  }
}
/**
 * Baked ground masks, all from plan data so later layout changes stay in sync.
 * R: ground darkening (footprint pads, canopy and trunk discs, lamp feet, the grass lip by the pavements).
 * G: the shallow-water ring round the coast and the lighthouse rock.
 * B: the mown town lawn (plan.lawnCore). A: terrain height over GROUND_HEIGHT_RANGE.
 */
export function buildGroundMasks(trees: plan.TreeSpec[], lampSpecs: plan.LampSpec[]) {
  const N = MASK_SIZE,
    E = MASK_EXTENT,
    texel = (2 * E) / N,
    centre = (i: number) => -E + (i + 0.5) * texel,
    ao = new Float32Array(N * N);
  const range = (lo: number, hi: number) =>
    [Math.max(0, Math.floor((lo + E) / texel)), Math.min(N - 1, Math.ceil((hi + E) / texel))] as const;
  /** Max-combine value(dx, dz) into every texel within `reach` of (cx, cz). */
  const stamp = (cx: number, cz: number, reach: number, value: (dx: number, dz: number) => number) => {
    const [i0, i1] = range(cx - reach, cx + reach),
      [j0, j1] = range(cz - reach, cz + reach);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const v = value(centre(i) - cx, centre(j) - cz);
        if (v > ao[j * N + i]) ao[j * N + i] = v;
      }
  };
  /** A w×d rectangle turned by ry (as rotation.y), full strength inside, fading over `margin` outside. */
  const rect = (cx: number, cz: number, w: number, d: number, ry: number, strength: number, margin: number) => {
    const c = Math.cos(ry),
      s = Math.sin(ry);
    stamp(cx, cz, Math.hypot(w, d) / 2 + margin, (dx, dz) => {
      const lx = dx * c - dz * s,
        lz = dx * s + dz * c,
        out = Math.hypot(Math.max(0, Math.abs(lx) - w / 2), Math.max(0, Math.abs(lz) - d / 2));
      return strength * (1 - T.MathUtils.smoothstep(out, 0, margin));
    });
  };
  const disc = (cx: number, cz: number, r: number, strength: number, feather: number) =>
    stamp(cx, cz, r + feather, (dx, dz) => strength * (1 - T.MathUtils.smoothstep(Math.hypot(dx, dz) - r, 0, feather)));

  for (const s of plan.siteList) rect(s.x, s.z, s.w + 0.4, s.d + 0.4, s.rotation, 1, 0.6);
  for (const c of plan.cottages) rect(c.x, c.z, 3.0, 2.6, c.rotation, 1, 0.5);
  const plot = plan.reservedPlot;
  rect(plot.x, plot.z, CRANE_BASE, CRANE_BASE, 0, 0.9, 0.4);
  for (const [dx, dz, l, ry] of hoardingWalls(plot)) rect(plot.x + dx, plot.z + dz, l, HOARDING_THICKNESS, ry, 0.5, 0.3);
  for (const p of plazaPlanters()) rect(p.x, p.z, PLANTER.w, PLANTER.d, p.ry, 0.7, 0.35);
  const [bx, bz] = bandstandAt();
  disc(bx, bz, 2.1, 1, 0.5);
  for (const t of trees) {
    disc(t.x, t.z, 1.0 * t.size, 0.45, 0.5);
    disc(t.x, t.z, 0.3 * t.size, 0.85, 0.3);
  }
  paddockMasks(rect, disc);
  for (const s of plan.flock) disc(s.x, s.z, 0.3, 0.4, 0.3); // a soft trodden patch under each sheep
  for (const s of plan.standingStones()) disc(s.x, s.z, 0.3, 0.6, 0.25);
  disc(plan.statueSpot[0], plan.statueSpot[1], 1.6, 0.6, 0.5); // the statue's pad
  const scratch = new Float32Array(N * N);
  for (let pass = 0; pass < 2; pass++) {
    boxBlur(ao, scratch, true);
    boxBlur(scratch, ao, false);
  }
  // Features about a texel wide go in after the blur, which would flatten them to nothing;
  // their own falloffs and the texture's linear filtering keep them soft.
  for (const l of lampSpecs) disc(l.x, l.z, 0.25, 0.5, 0.2);
  // A darker grass lip along the pavements and the plaza rim; only texels near the ring can have one.
  // The 0.4-unit ramp is barely wider than a texel, so it starts half a texel out: the first grass
  // texel then always carries the full 0.35, wherever the edge falls between texel centres.
  const { ring } = plan,
    [li0, li1] = range(-ring.hw - 3, ring.hw + 3),
    [lj0, lj1] = range(ring.cz - ring.hd - 3, ring.cz + ring.hd + 3);
  for (let j = lj0; j <= lj1; j++)
    for (let i = li0; i <= li1; i++) {
      const x = centre(i),
        z = centre(j),
        pd = Math.min(plan.distanceToStreets(x, z) - plan.PAVEMENT_WIDTH, Math.hypot(x, z) - plan.PLAZA_RADIUS);
      const lip = pd > 0 ? 0.35 * (1 - Math.max(0, pd - texel / 2) / 0.4) : 0;
      if (lip > ao[j * N + i]) ao[j * N + i] = lip;
    }

  const data = new Uint8Array(N * N * 4),
    [rockX, rockZ] = plan.lighthouseRock,
    byte = (v: number) => Math.round(T.MathUtils.clamp(v, 0, 1) * 255);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = centre(i),
        z = centre(j),
        k = (j * N + i) * 4,
        offshore = Math.hypot(x, z) - plan.islandRadius(Math.atan2(z, x));
      const shallow = Math.max(
        1 - T.MathUtils.smoothstep(offshore, 2.6, 7.5),
        1 - T.MathUtils.smoothstep(Math.hypot(x - rockX, z - rockZ), 1.5, 4),
      );
      data[k] = byte(ao[j * N + i]);
      data[k + 1] = byte(shallow);
      data[k + 2] = byte(plan.lawnCore(x, z));
      data[k + 3] = byte(plan.terrainHeight(x, z) / GROUND_HEIGHT_RANGE);
    }
  const texture = new T.DataTexture(data, N, N, T.RGBAFormat, T.UnsignedByteType);
  texture.colorSpace = T.NoColorSpace;
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.name = 'ground-masks';
  texture.needsUpdate = true;
  return texture;
}
type RectStamp = (cx: number, cz: number, w: number, d: number, ry: number, strength: number, margin: number) => void;
type DiscStamp = (cx: number, cz: number, r: number, strength: number, feather: number) => void;
/** The paddock's ground shade (stamped before the blur): a soft band under every dyke run, a pad under the hay rack and one under each animal. */
function paddockMasks(rect: RectStamp, disc: DiscStamp) {
  for (const [x, z, length, ry] of paddockRuns()) rect(x, z, length, plan.paddock.wall, ry, 0.5, 0.3);
  rect(plan.hayRack.x, plan.hayRack.z, 0.5, 1.0, 0, 0.6, 0.3);
  for (const animal of plan.herd) disc(animal.x, animal.z, 0.45 * animal.scale, 0.5, 0.3);
}

type TownOptions = {
  library?: ReturnType<typeof createCityMaterials>;
  /** Which season the trees wear (blossom, autumn tones); summer, all green, by default. */
  season?: Season;
};
export type Town = ReturnType<typeof buildTown>;

/** The whole town at once (the checks, and anything that cannot wait). */
export function buildTown(options: TownOptions = {}) {
  const phases = buildTownInPhases(options);
  for (;;) {
    const step = phases.next();
    if (step.done) return step.value;
  }
}

/**
 * The town in phases: it stops after each one (yielding the phase's name), so the page can
 * hand the main thread back to the browser between them instead of freezing for the whole
 * build. Run to the end, it returns the same town as buildTown.
 */
export function* buildTownInPhases(options: TownOptions = {}) {
  const library = options.library || createCityMaterials();
  const season = options.season ?? 'summer';
  const material = library.material;
  const city = new T.Group(),
    land = new T.Group();
  city.name = 'town';
  land.name = 'land';
  city.add(land);
  const lamps: T.Mesh[] = [],
    clocks: { hour: T.Object3D; minute: T.Object3D }[] = [],
    animated: { object: T.Object3D; update: (time: number, night: number) => void }[] = [];
  const ctx: TownContext = { library, material, season, land, lamps, clocks, animated };
  const kit = createKit(ctx), nature = createNature(ctx, kit);
  const { batch } = createBatch(ctx);
  const { box, cylinder, strut, cone, sphere, hullShape, hullSolid, pitchedRoof, slabRoof, windowAt, door, quoins, plinth, chimney, lampGlass, groundY } = kit, { tree, bloom, hedge, flowerBed, topiary, moorland } = nature;

  /* ---------------------------------------------------------------- */
  /* Terrain                                                           */
  /* ---------------------------------------------------------------- */
  function buildTerrain() {
    const rings = 26,
      segments = plan.OUTLINE_SAMPLES;
    const positions: number[] = [],
      colors: number[] = [],
      indices: number[] = [];
    // A clean yellow-green town lawn (lawnCore: inside the ring and the terrace gardens) and a
    // patchier outer meadow, from two low octaves only so the ~1-unit vertex spacing cannot alias.
    const lo = new T.Color('#98b74a'),
      hi = new T.Color('#aac757'),
      patch = new T.Color('#8bb038'),
      crest = new T.Color('#b4cf5c');
    positions.push(0, plan.terrainHeight(0, 0), 0);
    colors.push(...new T.Color('#a2bf50').toArray());
    for (let i = 1; i <= rings; i++)
      for (let j = 0; j < segments; j++) {
        const a = (j / segments) * Math.PI * 2,
          t = Math.pow(i / rings, 1.15),
          r = plan.islandRadius(a) * t,
          x = Math.cos(a) * r,
          z = Math.sin(a) * r;
        positions.push(x, plan.terrainHeight(x, z), z);
        const n = noise2(x * 0.07 + 5, z * 0.07 + 3) * 0.6 + noise2(x * 0.19 + 11, z * 0.19 + 7) * 0.4;
        const c = lo.clone().lerp(hi, T.MathUtils.smoothstep(n, 0.3, 0.7));
        c.lerp(patch, 0.6 * (1 - plan.lawnCore(x, z)) * T.MathUtils.smoothstep(noise2(x * 0.23 + 31, z * 0.23 + 17), 0.6, 0.7));
        c.lerp(crest, 0.45 * T.MathUtils.clamp(plan.terrainHeight(x, z) / 0.9, 0, 1));
        colors.push(c.r, c.g, c.b);
      }
    const index = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * segments + (j % segments));
    for (let j = 0; j < segments; j++) indices.push(0, index(1, j + 1), index(1, j));
    for (let i = 1; i < rings; i++)
      for (let j = 0; j < segments; j++) {
        const a = index(i, j),
          b = index(i, j + 1),
          c = index(i + 1, j),
          d = index(i + 1, j + 1);
        indices.push(a, d, c, a, b, d);
      }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const ground = new T.Mesh(geometry, material('#ffffff', 'grass'));
    ground.receiveShadow = true;
    ground.name = 'island-ground';
    land.add(ground);

    // The shore: a crisp darker turf lip, dry sand, wet sand, the waterline, a pale shelf, the drop.
    // The shelf colours sit under the sea's translucent turquoise shallows.
    const profile = [
      { width: 0, height: 0, color: '#98b74a' },
      { width: 0.22, height: -0.004, color: palette.lawnEdge },
      { width: 0.32, height: -0.008, color: '#efd9a4' },
      { width: 1.9, height: -0.014, color: palette.sand },
      { width: 2.5, height: -0.02, color: '#d6ba86' },
      { width: 2.85, height: -0.026, color: palette.sandWet },
      { width: 3.3, height: -0.05, color: '#a8d8cf' },
      { width: 4.6, height: -0.17, color: '#5fb8c8' },
      { width: 7.2, height: -0.48, color: '#2f8fb6' },
    ];
    /** The shore surface height at a given width out from the outline. */
    const shoreHeight = (width: number) => {
      for (let j = 1; j < profile.length; j++)
        if (width <= profile[j].width) {
          const a = profile[j - 1],
            b = profile[j];
          return T.MathUtils.lerp(a.height, b.height, (width - a.width) / (b.width - a.width));
        }
      return profile[profile.length - 1].height;
    };
    const n = plan.OUTLINE_SAMPLES;
    const shorePoint = (i: number, width: number, height: number): Point => {
      // Offset along the outline normal, smoothed over two neighbours each side.
      const p = plan.islandOutline[i % n],
        prev = plan.islandOutline[(i + n - 2) % n],
        next = plan.islandOutline[(i + 2) % n];
      const dx = next[0] - prev[0],
        dz = next[1] - prev[1],
        l = Math.hypot(dx, dz) || 1;
      return [p[0] + (dz / l) * width, height, p[1] - (dx / l) * width];
    };
    const sp: number[] = [],
      sc: number[] = [],
      si: number[] = [];
    for (let i = 0; i < n; i++)
      for (const band of profile) {
        // The inner edge meets the lawn's outer ring, which rises where a mound reaches the coast;
        // a flat edge there leaves a crack that shows the sea under the island.
        const [ox, oz] = plan.islandOutline[i],
          p = shorePoint(i, band.width, band.width === 0 ? plan.terrainHeight(ox, oz) : band.height);
        sp.push(...p);
        const tone = 0.96 + 0.04 * Math.sin(i * 0.9 + band.width * 2.1) + 0.02 * (hash(i * 7 + band.width * 13) - 0.5);
        const c = new T.Color(band.color).multiplyScalar(tone);
        sc.push(c.r, c.g, c.b);
      }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < profile.length - 1; j++) {
        const a = i * profile.length + j,
          b = ((i + 1) % n) * profile.length + j;
        si.push(a, b, b + 1, a, b + 1, a + 1);
      }
    const shoreGeometry = new T.BufferGeometry();
    shoreGeometry.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
    shoreGeometry.setAttribute('color', new T.Float32BufferAttribute(sc, 3));
    shoreGeometry.setIndex(si);
    shoreGeometry.computeVertexNormals();
    const beach = new T.Mesh(shoreGeometry, material('#ffffff', 'sand'));
    beach.receiveShadow = true;
    beach.name = 'shore';
    land.add(beach);
    // Foam: a bright wobbling band on the tide line and a fainter, straight one just beyond it.
    // RGBA vertex colours (itemSize 4) carry each band's alpha.
    const fp: number[] = [],
      fc: number[] = [],
      fi: number[] = [];
    const foamColour = new T.Color('#eaf6f2');
    const foamBands = [
      { from: 2.8, to: 3.0, wobble: 0.5, alpha: 0.9 },
      { from: 3.3, to: 3.46, wobble: 0, alpha: 0.45 },
    ];
    foamBands.forEach((band, b) => {
      for (let i = 0; i < n; i++) {
        const wobble = (0.12 * Math.sin(i * 1.7) + 0.08 * Math.sin(i * 4.3)) * band.wobble;
        fp.push(...shorePoint(i, band.from + wobble, WATER + 0.006), ...shorePoint(i, band.to + wobble, WATER + 0.006));
        for (let k = 0; k < 2; k++) fc.push(foamColour.r, foamColour.g, foamColour.b, band.alpha);
      }
      for (let i = 0; i < n; i++) {
        const a = (b * n + i) * 2,
          c = (b * n + ((i + 1) % n)) * 2;
        fi.push(a, c, c + 1, a, c + 1, a + 1);
      }
    });
    const foamGeometry = new T.BufferGeometry();
    foamGeometry.setAttribute('position', new T.Float32BufferAttribute(fp, 3));
    foamGeometry.setAttribute('color', new T.Float32BufferAttribute(fc, 4));
    foamGeometry.setIndex(fi);
    foamGeometry.computeVertexNormals();
    const foamMaterial = material('#ffffff', 'paint').clone();
    foamMaterial.vertexColors = true;
    foamMaterial.transparent = true;
    foamMaterial.opacity = 0.92;
    foamMaterial.depthWrite = false;
    foamMaterial.emissive.set('#ffffff');
    foamMaterial.emissiveIntensity = 0.2;
    const foam = new T.Mesh(foamGeometry, foamMaterial);
    foam.name = 'tide-foam';
    foam.renderOrder = 3;
    foam.userData.keepSeparate = true;
    land.add(foam);
    animated.push({
      object: foam,
      update(time, night) {
        foamMaterial.emissiveIntensity = 0.2 * (1 - 0.7 * night);
        foamMaterial.opacity = 0.92 + Math.sin(time * 0.7) * 0.06;
      },
    });
    // A few chunky, rounded boulders on the beach. They only turn about y, so their tops stay flat,
    // and brighten upwards; the batch's contact bake darkens their feet.
    for (let i = 0; i < n; i++) {
      if (hash(i) >= 0.07) continue;
      const width = 0.6 + 1.6 * hash(i * 3 + 1),
        r = 0.26 + 0.18 * (0.5 + 0.5 * Math.sin(i * 17.1)),
        p = shorePoint(i, width, shoreHeight(width)),
        geometry = new T.IcosahedronGeometry(r, 1),
        position = geometry.getAttribute('position'),
        tint = new T.Color(i % 2 ? '#b9b6a2' : '#9da394'),
        tone = new Float32Array(position.count * 3);
      for (let k = 0; k < position.count; k++) {
        const v = 0.9 + 0.15 * T.MathUtils.smoothstep(position.getY(k), -r, r);
        tone.set([tint.r * v, tint.g * v, tint.b * v], k * 3);
      }
      geometry.setAttribute('color', new T.BufferAttribute(tone, 3));
      const stone = new T.Mesh(geometry, material('#ffffff', 'stone'));
      // Resting on the sand, then sunk by 35% of its half-height.
      stone.position.set(p[0], p[1] + 0.62 * r * (1 - 0.35), p[2]);
      stone.scale.set(1.35, 0.62, 1.05);
      stone.rotation.y = i * 0.93;
      stone.castShadow = stone.receiveShadow = true;
      land.add(stone);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Streets                                                           */
  /* ---------------------------------------------------------------- */
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
    flat(new T.RingGeometry(poolOuter + coping - 0.01, 4.72, 64), palette.plaza, 'paving', plazaY);
    flat(new T.RingGeometry(4.72, 5.1, 64), palette.plazaDark, 'paving', plazaY);
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

  /* ---------------------------------------------------------------- */
  /* Furniture, planting, small things                                 */
  /* ---------------------------------------------------------------- */
  /** A chunky bench: two leg slabs with back posts, one seat slab and one back board. */
  function bench(g: T.Object3D, x: number, y: number, z: number, ry = 0) {
    const b = new T.Group(); b.position.set(x, y, z); b.rotation.y = ry; g.add(b);
    for (const sx of [-0.52, 0.52]) {
      box(b, sx, 0.19, 0.02, 0.1, 0.38, 0.4, palette.metal, 'iron');   // leg slab, 108
      box(b, sx, 0.62, -0.17, 0.1, 0.5, 0.08, palette.metal, 'iron');  // back post, 12
    }
    box(b, 0, 0.42, 0.02, 1.3, 0.1, 0.46, palette.wood, 'wood');      // seat slab, 108
    box(b, 0, 0.7, -0.19, 1.3, 0.26, 0.1, palette.wood, 'wood');      // back board, 108
    return b;
  }
  // Every street and pier lantern shares one glass; the frame loop sets the same glow on all of them.
  const lanternGlass = lampGlass();
  lanternGlass.emissiveIntensity = 0;
  /** A chunky lamp: iron plinth, a round brass collar, thick shaft, a fat lantern (height ± 0.2) and a hat. */
  function lamp(g: T.Object3D, x: number, z: number, height = 1.8, y = plan.terrainHeight(x, z)) {
    const post = new T.Group();
    post.position.set(x, y, z);
    g.add(post);
    const iron = palette.metal;
    box(post, 0, 0.15, 0, 0.34, 0.3, 0.34, iron, 'iron'); // plinth
    cylinder(post, 0, 0.33, 0, 0.14, 0.14, 0.06, palette.brass, 'brass', 12); // brass collar: round, so it sweeps a highlight
    const shaft = new T.Mesh(new T.CylinderGeometry(0.07, 0.085, height - 0.5, 10, 1, true), material(iron, 'iron'));
    shaft.position.y = 0.3 + (height - 0.5) / 2;
    shaft.castShadow = shaft.receiveShadow = true;
    post.add(shaft);
    const lantern = new T.Mesh(new T.BoxGeometry(0.36, 0.4, 0.36), lanternGlass);
    lantern.position.y = height;
    lantern.castShadow = false;
    post.add(lantern);
    cone(post, 0, height + 0.31, 0, 0.32, 0.22, iron, 'iron', 4); // hat
    lamps.push(lantern);
    return post;
  }
  /** A red enamel phone box: a stone plinth, a fat body with one big pane per face, a blank cream band, a crown and a pyramid hat. */
  function phoneBox(g: T.Object3D, x: number, y: number, z: number, ry = 0) {
    const p = new T.Group(); p.position.set(x, y, z); p.rotation.y = ry; g.add(p);
    const red = palette.boat; // the palette's accent red
    box(p, 0, 0.1, 0, 0.84, 0.2, 0.84, palette.stoneDark, 'stone'); // plinth
    box(p, 0, 1.0, 0, 0.72, 1.6, 0.72, red, 'enamel'); // body
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const f = new T.Group(); f.rotation.y = side; p.add(f);
      box(f, 0, 0.98, 0.35, 0.48, 1.04, 0.04, palette.glass, 'glass'); // pane
      box(f, 0, 0.98, 0.37, 0.07, 1.04, 0.03, red, 'enamel'); // mullion
      box(f, 0, 1.15, 0.37, 0.48, 0.07, 0.03, red, 'enamel'); // transom
      box(f, 0, 1.64, 0.37, 0.5, 0.13, 0.03, palette.white, 'enamel'); // sign band, blank
    }
    box(p, 0, 1.86, 0, 0.84, 0.12, 0.84, red, 'enamel'); // crown
    cone(p, 0, 2.02, 0, 0.58, 0.2, red, 'enamel', 4); // hat
    return p;
  }
  /** A fat green enamel litter bin with a brass band and an iron lid. */
  function bin(g: T.Object3D, x: number, y: number, z: number) {
    cylinder(g, x, y + 0.33, z, 0.24, 0.2, 0.66, palette.greenDoor, 'enamel', 12); // body
    cylinder(g, x, y + 0.5, z, 0.245, 0.245, 0.07, palette.brass, 'brass', 12); // band
    cylinder(g, x, y + 0.7, z, 0.27, 0.27, 0.1, palette.metal, 'iron', 12); // lid
  }
  /** The park bandstand: a fat octagon on a stepped plinth, chunky columns, low panels and a big verdigris hat. */
  function pavilion(g: T.Object3D, x: number, y: number, z: number) {
    const p = new T.Group(); p.position.set(x, y, z); g.add(p);
    /** Flat-faced 8-sided pieces (non-indexed, face normals) so they shade as octagons, not cylinders. */
    const facets = (geo: T.BufferGeometry) => { const flat = geo.toNonIndexed(); geo.dispose(); flat.computeVertexNormals(); return flat; };
    const oct = (rt: number, rb: number, h: number, yc: number, colour: string, kind: SurfaceKind) => {
      const m = new T.Mesh(facets(new T.CylinderGeometry(rt, rb, h, 8)), material(colour, kind));
      m.rotation.y = Math.PI / 8; m.position.y = yc; m.castShadow = m.receiveShadow = true; p.add(m); return m; };
    oct(1.9, 2.0, 0.4, 0.2, palette.stoneDark, 'stone');          // plinth (flat face to +z)
    oct(1.78, 1.78, 0.08, 0.44, palette.plaza, 'paving');         // floor
    box(p, 0, 0.13, 2.02, 1.1, 0.26, 0.34, palette.stoneDark, 'stone'); // steps land on the park's gravel strip
    box(p, 0, 0.065, 2.34, 1.1, 0.13, 0.3, palette.stoneDark, 'stone');
    for (let i = 0; i < 8; i++) {
      const th = Math.PI / 8 + (i * Math.PI) / 4;               // octagon corners (x = r sin, z = r cos)
      const col = new T.Mesh(new T.CylinderGeometry(0.09, 0.11, 2.1, 10, 1, true), material(palette.frame, 'enamel')); // painted cast iron
      col.position.set(1.55 * Math.sin(th), 1.45, 1.55 * Math.cos(th)); col.castShadow = col.receiveShadow = true; p.add(col);
      const mid = th + Math.PI / 8; if (i === 7) continue;     // entrance between corners 7 and 0 faces +z
      box(p, 1.432 * Math.sin(mid), 0.6, 1.432 * Math.cos(mid), 0.95, 0.4, 0.12, palette.frame, 'enamel', { ry: mid });
    }
    oct(1.7, 1.7, 0.32, 2.66, palette.frame, 'enamel');          // closed frieze; columns stop under it
    const roof = new T.Mesh(facets(new T.ConeGeometry(2.3, 1.2, 8)), material(palette.copper, 'copper'));
    roof.rotation.y = Math.PI / 8; roof.position.y = 3.42; roof.castShadow = roof.receiveShadow = true; p.add(roof);
    const fin = new T.Mesh(new T.IcosahedronGeometry(0.16, 1), material(palette.brass, 'brass')); fin.position.y = 4.1; p.add(fin);
    return p;
  }
  /** The park's notice board: two posts, a wooden board with a paper sheet and a slate roof. */
  function memoryBoard(g: T.Object3D, x: number, y: number, z: number, ry: number) {
    const b = new T.Group(); b.position.set(x, y, z); b.rotation.y = ry; g.add(b);
    for (const dx of [-0.6, 0.6]) box(b, dx, 0.8, 0, 0.12, 1.6, 0.12, palette.woodDark, 'wood'); // posts
    box(b, 0, 1.15, 0, 1.35, 0.85, 0.1, palette.wood, 'wood'); // board
    box(b, 0, 1.15, 0.06, 1.15, 0.65, 0.02, palette.white, 'paint'); // paper
    box(b, 0, 1.66, 0, 1.6, 0.12, 0.42, palette.slate, 'slate'); // roof
    return b;
  }
  /** The tower crane on the reserved plot, built from a few thick painted members, with a swinging jib and a hook load. */
  function crane(g: T.Object3D, x: number, z: number) {
    const Y = palette.gold; // crane yellow, enamelled
    const base = new T.Group();
    base.position.set(x, 0, z);
    g.add(base);
    box(base, 0, 0.18, 0, CRANE_BASE, 0.36, CRANE_BASE, '#bdb6a4', 'stone'); // footing
    for (const sx of [-0.3, 0.3])
      for (const sz of [-0.3, 0.3]) box(base, sx, 0.36 + 3.6, sz, 0.16, 7.2, 0.16, Y, 'enamel'); // mast chords
    for (let i = 0; i < 5; i++) {
      const y = 1.26 + i * 1.2;
      for (const s of [-0.3, 0.3]) {
        box(base, 0, y, s, 0.6, 0.09, 0.09, Y, 'enamel'); // ring bars
        box(base, s, y, 0, 0.09, 0.09, 0.6, Y, 'enamel');
      }
      // One diagonal on each camera-facing face.
      box(base, 0, y + 0.6, 0.3, 0.09, 1.34, 0.09, Y, 'enamel', { rz: 0.4636 });
      box(base, 0.3, y + 0.6, 0, 0.09, 1.34, 0.09, Y, 'enamel', { rx: 0.4636 });
    }
    const jib = new T.Group();
    jib.position.set(0, 7.86, 0);
    jib.userData.keepSeparate = true;
    base.add(jib);
    box(jib, 0, 0, 0, 1.1, 0.6, 1.1, Y, 'enamel'); // slewing unit
    box(jib, 0.35, 0.65, 0.1, 0.9, 0.7, 0.8, Y, 'enamel'); // cab
    box(jib, 0.35, 0.7, 0.51, 0.62, 0.38, 0.06, palette.glass, 'glass'); // cab window
    cone(jib, 0, 1.8, 0, 0.42, 1.6, Y, 'enamel', 4); // apex
    box(jib, 3.3, 0.35, 0, 6.2, 0.22, 0.22, Y, 'enamel'); // top chord
    for (const s of [-0.22, 0.22]) box(jib, 3.3, -0.05, s, 6.2, 0.12, 0.12, Y, 'enamel'); // bottom chords
    for (let i = 0; i < 8; i++) box(jib, 0.75 + i * 0.75, 0.15, 0, 0.09, 0.5, 0.09, Y, 'enamel', { rz: i % 2 ? 0.75 : -0.75 }); // web
    box(jib, -1.5, 0.15, 0, 2.4, 0.18, 0.5, Y, 'enamel'); // counter-jib
    box(jib, -2.3, -0.05, 0, 0.9, 0.8, 0.9, '#9a978c', 'stone'); // counterweight
    box(jib, 1.7, 1.15, 0, 3.9, 0.07, 0.07, palette.metal, 'iron', { rz: -0.34 }); // ties
    box(jib, -1.1, 1.15, 0, 2.5, 0.07, 0.07, palette.metal, 'iron', { rz: 0.55 });
    box(jib, 4.6, -0.2, 0, 0.42, 0.2, 0.5, palette.metal, 'iron'); // trolley
    box(jib, 4.6, -1.7, 0, 0.06, 2.9, 0.06, palette.metal, 'iron'); // line
    box(jib, 4.6, -3.25, 0, 0.36, 0.32, 0.24, palette.boat, 'enamel'); // hook block
    box(jib, 4.6, -3.8, 0, 1.2, 0.18, 0.5, palette.wood, 'wood'); // plank load
    animated.push({
      object: jib,
      update(time) {
        jib.rotation.y = Math.sin(time * 0.07) * 0.9;
      },
    });
    // Hoarding round the plot (lengthened by its thickness so the corners close), with a blue band
    // standing just proud of the top, and building materials inside.
    const plot = plan.reservedPlot;
    for (const [dx, dz, l, ry] of hoardingWalls(plot)) {
      box(g, plot.x + dx, 0.5, plot.z + dz, l + HOARDING_THICKNESS, 1.0, HOARDING_THICKNESS, '#efe2c2', 'paint', { ry });
      box(g, plot.x + dx, 0.93, plot.z + dz, l + 0.14, 0.18, 0.14, palette.blueDoor, 'paint', { ry });
    }
    box(g, plot.x - 1.4, 0.35, plot.z + 1.3, 0.7, 0.7, 0.7, palette.wood, 'wood'); // crates
    box(g, plot.x - 1.4, 1.0, plot.z + 1.3, 0.6, 0.6, 0.6, palette.wood, 'wood', { ry: 0.4 });
    box(g, plot.x + 1.2, 0.225, plot.z + 1.4, 0.9, 0.45, 0.6, palette.brick, 'stone'); // brick pallet
    return base;
  }
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
    const dinghy = new T.Group();
    dinghy.position.set(sx + dx * 5.3 + plan.pier.tangent[0] * 1.4, WATER, sz + dz * 5.3 + plan.pier.tangent[1] * 1.4);
    dinghy.rotation.y = heading + 0.06;
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
  function hotAirBalloon(g: T.Object3D) {
    const b = new T.Group();
    g.add(b);
    // A teardrop envelope lathed from the mouth (y 0) to the crown (y 4.1), with 12 crisp gores.
    const prof = [[0, 0], [0.3, 0.02], [0.42, 0.3], [0.75, 0.9], [1.25, 1.6], [1.55, 2.3], [1.6, 2.75], [1.48, 3.25], [1.15, 3.7], [0.62, 4.0], [0, 4.1]].map(
      ([r, y]) => new T.Vector2(r, y),
    );
    const lathe = new T.LatheGeometry(prof, 24).toNonIndexed(),
      pos = lathe.getAttribute('position'),
      col = new Float32Array(pos.count * 3),
      stripe = [new T.Color(palette.balloon), new T.Color(palette.balloonBand)];
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
        cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const c = stripe[Math.floor(((Math.atan2(cx, cz) + Math.PI) / (Math.PI * 2)) * 12) % 2];
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
    }
    lathe.setAttribute('color', new T.BufferAttribute(col, 3));
    const envelope = new T.Mesh(lathe, material('#ffffff', 'fabric'));
    envelope.position.y = 0.95;
    envelope.castShadow = envelope.receiveShadow = true;
    b.add(envelope);
    cylinder(b, 0, 5.0, 0, 0.5, 0.62, 0.12, palette.gold, 'fabric', 18); // crown cap
    box(b, 0, 0.2, 0, 0.7, 0.5, 0.7, palette.wood, 'wood'); // basket
    box(b, 0, 0.47, 0, 0.8, 0.1, 0.8, palette.woodDark, 'wood'); // rim
    // Rope tops end inside the mouth (r 0.32 there).
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        strut(b, new T.Vector3(sx * 0.32, 0.5, sz * 0.32), new T.Vector3(sx * 0.17, 1.02, sz * 0.17), 0.035, palette.woodDark, 'wood');
    b.userData.keepSeparate = true;
    animated.push({
      object: b,
      update(time) {
        // To and fro on the ring's far side, out over the shore and the sea, so it never drifts
        // across a chapter's subject or comes down past the hero text; it eases to a stop at
        // each end, as in a lull, and turns back.
        const a = BALLOON.middle + BALLOON.reach * Math.cos(time * BALLOON.rate);
        // The crown stays at about 17.9; the gulls fly below 10.7.
        b.position.set(Math.cos(a) * BALLOON.radius, 12.8 + Math.sin(time * 0.4) * 0.5, Math.sin(a) * BALLOON.radius);
        b.rotation.y = -a;
        b.rotation.z = Math.sin(time * 0.6) * 0.03;
      },
    });
    return b;
  }

  /* ---------------------------------------------------------------- */
  /* Buildings                                                         */
  /* ---------------------------------------------------------------- */
  function buildGate(shell: T.Group) {
    // One solid arch mass: piers, spandrels and entablature are a single bevelled extrusion, so no
    // light shows between the piers and the attic. Red and cream voussoirs, battered plinths.
    const W = 2.2,
      D = 1.5,
      r = 0.95,
      foot = 0.45,
      spring = 2.45,
      top = 4.2,
      b = 0.1,
      stone = palette.blonde,
      dress = palette.trim;
    // Plinth corners at (2.35, 0.9) stay inside the causeway sector (21.0 degrees, under 21.8).
    for (const sx of [-1, 1]) box(shell, sx * 1.6, foot / 2, 0, 1.5, foot, D + 0.3, palette.plinth, 'stone', { taper: 0.05 });
    const body = new T.Shape();
    body.moveTo(-W, foot);
    body.lineTo(-r, foot);
    body.lineTo(-r, spring);
    body.absarc(0, spring, r, Math.PI, 0, true);
    body.lineTo(r, foot);
    body.lineTo(W, foot);
    body.lineTo(W, top);
    body.lineTo(-W, top);
    body.closePath();
    const mass = new T.Mesh(
      new T.ExtrudeGeometry(body, { depth: D - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 16 }),
      material(stone, 'stone'),
    );
    mass.position.z = -D / 2 + b;
    mass.castShadow = mass.receiveShadow = true;
    shell.add(mass);
    // Seven chunky voussoirs, alternating dressing and red, standing 0.08 proud of each face.
    for (let i = 0; i < 7; i++) {
      const a0 = (i * Math.PI) / 7 + 0.012,
        a1 = ((i + 1) * Math.PI) / 7 - 0.012,
        ri = r - 0.03,
        ro = 1.5;
      const v = new T.Shape();
      v.moveTo(Math.cos(a0) * ri, spring + Math.sin(a0) * ri);
      v.lineTo(Math.cos(a0) * ro, spring + Math.sin(a0) * ro);
      v.lineTo(Math.cos(a1) * ro, spring + Math.sin(a1) * ro);
      v.lineTo(Math.cos(a1) * ri, spring + Math.sin(a1) * ri);
      v.closePath();
      const m = new T.Mesh(
        new T.ExtrudeGeometry(v, { depth: D + 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelOffset: -0.03, bevelSegments: 1 }),
        material(i % 2 ? palette.red : dress, 'stone'),
      );
      m.position.z = -(D + 0.16) / 2 + 0.03;
      m.castShadow = m.receiveShadow = true;
      shell.add(m);
    }
    box(shell, 0, 3.8, 0, 0.5, 0.9, D + 0.24, dress, 'stone'); // keystone into cornice
    for (const sx of [-1, 1]) {
      box(shell, sx * (r + 0.1), spring - 0.1, 0, 0.32, 0.2, D + 0.12, dress, 'stone'); // impost
      for (const sz of [-1, 1]) box(shell, sx * 1.6, 1.5, (sz * D) / 2, 0.7, 1.5, 0.12, dress, 'stone'); // pier panel, half set in
    }
    box(shell, 0, top + 0.1, 0, 2 * W + 0.3, 0.2, D + 0.3, dress, 'stone');
    box(shell, 0, top + 0.6, 0, 2 * W - 0.3, 0.8, D - 0.1, stone, 'stone', { segments: 2 });
    for (const sz of [-1, 1]) box(shell, 0, top + 0.6, sz * ((D - 0.1) / 2 + 0.03), 2.4, 0.46, 0.06, palette.bronze, 'brass'); // blank bronze plaques
    box(shell, 0, top + 1.1, 0, 2 * W - 0.1, 0.2, D + 0.1, dress, 'stone');
    box(shell, 0, top + 1.4, 0, 1.6, 0.4, 0.9, stone, 'stone');
    for (const sx of [-1, 1]) {
      cylinder(shell, sx * 1.75, top + 1.45, 0, 0.1, 0.13, 0.5, palette.bronze, 'brass');
      const glow = lampGlass();
      const bowl = new T.Mesh(new T.SphereGeometry(0.24, 14, 10), glow);
      bowl.position.set(sx * 1.75, top + 1.92, 0);
      shell.add(bowl);
      lamps.push(bowl);
    }
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
    box(shell, 0, 2.4, 0, w, 3.8, d, palette.blonde, 'stone');
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
        windowAt(face, z, 1.5, 0, 0.85, 1.15, { arched: true });
        windowAt(face, z, 3.55, 0, 0.85, 0.95, { sill: false, lintel: false });
      }
    }
    // The tower: buttresses with pyramid caps either side of the arched door, a mullioned window above.
    box(shell, 0, 4.675, tz, tw, 8.35, tw, palette.blonde, 'stone', { segments: 2 });
    for (const sx of [-1, 1]) {
      box(shell, sx * 1.2, 3.05, tz + 1.2, 0.5, 5.1, 0.5, palette.trim, 'stone');
      cone(shell, sx * 1.2, 5.8, tz + 1.2, 0.4, 0.4, palette.trim, 'stone', 4);
    }
    door(shell, 0, 0.52, tz + tw / 2, 1.3, 2.2, palette.greenDoor, { arched: true, landing: 0.25, width: 2.0 });
    windowAt(shell, 0, 4.65, tz + tw / 2, 0.8, 1.2, { arched: true, mullion: true });
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
    box(shell, 0, P + h / 2, 0, w, h, d, stone, 'stone');
    quoins(shell, w, d, P, top, dress, { front: 0.25, corners: 'front' });
    box(shell, 0, top + 0.1, 0, w + 0.3, 0.2, d + 0.3, dress, 'stone');
    // The signature bay: grounded on its own battered plinth, under a lean-to. The red bay
    // rises the full height of the wall, so the main roof's eave caps it instead.
    // 1.0 wide at x -0.6, so it clears the left quoins (x -1.11) and the door jamb.
    const bayX = -0.6,
      bayW = 1.0,
      bayTop = red ? top : 2.02;
    box(shell, bayX, P / 2, d / 2 + 0.3, bayW + 0.12, P, 0.75, base, 'stone', { taper: 0.04 }); // grounded
    box(shell, bayX, (P + bayTop) / 2, d / 2 + 0.25, bayW, bayTop - P, 0.6, stone, 'stone');
    box(shell, bayX, bayTop + 0.1, d / 2 + 0.3, bayW + 0.12, 0.2, 0.75, dress, 'stone');
    if (!red) box(shell, bayX, bayTop + 0.38, d / 2 + 0.33, bayW + 0.3, 0.16, 0.9, palette.slate, 'slate', { rx: 0.45 }); // lean-to
    windowAt(shell, bayX, 1.25, d / 2 + 0.55, 0.72, 0.95, { frame: dress, lintel: !red });
    if (red) windowAt(shell, bayX, 2.45, d / 2 + 0.55, 0.72, 0.8, { frame: dress, sill: false, lintel: false });
    // The door on the plinth's landing; its risers step down to the ground at d/2 + 0.85.
    const doorX = 0.52;
    door(shell, doorX, P, d / 2, 0.7, 1.75, doorColor, { surround: dress, landing: 0.25, width: 1.0 });
    // Sides get one window each (and a gable window under a side gable); the rear has masses only.
    for (const side of [-1, 1]) {
      const face = new T.Group();
      face.position.x = (side * w) / 2;
      face.rotation.y = (side * Math.PI) / 2;
      shell.add(face);
      windowAt(face, side * 0.6, 1.35, 0, 0.7, 0.95, { frame: dress });
      if (variant !== 'gabled-house') windowAt(face, 0, 3.8, 0, 0.5, 0.55, { frame: dress, lintel: false });
    }
    // A big slab roof and a fat chimney. The gabled house turns its ridge to face the street.
    if (variant === 'gabled-house') {
      const r = new T.Group();
      r.rotation.y = Math.PI / 2;
      shell.add(r);
      const top2 = slabRoof(r, 0, roofY, 0, d, w + 0.3, 1.6, palette.slate, { eave: 0.2, verge: 0.3, gable: stone });
      windowAt(shell, 0, 3.75, d / 2, 0.5, 0.55, { frame: dress, lintel: false });
      chimney(shell, 0, top2 - 0.8, top2 + 0.5, -(d / 2 - 0.5), stone, dress, 2);
    } else {
      const top2 = slabRoof(shell, 0, roofY, 0, w, d + 0.3, 1.8, palette.slate, { eave: 0.4, verge: 0.15, gable: stone });
      chimney(shell, seed % 2 ? -(w / 2 - 0.35) : w / 2 - 0.35, top2 - 0.9, top2 + 0.55, 0, stone, dress, 2);
    }
    // Front garden, sized to the room in front of the pavement (about 1.9 for every house in the row):
    // a flower mound before the bay, a hedge with a gap at the door, and a path from the steps.
    const fx = site.x + (Math.sin(site.rotation) * d) / 2,
      fz = site.z + (Math.cos(site.rotation) * d) / 2;
    const room = plan.distanceToStreets(fx, fz) - plan.PAVEMENT_WIDTH - 0.05;
    if (room >= 1.2) flowerBed(shell, bayX, 0, d / 2 + 0.9, 1.0, 0.4, seed * 31);
    if (room >= 1.75) hedge(shell, -0.1, 0, d / 2 + Math.min(1.4, room - 0.35), w - 0.5, 0, 0.55, { at: doorX + 0.1, width: 1.0 });
    if (room - 0.85 >= 0.2) box(shell, doorX, 0.03, d / 2 + (0.85 + room) / 2, 0.8, 0.06, room - 0.85, palette.plaza, 'paving');
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
    box(shell, ax, 2.35, 0, aw - 0.24, ah, d - 0.24, palette.studioGlass, 'glass').userData.paneSpan = true; // one gentle glint over both storeys
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
    box(shell, ax, 0.03, d / 2 + 1.2, 3.2, 0.06, 1.8, palette.pavement, 'paving'); // from the plinth foot, like the path
    bench(shell, ax - 0.85, 0.06, d / 2 + 1.85);
  }

  function buildArchive(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d;
    // Red brick walls (0.45-3.65) on a rusticated, battered plinth (the rear is seen at overview) under a pale cornice.
    plinth(shell, w, d, palette.plinth, { height: 0.45, blocks: true });
    box(shell, 0, 2.05, 0, w, 3.2, d, palette.brick, 'stone');
    box(shell, 0, 3.75, 0, w + 0.3, 0.2, d + 0.3, palette.trim, 'stone');
    // Blonde piers: fat corners, and two intermediates on the front and rear framing the hoist bay.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        box(shell, sx * 3.0, 2.05, sz * 2.3, 0.5, 3.2, 0.5, palette.brickLight, 'stone');
        box(shell, sx * 1.05, 2.05, sz * (d / 2 + 0.05), 0.45, 3.2, 0.2, palette.brickLight, 'stone');
      }
    // Arched, metal-framed windows. The rear is seen at overview, so it is a secondary front.
    const arched = { arched: true, frame: palette.metal, dress: palette.brickLight, mullion: true };
    for (const x of [-2.01, 2.01]) windowAt(shell, x, 1.75, d / 2, 0.9, 1.3, arched);
    const rear = new T.Group();
    rear.position.z = -d / 2;
    rear.rotation.y = Math.PI;
    shell.add(rear);
    for (const x of [-2.01, 0, 2.01]) windowAt(rear, x, 1.75, 0, 0.9, 1.3, arched);
    for (const side of [-1, 1]) {
      const face = new T.Group();
      face.position.x = (side * w) / 2;
      face.rotation.y = (side * Math.PI) / 2;
      shell.add(face);
      for (const z of [-0.95, 0.95]) windowAt(face, z, 1.75, 0, 0.9, 1.3, arched);
    }
    // The centre hoist bay: an arched door at dock height, a grounded dock, the hoist beam and block, crates.
    door(shell, 0, 0.45, d / 2, 1.3, 2.0, palette.greenDoor, { arched: true, surround: palette.brickLight, steps: false });
    box(shell, 0, 0.225, d / 2 + 0.6, 2.2, 0.45, 0.9, palette.plinth, 'stone');
    box(shell, 0, 3.45, d / 2 + 0.45, 0.24, 0.24, 1.0, palette.woodDark, 'wood');
    box(shell, 0, 3.18, d / 2 + 0.85, 0.2, 0.3, 0.2, palette.metal, 'iron');
    box(shell, 1.55, 0.3, d / 2 + 0.55, 0.6, 0.6, 0.6, palette.wood, 'wood');
    box(shell, 1.5, 0.84, d / 2 + 0.5, 0.48, 0.48, 0.48, '#b47a48', 'wood', { ry: 0.35 });
    // A real sawtooth: three teeth across x with their ridges along z, each glazed on its tall face.
    const Wr=w+0.3, bw=Wr/3, R=1.35, f=0.15, Dr=d+0.8, rb=0.04, y0=3.85;
    for(let i=0;i<3;i++){ const x0=-Wr/2+i*bw, s=new T.Shape(); s.moveTo(x0,0); s.lineTo(x0+bw,0); s.lineTo(x0+bw,R); s.lineTo(x0,f); s.closePath();
      const t=new T.Mesh(new T.ExtrudeGeometry(s,{depth:Dr-2*rb,bevelEnabled:true,bevelThickness:rb,bevelSize:rb,bevelOffset:-rb,bevelSegments:1}),material(palette.slate,'slate'));
      t.position.set(0,y0,-Dr/2+rb); t.castShadow=t.receiveShadow=true; shell.add(t);
      t.userData.roof = true; t.userData.eaveY = y0; // a tooth's box drops to the cornice top: the eave bake measures from there
      box(shell,x0+bw+0.035,y0+(f+R)/2+0.05,0,0.07,R-f-0.25,Dr-0.6,palette.glass,'glass'); // north light faces local +x (world +z, seen at overview)
      for(const mz of [-1,1]) box(shell,x0+bw+0.08,y0+(f+R)/2+0.05,mz*(Dr-0.6)/6,0.08,R-f-0.25,0.12,palette.metal,'iron');
      box(shell,x0+bw-0.09,y0+R+0.03,0,0.28,0.16,Dr+0.04,palette.slateLight,'slate'); }
    // A fat stack rising through the first tooth (roof at 4.41 there), with a blonde band and a metal cap.
    cylinder(shell, -2.5, 5.9, -1.8, 0.4, 0.48, 4.1, palette.brick, 'stone');
    cylinder(shell, -2.5, 7.4, -1.8, 0.47, 0.47, 0.26, palette.brickLight, 'stone');
    cylinder(shell, -2.5, 8.0, -1.8, 0.5, 0.44, 0.2, palette.metal, 'iron');
  }

  function buildCottage(g: T.Object3D, c: (typeof plan.cottages)[number], index: number) {
    const root = new T.Group();
    root.position.set(c.x, plan.terrainHeight(c.x, c.z), c.z);
    root.rotation.y = c.rotation;
    g.add(root);
    // Squat walls on a battered plinth under a steep (49 degree) slab roof, alternating slate and
    // red pantile, with a fat gable chimney. The wall is 2.0 so the door head clears the eave soffit.
    const w=2.8, d=2.4, P=0.3, h=2.0, top=P+h;
    plinth(root,w,d,palette.plinth,{height:P,proud:0.2});
    box(root,0,P+h/2,0,w,h,d,c.color,'stone');
    const pan=index%2===1, ridge=slabRoof(root,0,top,0,w,d,1.4,pan?palette.pantile:palette.slate,{eave:0.25,verge:0.25,inset:0,ridge:pan?palette.pantileLight:palette.slateLight,gable:c.color});
    door(root,0.6,P,d/2,0.75,1.5,[palette.greenDoor,palette.blueDoor,palette.redDoor][index%3],{landing:0.2,width:1.0});
    windowAt(root,-0.65,1.2,d/2,0.7,0.75,{frame:palette.trim});
    chimney(root,-(w/2-0.35),ridge-0.8,ridge+0.45,0,c.color,palette.trim,1);
    // Front garden sized to the room before the pavement: a hedge with a gap at the door, and a path from the step.
    const fx = c.x + (Math.sin(c.rotation) * d) / 2,
      fz = c.z + (Math.cos(c.rotation) * d) / 2;
    const room = plan.distanceToStreets(fx, fz) - plan.PAVEMENT_WIDTH - 0.05;
    if (room > 1.25) hedge(root, 0, 0, d / 2 + Math.min(1.0, room - 0.35), w, 0, 0.45, { at: 0.6, width: 0.9 });
    const L = Math.min(room, 1.6) - 0.5;
    if (L >= 0.2) box(root, 0.6, 0.035, d / 2 + 0.5 + L / 2, 0.7, 0.07, L, palette.plaza, 'paving');
  }

  /* ---------------------------------------------------------------- */
  /* Vehicles and people                                               */
  /* ---------------------------------------------------------------- */
  /** Glasgow Corporation tram: orange, green and cream tiers with half-round ends, an eaved roof and a trolley pole. */
  function buildTram() {
    const tram = new T.Group();
    tram.name = 'tram';
    const orange = palette.tramOrange, green = palette.tram, cream = palette.tramCream, half = 1.26;
    // Each tier is a box with a half-round cylinder at either end.
    const tier = (y: number, h: number, r: number, c: string, k: SurfaceKind) => {
      box(tram, 0, y, 0, r * 2, h, half * 2, c, k);
      for (const z of [-half, half]) cylinder(tram, 0, y, z, r, r, h, c, k, 24);
    };
    tier(0.48, 0.55, 0.54, orange, 'enamel'); // 0.205..0.755
    tier(0.8, 0.1, 0.565, green, 'enamel'); // waist band
    tier(1.09, 0.48, 0.52, cream, 'enamel'); // 0.85..1.33
    tier(1.1, 0.3, 0.535, palette.glass, 'glass'); // wrap-round windows, 0.015 proud
    tier(1.4, 0.14, 0.6, green, 'enamel'); // roof 1.33..1.47, 0.08 eave
    box(tram, 0, 1.53, 0, 0.7, 0.12, 2.0, cream, 'enamel'); // clerestory 1.47..1.59
    for (const z of [-0.84, -0.28, 0.28, 0.84]) box(tram, 0, 1.1, z, 1.1, 0.32, 0.1, cream, 'enamel'); // pillars
    for (const z of [-1.1, 1.1]) box(tram, 0, 0.13, z, 0.86, 0.22, 0.9, '#3a3f44', 'iron'); // bogie skirts replace 8 wheels
    box(tram, 0, 1.65, 0.5, 0.3, 0.12, 0.3, palette.metal, 'iron'); // pole base ON the clerestory
    box(tram, 0, 1.99, -0.085, 0.07, 0.07, 1.3, palette.metal, 'iron', { rx: 0.45 }); // trolley pole, lower end at the base
    for (const z of [-1.8, 1.8]) {
      const light = lampGlass();
      const head = new T.Mesh(new T.SphereGeometry(0.09, 12, 8), light);
      head.position.set(0, 0.5, z);
      tram.add(head);
      lamps.push(head);
    }
    return tram;
  }
  /** Harbour boat: a shaped red hull sitting in the water (waterline at local 0), a wheelhouse, funnel and a mast on its roof. */
  function buildBoat() {
    const boat = new T.Group();
    boat.name = 'harbour-boat';
    const red = palette.boat, cream = palette.tramCream, wood = palette.wood, dark = palette.woodDark;
    hullSolid(boat, 0.62, 2.0, 1.45, -0.12, 0.36, 0.06, red, 'enamel'); // -0.12..0.36, waterline at local 0
    hullSolid(boat, 0.66, 2.02, 1.47, 0.34, 0.04, 0.04, cream, 'enamel'); // gunwale 0.34..0.46, 0.02 proud
    const deck = new T.Mesh(new T.ShapeGeometry(hullShape(0.56, 1.8, 1.32), 6).rotateX(-Math.PI / 2), material(wood, 'wood'));
    deck.position.y = 0.465;
    deck.receiveShadow = true;
    boat.add(deck);
    box(boat, 0, 0.83, -0.45, 0.9, 0.74, 0.85, cream, 'enamel'); // wheelhouse 0.46..1.20
    box(boat, 0, 0.95, -0.45, 0.94, 0.26, 0.89, palette.glass, 'glass'); // wrap-round windows
    box(boat, 0, 1.26, -0.45, 1.04, 0.12, 1.0, red, 'enamel'); // roof, 0.07 eave
    cylinder(boat, 0, 1.52, -0.72, 0.13, 0.15, 0.4, cream, 'enamel', 18); // funnel
    cylinder(boat, 0, 1.66, -0.72, 0.145, 0.145, 0.1, red, 'enamel', 18); // funnel band
    cylinder(boat, 0, 1.75, -0.15, 0.055, 0.065, 0.9, dark, 'wood', 18); // mast stepped ON the roof (1.30..2.20)
    box(boat, 0, 1.98, -0.15, 0.7, 0.08, 0.08, dark, 'wood'); // yard
    box(boat, 0.18, 0.62, 0.75, 0.32, 0.3, 0.32, wood, 'wood', { ry: 0.3 }); // deck cargo
    box(boat, -0.2, 0.6, 1.05, 0.26, 0.26, 0.26, palette.gold, 'paint', { ry: -0.2 });
    for (const sx of [-1, 1])
      for (const fz of [-0.6, 0.35]) {
        const f = new T.Mesh(new T.TorusGeometry(0.09, 0.045, 6, 10), material('#3a3f44', 'paint')); // fenders
        f.position.set(sx * 0.72, 0.22, fz);
        f.rotation.y = Math.PI / 2;
        f.castShadow = true;
        boat.add(f);
      }
    const buoyRing = new T.Mesh(new T.TorusGeometry(0.14, 0.05, 8, 14), material(palette.flowers[0], 'enamel'));
    buoyRing.position.set(0.5, 0.66, -0.45);
    buoyRing.rotation.y = Math.PI / 2;
    boat.add(buoyRing);
    // Bow waves: each strip's forward end hugs the stem and its aft end trails outward, just clear of the hull.
    for (const s of [-1, 1]) box(boat, s * 0.52, 0.02, 1.5, 0.12, 0.03, 0.7, '#eaf6f2', 'paint', { ry: -s * 0.5 });
    const light = lampGlass();
    const lanternMesh = new T.Mesh(new T.SphereGeometry(0.1, 12, 8), light);
    lanternMesh.position.set(0, 2.28, -0.15); // mast lantern
    boat.add(lanternMesh);
    lamps.push(lanternMesh);
    return boat;
  }

  /* ---------------------------------------------------------------- */
  /* Highland herd                                                     */
  /* ---------------------------------------------------------------- */
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
   * The herd answers the pointer as the Corner park does (its label; a click opens Life, where
   * the Highland-cow outing lives) through an invisible box under the park's own hit box. The
   * herd stays out of the park group, so the park's selection ring still traces only the park.
   */
  function herdHit(parkHit: T.Mesh) {
    const P = plan.paddock;
    const hit = new T.Mesh(new T.BoxGeometry(P.w + 0.4, 1.6, P.d + 0.4), parkHit.material);
    hit.name = 'herd-hit';
    hit.position.set(P.x - parkHit.position.x, 0.8 - parkHit.position.y, P.z - parkHit.position.z);
    hit.userData.placeId = 'corner-park';
    parkHit.add(hit);
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

  /* ---------------------------------------------------------------- */
  /* Scottish touches                                                  */
  /* ---------------------------------------------------------------- */
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
  /**
   * A tartan picnic blanket and a hamper on the park turf, front-left of the bandstand under the
   * edge of the west tree: 0.27 clear of the bandstand plinth, 0.5 of the bench (so the bench back
   * hides no more than a corner from the Life chapter's camera) and 0.48 of the trunk.
   * The tartan is one flat colour per triangle on a 0.05 grid, the mix of a muted red, navy, green
   * and cream sett across and along it (0.5 repeat), so no texture can shimmer. It lies 0.012 over
   * the turf (top 0.10), casts no shadow and takes no contact bake.
   */
  function picnic(g: T.Object3D) {
    const spot = { x: -12.25, z: 10.08, ry: 0.12 },
      W = 1.1,
      D = 0.8,
      cell = 0.05;
    const red = new T.Color('#a94a3e'),
      navy = new T.Color('#34506e'),
      green = new T.Color('#3d6450'),
      cream = new T.Color(palette.white);
    // The sett in 0.05 cells: red 4, navy 2, red 1, green 2, cream 1.
    const sett = [red, red, red, red, navy, navy, red, green, green, cream];
    const stripe = (t: number) => sett[((Math.floor(t / cell + 1e-6) % sett.length) + sett.length) % sett.length];
    const geo = new T.PlaneGeometry(W, D, Math.round(W / cell), Math.round(D / cell)).rotateX(-Math.PI / 2).toNonIndexed();
    const p = geo.getAttribute('position'),
      out = new Float32Array(p.count * 3),
      c = new T.Color();
    for (let i = 0; i < p.count; i += 3) {
      const u = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 + W / 2,
        v = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 + D / 2;
      c.copy(stripe(u)).lerp(stripe(v), 0.5);
      for (let k = 0; k < 3; k++) c.toArray(out, (i + k) * 3);
    }
    geo.setAttribute('color', new T.BufferAttribute(out, 3));
    const rug = new T.Group();
    rug.position.set(spot.x, 0.112, spot.z);
    rug.rotation.y = spot.ry;
    g.add(rug);
    const blanket = new T.Mesh(geo, material('#ffffff', 'fabric'));
    blanket.castShadow = false;
    blanket.receiveShadow = true;
    blanket.userData.noShadow = true;
    rug.add(blanket);
    // A wicker hamper on the back corner, away from the Life chapter's camera: a pale wicker basket,
    // a slightly darker lid and an arched cane handle over it, so it reads as a basket, not a box.
    const hamper = new T.Group();
    hamper.position.set(-0.32, 0, -0.17);
    hamper.rotation.y = -0.18;
    rug.add(hamper);
    box(hamper, 0, 0.12, 0, 0.42, 0.24, 0.3, '#b08a5c', 'wood');
    box(hamper, 0, 0.265, 0, 0.45, 0.05, 0.33, '#9c7850', 'wood');
    const handle = new T.Mesh(new T.TorusGeometry(0.1, 0.016, 6, 12, Math.PI), material(palette.woodDark, 'wood'));
    handle.position.y = 0.29; // the arch stands on the lid along the basket's length
    handle.castShadow = handle.receiveShadow = true;
    hamper.add(handle);
    return rug;
  }
  /**
   * The Duke of Wellington as Glasgow knows him: a dark bronze rider on a chunky standing horse, an
   * orange traffic cone on his head, on a plain stone plinth (a base course, a battered die and a
   * cornice; no inscription) over a 12-sided paved pad. About 3.6 to the cone's tip.
   */
  function wellington(g: T.Object3D) {
    const [x, z] = plan.statueSpot,
      bronze = '#5f5a4a'; // dark, cool bronze (s 0.22) on the iron finish: half metal, so the sun still models it
    const root = new T.Group();
    root.position.set(x, 0, z);
    root.rotation.y = plan.statueHeading;
    g.add(root);
    const pad = new T.Mesh(new T.CylinderGeometry(1.6, 1.6, 0.1, 12), material(palette.plazaDark, 'paving'));
    pad.position.y = 0.05;
    pad.receiveShadow = true;
    root.add(pad);
    box(root, 0, 0.21, 0, 1.5, 0.22, 2.3, palette.plinth, 'stone'); // base course 0.10..0.32
    box(root, 0, 0.795, 0, 1.2, 0.95, 2.0, palette.blonde, 'stone', { taper: 0.05 }); // die 0.32..1.27
    box(root, 0, 1.35, 0, 1.38, 0.16, 2.18, palette.trim, 'stone'); // cornice 1.27..1.43
    const y0 = 1.43;
    // The horse, chunky and nose to the hall steps: a deep barrel on short, stout legs (the near
    // foreleg stepping forward), the neck leaning well forward and the head bowed.
    for (const sx of [-0.16, 0.16])
      for (const sz of [-0.42, 0.42]) {
        const step = sx > 0 && sz > 0 ? 0.18 : 0;
        box(root, sx, y0 + 0.28, sz + step * 0.25, 0.17, 0.56, 0.17, bronze, 'iron', { rx: -step }); // leg
      }
    box(root, 0, y0 + 0.78, 0, 0.56, 0.56, 1.3, bronze, 'iron', { bevel: 0.18 }); // barrel
    const neck = new T.Group();
    neck.position.set(0, y0 + 0.92, 0.48);
    neck.rotation.x = 0.75;
    root.add(neck);
    box(neck, 0, 0.22, 0, 0.32, 0.55, 0.34, bronze, 'iron');
    box(neck, 0, 0.24, -0.17, 0.07, 0.5, 0.07, bronze, 'iron'); // mane
    const head = new T.Group();
    head.position.set(0, y0 + 1.3, 0.82);
    head.rotation.x = 1.0;
    root.add(head);
    box(head, 0, 0.02, 0.12, 0.24, 0.26, 0.5, bronze, 'iron'); // head, nose down
    for (const s of [-1, 1]) box(head, s * 0.07, 0.16, -0.1, 0.05, 0.12, 0.05, bronze, 'iron', { rx: -0.8 }); // ear, upright on the poll
    const tail = new T.Group();
    tail.position.set(0, y0 + 0.95, -0.64);
    tail.rotation.x = -0.3;
    root.add(tail);
    box(tail, 0, -0.22, 0, 0.1, 0.45, 0.12, bronze, 'iron');
    // The rider, smaller than the horse: saddle cloth, legs down the flanks, torso, arms forward to the reins, head.
    box(root, 0, y0 + 1.07, -0.05, 0.64, 0.04, 0.5, bronze, 'iron');
    for (const s of [-1, 1]) {
      box(root, s * 0.31, y0 + 0.88, 0.04, 0.14, 0.4, 0.18, bronze, 'iron'); // leg
      box(root, s * 0.21, y0 + 1.3, 0.06, 0.1, 0.32, 0.12, bronze, 'iron', { rx: -0.6 }); // arm, hands forward to the reins
    }
    box(root, 0, y0 + 1.31, -0.05, 0.34, 0.45, 0.25, bronze, 'iron'); // torso
    sphere(root, 0, y0 + 1.67, -0.03, 0.15, bronze, 'iron');
    // The cone, knocked a little askew: a square foot, the cone and its white band.
    const hat = new T.Group();
    hat.position.set(0, y0 + 1.79, -0.03);
    hat.rotation.z = 0.15;
    root.add(hat);
    box(hat, 0, 0.015, 0, 0.28, 0.03, 0.28, palette.tramOrange, 'enamel');
    cone(hat, 0, 0.21, 0, 0.15, 0.36, palette.tramOrange, 'enamel', 12, 0);
    cylinder(hat, 0, 0.03 + 0.4 * 0.36, 0, 0.105, 0.105, 0.06, palette.white, 'enamel', 12);
    return root;
  }

  /* ---------------------------------------------------------------- */
  /* Assembly                                                          */
  /* ---------------------------------------------------------------- */
  buildTerrain();
  yield 'terrain';
  buildStreets();
  yield 'streets';
  const lampSpecs = plan.lampPlan();
  for (const spec of lampSpecs) lamp(land, spec.x, spec.z);
  const trees = plan.plantingPlan();
  // Ground shade, shallows and the town lawn, shared by every ground material (and later the sea).
  const groundMasks = buildGroundMasks(trees, lampSpecs);
  library.bakeUniforms.groundMasks.value = groundMasks;
  yield 'ground masks';
  const parkGroup = new T.Group();
  parkGroup.name = 'corner-park';
  parkGroup.userData.parkSelection = true;
  city.add(parkGroup);
  // Each tree's spin, tone and season accent come from its id, so a tree left out of the plan
  // (the one the paddock took) does not change the look of every tree planted after it.
  trees.forEach((spec) => {
    const inPark = Math.abs(spec.x - plan.park.x) < plan.park.w / 2 + 0.2 && Math.abs(spec.z - plan.park.z) < plan.park.d / 2 + 0.2;
    tree(inPark ? parkGroup : land, spec, Number(spec.id.slice(5)));
  });
  yield 'trees';
  // The corner park, a raised plot: a bevelled turf slab (top 0.10) inside stone edging that opens
  // on the ring side, a gravel strip along that side with spurs to the bandstand and to the ring's
  // inner pavement (z 13.05), then the bandstand, beds and board on the turf, benches and bin on the strip.
  {
    const P = plan.park,
      EDGE = 0.18,
      OPEN = 0.6;
    box(parkGroup, P.x, 0.05, P.z, P.w - 2 * EDGE, 0.1, P.d - 2 * EDGE, palette.grassLight, 'grass', { bevel: 0.04 });
    const edging = (x: number, z: number, w: number, d: number) => box(parkGroup, x, 0.08, z, w, 0.16, d, palette.kerb, 'stone');
    edging(P.x, P.z - P.d / 2 + EDGE / 2, P.w, EDGE);
    for (const s of [-1, 1]) {
      edging(P.x + s * (P.w / 2 - EDGE / 2), P.z, EDGE, P.d - 2 * EDGE);
      edging(P.x + s * (OPEN + P.w / 2) / 2, P.z + P.d / 2 - EDGE / 2, P.w / 2 - OPEN, EDGE);
    }
    const gravel = (g: T.Object3D, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const m = box(g, x, y, z, w, h, d, palette.path, 'gravel');
      m.userData.noShadow = true;
      return m;
    };
    gravel(parkGroup, P.x, 0.115, P.z + P.d / 2 - 0.55, P.w - 0.6, 0.03, 0.7);
    gravel(parkGroup, P.x, 0.115, P.z + 1.625, 0.8, 0.03, 0.45); // to the bandstand plinth (z 10.6 to 11.05)
    // To the ring's inner pavement: it starts under the strip, so no grass shows between them.
    gravel(land, P.x, 0.05, 12.35, 2 * OPEN, 0.1, 1.4);
    pavilion(parkGroup, bandstandAt()[0], 0.1, bandstandAt()[1]);
    memoryBoard(parkGroup, P.x + P.w / 2 - 1.0, 0.1, P.z + 1.6, -0.6);
    // At z + 2.1 the benches' back legs stay on the strip.
    bench(parkGroup, P.x - 2.6, 0.13, P.z + 2.1, Math.PI);
    bench(parkGroup, P.x + 1.4, 0.13, P.z + 2.1, Math.PI);
    flowerBed(parkGroup, P.x - 2.8, 0.1, P.z - 1.4, 1.6, 0.7, 7);
    flowerBed(parkGroup, P.x + 2.6, 0.1, P.z - 1.2, 1.4, 0.7, 19);
    bin(parkGroup, P.x + 3.3, 0.13, P.z + 2.2);
  }
  picnic(parkGroup);
  // Plaza furniture.
  phoneBox(land, plan.phoneBoxSpot[0], plan.levels.plaza, plan.phoneBoxSpot[1], -0.6);
  bin(land, 0.9, plan.levels.plaza, 4.9);
  bin(land, -4.9, plan.levels.plaza, 0.9);
  // Terrace gardens: a flower bed in each gap between the three homes, standing on the lawn (y 0).
  for (const [side, seed] of [[-0.5, 41], [0.5, 43]] as const)
    flowerBed(land, plan.terraceRow.x + 0.4, 0, plan.terraceRow.z + side * plan.terraceRow.spacing, 1.4, 0.8, seed);
  plan.cottages.forEach((c, i) => buildCottage(land, c, i));
  crane(land, plan.reservedPlot.x, plan.reservedPlot.z);
  pierAndHarbour(land);
  lighthouse(land);
  moorland(land, trees);
  plan.flock.forEach((spec, i) => blackfaceSheep(land, spec, i));
  standingStoneRing(land);
  wellington(land);
  hotAirBalloon(city);
  highlandPaddock(land);
  yield 'park, harbour and landmarks';

  const models = new Map<BuildingId, Model>();
  for (const b of buildings) {
    const site = plan.sites[b.id];
    const root = new T.Group(),
      shell = new T.Group();
    root.add(shell);
    root.position.set(site.x, 0, site.z);
    root.rotation.y = site.rotation;
    root.userData.buildingId = b.id;
    root.name = 'building-' + b.id;
    city.add(root);
    if (b.model === 'gate') buildGate(shell);
    else if (b.model === 'hall') buildHall(shell, site);
    else if (b.model === 'studio') buildStudio(shell, site);
    else if (b.model === 'archive') buildArchive(shell, site);
    else buildTerrace(shell, site, b.variant ?? 'villa', b.id === 'pengyuan-liu' ? 0 : b.id === 'yunlong-liu' ? 1 : 2);
    models.set(b.id, { root, shell, fade: [], center: new T.Vector3(site.x, 0, site.z) });
  }

  // People: seven residents on the pavements of the ring.
  const walkers: Walker[] = [];
  for (let i = 0; i < 7; i++) {
    const root = createResident(i, material);
    city.add(root);
    const inner = i % 2 === 0;
    walkers.push({
      root,
      loop: plan.walkLoop(inner ? 1.62 : -1.62),
      distance: i * 13.7 + 4,
      speed: (inner ? 0.85 : -0.85) * (0.85 + hash(i + 3) * 0.3),
    });
  }
  const tram = buildTram();
  city.add(tram);
  const boat = buildBoat();
  city.add(boat);
  yield 'buildings and vehicles';

  /* ---------------------------------------------------------------- */
  /* Static batching by surface family                                 */
  /* ---------------------------------------------------------------- */
  city.updateMatrixWorld(true);
  batch(land);
  yield 'batch land';
  batch(parkGroup);
  yield 'batch park';
  // Buildings share the library's batch materials, so one night toggle lights every window.
  for (const [id, m] of models) {
    batch(m.shell);
    yield `batch ${id}`;
  }
  for (const walker of walkers)
    for (const part of walker.root.children) {
      const joints = part.children.filter((o) => o instanceof T.Group);
      for (const joint of joints) {
        part.remove(joint);
        batch(joint as T.Group, { contact: 'none' });
      }
      batch(part as T.Group, { contact: 'none' });
      if (joints.length) part.add(...joints);
    }
  batch(tram, { contact: 'local', localFloor: 0 });
  batch(boat, { contact: 'none' });
  for (const entry of animated) if (entry.object.children.length > 1 || entry.object.children.some((c) => c instanceof T.Mesh)) batch(entry.object, { contact: 'none' });
  city.updateMatrixWorld(true);

  // Sprinkle a soft "lit window" marker for night: glass materials are shared, so one toggle lights the town.
  const parkHit = new T.Mesh(new T.BoxGeometry(plan.park.w, 2.2, plan.park.d), new T.MeshBasicMaterial({ visible: false }));
  parkHit.position.set(plan.park.x, 1.1, plan.park.z);
  parkHit.userData.placeId = 'corner-park';
  city.add(parkHit);
  herdHit(parkHit);

  return {
    city,
    land,
    models,
    walkers,
    tram,
    boat,
    lamps,
    clocks,
    animated,
    parkGroup,
    parkHit,
    waterLevel: WATER,
    groundMasks,
    materialLibrary: library,
    disposeMaterials: options.library ? () => {} : library.dispose,
  };
}
