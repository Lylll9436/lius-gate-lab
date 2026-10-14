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

export function createBatch(ctx: TownContext) {
  const { library, lamps } = ctx;
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
  function batch(g: T.Object3D, opts: { contact?: 'terrain' | 'local' | 'none'; localFloor?: number } = {}) {
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
      if (!groups.has(key)) groups.set(key, { mat, cast, list: [] });
      groups.get(key)!.list.push(geometry);
      old.push(o);
    });
    old.forEach((o) => o.removeFromParent());
    for (const { mat, cast, list: geometries } of groups.values()) {
      const normalized = geometries.map((geo) => {
        const plain = geo.index ? geo.toNonIndexed() : geo;
        for (const name of Object.keys(plain.attributes))
          if (!['position', 'normal', 'color', 'uv', 'aBake'].includes(name)) plain.deleteAttribute(name);
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
  return { paneUV, batch };
}
