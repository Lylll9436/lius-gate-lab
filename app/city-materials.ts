import * as T from 'three';

export type SurfaceKind =
  | 'stone'
  | 'slate'
  | 'wood'
  | 'bark'
  | 'metal'
  | 'glass'
  | 'foliage'
  | 'grass'
  | 'paving'
  | 'asphalt'
  | 'soil'
  | 'fabric'
  | 'paint'
  | 'water'
  | 'sand'
  | 'gravel';

// Physical surface families survive batching. Pigment alone is not a material.
const colours: Partial<Record<SurfaceKind, string[]>> = {
  wood: [
    '#886344',
    '#9f7a52',
    '#947650',
    '#81624c',
    '#b79a6a',
    '#9c7857',
    '#cbbb97',
    '#80654e',
    '#a99c7c',
    '#a8734e',
  ],
  slate: ['#43525b', '#33484f', '#445c63', '#647573'],
  metal: [
    '#344c4a',
    '#3d574c',
    '#43574e',
    '#486158',
    '#445f58',
    '#536963',
    '#718078',
    '#c8a96e',
    '#baa56f',
    '#adb4a0',
    '#55645a',
  ],
  glass: ['#719b9b', '#385c61', '#88aba5', '#8fafaa', '#b8d0c5', '#769b95'],
  grass: ['#aab983', '#a9b984', '#b2bb91', '#b4bd8a'],
  foliage: ['#758d5c', '#58754a', '#496f4c'],
};

export function surfaceForColour(colour: string): SurfaceKind {
  return (
    (Object.entries(colours).find(([, values]) =>
      values.includes(colour.toLowerCase()),
    )?.[0] as SurfaceKind) || 'stone'
  );
}

const fract = (n: number) => n - Math.floor(n);
const hash = (x: number, y: number) =>
  fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);

function noise(x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy);
  return T.MathUtils.lerp(
    T.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
    T.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u),
    v,
  );
}
/** Local procedural material maps, with directional grain and filtered distant detail. */
function surfaceMaps(kind: SurfaceKind) {
  const size = 128,
    pigment = new Uint8Array(size * size * 4),
    relief = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size,
        grain = hash(x, y);
      let level = 0.93 + (grain - 0.5) * 0.055,
        height = grain;
      if (kind === 'wood' || kind === 'bark') {
        const wandering =
          Math.sin(u * Math.PI * 2) * 0.1 + Math.sin(u * Math.PI * 6) * 0.018;
        const streak = Math.sin((v * 27 + wandering) * Math.PI * 2);
        const fine = Math.sin((v * 83 + wandering * 3) * Math.PI * 2);
        const knot = Math.exp(-((u - 0.43) ** 2 * 380 + (v - 0.36) ** 2 * 110));
        level =
          0.92 +
          streak * 0.035 +
          fine * 0.015 -
          knot * 0.11 +
          (grain - 0.5) * 0.02;
        height = 0.5 + streak * (kind === 'bark' ? 0.38 : 0.14) + fine * 0.09;
      } else if (kind === 'water') {
        const wave = Math.sin((v * 5 + Math.sin(u * 6.283) * 0.09) * 6.283);
        level = 0.98 + wave * 0.012;
        height = 0.5 + wave * 0.18 + Math.sin((u * 7 + v * 9) * 6.283) * 0.035;
      } else if (kind === 'grass' || kind === 'soil') {
        // Three octaves: meadow drifts, mown patches and blade-level grain.
        const patch =
          noise(u * 2.3 + 3.1, v * 2.3 + 7.7) * 0.42 +
          noise(u * 5.7 + 8.2, v * 5.7 - 2.4) * 0.3 +
          noise(u * 13.3 - 5, v * 13.3 + 9) * 0.18 +
          noise(u * 29, v * 29) * 0.1;
        level =
          (kind === 'grass' ? 0.78 : 0.83) +
          patch * (kind === 'grass' ? 0.3 : 0.22) +
          (grain - 0.5) * 0.07;
        height = 0.45 + (grain - 0.5) * 0.32;
      } else if (kind === 'sand' || kind === 'gravel') {
        const ripple = Math.sin((v * 9 + Math.sin(u * 6.283) * 0.18) * 6.283);
        level =
          0.95 +
          (grain - 0.5) * (kind === 'sand' ? 0.045 : 0.12) +
          ripple * 0.008;
        height = 0.5 + (grain - 0.5) * 0.2 + ripple * 0.08;
      } else if (kind === 'paving') {
        const row = Math.floor(v * 4),
          jointX = fract(u * 3 + (row % 2) * 0.5),
          jointY = fract(v * 4);
        const seam = jointX < 0.012 || jointY < 0.017;
        level = seam
          ? 0.72
          : 0.93 +
            (hash(Math.floor(u * 3 + (row % 2) * 0.5), row) - 0.5) * 0.075 +
            (grain - 0.5) * 0.025;
        height = seam ? 0.18 : 0.57 + grain * 0.06;
      } else if (kind === 'slate') {
        const cleft = Math.sin((v * 31 + Math.sin(u * 12.566) * 0.18) * 6.283);
        level = 0.94 + cleft * 0.018 + (grain - 0.5) * 0.025;
        height = 0.5 + cleft * 0.12 + grain * 0.12;
      } else if (kind === 'fabric') {
        level = 0.95 + ((x + y) % 2 ? 0.012 : -0.012);
        height = (x + y) % 2 ? 0.65 : 0.4;
      }
      for (let c = 0; c < 3; c++) {
        pigment[(y * size + x) * 4 + c] = Math.round(Math.min(1, level) * 255);
        relief[(y * size + x) * 4 + c] = Math.round(
          T.MathUtils.clamp(height, 0, 1) * 255,
        );
      }
      pigment[(y * size + x) * 4 + 3] = relief[(y * size + x) * 4 + 3] = 255;
    }
  const map = new T.DataTexture(pigment, size, size),
    bump = new T.DataTexture(relief, size, size);
  for (const texture of [map, bump]) {
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.magFilter = T.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    texture.name = `local-${kind}-grain`;
  }
  map.colorSpace = T.SRGBColorSpace;
  const repeat =
    kind === 'grass' || kind === 'soil'
      ? 0.085
      : kind === 'paving'
        ? 1.1
        : kind === 'wood'
          ? 1.5
          : 2;
  map.repeat.setScalar(repeat);
  bump.repeat.copy(map.repeat);
  return { map, bump };
}

export function createCityMaterials() {
  let night = 0;
  const cache = new Map<string, T.MeshStandardMaterial>();
  const maps = new Map<SurfaceKind, ReturnType<typeof surfaceMaps>>();
  function material(colour: string, kind = surfaceForColour(colour)) {
    const key = `${kind}:${colour}`;
    if (!cache.has(key)) {
      const m = new T.MeshStandardMaterial({
        color: colour,
        roughness: 0.84,
        flatShading: false,
      });
      m.name = `city-${kind}`;
      m.userData.surfaceKind = kind;
      if (kind === 'glass') {
        m.roughness = 0.16;
        m.metalness = 0.22;
        m.emissive.set('#ffd29a');
        m.emissiveIntensity = night * 0.72;
      } else if (kind === 'metal') {
        m.roughness = 0.38;
        m.metalness = 0.65;
      } else if (kind === 'paint') {
        m.roughness = 0.55;
        m.metalness = 0.06;
      } else if (kind === 'foliage') {
        m.roughness = 0.78;
        m.side = T.DoubleSide;
      } else {
        if (!maps.has(kind)) maps.set(kind, surfaceMaps(kind));
        const tx = maps.get(kind)!;
        m.map = tx.map;
        m.bumpMap = tx.bump;
        m.bumpScale =
          kind === 'bark'
            ? 0.012
            : kind === 'paving'
              ? 0.009
              : kind === 'stone'
                ? 0.003
                : 0.0018;
        m.roughness = kind === 'wood' ? 0.64 : kind === 'slate' ? 0.74 : 0.92;
        if (kind === 'water') {
          m.roughness = 0.27;
          m.metalness = 0.14;
          m.bumpScale = 0.012;
        }
      }
      cache.set(key, m);
    }
    return cache.get(key)!;
  }
  // Clones retain real maps/roughness/metalness and smooth geometric normals.
  const batches = new Map<string, T.MeshStandardMaterial>();
  function batchMaterial(source: T.MeshStandardMaterial, doubleSide: boolean) {
    const side = doubleSide ? T.DoubleSide : source.side;
    const key = [
      source.userData.surfaceKind || source.uuid,
      side,
      source.transparent,
      source.opacity,
      source.roughness,
      source.metalness,
      source.emissive.getHex(),
      source.userData.surfaceKind === 'glass' ? 0 : source.emissiveIntensity,
      source.bumpScale,
      source.map?.uuid,
      source.bumpMap?.uuid,
      source.flatShading,
    ].join(':');
    if (!batches.has(key)) {
      const m = source.clone();
      m.color.set('#ffffff');
      m.vertexColors = true;
      m.side = side;
      batches.set(key, m);
    }
    return batches.get(key)!;
  }
  function dispose() {
    for (const { map, bump } of maps.values()) {
      map.dispose();
      bump.dispose();
    }
    new Set([...cache.values(), ...batches.values()]).forEach((m) =>
      m.dispose(),
    );
  }
  function setNight(value: number) {
    night = value;
    for (const m of [...cache.values(), ...batches.values()])
      if (m.userData.surfaceKind === 'glass')
        m.emissiveIntensity = night * 0.72;
  }
  return { material, batchMaterial, dispose, setNight };
}

/** UVs use physical dimensions, not one identical stretched texture per box. */
export function projectMaterialUV(
  geometry: T.BufferGeometry,
  kind?: SurfaceKind,
) {
  const p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal'),
    uv = new Float32Array(p.count * 2);
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new T.Vector3());
  for (let i = 0; i < p.count; i++) {
    const a = Math.abs(n.getX(i)),
      b = Math.abs(n.getY(i)),
      c = Math.abs(n.getZ(i));
    let u = a > b && a > c ? p.getZ(i) : p.getX(i);
    let v = b > a && b > c ? p.getZ(i) : p.getY(i);
    if (
      (kind === 'wood' || kind === 'bark') &&
      (b > a && b > c ? size.z > size.x : size.y > Math.max(size.x, size.z))
    )
      [u, v] = [v, u];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
}
