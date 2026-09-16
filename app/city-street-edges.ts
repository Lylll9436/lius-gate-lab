export type Rect = { x: number; z: number; w: number; d: number };
export type Boundary = {
  axis: 'x' | 'z';
  fixed: number;
  start: number;
  end: number;
  normal: number;
};
const eps = 1e-7;
export function outsideEdges(rects: Rect[]): Boundary[] {
  const edges: Boundary[] = [];
  for (const r of rects)
    for (const axis of ['x', 'z'] as const)
      for (const normal of [-1, 1]) {
        const fixed =
          axis === 'x' ? r.z + (normal * r.d) / 2 : r.x + (normal * r.w) / 2;
        let spans = [
          [
            axis === 'x' ? r.x - r.w / 2 : r.z - r.d / 2,
            axis === 'x' ? r.x + r.w / 2 : r.z + r.d / 2,
          ],
        ];
        for (const q of rects) {
          const across = axis === 'x' ? q.z : q.x,
            depth = axis === 'x' ? q.d : q.w,
            probe = fixed + normal * eps * 2;
          if (
            probe <= across - depth / 2 + eps ||
            probe >= across + depth / 2 - eps
          )
            continue;
          const center = axis === 'x' ? q.x : q.z,
            size = axis === 'x' ? q.w : q.d,
            l = center - size / 2,
            h = center + size / 2;
          spans = spans.flatMap(([a, b]) =>
            h <= a + eps || l >= b - eps
              ? [[a, b]]
              : [
                  [a, Math.min(l, b)],
                  [Math.max(a, h), b],
                ].filter(([x, y]) => y - x > eps),
          );
        }
        for (const [start, end] of spans)
          edges.push({ axis, fixed, start, end, normal });
      }
  const merged: Boundary[] = [];
  for (const e of edges.sort(
    (a, b) =>
      a.axis.localeCompare(b.axis) ||
      a.fixed - b.fixed ||
      a.normal - b.normal ||
      a.start - b.start,
  )) {
    const last = merged.at(-1);
    if (
      last &&
      last.axis === e.axis &&
      Math.abs(last.fixed - e.fixed) < eps &&
      last.normal === e.normal &&
      Math.abs(last.end - e.start) < eps
    )
      last.end = e.end;
    else merged.push({ ...e });
  }
  return merged;
}
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const l = Math.max(a.x - a.w / 2, b.x - b.w / 2),
    r = Math.min(a.x + a.w / 2, b.x + b.w / 2),
    n = Math.max(a.z - a.d / 2, b.z - b.d / 2),
    s = Math.min(a.z + a.d / 2, b.z + b.d / 2);
  return r - l > eps && s - n > eps
    ? { x: (l + r) / 2, z: (n + s) / 2, w: r - l, d: s - n }
    : null;
}
export function kerbStrips(
  edges: Boundary[],
  width = 0.085,
  direction = 1,
): Rect[] {
  const rects: Rect[] = [];
  for (const e of edges) {
    const mid = (e.start + e.end) / 2,
      f = e.fixed + ((e.normal * width) / 2) * direction;
    rects.push(
      e.axis === 'x'
        ? { x: mid, z: f, w: e.end - e.start, d: width }
        : { x: f, z: mid, w: width, d: e.end - e.start },
    );
    // The same carve operation resolves both convex corner stones and concave mitres.
    for (const at of [e.start, e.end])
      rects.push(
        e.axis === 'x'
          ? { x: at, z: e.fixed, w: width * 2, d: width * 2 }
          : { x: e.fixed, z: at, w: width * 2, d: width * 2 },
      );
  }
  return rects;
}
