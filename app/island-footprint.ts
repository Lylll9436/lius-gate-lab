export type ShorePoint = readonly [number, number];
// One inhabited island; an unbuilt, gently uneven shore below the promenade.
const perimeter: ShorePoint[] = Array.from({ length: 160 }, (_, i) => {
  const a = (i / 160) * Math.PI * 2,
    c = Math.cos(a),
    s = Math.sin(a);
  const r =
    27.5 / Math.pow(c ** 4 + s ** 4, 0.25) +
    0.7 * Math.sin(a * 7 + 0.8) +
    0.42 * Math.sin(a * 13 + 1.3) +
    0.18 * Math.sin(a * 23);
  return [c * r, s * r] as const;
});
const north: ShorePoint[] = [];
for (let i = 0; i < perimeter.length; i++) {
  const a = perimeter[i],
    b = perimeter[(i + 1) % perimeter.length],
    ia = a[1] <= 18.2,
    ib = b[1] <= 18.2;
  if (ia) north.push(a);
  if (ia !== ib) {
    const t = (18.2 - a[1]) / (b[1] - a[1]);
    north.push([a[0] + (b[0] - a[0]) * t, 18.2]);
  }
}
export const islandOutline: ShorePoint[] = [];
for (let i = 0; i < north.length; i++) {
  const a = north[i],
    b = north[(i + 1) % north.length];
  islandOutline.push(a);
  if (a[1] === 18.2 && b[1] === 18.2 && Math.abs(a[0] - b[0]) > 20)
    for (let j = 1; j < 64; j++) {
      const t = j / 64,
        x = a[0] + (b[0] - a[0]) * t;
      islandOutline.push([
        x,
        18.2 +
          Math.sin(Math.PI * t) *
            (1.05 + 0.55 * Math.sin(x * 0.34) + 0.24 * Math.cos(x * 0.91)),
      ]);
    }
}
export const islandBanks = [islandOutline];
export function onIsland(x: number, z: number) {
  let inside = false;
  for (
    let i = 0, j = islandOutline.length - 1;
    i < islandOutline.length;
    j = i++
  ) {
    const a = islandOutline[i],
      b = islandOutline[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
