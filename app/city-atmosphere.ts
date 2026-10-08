import * as T from 'three';

/**
 * Weather, birds and the real Glasgow sun.
 * Everything here is decorative: no colliders, no pavement, no physics.
 */

const GLASGOW_LAT = (55.86 * Math.PI) / 180,
  GLASGOW_LON = -4.25;

export type SkyState = {
  /** Local wall-clock hours in Glasgow, e.g. 21.7 for 21:42. */
  hours: number;
  /** Solar elevation in radians (negative after sunset). */
  elevation: number;
  /** Solar azimuth in radians, 0 = north, clockwise. */
  azimuth: number;
  /** 0 = full daylight, 1 = night; civil twilight blends between. */
  night: number;
  /** Local time label, "21:42". */
  clock: string;
};

/** Approximate solar position for Glasgow at a given instant. */
export function glasgowSky(date = new Date()): SkyState {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .filter((p) => p.type === 'hour' || p.type === 'minute')
      .map((p) => [p.type, Number(p.value)]),
  ) as { hour: number; minute: number };
  const hours = (parts.hour % 24) + parts.minute / 60;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86400000;
  const declination =
    ((23.44 * Math.PI) / 180) *
    Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
  const solarHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    GLASGOW_LON / 15 +
    (9.87 * Math.sin((4 * Math.PI * (dayOfYear - 81)) / 364) -
      7.53 * Math.cos((2 * Math.PI * (dayOfYear - 81)) / 364) -
      1.5 * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 364)) /
      60;
  const hourAngle = ((solarHours - 12) * 15 * Math.PI) / 180;
  const sinElevation =
    Math.sin(GLASGOW_LAT) * Math.sin(declination) +
    Math.cos(GLASGOW_LAT) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(T.MathUtils.clamp(sinElevation, -1, 1));
  const cosAzimuth =
    (Math.sin(declination) - Math.sin(elevation) * Math.sin(GLASGOW_LAT)) /
    Math.max(1e-6, Math.cos(elevation) * Math.cos(GLASGOW_LAT));
  let azimuth = Math.acos(T.MathUtils.clamp(cosAzimuth, -1, 1));
  if (hourAngle > 0) azimuth = 2 * Math.PI - azimuth;
  const degrees = (elevation * 180) / Math.PI;
  const night = T.MathUtils.clamp((6 - degrees) / 12, 0, 1);
  return {
    hours,
    elevation,
    azimuth,
    night: night * night * (3 - 2 * night),
    clock: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  };
}

/** Camera-independent sun offset for the directional light, with a floor for crisp shadows. */
export function sunOffsetFor(elevation: number, azimuth: number, distance = 41) {
  const lifted = Math.max(elevation, 0.3);
  // The founding light came from (-16, 32, 20); keep that as solar noon.
  const bearing = azimuth - Math.PI + Math.atan2(-16, 20);
  return new T.Vector3(
    Math.cos(lifted) * Math.sin(bearing) * distance,
    Math.sin(lifted) * distance,
    Math.cos(lifted) * Math.cos(bearing) * distance,
  );
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
  const material = new T.LineBasicMaterial({
    color: '#aebfcc',
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

/** A few gulls circling the harbour; wings flap, then glide. */
export function createGulls(count = 5) {
  const group = new T.Group();
  group.name = 'gulls';
  const body = new T.MeshStandardMaterial({ color: '#f1f0ea', roughness: 0.9 }),
    tip = new T.MeshStandardMaterial({ color: '#5d6366', roughness: 0.9 });
  const birds = Array.from({ length: count }, (_, i) => {
    const bird = new T.Group();
    const torso = new T.Mesh(new T.BoxGeometry(0.34, 0.07, 0.11), body);
    torso.castShadow = true;
    bird.add(torso);
    const wings = [-1, 1].map((side) => {
      const pivot = new T.Group();
      pivot.position.set(0, 0.02, side * 0.05);
      const wing = new T.Mesh(new T.BoxGeometry(0.16, 0.014, 0.42), body);
      wing.position.z = side * 0.21;
      wing.castShadow = true;
      const black = new T.Mesh(new T.BoxGeometry(0.1, 0.016, 0.1), tip);
      black.position.z = side * 0.38;
      pivot.add(wing, black);
      bird.add(pivot);
      return { pivot, side };
    });
    group.add(bird);
    const phase = i * 1.37;
    return {
      bird,
      wings,
      phase,
      cx: Math.sin(phase * 2.1) * 9 - 6,
      cz: Math.cos(phase * 1.3) * 7 + 9,
      r: 7 + (i % 3) * 2.2,
      h: 10.5 + (i % 4) * 1.1,
      w: 0.16 + (i % 2) * 0.05,
    };
  });
  return {
    object: group,
    update(time: number) {
      for (const g of birds) {
        const a = g.phase + time * g.w;
        g.bird.position.set(
          g.cx + Math.cos(a) * g.r,
          g.h + Math.sin(time * 0.9 + g.phase) * 0.35,
          g.cz + Math.sin(a) * g.r,
        );
        g.bird.rotation.y = -a;
        const gliding = Math.sin(time * 0.23 + g.phase) > 0.35;
        const flap = gliding ? 0.08 : Math.sin(time * 9 + g.phase) * 0.55;
        for (const { pivot, side } of g.wings)
          pivot.rotation.x = side * (flap + 0.12);
      }
    },
    dispose() {
      group.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      body.dispose();
      tip.dispose();
    },
  };
}
