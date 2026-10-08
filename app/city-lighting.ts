import * as T from 'three';

/**
 * Real downward light cones attached to lantern apertures.
 * They only join the scene after dusk: during the day every spotlight would still
 * cost shader work for every lit pixel, for no visible light.
 */
export function createStreetLighting(
  scene: T.Scene,
  lamps: T.Mesh[],
  options: { shadows?: number; shadowSize?: number } = {},
) {
  const shadows = options.shadows ?? 1,
    shadowSize = options.shadowSize ?? 512;
  const lights = lamps.map((lamp, i) => {
    const light = new T.SpotLight('#ffcc86', 0, 5.2, 1.0, 0.7, 2);
    lamp.getWorldPosition(light.position);
    // Sample the lower front of the lantern, outside its opaque base and central pole.
    light.position.y -= 0.19;
    light.position.z += 0.075;
    light.target.position.copy(light.position);
    light.target.position.y = 0.12;
    light.castShadow = i < shadows;
    light.shadow.mapSize.set(shadowSize, shadowSize);
    light.shadow.bias = -0.0002;
    light.shadow.normalBias = 0.016;
    return light;
  });
  let attached = false;
  function setAttached(on: boolean) {
    if (on === attached) return;
    attached = on;
    for (const light of lights)
      if (on) scene.add(light, light.target);
      else scene.remove(light, light.target);
  }
  return {
    lights,
    update(night: number, inspecting: boolean) {
      const wanted = night > 0.04 && !inspecting;
      setAttached(wanted);
      for (const light of lights) light.intensity = inspecting ? 0 : night * 13;
    },
    dispose() {
      setAttached(false);
      for (const light of lights) light.dispose();
    },
  };
}
