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

/** Ground surfaces: never contact-darkened, never overhangs; their shading comes from the ground itself. */
export const GROUND_KINDS = new Set<SurfaceKind>(['grass', 'paving', 'asphalt', 'sand', 'soil', 'gravel', 'water']);

/**
 * Contact and eave darkening, shaped per fragment from the two linear distances batch() bakes
 * into aBake (height above the ground, depth below an overhang; 0..1 over 4 units).
 * Linear values interpolate exactly across a face, so the bands stay crisp at any tessellation.
 */
function bakeShader(m: T.MeshStandardMaterial) {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aBake;\nvarying vec2 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = aBake * 4.;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBake;')
      .replace('#include <color_fragment>', `#include <color_fragment>
   float contact = mix(.55, 1., smoothstep(0., .7, vBake.x)) * mix(.82, 1., smoothstep(0., .08, vBake.x)); // guide's 0.45 foot band
   diffuseColor.rgb *= contact * mix(.7, 1., smoothstep(0., .45, vBake.y));`);
  };
  m.customProgramCacheKey = () => 'lius-bake-solid';
}

/** The ground masks' A channel stores terrain height over this range (units). */
export const GROUND_HEIGHT_RANGE = 2;
/** Ground surfaces that read the baked ground masks (water reads them in city-water). */
const MASKED_GROUND = new Set<SurfaceKind>(['grass', 'soil', 'paving', 'asphalt', 'sand', 'gravel']);
type BakeUniforms = { groundMasks: { value: T.Texture }; maskExtent: { value: number } };
/**
 * Ground shade from the baked mask grid, sampled by world XZ: R darkens footprint pads,
 * canopy discs, lamp feet and the grass lip by the pavements (tinted, never grey), B is the
 * mown town lawn that carries a soft 1.5-unit checker, A the terrain height (so only
 * surfaces lying on the ground are shaded, not roof lawns or raised floors).
 * Paving gets offset flags whose joints fade out once a flag is too small on screen.
 */
function groundShader(m: T.MeshStandardMaterial, kind: SurfaceKind, uniforms: BakeUniforms) {
  const tint = kind === 'grass' || kind === 'soil' ? 'vec3(.52, .60, .40)' : 'vec3(.62, .58, .50)';
  const lawn = `vec2 q=vGroundP.xz/1.5;vec2 tri=abs(fract(q*.5)*2.-1.);vec2 fw=fwidth(q)+1e-4;vec2 e=smoothstep(.5-fw,.5+fw,tri);float ch=e.x+e.y-2.*e.x*e.y;
diffuseColor.rgb*=mix(vec3(.93,.95,.90),mix(vec3(.965),vec3(1.035),ch),gs.b);`;
  const flags = `vec2 tq=vGroundP.xz/.9;tq.x+=.5*step(1.,mod(floor(tq.y),2.));float th=fract(sin(dot(floor(tq),vec2(127.1,311.7)))*43758.5453);vec2 f=fract(tq);vec2 fj=fwidth(tq);float jn=1.-smoothstep(0.,.06+fj.x,min(min(f.x,1.-f.x),min(f.y,1.-f.y)));float jnear=1.-smoothstep(.03,.06,max(fj.x,fj.y));
diffuseColor.rgb*=(.96+.08*th)*(1.-.18*jn*jnear);`;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.groundMasks = uniforms.groundMasks;
    shader.uniforms.maskExtent = uniforms.maskExtent;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundP = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundP;\nuniform sampler2D groundMasks;\nuniform float maskExtent;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
vec4 gs=texture2D(groundMasks,vGroundP.xz/(2.*maskExtent)+.5);
float nearGround=1.-smoothstep(.2,.5,vGroundP.y-gs.a*${GROUND_HEIGHT_RANGE.toFixed(1)});
${kind === 'grass' ? lawn : kind === 'paving' ? flags : ''}
diffuseColor.rgb*=mix(vec3(1.),${tint},gs.r*nearGround);
}`);
  };
  m.customProgramCacheKey = () => 'lius-ground-' + kind;
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
        // Broad drifts only: blade-level grain reads as pixels in a soft render.
        const patch =
          noise(u * 2.3 + 3.1, v * 2.3 + 7.7) * 0.5 +
          noise(u * 5.7 + 8.2, v * 5.7 - 2.4) * 0.34 +
          noise(u * 13.3 - 5, v * 13.3 + 9) * 0.16;
        // Grass drifts stay within about 5% (linear 0.90-1.0); the ground shader does the rest.
        level = kind === 'grass' ? 0.955 + patch * 0.045 : 0.86 + patch * 0.14;
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
  // The ground masks are baked by buildTown; until then a black texel leaves the ground untouched.
  const blank = new T.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  blank.needsUpdate = true;
  const bakeUniforms: BakeUniforms = { groundMasks: { value: blank }, maskExtent: { value: 44 } };
  /**
   * A studio render, not a texture atlas: clean matte clay for masonry, satin paint,
   * soft plastic foliage, satin glass. The room environment does the shading;
   * only meadows keep a broad colour drift.
   */
  const finish: Partial<Record<SurfaceKind, { roughness: number; metalness?: number }>> = {
    stone: { roughness: 0.9 },
    slate: { roughness: 0.85 },
    wood: { roughness: 0.88 },
    bark: { roughness: 0.95 },
    metal: { roughness: 0.55, metalness: 0.3 },
    glass: { roughness: 0.22, metalness: 0 },
    foliage: { roughness: 0.9 },
    grass: { roughness: 0.95 },
    paving: { roughness: 0.92 },
    asphalt: { roughness: 0.93 },
    soil: { roughness: 0.95 },
    fabric: { roughness: 0.9 },
    paint: { roughness: 0.7 },
    water: { roughness: 0.3 },
    sand: { roughness: 0.95 },
    gravel: { roughness: 0.95 },
  };
  function material(colour: string, kind: SurfaceKind = 'stone') {
    const key = `${kind}:${colour}`;
    if (!cache.has(key)) {
      const look = finish[kind] ?? { roughness: 0.7 };
      const m = new T.MeshStandardMaterial({
        color: colour,
        roughness: look.roughness,
        metalness: look.metalness ?? 0,
        flatShading: false,
      });
      m.name = `city-${kind}`;
      m.userData.surfaceKind = kind;
      if (kind === 'glass') {
        m.emissive.set('#ffd29a');
        m.emissiveIntensity = night * 0.72;
      } else if (kind === 'grass' || kind === 'soil') {
        if (!maps.has(kind)) maps.set(kind, surfaceMaps(kind));
        m.map = maps.get(kind)!.map;
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
      const kind = source.userData.surfaceKind as SurfaceKind;
      if (MASKED_GROUND.has(kind)) groundShader(m, kind, bakeUniforms);
      else if (!GROUND_KINDS.has(kind)) bakeShader(m);
      batches.set(key, m);
    }
    return batches.get(key)!;
  }
  function dispose() {
    bakeUniforms.groundMasks.value.dispose();
    blank.dispose();
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
  return { material, batchMaterial, dispose, setNight, bakeUniforms };
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
