import * as T from 'three';

export type DetailAsset = {
  id: string;
  root: T.Object3D;
  low: T.Object3D;
  height: number;
  kind: 'tree' | 'building';
  create: () => T.Object3D;
  activate?: (high: boolean) => void;
  onEvict?: () => void;
};

/** Build one visible asset after the camera settles, with hysteresis and bounded caches. */
export function createDetailManager(assets: DetailAsset[]) {
  const entries = assets.map((asset) => ({
    ...asset,
    high: null as T.Object3D | null,
    used: 0,
  }));
  let serial = 0,
    pending: ReturnType<typeof setTimeout> | null = null,
    stopped = false;
  let lastCamera = '',
    stableSince = 0;
  const point = new T.Vector3();
  function free(entry: (typeof entries)[number]) {
    if (!entry.high) return;
    const geometries = new Set<T.BufferGeometry>();
    entry.high.traverse((o) => {
      if (o instanceof T.Mesh) geometries.add(o.geometry);
    });
    entry.root.remove(entry.high);
    geometries.forEach((g) => g.dispose());
    entry.high = null;
    entry.low.visible = true;
    entry.activate?.(false);
    entry.onEvict?.();
  }
  function show(entry: (typeof entries)[number]) {
    if (!entry.high) {
      entry.high = entry.create();
      entry.root.add(entry.high);
    }
    entry.high.visible = true;
    entry.low.visible = false;
    entry.used = ++serial;
    entry.activate?.(true);
    const cache = entries
      .filter((e) => e.kind === entry.kind && e.high)
      .sort(
        (a, b) =>
          Number(!!a.high?.visible) - Number(!!b.high?.visible) ||
          a.used - b.used,
      );
    const limit = entry.kind === 'tree' ? 8 : 3;
    while (cache.length > limit) free(cache.shift()!);
  }
  function cancel() {
    if (pending !== null) clearTimeout(pending);
    pending = null;
  }
  return {
    ensure(id: string) {
      if (stopped) return;
      cancel();
      const entry = entries.find((e) => e.id === id);
      if (entry) show(entry);
    },
    update(
      camera: T.OrthographicCamera,
      viewportHeight: number,
      now: number,
      frozen: boolean,
    ) {
      if (stopped || frozen) {
        cancel();
        return;
      }
      const signature = [
        ...camera.position.toArray(),
        ...camera.quaternion.toArray(),
        camera.zoom,
      ]
        .map((v) => v.toFixed(2))
        .join(',');
      if (signature !== lastCamera) {
        lastCamera = signature;
        stableSince = now;
        cancel();
      }
      if (now - stableSince < 180) return;
      const candidates: {
        entry: (typeof entries)[number];
        distance: number;
      }[] = [];
      for (const entry of entries) {
        entry.root.getWorldPosition(point);
        point.y += entry.height * 0.5;
        point.project(camera);
        const visible =
          Math.abs(point.x) < 1.1 &&
          Math.abs(point.y) < 1.1 &&
          Math.abs(point.z) < 1;
        const pixels =
          (entry.height * camera.zoom * viewportHeight) /
          (camera.top - camera.bottom);
        const threshold = entry.kind === 'tree' ? 46 : 75;
        if (
          visible &&
          pixels > (entry.high?.visible ? threshold * 0.68 : threshold)
        ) {
          candidates.push({
            entry,
            distance: point.x * point.x + point.y * point.y,
          });
        } else if (!visible || pixels < threshold * 0.68) {
          if (entry.high) entry.high.visible = false;
          entry.low.visible = true;
          entry.activate?.(false);
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);
      const chosen = new Set<(typeof entries)[number]>();
      for (const kind of ['tree', 'building'] as const)
        candidates
          .filter((c) => c.entry.kind === kind)
          .slice(0, kind === 'tree' ? 8 : 3)
          .forEach((c) => chosen.add(c.entry));
      for (const entry of entries) {
        const visible = chosen.has(entry) && !!entry.high;
        if (entry.high) {
          if (visible && !entry.high.visible) entry.used = ++serial;
          entry.high.visible = visible;
        }
        entry.low.visible = !visible;
        entry.activate?.(visible);
      }
      const next = candidates.find(
        ({ entry }) => chosen.has(entry) && !entry.high,
      );
      // Yield between upgrades. Never build all near assets in the same turn.
      if (!pending && next)
        pending = setTimeout(() => {
          pending = null;
          if (!stopped) show(next.entry);
        }, 40);
    },
    stats: () => ({
      cached: entries.filter((e) => e.high).length,
      visible: entries.filter((e) => e.high?.visible).length,
      pending: pending !== null,
    }),
    dispose() {
      stopped = true;
      cancel();
      entries.forEach(free);
    },
  };
}
