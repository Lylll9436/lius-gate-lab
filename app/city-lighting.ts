import * as T from 'three';

/** Real downward light cones, attached to the lantern apertures. */
export function createStreetLighting(scene: T.Scene, lamps: T.Mesh[]) {
  const lights = lamps.map((lamp, i) => {
    const light = new T.SpotLight('#ffcc86', 0, 5.2, 1.0, 0.7, 2);
    lamp.getWorldPosition(light.position);
    // Sample the lower front of the lantern, outside its opaque base and central pole.
    light.position.y -= 0.19;
    light.position.z += 0.075;
    light.target.position.copy(light.position);
    light.target.position.y = 0.12;
    // Two central lanterns resolve shadows; the other cones provide inexpensive direct light.
    light.castShadow = i === 8 || i === 9;
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.0002;
    light.shadow.normalBias = 0.016;
    scene.add(light, light.target);
    return light;
  });
  return {
    lights,
    update(night: number, inspecting: boolean) {
      for (const light of lights) light.intensity = inspecting ? 0 : night * 13;
    },
    dispose() {
      for (const light of lights) {
        scene.remove(light, light.target);
        light.dispose();
      }
    },
  };
}
