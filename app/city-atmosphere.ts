import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Weather and birds. The real Glasgow sun lives in glasgow-sun.ts (no three).
 * Everything here is decorative: no colliders, no pavement, no physics.
 */

export { glasgowSky, glasgowSeason, type SkyState, type Season } from './glasgow-sun';

const DEG = Math.PI / 180;

/**
 * How low the sun is, 0..1: 0 from about 12 degrees of real elevation up, 1 from about 3 degrees
 * down to the horizon (dawn and golden hour), fading back to 0 through civil twilight, where the
 * night light takes over. Lowers and warms the key light.
 */
export function lowSun(elevation: number) {
  return (
    (1 - T.MathUtils.smoothstep(elevation, 3 * DEG, 12 * DEG)) *
    T.MathUtils.smoothstep(elevation, -8 * DEG, -2 * DEG)
  );
}

/**
 * How warm the key light and the sky are, 0..1: none from about 29 degrees of real elevation up,
 * full from about 4.6 degrees down (late afternoon and the night's light, which the night tint
 * then covers).
 */
export function warmSun(elevation: number) {
  return T.MathUtils.clamp((0.5 - elevation) / 0.42, 0, 1);
}

/**
 * Stylised key-light offset for the overview bearing (the scene turns it with the camera yaw).
 * The real sun only nudges it: elevation is lifted to 50-57 degrees (lowered to 40 at dawn and
 * golden hour, for longer shadows) and the sideways swing is capped at +-35 degrees around the
 * founding light (-16, 32, 20), so tops stay brightest and the +z fronts stay lit all year.
 */
export function sunOffsetFor(elevation: number, azimuth: number, distance = 41) {
  const lifted = T.MathUtils.lerp(
    T.MathUtils.lerp(0.87, 1.0, T.MathUtils.smoothstep(elevation, 0, 0.6)), // 50-57 degrees
    40 * DEG,
    lowSun(elevation),
  );
  // The sun's bearing from due south, turned into a swing of at most +-35 degrees. Past 126
  // degrees either side (the night, with the sun to the north) it eases back to the founding
  // light, so it passes north smoothly instead of flipping 70 degrees as the azimuth wraps.
  const fromSouth = Math.atan2(Math.sin(azimuth - Math.PI), Math.cos(azimuth - Math.PI)),
    reach = 2.2,
    swing =
      0.28 *
      (Math.abs(fromSouth) <= reach
        ? fromSouth
        : (Math.sign(fromSouth) * reach * (Math.PI - Math.abs(fromSouth))) / (Math.PI - reach));
  const bearing = Math.atan2(-16, 20) + swing;
  return new T.Vector3(Math.cos(lifted) * Math.sin(bearing) * distance, Math.sin(lifted) * distance, Math.cos(lifted) * Math.cos(bearing) * distance);
}

/** West-coast rain: short falling streaks over the whole island. */
export function createRain(count = 1700, radius = 50, ceiling = 30) {
  const positions = new Float32Array(count * 6),
    speeds = new Float32Array(count),
    seed = (i: number) => {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1,
        z = (Math.sin(i * 78.233) * 12345.6789) % 1,
        y = (Math.sin(i * 39.346) * 2468.1357) % 1;
      return [Math.abs(x), Math.abs(y), Math.abs(z)];
    };
  for (let i = 0; i < count; i++) {
    const [a, b, c] = seed(i + 1);
    const x = (a * 2 - 1) * radius,
      z = (c * 2 - 1) * radius,
      y = b * ceiling;
    positions.set([x, y, z, x, y - 0.75, z], i * 6);
    speeds[i] = 16 + a * 9;
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  // Darker than the sky: pale streaks vanish against the lawns and the sand.
  const material = new T.LineBasicMaterial({
    color: '#7f8f9c',
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const lines = new T.LineSegments(geometry, material);
  lines.name = 'rain';
  lines.frustumCulled = false;
  lines.visible = false;
  lines.renderOrder = 5;
  const attribute = geometry.getAttribute('position') as T.BufferAttribute;
  return {
    object: lines,
    update(dt: number, amount: number, paused: boolean) {
      material.opacity = amount * 0.5;
      lines.visible = amount > 0.01;
      if (!lines.visible || paused) return;
      for (let i = 0; i < count; i++) {
        let y = positions[i * 6 + 1] - speeds[i] * dt;
        if (y < 0.2) y += ceiling;
        positions[i * 6 + 1] = y;
        positions[i * 6 + 4] = y - 0.75;
      }
      attribute.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * A few gulls circling the harbour and the lighthouse; wings flap, then glide in a shallow V.
 * Each bird is a chunky body (head, beak, tail) and two wings, all sharing one vertex-coloured
 * material. Beaks point along local +x, which the update turns along the direction of travel.
 */
export function createGulls(count = 5) {
  const group = new T.Group();
  group.name = 'gulls';
  const feathers = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const tint = (geo: T.BufferGeometry, hex: string) => {
    const c = new T.Color(hex),
      n = geo.getAttribute('position').count,
      a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new T.BufferAttribute(a, 3));
    return geo;
  };
  const bodyGeo = mergeGeometries([
    tint(new T.SphereGeometry(1, 10, 7).scale(0.26, 0.09, 0.1), '#f5efe0'),
    tint(new T.SphereGeometry(0.075, 10, 7).translate(0.2, 0.05, 0), '#f5efe0'),
    tint(new T.ConeGeometry(0.03, 0.1, 6).rotateZ(-Math.PI / 2).translate(0.3, 0.04, 0), '#f6c63f'),
    tint(new T.BoxGeometry(0.12, 0.025, 0.14).translate(-0.27, 0.01, 0), '#f5efe0'),
  ])!;
  const wingGeo = (side: number) =>
    mergeGeometries([
      tint(new T.BoxGeometry(0.22, 0.03, 0.36).translate(0, 0, side * 0.18), '#f5efe0'),
      tint(new T.BoxGeometry(0.16, 0.032, 0.12).translate(-0.02, 0, side * 0.42), '#4b545b'),
    ])!;
  const wing = { [-1]: wingGeo(-1), [1]: wingGeo(1) } as Record<number, T.BufferGeometry>;
  // Circle centres and radii: three over the harbour and pier, two round the lighthouse rock.
  const roosts: [number, number, number][] = [
    [15, 22, 4.5],
    [14, 20, 6.2],
    [17, 24, 3.6],
    [-8, 30.5, 3.4],
    [-7, 29, 5.2],
  ];
  const birds = Array.from({ length: count }, (_, i) => {
    const bird = new T.Group();
    bird.rotation.order = 'YXZ'; // heading first, then the bank about the beak axis
    const body = new T.Mesh(bodyGeo, feathers);
    body.castShadow = true;
    bird.add(body);
    const wings = [-1, 1].map((side) => {
      const pivot = new T.Group();
      pivot.position.set(0, 0.03, side * 0.07);
      pivot.add(new T.Mesh(wing[side], feathers));
      bird.add(pivot);
      return { pivot, side };
    });
    group.add(bird);
    const phase = i * 1.37,
      [cx, cz, r] = roosts[i % roosts.length];
    // 8.6-10.4: above the lighthouse lantern, well below the balloon's basket.
    return { bird, wings, phase, cx, cz, r, h: 8.6 + (i % 3) * 0.9, w: 0.16 + (i % 2) * 0.05 };
  });
  return {
    object: group,
    update(time: number) {
      for (const g of birds) {
        const a = g.phase + time * g.w;
        g.bird.position.set(
          g.cx + Math.cos(a) * g.r,
          g.h + Math.sin(time * 0.9 + g.phase) * 0.3,
          g.cz + Math.sin(a) * g.r,
        );
        g.bird.rotation.y = -a - Math.PI / 2; // local +x (beak) along the velocity (-sin a, 0, cos a)
        g.bird.rotation.x = 0.22; // bank: local +z points at the circle centre and dips
        const gliding = Math.sin(time * 0.23 + g.phase) > 0.35;
        const flap = gliding ? -0.15 : Math.sin(time * 9 + g.phase) * 0.55;
        for (const { pivot, side } of g.wings) pivot.rotation.x = side * flap; // glide in a shallow V
      }
    },
    dispose() {
      bodyGeo.dispose();
      wing[-1].dispose();
      wing[1].dispose();
      feathers.dispose();
    },
  };
}
