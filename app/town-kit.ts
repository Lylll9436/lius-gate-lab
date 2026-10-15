import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { METAL_KINDS, type SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import { palette, type TownContext } from './town-shared';
import type { Season } from './glasgow-sun';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */
/** A roof's finish follows its colour: verdigris copper, glazed pantile, otherwise satin slate. */
function roofKind(colour: string): SurfaceKind {
  if (colour === palette.copper || colour === palette.copperLight) return 'copper';
  if (colour === palette.pantile || colour === palette.pantileLight) return 'pantile';
  return 'slate';
}
/** A canted bay's plan on its wall (see bayOutline): centre x, wall face z0, root width, projection and cant per side. */
export type Bay = { x: number; z0: number; root: number; depth: number; cant: number };
/**
 * Ivy on a wall, in the wall's own plan (x along the face, y up from the ground, +z out of it).
 * `areas` are the rectangles [x0, y0, x1, y1] it covers (their union, with a ragged edge), `keep`
 * the ones it never reaches (openings with their frames, sills and keystones, and a margin), and
 * `plinth` a battered base it climbs over (proud at the foot, `proud - batter` at its top, `h`).
 */
export type IvySpec = {
  areas: [number, number, number, number][];
  keep: [number, number, number, number][];
  plinth?: { h: number; proud: number; batter: number };
  seed: number;
};
/**
 * The ivy's leaves by season: deep green, fresher in spring, darker in winter; in autumn the reds
 * and rusts of Boston ivy, each no more saturated than the brick and the hedge it is drawn from.
 */
export const IVY: Record<Season, { tones: string[]; top: string }> = {
  spring: { tones: ['#5a9040', '#66a046', '#528838'], top: '#9cc456' },
  summer: { tones: ['#4f8236', '#5a8e3c', '#467832'], top: '#8ab450' },
  autumn: { tones: ['#a84c32', '#b25e36', '#984530', '#8e6638'], top: '#d08250' },
  winter: { tones: ['#4a6a40', '#527446', '#43603a'], top: '#76925e' },
};
/** Ivy clumps' spacing on the wall: one clump about every 0.24, each about 0.4 to 0.5 across, so they overlap into one lumpy mass. */
const IVY_STEP = 0.24;
/**
 * The ivy's clumps for a spec (x, y, z of each centre on the wall, radius r): each area is packed
 * on its own staggered grid, centred on its width (so a narrow pier of wall between two windows
 * still gets a full column), clumps already covered by another area's are skipped, and the edge
 * is made ragged by dropping a share of the outermost clumps (not a stem's) and jittering the rest.
 * A clump that would reach a `keep` box shrinks to fit beside it (down to 0.09) or is left out.
 */
export function ivyLumps(spec: IvySpec) {
  const out: { x: number; y: number; z: number; r: number }[] = [],
    h = (n: number) => plan.hash(spec.seed * 97 + n);
  // A clump spans r every way once spun (its 0.85 squash may stand upright).
  const clear = (x: number, y: number, r: number) => !spec.keep.some(([a, b, c, d]) => x + r > a && x - r < c && y + r > b && y - r < d);
  let k = 0;
  spec.areas.forEach(([a, b, c, d]) => {
    const cols = Math.max(1, Math.round((c - a) / IVY_STEP)),
      dx = (c - a) / cols,
      rows = Math.max(1, Math.round((d - b) / (IVY_STEP * 0.8))),
      dy = (d - b) / rows;
    for (let row = 0; row < rows; row++) {
      const odd = row % 2 === 1 && cols > 1,
        n = odd ? cols - 1 : cols;
      for (let col = 0; col < n; col++, k++) {
        // A ragged edge: the top row, and the sides of an area wider than a stem (a stem keeps its
        // clumps, or it parts into floating tufts).
        const edge = (cols > 2 && (col === 0 || col === n - 1)) || row === rows - 1;
        if (edge && h(k * 5 + 7) < 0.3) continue;
        const px = a + (col + (odd ? 1 : 0.5)) * dx + (h(k * 3) - 0.5) * 0.08,
          py = b + (row + 0.5) * dy + (h(k * 3 + 1) - 0.5) * 0.07;
        if (out.some((o) => Math.hypot(o.x - px, o.y - py) < IVY_STEP * 0.55)) continue;
        let r = IVY_STEP * (0.78 + 0.24 * h(k * 3 + 2));
        while (r >= 0.09 && !clear(px, py, r)) r *= 0.8;
        if (r < 0.09) continue;
        const p = spec.plinth,
          wall = p && py < p.h ? p.proud - (p.batter * py) / p.h : 0;
        out.push({ x: px, y: Math.max(py, r * 0.6), z: wall + r * 0.2, r });
      }
    }
  });
  return out;
}
/**
 * One ivy clump before its placing: the front of a smooth blob (the icosahedron's faces that do
 * not face the wall, 15 of its 20), since the wall hides the rest.
 */
const ivyBlob = (() => {
  const ico = new T.IcosahedronGeometry(1, 0),
    p = ico.getAttribute('position'),
    kept: number[] = [];
  for (let f = 0; f < p.count; f += 3)
    if (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2) > -1.2) for (let j = 0; j < 9; j++) kept.push(p.array[f * 3 + j]);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(kept, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(kept, 3));
  g.normalizeNormals();
  ico.dispose();
  return g;
})();
const unitBox = new T.BoxGeometry(1, 1, 1);
/**
 * Soft, rendered-object edges: every box thicker than a slab gets a small rounded edge,
 * so the environment light draws a highlight along it instead of a hard pixel step.
 * Geometries are shared per size; batching bakes them into the merged meshes anyway.
 */
const roundedBoxes = new Map<string, RoundedBoxGeometry>();
function roundedBox(w: number, h: number, d: number, radius: number, segments: number) {
  const key = [w, h, d, radius, segments].map((n) => n.toFixed(4)).join('|');
  let geometry = roundedBoxes.get(key);
  if (!geometry) {
    geometry = new RoundedBoxGeometry(w, h, d, segments, radius);
    roundedBoxes.set(key, geometry);
  }
  return geometry;
}

export function createKit(ctx: TownContext) {
  const { material, land } = ctx;
  function box(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
    kind?: SurfaceKind,
    opts: { bevel?: number; segments?: number; taper?: number; ry?: number; rx?: number; rz?: number } = {},
  ) {
    const mat = material(color, kind);
    const thinnest = Math.min(w, h, d);
    // Clash bevel: r = clamp(0.2*thinnest, 0.03, 0.12), x0.6 on iron and brass; plates under 0.1 stay sharp.
    // An explicit bevel overrides the automatic one ({ bevel: 0 } is sharp); under 0.06 is always sharp.
    const auto =
      thinnest >= 0.1
        ? T.MathUtils.clamp(0.2 * thinnest, 0.03, 0.12) * (METAL_KINDS.has(mat.userData.surfaceKind) ? 0.6 : 1)
        : 0;
    const radius = thinnest < 0.06 ? 0 : Math.min(opts.bevel ?? auto, thinnest * 0.45);
    let geometry: T.BufferGeometry = radius > 0 ? roundedBox(w, h, d, radius, opts.segments ?? 1) : unitBox;
    if (opts.taper && radius > 0) { // battered plinths: top ring pulled in by `taper`
      geometry = geometry.clone();
      const p = geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i) / h + 0.5;
        p.setX(i, p.getX(i) * (1 - (2 * opts.taper * t) / w));
        p.setZ(i, p.getZ(i) * (1 - (2 * opts.taper * t) / d));
      }
    }
    const m = new T.Mesh(geometry, mat);
    m.position.set(x, y, z);
    if (radius <= 0) m.scale.set(w, h, d);
    if (opts.ry) m.rotation.y = opts.ry;
    if (opts.rx) m.rotation.x = opts.rx;
    if (opts.rz) m.rotation.z = opts.rz;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function cylinder(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    rTop: number,
    rBottom: number,
    h: number,
    color: string,
    kind?: SurfaceKind,
    sides = 12,
  ) {
    // Thin posts and pivots need far fewer sides than towers and tanks.
    const rr = Math.max(rTop, rBottom);
    const smooth = sides < 5 ? sides : rr < 0.06 ? 8 : rr < 0.2 ? 12 : Math.max(sides, 18);
    const m = new T.Mesh(new T.CylinderGeometry(rTop, rBottom, h, smooth), material(color, kind));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  /** A round rod of radius r from a to b (ropes, stays). */
  function strut(g: T.Object3D, a: T.Vector3, b: T.Vector3, r: number, colour: string, kind: SurfaceKind) {
    const d = b.clone().sub(a),
      m = cylinder(g, 0, 0, 0, r, r, d.length(), colour, kind, 8);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    return m;
  }
  /** A cast-iron mooring bollard's profile (radius, height): a flared foot, a waisted neck, a fat head. */
  const BOLLARD = [[0, 0], [0.13, 0], [0.13, 0.035], [0.1, 0.06], [0.085, 0.2], [0.09, 0.24], [0.125, 0.27], [0.13, 0.3], [0.105, 0.335], [0, 0.345]].map(([r, y]) => new T.Vector2(r, y));
  /** A bollard standing on y: dark iron, 0.345 tall, 0.26 across at the foot (216 triangles). */
  function bollard(g: T.Object3D, x: number, y: number, z: number) {
    const m = new T.Mesh(new T.LatheGeometry(BOLLARD, 12), material('#3a3f44', 'iron'));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  /**
   * A rope through the points (a centripetal Catmull-Rom tube, 0.07 thick unless r says otherwise,
   * 10 triangles per 0.06). The tube is open-ended, so both end points must be buried: in a hull,
   * a pile, a bollard, a plank or the sand. Thin casters ghost in the shadow map, so a rope casts
   * only when asked.
   */
  function rope(g: T.Object3D, points: T.Vector3[], colour = palette.rope, opts: { r?: number; shadow?: boolean } = {}) {
    const curve = new T.CatmullRomCurve3(points, false, 'centripetal'),
      m = new T.Mesh(new T.TubeGeometry(curve, Math.ceil(curve.getLength() / 0.06), opts.r ?? 0.035, 5), material(colour, 'fabric'));
    m.castShadow = !!opts.shadow;
    m.receiveShadow = true;
    m.userData.noShadow = !opts.shadow;
    g.add(m);
    return m;
  }
  /** A rope eye of radius R lying flat round a post at (x, y, z): its tube is 0.08 thick, 0.005 fatter than the rope spliced into it. */
  function eye(g: T.Object3D, x: number, y: number, z: number, R: number, colour = palette.rope) {
    const m = new T.Mesh(new T.TorusGeometry(R, 0.04, 5, 12), material(colour, 'fabric'));
    m.position.set(x, y, z);
    m.rotation.x = Math.PI / 2;
    m.receiveShadow = true;
    m.userData.noShadow = true;
    g.add(m);
    return m;
  }
  /**
   * A flat coil lying on the surface at y: `turns` turns from radius r0 in the middle out to r1,
   * 12 points a turn, ending at endAngle, where it runs along (x, z) = (-sin, cos) of endAngle.
   * A 0.07 rope on r0 0.06 to r1 0.19 over 3 turns overlaps its neighbouring turn into a grooved
   * disc 0.45 across (under batch()'s 0.5 eave-cap size).
   */
  function coilPoints(x: number, y: number, z: number, r0: number, r1: number, turns: number, endAngle: number) {
    const n = turns * 12;
    return Array.from({ length: n + 1 }, (_, k) => {
      const t = k / n,
        a = endAngle - Math.PI * 2 * turns * (1 - t),
        r = r0 + (r1 - r0) * t;
      return new T.Vector3(x + r * Math.cos(a), y + 0.03 + 0.01 * t, z + r * Math.sin(a));
    });
  }
  function cone(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    color: string,
    kind?: SurfaceKind,
    sides = 4,
    ry = Math.PI / 4,
  ) {
    const smooth = sides < 5 ? sides : r < 0.2 ? 12 : Math.max(sides, 18);
    let geo: T.BufferGeometry = new T.ConeGeometry(r, h, smooth);
    if (smooth <= 6) { geo = geo.toNonIndexed(); geo.computeVertexNormals(); } // flat pyramid facets
    const m = new T.Mesh(geo, material(color, kind));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function sphere(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    r: number,
    color: string,
    kind?: SurfaceKind,
    segments = 12,
  ) {
    // Small spheres (flowers, hubs, finials) become icosahedra with smooth normals.
    const s = Math.max(segments, 18);
    const geo =
      r < 0.16
        ? new T.IcosahedronGeometry(r, 1)
        : r < 0.3
          ? new T.IcosahedronGeometry(r, 2)
          : new T.SphereGeometry(r, s, Math.round(s * 0.7));
    const m = new T.Mesh(geo, material(color, kind));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  /** A boat hull plan in shape space: a rounded bow at -y (local +z after rotateX(-PI/2)), a square stern. */
  function hullShape(hw: number, bow: number, stern: number) {
    const s = new T.Shape(), q = Math.min(0.45, stern * 0.4);
    s.moveTo(-hw * 0.82, stern); s.lineTo(hw * 0.82, stern); s.quadraticCurveTo(hw, stern, hw, stern - q); s.lineTo(hw, -bow * 0.15);
    s.quadraticCurveTo(hw * 0.96, -bow * 0.8, 0, -bow); s.quadraticCurveTo(-hw * 0.96, -bow * 0.8, -hw, -bow * 0.15); s.lineTo(-hw, stern - q); s.quadraticCurveTo(-hw, stern, -hw * 0.82, stern);
    return s;
  }
  /** A bevelled hull solid: spans y0 .. y0+depth+2*bevel, half-width hw+bevel, bow towards local +z. */
  function hullSolid(g: T.Object3D, hw: number, bow: number, stern: number, y0: number, depth: number, bevel: number, colour: string, kind: SurfaceKind) {
    const geo = new T.ExtrudeGeometry(hullShape(hw, bow, stern), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
    geo.rotateX(-Math.PI / 2).translate(0, y0 + bevel, 0);
    const m = new T.Mesh(geo, material(colour, kind)); m.castShadow = m.receiveShadow = true; g.add(m); return m;
  }
  /**
   * A pitched roof along the local x axis: a pentagon profile with a short fascia at the eaves,
   * bevelled ends and a fat ridge cap. For small roofs (hut, dormers); buildings use slabRoof.
   */
  function pitchedRoof(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    rise: number,
    color = palette.slate,
    opts: { ridge?: boolean; ridgeColor?: string } = {},
  ) {
    const f = Math.min(0.16, 0.3 * rise),
      b = 0.03;
    const shape = new T.Shape();
    shape.moveTo(-d / 2, 0);
    shape.lineTo(d / 2, 0);
    shape.lineTo(d / 2, f);
    shape.lineTo(0, rise);
    shape.lineTo(-d / 2, f);
    shape.closePath();
    const mesh = new T.Mesh(
      new T.ExtrudeGeometry(shape, {
        depth: w - 2 * b,
        bevelEnabled: true,
        bevelThickness: b,
        bevelSize: b,
        bevelOffset: -b,
        bevelSegments: 1,
      }),
      material(color, roofKind(color)),
    );
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(x - w / 2 + b, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    // An overhang for the eave bake, measured from the wall plate.
    mesh.userData.roof = true;
    mesh.userData.eaveY = y;
    g.add(mesh);
    const ridge = opts.ridgeColor ?? palette.slateLight;
    if (opts.ridge !== false) box(g, x, y + rise - 0.01, z, w + 0.04, 0.12, 0.2, ridge, roofKind(ridge));
    return mesh;
  }
  /** Two rounded 0.2 slabs on the plate edges (+-d/2 at y), eave/verge overhang, 0.16x0.26 ridge, stone gables tucked under. Ridge along x. Returns ridge top. */
  function slabRoof(g: T.Object3D, x: number, y: number, z: number, w: number, d: number, rise: number, color: string, opts: { eave?: number; verge?: number; thick?: number; ridge?: string; gable?: string; inset?: number } = {}) {
    const e = opts.eave ?? 0.4, v = opts.verge ?? 0.25, t = opts.thick ?? 0.2, half = d / 2;
    const a = Math.atan2(rise, half), s = Math.sin(a), c = Math.cos(a);
    const len = (half + e + t * s) / c, zc = (half + e) / 2;
    const yc = y + rise - ((half + e - t * s) / 2) * Math.tan(a) + (c * t) / 2;
    for (const side of [-1, 1]) {
      const plate = box(g, x, yc, z + side * zc, w + 2 * v, t, len, color, roofKind(color), { rx: side * a });
      // A sloped slab's box drops below the wall top, so it says where its eave is (Step 5 bake).
      plate.userData.roof = true;
      plate.userData.eaveY = y;
    }
    const top = y + rise + t / c;
    const ridge = opts.ridge ?? palette.slateLight;
    box(g, x, top - 0.03, z, w + 2 * v + 0.06, 0.16, 0.26, ridge, roofKind(ridge));
    if (opts.gable) {
      const inner = half - (opts.inset ?? 0.15), k = (half - inner) * Math.tan(a) - 0.02;
      const sh = new T.Shape(); sh.moveTo(-inner, 0); sh.lineTo(inner, 0);
      if (k > 0.01) sh.lineTo(inner, k); sh.lineTo(0, rise - 0.02); if (k > 0.01) sh.lineTo(-inner, k); sh.closePath();
      const geo = new T.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: false });
      for (const side of [-1, 1]) { const m = new T.Mesh(geo, material(opts.gable, 'stone')); m.rotation.y = Math.PI / 2; m.position.set(x + side * w / 2 - (side > 0 ? 0.16 : 0), y, z); m.castShadow = m.receiveShadow = true; g.add(m); }
    }
    return top;
  }
  /**
   * A bevelled frame ring, extruded `deep` out of the wall face at z: rectangular or arched,
   * closed (a window) or open at the foot (an arched doorway). Returns the ring outline maker.
   */
  function frameRing(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    f: number,
    deep: number,
    color: string,
    kind: SurfaceKind,
    arched = false,
    open = false,
  ) {
    const r=w/2, s=new T.Shape();
    const ring=(grow:number)=>{ const p=new T.Shape(); p.moveTo(-r-grow,-h/2-grow); p.lineTo(r+grow,-h/2-grow); if(arched){p.lineTo(r+grow,h/2); p.absarc(0,h/2,r+grow,0,Math.PI,false);} else {p.lineTo(r+grow,h/2+grow); p.lineTo(-r-grow,h/2+grow);} p.closePath(); return p; };
    let outline=s;
    if(open){ s.moveTo(-r-f,-h/2); s.lineTo(-r,-h/2); s.lineTo(-r,h/2); if(arched) s.absarc(0,h/2,r,Math.PI,0,true); else s.lineTo(r,h/2); s.lineTo(r,-h/2); s.lineTo(r+f,-h/2); if(arched){ s.lineTo(r+f,h/2); s.absarc(0,h/2,r+f,0,Math.PI,false);} else { s.lineTo(r+f,h/2+f); s.lineTo(-r-f,h/2+f);} s.closePath(); }
    else { outline=ring(f); outline.holes.push(ring(0)); }
    const b=0.02, m=new T.Mesh(new T.ExtrudeGeometry(outline,{depth:deep-2*b,bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelOffset:-b,bevelSegments:1,curveSegments:8}),material(color,kind));
    m.position.set(x,y,z+b); m.castShadow=m.receiveShadow=true; g.add(m); return ring;
  }
  /**
   * A window: one chunky bevelled frame proud of the wall face at z, glass recessed 0.1 behind
   * the frame face, a chunky sill and lintel (a keystone on arched ones). Faces local +z.
   * Returns the glass pane (for its night-light tags).
   * `bars` is accepted for old callers and ignored: no glazing bars.
   */
  function windowAt(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    opts: { arched?: boolean; frame?: string; dress?: string; sill?: boolean; lintel?: boolean; mullion?: boolean; glass?: string; bars?: number } = {},
  ) {
    const f=0.11, r=w/2, frame=opts.frame??palette.trim, dress=opts.dress??palette.trim;
    const frameKind: SurfaceKind = frame === palette.metal ? 'iron' : 'paint'; // cream and dressed frames stay matte
    const ring=frameRing(g,x,y,z,w,h,f,0.16,frame,frameKind,opts.arched);
    const glass=new T.Mesh(new T.ShapeGeometry(ring(0.01),8),material(opts.glass??palette.glass,'glass'));
    glass.position.set(x,y,z+0.06); g.add(glass); // 0.1 behind the frame face
    if(opts.mullion) box(g,x,y,z+0.08,0.08,h,0.06,frame,frameKind);
    if(opts.sill!==false) box(g,x,y-h/2-f-0.05,z+0.11,w+2*f+0.16,0.1,0.22,dress,'stone');
    if(opts.lintel!==false){ if(opts.arched) box(g,x,y+h/2+r+f+0.1,z+0.1,0.24,0.32,0.2,dress,'stone'); else box(g,x,y+h/2+f+0.09,z+0.09,w+2*f+0.2,0.18,0.18,dress,'stone'); }
    return glass;
  }
  /*
   * The canted bay kit (Glasgow sandstone bays on the three homes). A bay is a trapezoid in a
   * wall's plan: its roots on the wall face at z0, `root` apart; its front `depth` out and
   * `cant` narrower on each side. Everything stands on a shell's own plan (x along the wall,
   * +z out of it).
   */
  /** Root-left, front-left, front-right, root-right, `grow` beyond the faces (a cheek moved out meets the wall wider). */
  function bayOutline(b: Bay, grow = 0): [number, number][] {
    const out = (grow * Math.hypot(b.depth, b.cant)) / b.depth, root = b.root / 2 + out,
      front = root - ((b.depth + grow) * b.cant) / b.depth, z1 = b.z0 + b.depth + grow;
    return [[b.x - root, b.z0], [b.x - front, z1], [b.x + front, z1], [b.x + root, b.z0]];
  }
  /** The bay plan extruded y0..y1, tucked 0.04 into the wall, top and bottom edges chamfered like pitchedRoof. */
  function cantedPrism(g: T.Object3D, b: Bay, y0: number, y1: number, colour: string, kind: SurfaceKind = 'stone', grow = 0) {
    const p = bayOutline(b, grow), back = b.z0 - 0.04, bev = Math.min(0.03, (y1 - y0) / 4);
    const shape = new T.Shape([[p[0][0], back], ...p, [p[3][0], back]].map(([x, z]) => new T.Vector2(x, -z)));
    const geo = new T.ExtrudeGeometry(shape, { depth: y1 - y0 - 2 * bev, bevelEnabled: true, bevelThickness: bev,
      bevelSize: bev, bevelOffset: -bev, bevelSegments: 1 }).rotateX(-Math.PI / 2).translate(0, y0 + bev, 0);
    const m = new T.Mesh(geo, material(colour, kind)); m.castShadow = m.receiveShadow = true; g.add(m); return m;
  }
  /**
   * A group per bay face on its plane (local +z out of the face, x along it): the front first,
   * then the left and right cheeks. `arris` is the local x sign toward the front angle (0 on the
   * front). The order is load-bearing: a window group's first pane is the front's (night windows).
   */
  function bayFaces(g: T.Object3D, b: Bay) {
    const p = bayOutline(b);
    return [1, 0, 2].map((i) => {
      const [ax, az] = p[i], [bx, bz] = p[i + 1], face = new T.Group();
      face.position.set((ax + bx) / 2, 0, (az + bz) / 2);
      face.rotation.y = Math.atan2(az - bz, bx - ax);
      g.add(face);
      return { face, length: Math.hypot(bx - ax, bz - az), arris: i === 0 ? 1 : i === 2 ? -1 : 0 };
    });
  }
  /**
   * A sash window on the face at z: a slim 0.05 painted frame `win.deep` proud (0.08), two panes
   * (the upper sash 0.02 in front, on the outer track) and a 0.05 meeting rail. `win.single` makes
   * it one fixed light instead (a cheek light): one pane, no rail, so a bay reads as glass rather
   * than a lattice of small frames. (Frames 0.08 wide and 0.12 deep hid half the glass of a narrow
   * bay seen at an angle, which then read as stacked frames.) Each pane is its own centred plane,
   * never rotated or pre-merged, so batch() gives it pane-centred glint coordinates and its own
   * upward gradient. Every pane carries `userData.windowGroup = win.group` (one light at night: the
   * group's first pane, the lower one, draws it) and `sashPane`; `win.lit` adds `windowLit` (kept
   * lit late).
   */
  function sash(g: T.Object3D, x: number, y: number, z: number, w: number, h: number, frame: string,
    win: { group: string; lit?: boolean; single?: boolean; deep?: number }) {
    const rail = 0.05, ph = win.single ? h : (h - rail) / 2;
    frameRing(g, x, y, z, w, h, 0.05, win.deep ?? 0.08, frame, 'paint');
    const panes: (readonly [number, number])[] = win.single ? [[0, 0.03]] : [[-1, 0.03], [1, 0.05]]; // lower pane first
    for (const [s, dz] of panes) {
      const pane = new T.Mesh(new T.PlaneGeometry(w + 0.02, ph + 0.01), material(palette.glass, 'glass'));
      pane.position.set(x, y + (s * (ph + rail)) / 2, z + dz);
      pane.userData.windowGroup = win.group;
      pane.userData.sashPane = true;
      if (win.lit) pane.userData.windowLit = true;
      g.add(pane);
    }
    if (!win.single) box(g, x, y, z + 0.06, w + 0.02, rail, 0.04, frame, 'paint'); // 0.04 deep, so a sharp 12-triangle box
  }
  /** A piended bay roof: three facets to one apex on the wall, and a soffit (the shadow pass draws back faces). A bay cap. */
  function bayRoof(g: T.Object3D, b: Bay, yEave: number, rise: number, colour: string) {
    const [p0, p1, p2, p3] = bayOutline(b, 0.12).map(([x, z]) => new T.Vector3(x, yEave, z)),
      a = new T.Vector3(b.x, yEave + rise, b.z0 - 0.05);
    const geo = new T.BufferGeometry().setFromPoints([p0, p1, a, p1, p2, a, p2, p3, a, p0, p2, p1, p0, p3, p2]);
    geo.computeVertexNormals(); // non-indexed, so flat facets; facets face up and out, the soffit down
    const m = new T.Mesh(geo, material(colour, roofKind(colour)));
    m.castShadow = m.receiveShadow = true;
    Object.assign(m.userData, { roof: true, eaveY: yEave, bayCap: true });
    g.add(m);
    return m;
  }
  /**
   * A door on the wall face at z: one enamelled leaf with a raised rim (the centre reads recessed),
   * a round brass knob, a 0.18 stone surround and, when the sill y is above the ground, nested 0.14
   * risers that stand on y=0. `fanlight` is accepted for old callers and ignored; `arched` is the
   * arched variant.
   */
  function door(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    color: string,
    opts: { arched?: boolean; fanlight?: boolean; surround?: string; width?: number; landing?: number; steps?: boolean | number } = {},
  ) {
    const s=opts.surround??palette.trim, f=0.18;
    box(g,x,y+h/2,z+0.05,w,h,0.1,color,'enamel');
    for(const sx of [-1,1]) box(g,x+sx*(w/2-0.08),y+h/2,z+0.12,0.16,h,0.04,color,'enamel');
    for(const ry of [0.08,h-0.08]) box(g,x,y+ry,z+0.12,w-0.32,0.16,0.04,color,'enamel'); // centre reads 0.04 recessed
    sphere(g,x+w*0.3,y+h*0.5,z+0.17,0.05,palette.brass,'brass'); // round, so it can carry a highlight
    if(opts.arched){ const fan=new T.Shape(); fan.absarc(0,0,w/2,0,Math.PI,false); fan.closePath();
      const gl=new T.Mesh(new T.ShapeGeometry(fan,8),material(palette.glass,'glass')); gl.position.set(x,y+h,z+0.06); g.add(gl);
      frameRing(g,x,y+h/2,z,w,h,0.2,0.24,s,'stone',true,true); box(g,x,y+h+w/2+0.2,z+0.12,0.28,0.36,0.24,s,'stone'); }
    else { for(const sx of [-1,1]) box(g,x+sx*(w/2+f/2),y+(h+f)/2,z+0.1,f,h+f,0.2,s,'stone'); box(g,x,y+h+0.11,z+0.12,w+2*f+0.16,0.22,0.24,s,'stone'); }
    if(opts.steps===false) return;
    const landing=opts.landing??0, n=y>0.05?Math.max(1,Math.round(y/0.14)):0;
    for(let i=landing>0?1:0;i<n;i++){ const tread=y-(i*y)/n, front=landing+(landing>0?i:i+1)*0.3;
      box(g,x,tread/2,z+(front-0.05)/2,(opts.width??w+0.5)+i*0.08,tread,front+0.05,palette.plinth,'stone'); }
  }
  /**
   * Corner quoins from y0 to y1: 0.45-tall blocks alternating long and short by index, tucked into
   * the wall corner so only 0.06 stands proud. `front` caps the block length on the front face;
   * `corners: 'front'` dresses the two front corners only.
   */
  function quoins(g: T.Object3D, w: number, d: number, y0: number, y1: number, color: string, opts: { front?: number; corners?: 'all' | 'front' } = {}) {
    const proud=0.06, tall=0.45, n=Math.max(2,Math.floor((y1-y0+0.07)/(tall+0.07))), step=(y1-y0-tall)/(n-1);
    for(const sx of [-1,1]) for(const sz of opts.corners==='front'?[1]:[-1,1]) for(let i=0;i<n;i++){
      const long=i%2===0, lx=Math.min(long?0.45:0.3,opts.front??0.45), lz=long?0.3:0.45;
      box(g,sx*(w/2+proud-lx/2),y0+tall/2+i*step,sz*(d/2+proud-lz/2),lx,tall,lz,color,'stone'); }
  }
  /** A battered, grounded base (6 degree batter) w x d plus `proud` all round, with an optional rusticated block row. Returns its height. */
  function plinth(g: T.Object3D, w: number, d: number, color: string, opts: { x?: number; z?: number; height?: number; proud?: number; blocks?: boolean } = {}) {
    const ph=opts.height??0.42, p=opts.proud??0.25, x=opts.x??0, z=opts.z??0;
    box(g,x,ph/2,z,w+2*p,ph,d+2*p,color,'stone',{taper:ph*0.105}); // 6 degree batter
    if(opts.blocks){ const run=w+2*p-0.1, n=Math.max(2,Math.round(run/0.65)), len=run/n;
      for(const sz of [-1,1]) for(let i=0;i<n;i++) box(g,x-run/2+len*(i+0.5),ph*0.42,z+sz*(d/2+p-0.02),len-0.05,ph*0.72,0.12,i%2?color:'#b89c6c','stone'); }
    return ph;
  }
  /** A fat chimney stack from y0 to top with a cap and `pots` pantile pots. */
  function chimney(g: T.Object3D, x: number, y0: number, top: number, z: number, color: string, cap: string, pots = 2) { box(g,x,(y0+top)/2,z,0.7,top-y0,0.85,color,'stone'); box(g,x,top+0.08,z,0.86,0.16,1.01,cap,'stone'); for(let i=0;i<pots;i++) cylinder(g,x,top+0.31,z+(pots===1?0:(i-0.5)*0.36),0.11,0.13,0.3,palette.pantile,'pantile',18); }
  /**
   * Glass for a lamp, which the frame loop lights at night. Lamps are never batched, so they miss
   * the glass spec patch; frosted, a globe shows one soft highlight instead of pinpoint specks.
   */
  function lampGlass() {
    const glass = material(palette.lantern, 'glass').clone();
    glass.emissive.set(palette.lantern);
    glass.roughness = 0.3;
    return glass;
  }

  /**
   * Ivy on a face (local +z out of the wall): one mesh of soft leaf clumps (the fronts of smooth blobs,
   * flattened against the wall) over ivyLumps(spec), in the season's IVY tones. Each clump is a
   * shade of its own; clumps darken toward the ground, and their up- and out-facing
   * sides take the lighter `top`, so the patch reads as layered leaves rather than a green slab.
   */
  function ivy(g: T.Object3D, spec: IvySpec) {
    const look = IVY[ctx.season],
      top = new T.Color(look.top),
      c = new T.Color(),
      m4 = new T.Matrix4(),
      q = new T.Quaternion(),
      h = (n: number) => plan.hash(spec.seed * 131 + n);
    const parts = ivyLumps(spec).map(({ x, y, z, r }, k) => {
      const geo = ivyBlob.clone();
      q.setFromEuler(new T.Euler(0, 0, h(k) * Math.PI));
      geo.applyMatrix4(m4.compose(new T.Vector3(x, y, z), q, new T.Vector3(r, r * 0.85, r * 0.55)));
      const base = new T.Color(look.tones[Math.floor(h(k + 0.5) * look.tones.length)]),
        value = (0.84 + 0.18 * Math.min(1, y / 1.2)) * (0.9 + 0.14 * h(k + 0.25)),
        n = geo.getAttribute('normal'),
        colour = new Float32Array(n.count * 3);
      for (let i = 0; i < n.count; i++) {
        const lift = Math.max(0, n.getY(i) * 0.6 + n.getZ(i) * 0.4);
        c.copy(base).lerp(top, 0.35 * lift * lift).multiplyScalar(value);
        colour.set([c.r, c.g, c.b], i * 3);
      }
      geo.setAttribute('color', new T.BufferAttribute(colour, 3));
      return geo;
    });
    if (!parts.length) return undefined;
    const geometry = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    const m = new T.Mesh(geometry, material('#ffffff', 'foliage'));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }

  const groundRay = new T.Raycaster(),
    down = new T.Vector3(0, -1, 0);
  /** The built island ground's height at (x, z): its triangles, not the smooth terrainHeight they sample. */
  function groundY(x: number, z: number) {
    const ground = land.getObjectByName('island-ground');
    groundRay.set(new T.Vector3(x, 10, z), down);
    const hit = ground ? groundRay.intersectObject(ground, false)[0] : undefined;
    return hit ? hit.point.y : plan.terrainHeight(x, z);
  }
  return { box, cylinder, strut, bollard, rope, eye, coilPoints, cone, sphere, hullShape, hullSolid, pitchedRoof, slabRoof, frameRing, windowAt, bayOutline, cantedPrism, bayFaces, sash, bayRoof, door, quoins, plinth, chimney, lampGlass, groundY, ivy };
}
export type Kit = ReturnType<typeof createKit>;
