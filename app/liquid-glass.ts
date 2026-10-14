/**
 * Liquid-glass edges, after Apple's material: the glass defines itself by bending what is
 * behind it in a convex bevel at the rim, not by a border. Each element gets an SVG
 * displacement map built from a rounded-rectangle profile and Snell's law (kube.io's model),
 * applied through `backdrop-filter: ... url(#lens)`.
 *
 * Only Chromium renders url() inside backdrop-filter. Safari and Firefox parse it (so
 * @supports says yes) and then drop the whole backdrop-filter, blur included, so the lens is
 * switched on from script for Chromium only; everyone else keeps the CSS frosted glass.
 */

const IOR = 1.5; // glass; air = 1
const BASE = 0.5; // flat glass thickness under the bevel, in bezel widths
const STEPS = 128; // samples across the bezel

/** Convex squircle bevel: 0 at the rim, 1 where the flat top begins. */
const surface = (x: number) => (1 - (1 - x) ** 4) ** 0.25;

/** Inward shift across the bezel (one refraction of a vertical ray), normalised to 1. */
const PROFILE = (() => {
  const p = new Float32Array(STEPS + 1);
  for (let i = 0; i <= STEPS; i++) {
    const x = Math.min(Math.max(i / STEPS, 1e-3), 1 - 1e-3);
    const slope = (surface(x + 1e-3) - surface(x - 1e-3)) / 2e-3;
    const incidence = Math.atan(slope);
    const refracted = Math.asin(Math.sin(incidence) / IOR);
    p[i] = Math.tan(incidence - refracted) * (surface(x) + BASE);
  }
  const max = Math.max(...p);
  return p.map((v) => v / max);
})();

/** Red = x shift, green = y shift, 128 = none; opaque, because Chromium premultiplies. */
function lensMapURL(w: number, h: number, radius: number, bezel: number) {
  const r = Math.min(radius, w / 2, h / 2);
  const b = Math.max(1, Math.min(bezel, r)); // a bezel wider than the corner creases the diagonal
  const img = new ImageData(w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i + 1] = d[i + 2] = 128;
    d[i + 3] = 255;
  }
  for (let y = 0; y < h; y++) {
    const py = y + 0.5 - h / 2,
      qy = Math.abs(py) - (h / 2 - r);
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2,
        qx = Math.abs(px) - (w / 2 - r);
      let depth: number,
        nx = 0,
        ny = 0;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        depth = r - len;
        nx = (Math.sign(px) * qx) / len;
        ny = (Math.sign(py) * qy) / len;
      } else if (qx > qy) {
        depth = r - qx;
        nx = Math.sign(px);
      } else {
        depth = r - qy;
        ny = Math.sign(py);
      }
      if (depth < 0 || depth >= b) continue;
      const s = PROFILE[Math.round((depth / b) * STEPS)];
      const i = (y * w + x) * 4;
      d[i] = 128 - 127 * nx * s; // sample inward: a convex lens
      d[i + 1] = 128 - 127 * ny * s;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

const maps = new Map<string, Promise<string>>();
/** Decoded before use: Chromium paints an undecoded feImage blank, shifting the whole backdrop. */
function lensMap(w: number, h: number, radius: number, bezel: number) {
  const key = `${w}x${h}r${radius}b${bezel}`;
  let map = maps.get(key);
  if (!map) {
    const url = lensMapURL(w, h, radius, bezel);
    const image = new Image();
    image.src = url;
    map = image.decode().then(() => url);
    maps.set(key, map);
    if (maps.size > 48) maps.delete(maps.keys().next().value!);
  }
  return map;
}

export function canRefract() {
  if (typeof window === 'undefined') return false;
  const data = (
    navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }
  ).userAgentData;
  return (
    !!data?.brands?.some((b) => b.brand === 'Chromium') &&
    !matchMedia('(prefers-reduced-transparency: reduce)').matches
  );
}

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Give every element matching `selector` a refracting rim, now and as they appear.
 * Maps are rebuilt (debounced) when an element changes size. Returns a cleanup function.
 */
export function installLiquidGlass(selector: string) {
  if (!canRefract()) return () => {};
  const defs = document.createElementNS(SVG, 'svg');
  defs.setAttribute('class', 'glass-defs');
  defs.setAttribute('aria-hidden', 'true');
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  document.body.appendChild(defs);
  const applied = new Map<HTMLElement, { key: string; filter: SVGFilterElement }>(),
    timers = new Map<HTMLElement, number>();
  let serial = 0,
    scanQueued = 0,
    alive = true;

  function clear(el: HTMLElement) {
    applied.get(el)?.filter.remove();
    applied.delete(el);
    el.style.removeProperty('--lens');
    delete el.dataset.lens;
  }
  async function apply(el: HTMLElement) {
    const w = el.offsetWidth,
      h = el.offsetHeight;
    const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
    if (!el.isConnected || w < 16 || h < 16 || radius < 4) return clear(el);
    const r = Math.round(radius),
      bezel = Math.round(Math.min(24, r)),
      // Peak inward shift at the rim, in CSS px; the filter's scale is twice that.
      scale = 2 * Math.round(bezel * 0.45),
      key = `${w}x${h}r${r}b${bezel}`;
    if (applied.get(el)?.key === key) return;
    const url = await lensMap(w, h, r, bezel);
    if (!alive || !el.isConnected) return;
    const filter = document.createElementNS(SVG, 'filter');
    const id = `lens-${++serial}`; // a new id per size: filters are cached by id
    filter.setAttribute('id', id);
    for (const [k, v] of Object.entries({ x: '0', y: '0', width: '100%', height: '100%' }))
      filter.setAttribute(k, v);
    // sRGB, or the map is linearised and 128 stops meaning "no shift".
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const image = document.createElementNS(SVG, 'feImage');
    for (const [k, v] of Object.entries({
      href: url,
      x: '0',
      y: '0',
      width: String(w),
      height: String(h),
      preserveAspectRatio: 'none',
      result: 'map',
    }))
      image.setAttribute(k, v);
    const displace = document.createElementNS(SVG, 'feDisplacementMap');
    for (const [k, v] of Object.entries({
      in: 'SourceGraphic',
      in2: 'map',
      scale: String(scale),
      xChannelSelector: 'R',
      yChannelSelector: 'G',
    }))
      displace.setAttribute(k, v);
    filter.appendChild(image);
    filter.appendChild(displace);
    defs.appendChild(filter);
    applied.get(el)?.filter.remove();
    applied.set(el, { key, filter });
    el.style.setProperty('--lens', `url(#${id})`);
    el.dataset.lens = '';
  }
  const resized = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const el = target as HTMLElement;
      clearTimeout(timers.get(el));
      timers.set(el, window.setTimeout(() => void apply(el), 150));
    }
  });
  /** An element gone from the page (a hover chip, a closed bar) is let go entirely. */
  function forget(el: HTMLElement) {
    clearTimeout(timers.get(el));
    timers.delete(el);
    resized.unobserve(el);
    clear(el);
  }
  function scan() {
    scanQueued = 0;
    // Deleting the entry being visited is safe while iterating a Map.
    for (const el of timers.keys()) if (!el.isConnected) forget(el);
    for (const el of applied.keys()) if (!el.isConnected) clear(el);
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      if (applied.has(el) || timers.has(el)) return;
      timers.set(el, 0);
      resized.observe(el);
      void apply(el);
    });
  }
  const mutations = new MutationObserver(() => {
    if (!scanQueued) scanQueued = requestAnimationFrame(scan);
  });
  mutations.observe(document.body, { childList: true, subtree: true });
  scan();
  return () => {
    alive = false;
    mutations.disconnect();
    resized.disconnect();
    cancelAnimationFrame(scanQueued);
    timers.forEach((t) => clearTimeout(t));
    // Deleting the entry being visited is safe while iterating a Map.
    for (const el of applied.keys()) clear(el);
    defs.remove();
  };
}
