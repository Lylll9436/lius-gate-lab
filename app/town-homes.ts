import * as T from 'three';
import * as plan from './town-plan';
import { palette } from './town-shared';
import type { Kit } from './town-kit';
import type { Nature } from './town-nature';

/* ------------------------------------------------------------------ */
/* Homes: the terrace row and the cottages                             */
/* ------------------------------------------------------------------ */
export function createHomes(kit: Kit, nature: Nature) {
  const { box, slabRoof, windowAt, door, quoins, plinth, chimney } = kit;
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
    // The signature bay: grounded on its own battered plinth, under a lean-to. The red bay
    // rises the full height of the wall, so the main roof's eave caps it instead.
    // 1.0 wide at x -0.6, so it clears the left quoins (x -1.11) and the door jamb.
    const bayX = -0.6,
      bayW = 1.0,
      bayTop = red ? top : 2.02;
    box(shell, bayX, P / 2, d / 2 + 0.3, bayW + 0.12, P, 0.75, base, 'stone', { taper: 0.04 }); // grounded
    box(shell, bayX, (P + bayTop) / 2, d / 2 + 0.25, bayW, bayTop - P, 0.6, stone, 'stone');
    box(shell, bayX, bayTop + 0.1, d / 2 + 0.3, bayW + 0.12, 0.2, 0.75, dress, 'stone');
    if (!red) box(shell, bayX, bayTop + 0.38, d / 2 + 0.33, bayW + 0.3, 0.16, 0.9, palette.slate, 'slate', { rx: 0.45 }); // lean-to
    windowAt(shell, bayX, 1.25, d / 2 + 0.55, 0.72, 0.95, { frame: dress, lintel: !red });
    if (red) windowAt(shell, bayX, 2.45, d / 2 + 0.55, 0.72, 0.8, { frame: dress, sill: false, lintel: false });
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
    if (room >= 1.2) flowerBed(shell, bayX, 0, d / 2 + 0.9, 1.0, 0.4, seed * 31);
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
