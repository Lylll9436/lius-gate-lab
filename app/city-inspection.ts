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
/**
 * Frame a building for Inspect: `focus` is the offset from its position to the view centre,
 * `zoom` fits it to the camera's own frustum. `free` is the share of the frame's width left
 * beside a side panel and `freeHeight` the share of its height left above a phone's sheet
 * (1 when nothing covers the frame); the caller adds the panel offset.
 */
export function fitStudy(
  bounds: T.Box3,
  camera: T.OrthographicCamera,
  free = 1,
  freeHeight = 1,
) {
  camera.updateMatrixWorld(true);
  const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
    up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
    p = projectedBounds(bounds, right, up);
  const frameWidth = (camera.right - camera.left) * T.MathUtils.clamp(free, 0.3, 1),
    frameHeight = (camera.top - camera.bottom) * T.MathUtils.clamp(freeHeight, 0.3, 1);
  return {
    focus: right
      .multiplyScalar((p.minX + p.maxX) / 2)
      .addScaledVector(up, (p.minY + p.maxY) / 2),
    zoom: T.MathUtils.clamp(
      Math.min(
        (frameHeight * 0.7) / Math.max(p.maxY - p.minY, 1e-3),
        (frameWidth * 0.84) / Math.max(p.maxX - p.minX, 1e-3),
      ),
      0.7,
      8,
    ),
  };
}
