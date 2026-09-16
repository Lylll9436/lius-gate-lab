import * as T from 'three';
import { groundHeightAt, baseGroundHeightAt } from './city-ground';
import { treePits, shrubBeds, rockGardens, hash } from './city-planting-plan';
import type { createCraft, BoxMaker } from './city-craft';
import type { SurfaceKind } from './city-materials';

/** Permanent planting works live outside the replaceable tree LOD roots. */
export function addPlantingWorks(
  land: T.Group,
  box: BoxMaker,
  material: (c: string, k?: SurfaceKind) => T.MeshStandardMaterial,
  craft: ReturnType<typeof createCraft>,
) {
  for (const pit of treePits) {
    const top = baseGroundHeightAt(pit.x, pit.z),
      soil = groundHeightAt(pit.x, pit.z),
      rim = Math.max(top, soil);
    const group = new T.Group();
    group.name = pit.id;
    land.add(group);
    box(
      group,
      pit.x,
      soil - 0.004,
      pit.z,
      pit.w,
      0.008,
      pit.d,
      '#6b6950',
      'soil',
    ).userData.plantingSoil = pit.id;
    // Four flush edging courses; the centre really is open soil, not a slab under a tree.
    for (const side of [-1, 1]) {
      box(
        group,
        pit.x + side * (pit.w / 2 - 0.013),
        rim - 0.012,
        pit.z,
        0.026,
        0.024,
        pit.d,
        '#b5b39c',
        'stone',
      );
      box(
        group,
        pit.x,
        rim - 0.012,
        pit.z + side * (pit.d / 2 - 0.013),
        pit.w - 0.052,
        0.024,
        0.026,
        '#b5b39c',
        'stone',
      );
    }
  }
  const foliage = material('#ffffff', 'foliage').clone();
  foliage.vertexColors = true;
  foliage.side = T.DoubleSide;
  for (const [bedIndex, bed] of shrubBeds.entries()) {
    const g = new T.Group();
    g.name = bed.id;
    g.position.set(bed.x, 0, bed.z);
    g.userData.collider = { id: bed.id, kind: 'planting' };
    land.add(g);
    const vertices: number[] = [],
      colors: number[] = [];
    const triangle = (
      a: T.Vector3,
      b: T.Vector3,
      c: T.Vector3,
      color: T.Color,
    ) => {
      vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
    };
    const count = Math.max(1, Math.round(bed.w * bed.d * 3));
    for (let i = 0; i < count; i++) {
      const seed = bedIndex * 997 + i * 41,
        x = (hash(seed + 1) - 0.5) * Math.max(0.05, bed.w - 0.45),
        z = (hash(seed + 2) - 0.5) * Math.max(0.05, bed.d - 0.45),
        h = 0.22 + hash(seed + 3) * 0.2;
      const base = groundHeightAt(bed.x + x, bed.z + z);
      for (let j = 0; j < 5; j++) {
        const angle = j * 2.4 + hash(seed + 4) * 6,
          tip = new T.Vector3(
            x + Math.cos(angle) * 0.13,
            base + h * (0.65 + hash(seed + j + 11) * 0.35),
            z + Math.sin(angle) * 0.13,
          );
        craft.branch(
          g,
          [x, base - 0.01, z],
          tip.toArray() as [number, number, number],
          0.008,
          0.002,
          '#6b6650',
        );
        for (let k = 0; k < 9; k++) {
          const n = seed + j * 17 + k,
            a = angle + k * 2.4,
            center = tip
              .clone()
              .add(
                new T.Vector3(
                  Math.cos(a) * hash(n + 31) * 0.13,
                  -hash(n + 39) * 0.1,
                  Math.sin(a) * hash(n + 47) * 0.13,
                ),
              );
          const len = 0.055 + hash(n + 57) * 0.035,
            along = new T.Vector3(Math.cos(a) * len, 0.035, Math.sin(a) * len),
            across = new T.Vector3(
              -Math.sin(a) * len * 0.42,
              0,
              Math.cos(a) * len * 0.42,
            );
          const root = center.clone().sub(along),
            end = center.clone().add(along),
            left = center.clone().add(across),
            right = center.clone().sub(across),
            ridge = center.clone().add(new T.Vector3(0, 0.018, 0));
          const tint = new T.Color(
            ['#527449', '#6f8951', '#879853', '#41664b'][
              Math.floor(hash(n + 71) * 4)
            ],
          );
          triangle(root, left, ridge, tint);
          triangle(left, end, ridge, tint);
          triangle(end, right, ridge, tint);
          triangle(right, root, ridge, tint);
        }
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const leaves = new T.Mesh(geometry, foliage);
    leaves.userData.softFoliage = true;
    leaves.userData.craft = 'curved-shrub-leaves';
    leaves.castShadow = leaves.receiveShadow = true;
    g.add(leaves);
    g.userData.grounded = true;
    g.userData.grounding = { maxEmbed: 0.019 };
  }
  for (const [index, [x, z]] of rockGardens.entries()) {
    const g = new T.Group();
    g.name = 'rock-garden-' + index;
    g.position.set(x, 0, z);
    g.userData.collider = { id: g.name, kind: 'rock' };
    g.userData.grounded = true;
    g.userData.grounding = { maxEmbed: 0.06 };
    land.add(g);
    for (let i = 0; i < 3; i++) {
      const seed = index * 47 + i * 19,
        dx = (hash(seed + 1) - 0.5) * 0.7,
        dz = (hash(seed + 2) - 0.5) * 0.6,
        r = 0.12 + hash(seed + 3) * 0.17;
      const geo = new T.IcosahedronGeometry(1, 1),
        p = geo.getAttribute('position');
      for (let n = 0; n < p.count; n++) {
        const factor =
          0.92 +
          0.08 *
            Math.sin(p.getX(n) * 13 + p.getY(n) * 7 + p.getZ(n) * 11 + seed);
        p.setXYZ(n, p.getX(n) * factor, p.getY(n) * factor, p.getZ(n) * factor);
      }
      geo.computeVertexNormals();
      const stone = new T.Mesh(
        geo,
        material(i === 0 ? '#94968a' : '#adb09a', 'stone'),
      );
      stone.scale.set(r * 1.15, r * 0.58, r * 0.9);
      stone.rotation.y = hash(seed + 7) * Math.PI;
      stone.position.set(dx, groundHeightAt(x + dx, z + dz) + r * 0.4, dz);
      stone.castShadow = stone.receiveShadow = true;
      g.add(stone);
    }
  }
}
