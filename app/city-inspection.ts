import * as T from 'three';
function projectedBounds(bounds: T.Box3, right: T.Vector3, up: T.Vector3) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new T.Vector3(x, y, z),
          sx = point.dot(right),
          sy = point.dot(up);
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
  return { minX, maxX, minY, maxY };
}
export function fitStudy(bounds: T.Box3, camera: T.Camera, aspect: number) {
  camera.updateMatrixWorld(true);
  const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
    up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
    p = projectedBounds(bounds, right, up);
  const vertical = Math.max(46, 65 / aspect);
  return {
    focus: right
      .multiplyScalar((p.minX + p.maxX) / 2)
      .addScaledVector(up, (p.minY + p.maxY) / 2),
    zoom: T.MathUtils.clamp(
      vertical /
        Math.max((p.maxY - p.minY) / 0.7, (p.maxX - p.minX) / aspect / 0.84),
      0.7,
      8,
    ),
  };
}
export function roofDock(
  body: T.Box3,
  roof: T.Box3,
  camera: T.Camera,
  aspect: number,
) {
  camera.updateMatrixWorld(true);
  const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
    up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
    scale = 0.48,
    smallRoof = new T.Box3(
      roof.min.clone().multiplyScalar(scale),
      roof.max.clone().multiplyScalar(scale),
    ),
    b = projectedBounds(body, right, up),
    r = projectedBounds(smallRoof, right, up),
    gap = Math.max(0.4, (b.maxX - b.minX) * 0.09),
    dx = b.maxX + gap - r.minX,
    dy = (b.minY + b.maxY - r.minY - r.maxY) / 2,
    offset = right.clone().multiplyScalar(dx).addScaledVector(up, dy),
    visible = aspect >= 1.25;
  const union = visible
    ? body.clone().union(smallRoof.clone().translate(offset))
    : body;
  return { offset, scale, visible, ...fitStudy(union, camera, aspect) };
}
