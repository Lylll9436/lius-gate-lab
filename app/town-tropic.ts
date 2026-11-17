import * as T from 'three';
import { WATER } from './town-shared';

/*
 * STUB (camera lane). The land lane's town-tropic.ts (the tropic island's land and shore) takes this
 * file's place whole at the merge. Until then it holds the two sets of points of the island the camera
 * reads (the interface agreed between the two lanes), laid out as the land lane lays them: its
 * waterline an ellipse round (19.5, 51) out on the sea off the south shore, 13 east-west by 10.5
 * north-south (the sand's 12 by 9.5 and its beach), its building's corners 7.85 up over its podium's
 * plan (5.9 by 4 either side of a point 2.3 north of the middle), its trees' crowns 4.6 up; its
 * beach's shelf under the water 4.31 past the waterline and its shallows 3, its shore profile's foot
 * 0.48 under the water.
 */
const ISLAND = { x: 19.5, z: 51, a: 13, b: 10.5 },
  BUILDING = { x: 0, z: -2.3, hw: 5.9, hd: 4.0, top: 7.85 },
  REACH = { sea: 4.6, floor: -0.48, crown: 4.6, crowns: 0.7, points: 32 };

/** `count` points round the waterline, each `offset` out along the ellipse's own outward normal. */
function outline(offset: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const u = (i / count) * Math.PI * 2,
      gx = Math.cos(u) / ISLAND.a,
      gz = Math.sin(u) / ISLAND.b,
      l = Math.hypot(gx, gz);
    return { x: ISLAND.x + ISLAND.a * Math.cos(u) + (gx / l) * offset, z: ISLAND.z + ISLAND.b * Math.sin(u) + (gz / l) * offset };
  });
}

/**
 * The tropic island as the camera frames it (decision 16's TROPIC_EXTENT), world points: its outline
 * at the water (its waterline, as the corners of a polygon whose sides touch it), the tops of its
 * trees over that outline and its building's corners at its top. Everything of the island that stands
 * on it, at or over the water and inside its waterline, lies inside these points' hull. The camera
 * fits the island's file to them, adds them to City mode's overview, centres its pan pocket on the
 * middle of the outline's box (the points under half a unit up) and holds the sun's shadow box round
 * them (city-scene).
 */
export const TROPIC_EXTENT: T.Vector3[] = (() => {
  const out = 1 / Math.cos(Math.PI / REACH.points),
    ring = Array.from({ length: REACH.points }, (_, k) => {
      const u = ((k + 0.5) / REACH.points) * Math.PI * 2;
      return { x: ISLAND.x + ISLAND.a * Math.cos(u) * out, z: ISLAND.z + ISLAND.b * Math.sin(u) * out };
    });
  return [
    ...ring.map((p) => new T.Vector3(p.x, WATER, p.z)),
    ...ring.map((p) => new T.Vector3(p.x, REACH.crown, p.z)),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => new T.Vector3(ISLAND.x + BUILDING.x + sx * BUILDING.hw, BUILDING.top, ISLAND.z + BUILDING.z + sz * BUILDING.hd))),
  ];
})();

/**
 * Everything of the tropic island that can show on screen, world points: TROPIC_EXTENT, and the sea
 * round it that goes and comes with it (its shelf and shallows: a ring 4.6 past the waterline at the
 * water's level and at its shore profile's foot) and its crowns' ring 0.7 past the waterline (a palm
 * leaning further out than planned). The scene's rule for when the island may go measures these
 * (city-scene's islandShown: never taken away while any of it is in view).
 */
export const TROPIC_SEEN: T.Vector3[] = (() => {
  const sea = outline(REACH.sea, REACH.points);
  return [
    ...TROPIC_EXTENT.map((p) => p.clone()),
    ...sea.map((p) => new T.Vector3(p.x, WATER, p.z)),
    ...sea.map((p) => new T.Vector3(p.x, REACH.floor, p.z)),
    ...outline(REACH.crowns, REACH.points).map((p) => new T.Vector3(p.x, REACH.crown, p.z)),
  ];
})();
