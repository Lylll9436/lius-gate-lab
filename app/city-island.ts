import * as T from 'three';
import { shoreProfile, shorePoint, waterlineBands } from './city-shore';
import { islandOutline } from './island-footprint';
import type { SurfaceKind } from './city-materials';

const grain = (n: number) => {
  const v = Math.sin(n * 127.1) * 43758.5;
  return v - Math.floor(v);
};

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

  // The sloping shore: one indexed strip per profile band, shared with the checks.
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < islandOutline.length; i++)
    for (const band of shoreProfile) {
      const p = shorePoint(i, band.width, band.height);
      positions.push(...p);
      // Sand is never one flat colour: streaks follow the shore, flecks follow the grain.
      const tone =
        0.965 +
        0.03 * Math.sin(p[0] * 0.7 + p[2] * 0.9) +
        0.018 * Math.sin(i * 0.9 + band.width * 2.1) +
        0.012 * (grain(i * 7 + band.width * 13) - 0.5);
      const c = new T.Color(band.color).multiplyScalar(tone);
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

  // A broken line of foam at the waterline, just above the tide.
  const foamPositions: number[] = [],
    foamColors: number[] = [],
    foamIndices: number[] = [];
  for (let i = 0; i < islandOutline.length; i++) {
    const wobble = 0.12 * Math.sin(i * 1.7) + 0.08 * Math.sin(i * 4.3);
    const inner = shorePoint(
        i,
        waterlineBands.inner + wobble,
        waterlineBands.height,
      ),
      outer = shorePoint(
        i,
        waterlineBands.outer + wobble * 0.6,
        waterlineBands.height,
      );
    foamPositions.push(...inner, ...outer);
    const strength = 0.55 + 0.45 * Math.sin(i * 0.61 + Math.sin(i * 0.17) * 3);
    const lit = new T.Color('#f4f7f1').multiplyScalar(0.72 + 0.28 * strength);
    foamColors.push(lit.r, lit.g, lit.b, lit.r, lit.g, lit.b);
  }
  for (let i = 0; i < islandOutline.length; i++) {
    const a = i * 2,
      b = ((i + 1) % islandOutline.length) * 2;
    foamIndices.push(a, b, b + 1, a, b + 1, a + 1);
  }
  const foamGeometry = new T.BufferGeometry();
  foamGeometry.setAttribute(
    'position',
    new T.Float32BufferAttribute(foamPositions, 3),
  );
  foamGeometry.setAttribute(
    'color',
    new T.Float32BufferAttribute(foamColors, 3),
  );
  foamGeometry.setIndex(foamIndices);
  foamGeometry.computeVertexNormals();
  // A standard material (not an unlit one) so the static batch can merge it.
  const foamMaterial = material('#ffffff', 'paint').clone();
  foamMaterial.vertexColors = true;
  foamMaterial.transparent = true;
  foamMaterial.opacity = 0.46;
  foamMaterial.depthWrite = false;
  foamMaterial.emissive.set('#ffffff');
  foamMaterial.emissiveIntensity = 0.35;
  foamMaterial.roughness = 1;
  const foam = new T.Mesh(foamGeometry, foamMaterial);
  foam.name = 'tide-foam';
  foam.renderOrder = 3;
  foam.receiveShadow = false;
  land.add(foam);

  // Boulders along the tide line, in two greys.
  for (let i = 0; i < islandOutline.length; i++) {
    if (grain(i) > 0.22) continue;
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
