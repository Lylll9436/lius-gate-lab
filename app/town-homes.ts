import * as T from 'three';
import * as plan from './town-plan';
import { palette } from './town-shared';
import type { Bay, Kit } from './town-kit';
import type { Nature } from './town-nature';

/* ------------------------------------------------------------------ */
/* Homes: the terrace row and the cottages                             */
/* ------------------------------------------------------------------ */
export function createHomes(kit: Kit, nature: Nature) {
  const { box, cylinder, sphere, slabRoof, windowAt, door, quoins, plinth, chimney, bayOutline, cantedPrism, bayFaces, sash, bayRoof } = kit;
  const { hedge, flowerBed } = nature;
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
    // storey the front has a sash window (0.36 glass, meeting rail) and each cheek a single 0.20
    // light whose frame stands only 0.07 proud, so the bay reads as glass, not a lattice, and the
    // door-side frame keeps 0.07 of stone clear of the lintel end. Each home's bay differs in its top: Pengyuan's villa bay is one storey under a stone
    // balustrade, Yunlong's rises two storeys to the main eave, Qin's two under its own slate roof.
    // Window groups (stable ids, read by the night lights; each group is one light, drawn from
    // its first pane, the front's lower one): `<id>-bay-0` the ground storey (kept lit late),
    // `<id>-bay-1` the upper storey, `<id>-balcony` the villa's sash behind the balustrade.
    const first = shell.children.length; // from here to the bay's top, everything is bay (tagged at the end)
    const bay: Bay = { x: -0.68, z0: d / 2, root: 1.06, depth: 0.55, cant: 0.23 },
      faces = bayFaces(shell, bay);
    const storey = (n: number, y: number, h: number) => faces.forEach(({ face, arris }) =>
      sash(face, arris * 0.07, y, 0, arris ? 0.2 : 0.36, h, dress,
        { group: `${site.id}-bay-${n}`, lit: n === 0, single: arris !== 0, deep: arris ? 0.07 : 0.12 }));
    cantedPrism(shell, bay, 0, P, base, 'stone', 0.06); // footing on the plinth line
    cantedPrism(shell, bay, 0.56, 0.68, dress, 'stone', 0.06).userData.band = true; // sill course; frames sit on it
    cantedPrism(shell, bay, P, 1.76, stone); // ground storey
    storey(0, 1.2, 0.86); // glass 0.77-1.63, frames 0.69-1.71
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
      // The balcony: a cream sash on the wall behind the balustrade, its sill on the cornice. The
      // main eave (lower edge at y 2.90, 0.55 out) hides the wall above about 2.37 from the People
      // bearing and 2.19 from the overview, so the sash sits low enough to show its lower half.
      sash(shell, bay.x, 2.36, d / 2, 0.44, 0.48, dress, { group: `${site.id}-balcony` }); // glass 2.12-2.60, frame 2.04-2.68
      box(shell, bay.x, 2.0, d / 2 + 0.08, 0.64, 0.08, 0.16, dress, 'stone'); // its sill, 1.96-2.04
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
    door(root,0.6,P,d/2,0.75,1.5,[palette.greenDoor,palette.blueDoor,palette.redDoor][index%3],{landing:0.2,width:1.0});
    windowAt(root,-0.65,1.2,d/2,0.7,0.75,{frame:palette.trim});
    chimney(root,-(w/2-0.35),ridge-0.8,ridge+0.45,0,c.color,palette.trim,1);
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
