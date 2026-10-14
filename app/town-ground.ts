import * as T from 'three';
import { GROUND_HEIGHT_RANGE } from './city-materials';
import * as plan from './town-plan';
import {
  palette,
  hash,
  noise2,
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

/* ------------------------------------------------------------------ */
/* Terrain                                                             */
/* ------------------------------------------------------------------ */
type Point = [number, number, number];

/* ------------------------------------------------------------------ */
/* Shore profile                                                       */
/* ------------------------------------------------------------------ */

/**
 * The shore by width out from the outline: a crisp darker turf lip, dry sand, wet sand, the
 * waterline, a pale shelf, the drop. The shelf colours sit under the sea's translucent turquoise
 * shallows.
 */
export const SHORE_PROFILE = [
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
/** The shore surface height at a given width out from the outline (props stand at this less 0.01). */
export function shoreHeight(width: number) {
  for (let j = 1; j < SHORE_PROFILE.length; j++)
    if (width <= SHORE_PROFILE[j].width) {
      const a = SHORE_PROFILE[j - 1],
        b = SHORE_PROFILE[j];
      return T.MathUtils.lerp(a.height, b.height, (width - a.width) / (b.width - a.width));
    }
  return SHORE_PROFILE[SHORE_PROFILE.length - 1].height;
}

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
  shoreMasks(rect, disc);
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
/** Damp, darker sand under the harbour's beach details (stamped after the blur: each is only a texel or two wide). */
function shoreMasks(rect: RectStamp, disc: DiscStamp) {
  const S = plan.shoreProps,
    at = (s: { i: number; w: number }) => plan.shoreAt(s.i, s.w);
  for (const pool of S.rockPools) disc(...at(pool), pool.r + 0.12, 0.3, 0.25);
  rect(...at(S.creelStack), 0.9, 0.55, plan.shoreTurn(S.creelStack.i), 0.4, 0.25);
  disc(...at(S.creel), 0.32, 0.35, 0.2);
  disc(...at(S.coil), 0.22, 0.25, 0.2);
  for (const post of [S.netFrame.from, S.netFrame.to]) disc(...at(post), 0.2, 0.3, 0.15);
  const [fx, fz] = at(S.driftwood.from),
    [tx, tz] = at(S.driftwood.to);
  rect((fx + tx) / 2, (fz + tz) / 2, Math.hypot(tx - fx, tz - fz), 0.2, Math.atan2(fz - tz, tx - fx), 0.35, 0.15);
}
/** The paddock's ground shade (stamped before the blur): a soft band under every dyke run, a pad under the hay rack and its bale and one under each animal. */
function paddockMasks(rect: RectStamp, disc: DiscStamp) {
  for (const [x, z, length, ry] of paddockRuns()) rect(x, z, length, plan.paddock.wall, ry, 0.5, 0.3);
  rect(plan.hayRack.x, plan.hayRack.z, 0.5, 1.0, 0, 0.6, 0.3);
  rect(plan.hayBale.x, plan.hayBale.z, 0.3, 0.44, plan.hayBale.ry, 0.5, 0.15);
  for (const animal of plan.herd) disc(animal.x, animal.z, 0.45 * animal.scale, 0.5, 0.3);
}

export function createGround(ctx: TownContext) {
  const { material, land, animated } = ctx;
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

    // The shore: one ring of SHORE_PROFILE bands at every outline sample.
    const n = plan.OUTLINE_SAMPLES;
    const shorePoint = (i: number, width: number, height: number): Point => {
      const [x, z] = plan.shoreAt(i, width);
      return [x, height, z];
    };
    const sp: number[] = [],
      sc: number[] = [],
      su: number[] = [],
      si: number[] = [];
    for (let i = 0; i < n; i++)
      for (const band of SHORE_PROFILE) {
        // The inner edge meets the lawn's outer ring, which rises where a mound reaches the coast;
        // a flat edge there leaves a crack that shows the sea under the island.
        const [ox, oz] = plan.islandOutline[i],
          p = shorePoint(i, band.width, band.width === 0 ? plan.terrainHeight(ox, oz) : band.height);
        sp.push(...p);
        const tone = 0.96 + 0.04 * Math.sin(i * 0.9 + band.width * 2.1) + 0.02 * (hash(i * 7 + band.width * 13) - 0.5);
        const c = new T.Color(band.color).multiplyScalar(tone);
        sc.push(c.r, c.g, c.b);
        su.push(band.width, 0); // the sand shader's wet band reads the exact width out from the outline
      }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < SHORE_PROFILE.length - 1; j++) {
        const a = i * SHORE_PROFILE.length + j,
          b = ((i + 1) % n) * SHORE_PROFILE.length + j;
        si.push(a, b, b + 1, a, b + 1, a + 1);
      }
    const shoreGeometry = new T.BufferGeometry();
    shoreGeometry.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
    shoreGeometry.setAttribute('color', new T.Float32BufferAttribute(sc, 3));
    shoreGeometry.setAttribute('uv', new T.Float32BufferAttribute(su, 2));
    shoreGeometry.userData.longitudinalUV = true; // batch() keeps this uv
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
  return { buildTerrain };
}
