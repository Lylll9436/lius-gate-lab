import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  GROUND_KINDS,
  projectMaterialUV,
  type SurfaceKind,
} from './city-materials';
import * as plan from './town-plan';
import type { TownContext } from './town-shared';

/* ------------------------------------------------------------------ */
/* Static batching by surface family                                   */
/* ------------------------------------------------------------------ */
/** batch() bakes contact and eave distances up to this many units (the shader's `aBake * 4.`). */
const BAKE_RANGE = 4;

/*
 * Night windows. Every glass pane carries its own light in `aWindow` (four normalised bytes, the
 * same on each of its vertices): r its level tonight (0 dark, 0.45 dim, 0.7 cool, 1 full), g its
 * tint (0 warm, 128 exactly today's glow, 255 cool), b the night clock's `out` at which it goes
 * dark and a the `wake` at which it comes on in the morning (255 = never). The glass shader
 * reads them against the window clock (city-materials' setWindows).
 */
type WindowRole = 'home' | 'civic' | 'studio' | 'kiosk' | 'beacon' | 'dial' | 'vehicle' | 'unlit';
type Mix = { lit: number; dim: number; cool: number; goes: number; span: [number, number]; risers: number };
/**
 * Evening share lit (of which dim and cool), share that goes out and over which stretch of `out`, early risers.
 * Cool stays an accent (about one lit room in ten, besides the phone box): the pale cool white reads as a flat grey
 * card beside the warm panes, so a whole ribbon or a row of arches in it looks like a blank board.
 */
const WINDOW_MIX: Partial<Record<WindowRole, Mix>> = {
  home: { lit: 0.55, dim: 0.25, cool: 0.1, goes: 0.5, span: [0.03, 0.97], risers: 0.25 }, // 22:08-02:22
  civic: { lit: 0.4, dim: 0.25, cool: 0.1, goes: 0.75, span: [0.02, 0.45], risers: 0 }, // cleaners, 22:05-00:02
  studio: { lit: 0.85, dim: 0, cool: 0.1, goes: 0.5, span: [0.6, 0.98], risers: 0 }, // 00:42-02:25
};
/** [level, tint, off, wake] for panes that never change (1 = never). */
const WINDOW_FIXED: Partial<Record<WindowRole, number[]>> = {
  kiosk: [0.8, 1, 1, 1],
  beacon: [1, 0, 1, 1],
  dial: [1, 0.5, 1, 1],
  vehicle: [0.85, 0.25, 1, 1],
  unlit: [0, 0, 1, 1],
};
type WindowPane = { role: WindowRole; place: string; at: T.Vector3; light: number[] };
type Claimed = { off: Set<number>; wake: Set<number> };
const byte = (v: number) => Math.round(v * 255);
/** Five uniform draws from a pane's world centre (to the centimetre): the same pane gets the same light on every build. */
function paneDraws(p: T.Vector3) {
  let h = Math.imul(Math.round(p.x * 100), 0x27d4eb2d) ^ Math.imul(Math.round(p.y * 100), 0x165667b1) ^ Math.imul(Math.round(p.z * 100), 0x9e3779b1);
  return Array.from({ length: 5 }, () => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  });
}
/** The free byte nearest lo + (hi - lo) * u in [lo, hi], searching up and wrapping to lo: no two panes switch together. */
function claim(set: Set<number>, lo: number, hi: number, u: number) {
  if (!(lo < hi)) throw new Error(`Empty window span ${lo}..${hi}`);
  for (let i = 0, b = lo + Math.round((hi - lo) * u); i <= hi - lo; i++, b = b >= hi ? lo : b + 1)
    if (!set.has(b)) {
      set.add(b);
      return b;
    }
  throw new Error(`No free window byte in ${lo}..${hi}`);
}
/**
 * A pane's four aWindow bytes. `windowLit` panes are lit at today's colour (at full level, or at
 * the level `windowLit` gives as a number) and go out no earlier than 01:22. Only a pane that is
 * dark by morning can be an early riser, so every riser comes on from dark rather than brightening
 * a lamp left on all night.
 */
function windowLight(o: T.Object3D, role: WindowRole, at: T.Vector3, claimed: Claimed) {
  const fixed = WINDOW_FIXED[role];
  if (fixed) return fixed.map(byte);
  const m = WINDOW_MIX[role]!,
    [u0, u1, u2, u3, u4] = paneDraws(at),
    forced = !!o.userData.windowLit,
    forcedLevel = typeof o.userData.windowLit === 'number' ? o.userData.windowLit : 1;
  const lit = forced || u0 < m.lit,
    dim = !forced && u1 < m.dim,
    cool = !forced && !dim && u1 < m.dim + m.cool;
  const level = !lit ? 0 : forced ? forcedLevel : dim ? 0.45 : cool ? 0.7 : 1;
  const tint = forced ? 0.5 : !lit || dim ? 0 : cool ? 1 : u2 < 0.7 ? 0 : 0.5; // dark panes get 0: risers are warm
  const lo = forced ? Math.max(m.span[0], 0.75) : m.span[0],
    hi = forced ? Math.min(0.98, Math.max(m.span[1], lo + 0.2)) : m.span[1];
  const off = lit && u3 < m.goes ? claim(claimed.off, byte(lo), byte(hi), u3 / m.goes) : 255;
  return [byte(level), byte(tint), off, u4 < m.risers && (!lit || off < 255) ? claim(claimed.wake, 10, 245, u4 / m.risers) : 255];
}

export function createBatch(ctx: TownContext) {
  const { library, lamps } = ctx;
  // Per build, like ctx: the off and wake bytes already taken, every lit place's pane list, and
  // each window group's one light.
  const claimed: Claimed = { off: new Set(), wake: new Set() },
    windows: WindowPane[] = [],
    groupLight = new Map<string, number[]>();
  /**
   * Pane coordinates for the glass glint, in units from the pane's middle: x across the face
   * (to the right seen from outside, so every pane leans the same way on screen), y up. The
   * middle is the whole opening's, so an arched pane's band runs over the arch too.
   * A curtain wall (`paneSpan`) is one sheet several units tall, and measured in units its whole
   * upper storey would sit in the shader's clamped top lean (a pale strip). Its height maps
   * instead onto one gentle sweep, -0.6 at the foot to 0.2 at the head. A `flatGlass` face (the
   * clock dials) keeps one lean all over, so it reads as an even face under the glass.
   */
  function paneUV(geometry: T.BufferGeometry, bounds: T.Box3, look: { flatGlass?: boolean; paneSpan?: boolean }) {
    const p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal'),
      mid = bounds.getCenter(new T.Vector3()),
      tall = Math.max(1e-3, bounds.max.y - bounds.min.y),
      uv = new Float32Array(p.count * 2);
    if (!look.flatGlass)
      for (let i = 0; i < p.count; i++) {
        // Across = up x normal; a face looking straight up or down has no across.
        const ax = n.getZ(i), az = -n.getX(i), len = Math.hypot(ax, az);
        uv[i * 2] = len > 0.1 ? ((p.getX(i) - mid.x) * ax + (p.getZ(i) - mid.z) * az) / len : 0;
        uv[i * 2 + 1] = look.paneSpan ? -0.6 + (0.8 * (p.getY(i) - bounds.min.y)) / tall : p.getY(i) - mid.y;
      }
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
  }
  /**
   * `windows` is the role of g's glass where a pane has no `userData.window` of its own (home by
   * default), `place` the name its panes are listed under (g's name by default).
   */
  function batch(g: T.Object3D, opts: { contact?: 'terrain' | 'local' | 'none'; localFloor?: number; windows?: WindowRole; place?: string } = {}) {
    const mode = opts.contact ?? 'terrain',
      localFloor = opts.localFloor ?? 0;
    g.updateMatrixWorld(true);
    const inv = g.matrixWorld.clone().invert(),
      groups = new Map<string, { mat: T.Material; cast: boolean; list: T.BufferGeometry[] }>(),
      old: T.Mesh[] = [];
    const kindOf = (o: T.Mesh) => (o.material as T.Material).userData?.surfaceKind as SurfaceKind;
    // Pass 1: overhangs in g space (roofs and flat solid slabs, never foliage, ground or a `band`
    // course such as a bay's sill or string course), in a 4-unit grid. A `bayCap` (a bay's own
    // cornice or roof) darkens only meshes tagged `bay`, so the main wall behind keeps its bake.
    type Cap = { id: number; box: T.Box3; top: number; bay: boolean };
    const caps = new Map<number, Cap[]>();
    const cellOf = (x: number, z: number) => (Math.floor(x / 4) + 512) * 1024 + Math.floor(z / 4) + 512;
    if (mode !== 'none')
      g.traverse((o) => {
        if (!(o instanceof T.Mesh) || lamps.includes(o)) return;
        const k = kindOf(o);
        if (GROUND_KINDS.has(k) || k === 'foliage' || o.userData.ground || o.userData.band) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const toG = inv.clone().multiply(o.matrixWorld),
          box = o.geometry.boundingBox!.clone().applyMatrix4(toG),
          s = box.getSize(new T.Vector3());
        if (!o.userData.roof && !(s.y <= 0.3 && s.y >= 0.03 && Math.min(s.x, s.z) >= 0.5)) return;
        // A sloped roof's box drops below the wall plate, so roofs say where their eave is.
        const top =
          o.userData.eaveY !== undefined
            ? new T.Vector3(0, o.userData.eaveY, 0).applyMatrix4(inv.clone().multiply(o.parent!.matrixWorld)).y
            : box.min.y;
        const cap = { id: o.id, box, top, bay: !!o.userData.bayCap };
        for (let cx = Math.floor(box.min.x / 4); cx <= Math.floor(box.max.x / 4); cx++)
          for (let cz = Math.floor(box.min.z / 4); cz <= Math.floor(box.max.z / 4); cz++) {
            const key = (cx + 512) * 1024 + cz + 512;
            const list = caps.get(key);
            if (list) list.push(cap);
            else caps.set(key, [cap]);
          }
      });
    const world = new T.Vector3();
    g.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      if (lamps.includes(o)) return;
      let keep: T.Object3D | null = o;
      while (keep && keep !== g) {
        if (keep.userData.keepSeparate) return;
        keep = keep.parent;
      }
      const source = o.material as T.MeshStandardMaterial;
      if (!(source instanceof T.MeshStandardMaterial)) return;
      const mat = library.batchMaterial(source, source.side === T.DoubleSide);
      const geometry = o.geometry.clone();
      if (!geometry.userData.longitudinalUV) {
        const local = geometry.clone().scale(o.scale.x, o.scale.y, o.scale.z);
        projectMaterialUV(local, source.userData.surfaceKind);
        geometry.setAttribute('uv', local.getAttribute('uv').clone());
        local.dispose();
      }
      geometry.applyMatrix4(inv.clone().multiply(o.matrixWorld));
      // Cast by size: glass volumes cast, flowers, trims and thin panes do not, water never does.
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox!,
        size = bb.getSize(new T.Vector3());
      const k = source.userData.surfaceKind as SurfaceKind;
      const cast = Math.max(size.x, size.y, size.z) >= 0.3 && k !== 'water'
        && !(k === 'glass' && Math.min(size.x, size.y, size.z) < 0.3) && !o.userData.noShadow;
      const key = mat.uuid + (cast ? '|c' : '|n');
      if (source.userData.surfaceKind === 'grass') projectMaterialUV(geometry, 'grass');
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      if (k === 'glass') {
        paneUV(geometry, bb, o.userData);
        if (o.userData.sashPane) {
          // A sash pane (0.2-0.4 tall) reads its glint as a 0.95-tall window would: the shared
          // glint constants stay, the pane's coordinates stretch to about +-0.475.
          const uv = geometry.getAttribute('uv') as T.BufferAttribute,
            stretch = 0.95 / Math.max(1e-3, size.y);
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * stretch, uv.getY(i) * stretch);
        }
      }
      const count = geometry.getAttribute('position').count,
        previous = geometry.getAttribute('color'),
        positions = geometry.getAttribute('position'),
        normals = geometry.getAttribute('normal'),
        meshNormals = o.geometry.getAttribute('normal');
      // Solids get the bake; ground surfaces and wafer-thin decals keep their own shading.
      const solid = !GROUND_KINDS.has(k) && !o.userData.ground && size.y >= 0.03,
        rounded = o.geometry instanceof RoundedBoxGeometry,
        span = Math.max(1e-3, size.y);
      const colors = new Float32Array(count * 3),
        bake = new Uint8Array(count * 2);
      for (let i = 0; i < count; i++) {
        let h = BAKE_RANGE,
          eave = BAKE_RANGE,
          shade = 1,
          warm = 0;
        if (solid) {
          const px = positions.getX(i),
            py = positions.getY(i),
            pz = positions.getZ(i),
            nx = normals.getX(i),
            ny = normals.getY(i),
            nz = normals.getZ(i);
          // Contact: height above the ground; eave: depth below the nearest overhang.
          if (mode !== 'none' && ny < 0.6) {
            if (mode === 'local') h = py - localFloor;
            else {
              world.set(px, py, pz).applyMatrix4(g.matrixWorld);
              h = world.y - plan.terrainHeight(world.x, world.z);
            }
            if (Math.abs(ny) < 0.6) {
              const qx = px + nx * 0.08,
                qz = pz + nz * 0.08;
              for (const c of caps.get(cellOf(qx, qz)) ?? [])
                if (c.id !== o.id && (!c.bay || o.userData.bay) && c.top > py - 0.06 && qx >= c.box.min.x && qx <= c.box.max.x && qz >= c.box.min.z && qz <= c.box.max.z)
                  eave = Math.min(eave, Math.max(0, c.top - py));
            }
          }
          // Bright tops, bevels that catch the light (mesh-local normals), glass that brightens upwards.
          if (ny > 0.6) shade *= 1.04;
          if (rounded) {
            const e = 1 - Math.max(Math.abs(meshNormals.getX(i)), Math.abs(meshNormals.getY(i)), Math.abs(meshNormals.getZ(i)));
            if (ny < -0.2) shade *= 1 - 0.35 * e;
            else {
              const lift = 0.35 * e * T.MathUtils.clamp(ny * 0.8 + 0.4, 0, 1);
              shade *= 1 + lift;
              warm = lift * 0.3;
            }
          }
          if (k === 'glass' && !o.userData.flatGlass) shade *= T.MathUtils.lerp(0.7, 1.15, (py - bb.min.y) / span);
        }
        bake[i * 2] = Math.round(T.MathUtils.clamp(h / BAKE_RANGE, 0, 1) * 255);
        bake[i * 2 + 1] = Math.round(T.MathUtils.clamp(eave / BAKE_RANGE, 0, 1) * 255);
        colors[i * 3] = source.color.r * (previous ? previous.getX(i) : 1) * shade * (1 + warm);
        colors[i * 3 + 1] = source.color.g * (previous ? previous.getY(i) : 1) * shade;
        colors[i * 3 + 2] = source.color.b * (previous ? previous.getZ(i) : 1) * shade * (1 - 0.6 * warm);
      }
      geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
      geometry.setAttribute('aBake', new T.BufferAttribute(bake, 2, true));
      if (k === 'glass') {
        // A window group (a bay storey's sash panes) is one light: its first pane draws and claims, the rest reuse it.
        const group: string | undefined = o.userData.windowGroup;
        let light = group ? groupLight.get(group) : undefined;
        if (!light) {
          const at = o.getWorldPosition(new T.Vector3()),
            role: WindowRole = o.userData.window ?? opts.windows ?? 'home';
          light = windowLight(o, role, at, claimed);
          if (group) groupLight.set(group, light);
          windows.push({ role, place: opts.place ?? g.name, at, light: light.map((v) => v / 255) });
        }
        const bytes = light;
        geometry.setAttribute('aWindow', new T.BufferAttribute(new Uint8Array(count * 4).map((_, i) => bytes[i % 4]), 4, true));
      }
      if (!groups.has(key)) groups.set(key, { mat, cast, list: [] });
      groups.get(key)!.list.push(geometry);
      old.push(o);
    });
    old.forEach((o) => o.removeFromParent());
    for (const { mat, cast, list: geometries } of groups.values()) {
      const normalized = geometries.map((geo) => {
        const plain = geo.index ? geo.toNonIndexed() : geo;
        for (const name of Object.keys(plain.attributes))
          if (!['position', 'normal', 'color', 'uv', 'aBake', 'aWindow'].includes(name)) plain.deleteAttribute(name);
        if (!plain.getAttribute('normal')) plain.computeVertexNormals();
        return plain;
      });
      const merged = mergeGeometries(normalized, false);
      if (merged) {
        const mesh = new T.Mesh(merged, mat);
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        g.add(mesh);
      }
      const disposed = new Set<T.BufferGeometry>();
      for (const geo of [...geometries, ...normalized])
        if (!disposed.has(geo)) {
          geo.dispose();
          disposed.add(geo);
        }
    }
  }
  return { paneUV, batch, windows };
}
