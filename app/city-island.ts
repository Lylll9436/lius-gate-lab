import * as T from 'three';
import { shoreProfile, shorePoint } from './city-shore';
import { islandOutline } from './island-footprint';
import type { SurfaceKind } from './city-materials';
export function addIsland(
  land: T.Group,
  material: (color: string, kind?: SurfaceKind) => T.MeshStandardMaterial,
) {
  const shape = new T.Shape();
  islandOutline.forEach(([x, z], i) =>
    i ? shape.lineTo(x, -z) : shape.moveTo(x, -z),
  );
  shape.closePath();
  const top = new T.Mesh(
    new T.ShapeGeometry(shape),
    material('#97ad82', 'grass'),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.1;
  top.receiveShadow = true;
  top.name = 'organic-island-ground';
  land.add(top);
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < islandOutline.length; i++)
    for (const band of shoreProfile) {
      const p = shorePoint(i, band.width, band.height);
      positions.push(...p);
      const c = new T.Color(band.color).multiplyScalar(
        0.98 + 0.02 * Math.sin(p[0] * 0.7 + p[2] * 0.9),
      );
      colors.push(c.r, c.g, c.b);
    }
  for (let i = 0; i < islandOutline.length; i++)
    for (let j = 0; j < shoreProfile.length - 1; j++) {
      const a = i * shoreProfile.length + j,
        b = ((i + 1) % islandOutline.length) * shoreProfile.length + j;
      indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = material('#ffffff', 'sand').clone();
  mat.vertexColors = true;
  const beach = new T.Mesh(geo, mat);
  beach.receiveShadow = true;
  beach.name = 'sloping-natural-shore';
  land.add(beach);
  for (let i = 0; i < islandOutline.length; i++) {
    if (
      Math.sin(i * 127.1) * 43758.5 -
        Math.floor(Math.sin(i * 127.1) * 43758.5) >
      0.22
    )
      continue;
    const p = shorePoint(i, 0.45 + 0.45 * (1 + Math.sin(i * 8.3)), 0.076),
      r = 0.09 + 0.075 * (0.5 + 0.5 * Math.sin(i * 17.1));
    const stone = new T.Mesh(
      new T.DodecahedronGeometry(r, 0),
      material(i % 2 ? '#8c9789' : '#aaa991', 'stone'),
    );
    stone.position.set(...(p as [number, number, number]));
    stone.scale.set(1.7, 0.55, 1.05);
    stone.rotation.set(i * 0.71, i * 0.93, 0);
    stone.castShadow = stone.receiveShadow = true;
    land.add(stone);
  }
}
