import * as T from 'three';

/*
 * STUB (camera lane). The land lane's town-tropic.ts (the tropic island's land and shore) takes this
 * file's place whole at the merge. Until then it holds the one value of the island the camera reads
 * (the interface agreed between the two lanes), worked out from the island's placement: its middle at
 * (19.5, 51) out on the sea off the south shore, a sand ellipse of half-axes 12 (east-west) by 9.5
 * (north-south) and about 1 of beach round it, its building's roof (11 by 7.2) and its trees' crowns
 * about 7 up.
 */
const MIDDLE = { x: 19.5, z: 51 },
  // The ellipse with its beach, out to the water.
  WATER = { a: 12 + 1, b: 9.5 + 1 },
  // The roof's top over the sea (7.3 over its podium, the podium 0.12 over the lawn, the lawn 0.3 up),
  // and its half sizes.
  ROOF = { top: 7.72, hw: 5.5, hd: 3.6 },
  // The trees' crowns: on a ring three quarters of the way out, as high as they rise.
  CROWNS = { out: 0.75, top: 6.5 };

/**
 * World points bounding everything of the tropic island that can be on screen: the ellipse-plus-beach
 * outline at the water (every 11.25 degrees), the corners of its roof at the roof's top and a ring of
 * points over its trees' crowns. The camera fits the island's file to them, adds them to City mode's
 * overview and measures them for when the island may go and come (city-scene).
 */
export const TROPIC_EXTENT: T.Vector3[] = [
  ...Array.from({ length: 32 }, (_, k) => {
    const angle = (k / 32) * Math.PI * 2;
    return new T.Vector3(MIDDLE.x + WATER.a * Math.cos(angle), 0, MIDDLE.z + WATER.b * Math.sin(angle));
  }),
  ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => new T.Vector3(MIDDLE.x + sx * ROOF.hw, ROOF.top, MIDDLE.z + sz * ROOF.hd)),
  ...Array.from({ length: 16 }, (_, k) => {
    const angle = (k / 16) * Math.PI * 2;
    return new T.Vector3(MIDDLE.x + CROWNS.out * WATER.a * Math.cos(angle), CROWNS.top, MIDDLE.z + CROWNS.out * WATER.b * Math.sin(angle));
  }),
];
