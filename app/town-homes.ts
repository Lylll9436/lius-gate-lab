import * as T from 'three';
import * as plan from './town-plan';
import type { Season } from './glasgow-sun';
import { palette, hash, type TownContext } from './town-shared';
import type { Bay, Kit } from './town-kit';
import { bakeRamp, type Nature } from './town-nature';

/** A colour with its HSL saturation cut by `k` (0..1): window-box blooms and painted boxes stay calmer than the beds. */
export function muted(hex: string, k: number) {
  const c = new T.Color(hex), hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return '#' + c.setHSL(hsl.h, hsl.s * (1 - k), hsl.l).getHexString();
}
/**
 * What the window boxes hold through the year: a leafy mound (`leaf`, lime `top`) with blooms from
 * palette.flowers, muted, from spring to autumn (daffodil yellow and primrose white in spring,
 * geranium red and pink in summer, pansy purple and gold in autumn), and in winter dark evergreen
 * sprigs with a few tufts of winter heather.
 */
const [RED, YELLOW, PINK, WHITE, PURPLE] = palette.flowers;
export const WINDOW_BOX: Record<Season, { leaf: string; top: string; blooms: string[]; sprigs: number }> = {
  spring: { leaf: '#5b8a34', top: '#93bb3a', blooms: [YELLOW, WHITE, YELLOW, PINK, YELLOW].map((c) => muted(c, 0.3)), sprigs: 0 },
  summer: { leaf: '#4f7f2e', top: '#86b234', blooms: [RED, PINK, WHITE, RED, PURPLE].map((c) => muted(c, 0.3)), sprigs: 0 },
  autumn: { leaf: '#5a7634', top: '#8a9a3e', blooms: [PURPLE, YELLOW, PURPLE, WHITE].map((c) => muted(c, 0.3)), sprigs: 0 },
  winter: { leaf: '#3f6236', top: '#5e7f45', blooms: ['#b48aa2', '#b48aa2'], sprigs: 2 },
};
/** The cottage (plan.cottages index) with ivy on its blank +x gable. */
export const IVY_COTTAGE = 0;
/** A small smooth blob (20 triangles): a window-box bloom, heather tuft or trailing leaf. */
const blobGeometry = (() => {
  const g = new T.IcosahedronGeometry(1, 0);
  g.setAttribute('normal', g.getAttribute('position').clone());
  g.normalizeNormals();
  return g;
})();

/**
 * Each terrace home's back green (the lawn between its back wall and the beach) has a washing line,
 * in the home's own frame (front +z): two T-posts `back` behind the wall face, `half` either side of
 * the home's middle (inside its 2.6 width, so never in a gap between homes), and two lines `spread`
 * either side of the crossbars' middle, `height` up.
 */
export const WASHING = { back: 1.4, half: 0.95, height: 1.45, spread: 0.15 };
type Garment = 'sheet' | 'towel' | 'shirt' | 'cloth';
/**
 * What hangs on each home's lines (by its seed): [line (-1 the beach side, 1 the house side), what,
 * x along the line, colour, stripe]. Muted colours, each within a palette family (white, sandstone,
 * glass, brass, heather, hedge); the two lines' pieces never overlap along the line.
 */
const LAUNDRY: [number, Garment, number, string, string?][][] = [
  [[-1, 'sheet', -0.45, '#ece6d8'], [-1, 'towel', 0.55, '#cf9a80', '#b07a64'], [1, 'shirt', 0.05, '#a9bccb']],
  [[-1, 'towel', -0.55, '#d8bc7c', '#b39858'], [-1, 'sheet', 0.3, '#dfe3d6'], [1, 'shirt', -0.2, '#efe9dc'], [1, 'cloth', 0.72, '#c9b8a8', '#a08878']],
  [[-1, 'shirt', -0.5, '#b7a6bf'], [-1, 'sheet', 0.3, '#e8e0d0'], [1, 'towel', -0.05, '#9fb3a0', '#7f977f']],
];

/* ------------------------------------------------------------------ */
/* Homes: the terrace row and the cottages                             */
/* ------------------------------------------------------------------ */
export function createHomes(ctx: TownContext, kit: Kit, nature: Nature) {
  const { material, season, animated } = ctx;
  const { box, cylinder, cone, sphere, slabRoof, windowAt, door, quoins, plinth, chimney, bayOutline, cantedPrism, bayFaces, sash, bayRoof, ivy } = kit;
  const { hedge, flowerBed } = nature;
  /** A blob of radius r, squashed to `squash` of its height, that casts no shadow. */
  function blob(g: T.Object3D, x: number, y: number, z: number, r: number, colour: string, squash = 0.75) {
    const m = new T.Mesh(blobGeometry, material(colour, 'foliage'));
    m.position.set(x, y, z);
    m.scale.set(r, r * squash, r);
    m.rotation.y = hash(x * 17 + z * 5) * 3;
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.noShadow = true;
    g.add(m);
    return m;
  }
  /**
   * A window box on a face (local +z out of the wall): a painted timber box `length` long and
   * `depth` deep from its back at z, its foot at y, holding a leafy mound and the season's planting
   * (WINDOW_BOX). It stands in front of the window frame and below the glass: seen from the town's
   * camera (42.6 degrees down) the planting's tops fall below the glass's foot.
   */
  function windowBox(g: T.Object3D, x: number, y: number, z: number, length: number, depth: number, paint: string, seed: number) {
    const H = 0.12,
      look = WINDOW_BOX[season],
      zc = z + depth / 2;
    box(g, x, y + H / 2, zc, length, H, depth, paint, 'paint');
    bakeRamp(box(g, x, y + H + 0.015, zc, length - 0.05, 0.07, depth - 0.035, '#ffffff', 'foliage', { bevel: 0.03 }), look.leaf, 0.85, 1.05, look.top, 0.4);
    // Fewer, fatter blooms read as flowers; a row of small ones reads as beads. Each stays inside
    // the box's front face (r at most 0.55 of its depth).
    const n = Math.max(3, Math.round(length / 0.17)),
      top = y + H + 0.04,
      big = Math.min(0.064, depth * 0.52);
    for (let i = 0; i < n; i++) {
      const r = big * (0.85 + 0.15 * hash(seed + i * 5)),
        along = ((i + 0.5) / n - 0.5) * (length - 2 * big - 0.02) + (hash(seed + i * 11) - 0.5) * 0.03,
        across = (hash(seed + i * 7) - 0.5) * Math.max(0, depth - 2 * r - 0.01);
      if (look.sprigs && i % 2 === 0) {
        // Winter: a little dark conifer sprig between the heather tufts.
        const sprig = cone(g, x + along, top + 0.045, zc + across, r * 0.8, 0.15, '#3a5a34', 'foliage', 6, hash(seed + i));
        sprig.castShadow = false;
        sprig.userData.noShadow = true;
      } else blob(g, x + along, top + 0.01 * hash(seed + i * 3), zc + across, r, look.blooms[(seed + i) % look.blooms.length]);
    }
  }
  /** A piece of cloth hung from y = 0 (its top edge on the line): a thin slab with soft vertical folds, casting nothing. */
  function cloth(g: T.Object3D, x: number, z: number, w: number, h: number, colour: string, folds: number, y = 0) {
    const geo = new T.BoxGeometry(w, h, 0.025, folds, 1, 1),
      p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 0.016 * Math.sin((p.getX(i) / w + 0.5) * Math.PI * folds));
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, material(colour, 'fabric'));
    m.position.set(x, y - h / 2 - 0.004, z);
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.noShadow = true;
    g.add(m);
    return m;
  }
  /**
   * The back green's washing: two painted T-posts (part of the home) and, between their crossbars,
   * two lines with the home's LAUNDRY. The lines and the washing are one group pivoting on the
   * crossbars' middle, so the frame loop sways it by turning that one group a little (no vertex is
   * moved), and takes it all in, lines and all, while it rains (as a Glasgow back court's ropes were
   * put up on washing day). It casts nothing, like the drying net on the beach.
   */
  function washingLine(shell: T.Group, d: number, seed: number) {
    const { back, half, height: H, spread } = WASHING,
      z = -(d / 2 + back),
      pole = '#8f8270'; // weathered paint, between the lawn and the stone in value
    for (const s of [-1, 1]) {
      box(shell, s * half, (H + 0.07) / 2, z, 0.08, H + 0.07, 0.08, pole, 'paint');
      box(shell, s * half, H, z, 0.07, 0.07, 2 * spread + 0.12, pole, 'paint');
    }
    const wash = new T.Group();
    wash.name = 'washing';
    wash.position.set(0, H, z);
    wash.userData.keepSeparate = true;
    shell.add(wash);
    for (const s of [-1, 1]) {
      // Each end buried in a crossbar; a gentle sag between.
      const curve = new T.QuadraticBezierCurve3(new T.Vector3(-half, 0, s * spread), new T.Vector3(0, -0.07, s * spread), new T.Vector3(half, 0, s * spread)),
        line = new T.Mesh(new T.TubeGeometry(curve, 8, 0.012, 4), material('#e9e4d8', 'fabric'));
      line.castShadow = false;
      line.userData.noShadow = true;
      wash.add(line);
    }
    const sag = (x: number) => -0.07 * (1 - (x / half) ** 2);
    for (const [s, what, x, colour, stripe] of LAUNDRY[seed % LAUNDRY.length]) {
      const lz = s * spread,
        y = sag(x);
      if (what === 'sheet') cloth(wash, x, lz, 0.65, 0.52, colour, 4, y);
      else if (what === 'towel' || what === 'cloth') {
        const [w, h] = what === 'towel' ? [0.32, 0.48] : [0.25, 0.32];
        cloth(wash, x, lz, w, h, colour, 2, y);
        box(wash, x, y - h + 0.08, lz, w + 0.004, 0.05, 0.03, stripe ?? colour, 'fabric').userData.noShadow = true;
      } else {
        // A shirt pegged by its shoulders: the body and two sleeves hanging out and down.
        cloth(wash, x, lz, 0.34, 0.38, colour, 2, y);
        for (const side of [-1, 1]) {
          const sleeve = box(wash, x + side * 0.21, y - 0.1, lz, 0.13, 0.18, 0.022, colour, 'fabric', { rz: side * 0.5 });
          sleeve.castShadow = false;
          sleeve.userData.noShadow = true;
        }
      }
    }
    wash.traverse((o) => { if (o instanceof T.Mesh) o.castShadow = false; });
    const phase = seed * 1.7;
    const update = (time: number, _night: number, rain = 0) => {
      // Taken in once the rain sets in: hidden, and shrunk to its pivot so Inspect's copy (which
      // follows the group's pose, not its visibility) is taken in with it.
      const dry = rain < 0.25;
      wash.visible = dry;
      wash.scale.setScalar(dry ? 1 : 1e-3);
      // A breeze off the sea: a slight lean toward the house and a slow, uneven sway.
      wash.rotation.x = -0.05 + 0.06 * Math.sin(time * 1.1 + phase) + 0.025 * Math.sin(time * 2.6 + phase * 2);
    };
    update(0, 0, 0);
    animated.push({ object: wash, update });
  }
  function buildTerrace(shell: T.Group, site: plan.Site, variant: 'villa' | 'red-tenement' | 'gabled-house', seed: number) {
    const w = site.w,
      d = site.d;
    // Squat walls under a big roof: a 0.42 plinth and 2.6 of wall, so the roof is about 43% of the height.
    const P = 0.42,
      h = 2.6,
      top = P + h,
      roofY = top + 0.2; // 3.22: on the cornice
    const red = variant === 'red-tenement';
    const stone = variant === 'villa' ? palette.blonde : red ? palette.red : palette.pale;
    const dress = variant === 'villa' ? palette.trim : red ? palette.trimRed : palette.blonde;
    const base = red ? palette.plinthRed : palette.plinth;
    const doorColor = variant === 'villa' ? palette.greenDoor : red ? palette.blueDoor : palette.redDoor;
    plinth(shell, w, d, base, { height: P, proud: 0.25 });
    box(shell, 0, P + h / 2, 0, w, h, d, stone, 'stone');
    quoins(shell, w, d, P, top, dress, { front: 0.25, corners: 'front' });
    box(shell, 0, top + 0.1, 0, w + 0.3, 0.2, d + 0.3, dress, 'stone');
    // The signature bay: a Glasgow canted sandstone bay in the 1.06 slot between the left quoins
    // and the doorpiece. Its cheeks meet the wall at 67 degrees (the slot is too narrow for 45),
    // so from any bearing the front and a cheek read as two tones meeting at an angle. On every
    // storey the front has a sash window (0.46 glass in the 0.6 front, slim frames and one meeting
    // rail) and each cheek a single 0.30 light whose frame stands only 0.06 proud, so the bay reads
    // as glass, not a stack of frames (0.36 and 0.20 lights under 0.08 frames kept about half the
    // old box bays' glass), and the door-side frame keeps stone clear of the lintel end. Each home's bay differs in its
    // top: Pengyuan's villa bay is one storey under a stone balustrade, Yunlong's rises two
    // storeys to the main eave, Qin's two under its own slate roof.
    // Window groups (stable ids, read by the night lights; each group is one light, drawn from
    // its first pane, the front's lower one): `<id>-bay-0` the ground storey (kept lit late) and
    // `<id>-bay-1` the upper storey (Yunlong's and Qin's two-storey bays only).
    const first = shell.children.length; // from here to the bay's top, everything is bay (tagged at the end)
    const bay: Bay = { x: -0.68, z0: d / 2, root: 1.06, depth: 0.55, cant: 0.23 },
      faces = bayFaces(shell, bay);
    const storey = (n: number, y: number, h: number) => faces.forEach(({ face, arris }) =>
      sash(face, arris * 0.07, y, 0, arris ? 0.3 : 0.46, h, dress,
        { group: `${site.id}-bay-${n}`, lit: n === 0, single: arris !== 0, deep: arris ? 0.06 : 0.08 }));
    cantedPrism(shell, bay, 0, P, base, 'stone', 0.06); // footing on the plinth line
    cantedPrism(shell, bay, 0.56, 0.68, dress, 'stone', 0.06).userData.band = true; // sill course; frames sit on it
    cantedPrism(shell, bay, P, 1.76, stone); // ground storey
    storey(0, 1.2, 0.86); // glass 0.77-1.63, frames 0.69-1.71
    // A window box on the front's sill course, in front of the frame and under the glass's foot
    // (0.765); painted like the door. Inside z 2.85, as everything above 0.7 on the bay is.
    windowBox(faces[0].face, 0, 0.6, 0.085, 0.58, 0.105, muted(doorColor, 0.25), seed * 13 + 3);
    if (variant === 'villa') {
      // The West End main-door villa: a cornice (its cap, front at z 2.74) under a stone balustrade.
      cantedPrism(shell, bay, 1.76, 1.96, dress, 'stone', 0.09).userData.bayCap = true;
      // Dies 0.04 inside each front angle, along its bisector, so their outer corners end flush with the
      // cornice. Each carries a ball sunk 0.02 into its top.
      const [, fl, fr] = bayOutline(bay),
        a = Math.atan2(bay.depth, bay.cant + Math.hypot(bay.depth, bay.cant)); // 0.587
      for (const [[x, z], s] of [[fl, -1], [fr, 1]] as const) {
        const cx = x - s * 0.04 * Math.sin(a),
          cz = z - 0.04 * Math.cos(a);
        box(shell, cx, 2.18, cz, 0.18, 0.44, 0.18, dress, 'stone', { ry: s * a }); // 1.96-2.40
        sphere(shell, cx, 2.45, cz, 0.07, dress, 'stone'); // 2.38-2.52
      }
      // A coping stops 0.04 short of each front angle, so its ends stay inside the die; a cheek's coping
      // runs 0.03 past its root, into the wall (left) or the lintel's end (right). One centred baluster
      // per face stands under it.
      for (const { face, length, arris } of faces) {
        box(face, -arris * 0.035, 2.29, 0, arris ? length - 0.01 : length - 0.08, 0.1, 0.16, dress, 'stone'); // 2.24-2.34
        cylinder(face, 0, 2.1, 0, 0.042, 0.055, 0.28, dress, 'stone', 8); // 1.96-2.24
      }
      // No window on the wall behind the balustrade: the main eave (lower edge at y 2.90, 0.55 out)
      // hides the wall above about 2.37 from the People bearing and 2.19 from the overview, so any
      // sash there shows only as a strip cut off by the roof (and a lit sliver at night).
    } else {
      // Two storeys. The red bay rises to the wallhead: the main eave caps it and its cornice stops
      // under the eave lip. Qin's stops lower, under its own piended slate roof below the gable window.
      const upper = red ? 2.78 : 2.64;
      cantedPrism(shell, bay, 1.76, 1.9, dress, 'stone', 0.07).userData.band = true; // string course
      cantedPrism(shell, bay, 1.9, upper, stone);
      if (red) storey(1, 2.33, 0.7); // frames 1.90-2.76
      else storey(1, 2.25, 0.54); // frames 1.90-2.60
      cantedPrism(shell, bay, upper, upper + (red ? 0.18 : 0.16), dress, 'stone', 0.1).userData.bayCap = true; // front at z 2.75
      // Its eave at z 2.77, just past the cornice; the apex (3.22) dies into the main cornice under the gable window.
      if (!red) bayRoof(shell, bay, 2.8, 0.42, palette.slate);
    }
    for (const o of shell.children.slice(first)) o.traverse((m) => { m.userData.bay = true; }); // batch()'s bay-cap rule
    // The door on the plinth's landing; its risers step down to the ground at d/2 + 0.85.
    const doorX = 0.52;
    door(shell, doorX, P, d / 2, 0.7, 1.75, doorColor, { surround: dress, landing: 0.25, width: 1.0 });
    // Sides get one window each (and a gable window under a side gable); the rear has masses only.
    for (const side of [-1, 1]) {
      const face = new T.Group();
      face.position.x = (side * w) / 2;
      face.rotation.y = (side * Math.PI) / 2;
      shell.add(face);
      windowAt(face, side * 0.6, 1.35, 0, 0.7, 0.95, { frame: dress });
      if (variant !== 'gabled-house') windowAt(face, 0, 3.8, 0, 0.5, 0.55, { frame: dress, lintel: false });
    }
    // A big slab roof and a fat chimney. The gabled house turns its ridge to face the street.
    if (variant === 'gabled-house') {
      const r = new T.Group();
      r.rotation.y = Math.PI / 2;
      shell.add(r);
      const top2 = slabRoof(r, 0, roofY, 0, d, w + 0.3, 1.6, palette.slate, { eave: 0.2, verge: 0.3, gable: stone });
      windowAt(shell, 0, 3.75, d / 2, 0.5, 0.55, { frame: dress, lintel: false });
      chimney(shell, 0, top2 - 0.8, top2 + 0.5, -(d / 2 - 0.5), stone, dress, 2);
    } else {
      const top2 = slabRoof(shell, 0, roofY, 0, w, d + 0.3, 1.8, palette.slate, { eave: 0.4, verge: 0.15, gable: stone });
      chimney(shell, seed % 2 ? -(w / 2 - 0.35) : w / 2 - 0.35, top2 - 0.9, top2 + 0.55, 0, stone, dress, 2);
    }
    // Front garden, sized to the room in front of the pavement (about 1.9 for every house in the row):
    // a flower mound before the bay, a hedge with a gap at the door, and a path from the steps.
    const fx = site.x + (Math.sin(site.rotation) * d) / 2,
      fz = site.z + (Math.cos(site.rotation) * d) / 2;
    const room = plan.distanceToStreets(fx, fz) - plan.PAVEMENT_WIDTH - 0.05;
    if (room >= 1.2) flowerBed(shell, bay.x, 0, d / 2 + 0.9, 1.0, 0.4, seed * 31);
    if (room >= 1.75) hedge(shell, -0.1, 0, d / 2 + Math.min(1.4, room - 0.35), w - 0.5, 0, 0.55, { at: doorX + 0.1, width: 1.0 });
    if (room - 0.85 >= 0.2) box(shell, doorX, 0.03, d / 2 + (0.85 + room) / 2, 0.8, 0.06, room - 0.85, palette.plaza, 'paving');
    // The back green: a washing line behind the home, inside its own width.
    washingLine(shell, d, seed);
  }

  function buildCottage(g: T.Object3D, c: (typeof plan.cottages)[number], index: number) {
    const root = new T.Group();
    root.position.set(c.x, plan.terrainHeight(c.x, c.z), c.z);
    root.rotation.y = c.rotation;
    g.add(root);
    // Squat walls on a battered plinth under a steep (49 degree) slab roof, alternating slate and
    // red pantile, with a fat gable chimney. The wall is 2.0 so the door head clears the eave soffit.
    const w=2.8, d=2.4, P=0.3, h=2.0, top=P+h;
    plinth(root,w,d,palette.plinth,{height:P,proud:0.2});
    box(root,0,P+h/2,0,w,h,d,c.color,'stone');
    const pan=index%2===1, ridge=slabRoof(root,0,top,0,w,d,1.4,pan?palette.pantile:palette.slate,{eave:0.25,verge:0.25,inset:0,ridge:pan?palette.pantileLight:palette.slateLight,gable:c.color});
    const doorColour = [palette.greenDoor, palette.blueDoor, palette.redDoor][index % 3];
    door(root,0.6,P,d/2,0.75,1.5,doorColour,{landing:0.2,width:1.0});
    const pane = windowAt(root,-0.65,1.2,d/2,0.7,0.75,{frame:palette.trim});
    // A window box on the sill (top 0.715), against the frame's face (d/2 + 0.16), under the glass (foot 0.83).
    windowBox(root, -0.65, 0.716, d / 2 + 0.165, 0.84, 0.15, muted(doorColour, 0.25), index * 11 + 5);
    if (c.nightLight) pane.userData.nightLight = true; // a dim lamp left on all night (town-batch)
    chimney(root,-(w/2-0.35),ridge-0.8,ridge+0.45,0,c.color,palette.trim,1);
    // Ivy on one cottage's blank +x gable (the cottage south of the row, whose gable faces the
    // People chapter): rooted in a narrow stem at the plinth, it spreads over the wall and up into
    // the gable's peak, kept off both corners and inside the gable under the verge. Here the front
    // is the face's -x.
    if (index === IVY_COTTAGE) {
      const face = new T.Group();
      face.position.x = w / 2;
      face.rotation.y = Math.PI / 2;
      root.add(face);
      ivy(face, {
        areas: [[-0.15, 0, 0.6, 0.75], [-0.6, 0.65, 0.95, 1.75], [-0.3, 1.7, 0.75, 2.45], [0, 2.4, 0.45, 2.8]],
        keep: [[-3, 0, -1.06, 5], [1.06, 0, 3, 5], [-3, 3.0, 3, 5]],
        plinth: { h: P, proud: 0.2, batter: P * 0.105 },
        seed: 11,
      });
    }
    // Front garden sized to the room before the pavement: a hedge with a gap at the door, and a path from the step.
    const fx = c.x + (Math.sin(c.rotation) * d) / 2,
      fz = c.z + (Math.cos(c.rotation) * d) / 2;
    const room = plan.distanceToStreets(fx, fz) - plan.PAVEMENT_WIDTH - 0.05;
    if (room > 1.25) hedge(root, 0, 0, d / 2 + Math.min(1.0, room - 0.35), w, 0, 0.45, { at: 0.6, width: 0.9 });
    const L = Math.min(room, 1.6) - 0.5;
    if (L >= 0.2) box(root, 0.6, 0.035, d / 2 + 0.5 + L / 2, 0.7, 0.07, L, palette.plaza, 'paving');
  }
  return { buildTerrace, buildCottage };
}
