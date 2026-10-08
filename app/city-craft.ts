import * as T from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';

export type BoxMaker = (
  g: T.Group,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: string,
  kind?: SurfaceKind,
) => T.Mesh;
type Point = [number, number, number];
/** Small real surfaces, sharing materials and vertex colours instead of image textures. */
export function createCraft(
  box: BoxMaker,
  material: (color: string, kind?: SurfaceKind) => T.MeshStandardMaterial,
  quality: 'near' | 'far' = 'near',
) {
  const detailed = quality === 'near';
  const coloured = material('#ffffff', 'stone').clone();
  coloured.vertexColors = true;
  const foliage = material('#ffffff', 'foliage').clone();
  foliage.vertexColors = true;
  const random = (n: number) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  function surfaces(g: T.Group, leaf = false) {
    const positions: number[] = [],
      colors: number[] = [];
    const triangle = (a: Point, b: Point, c: Point, color: T.Color) => {
      positions.push(...a, ...b, ...c);
      for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
    };
    return {
      triangle,
      quad(a: Point, b: Point, c: Point, d: Point, color: T.Color) {
        triangle(a, b, c, color);
        triangle(a, c, d, color);
      },
      finish(kind: string) {
        let geometry = new T.BufferGeometry();
        geometry.setAttribute(
          'position',
          new T.Float32BufferAttribute(positions, 3),
        );
        geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
        if (leaf) geometry = mergeVertices(geometry);
        geometry.computeVertexNormals();
        const surface =
          kind === 'individual-slates' || kind === 'ridge-caps'
            ? material('#ffffff', 'slate').clone()
            : leaf
              ? foliage
              : coloured;
        surface.vertexColors = true;
        const mesh = new T.Mesh(geometry, surface);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.craft = kind;
        if (leaf) mesh.userData.softFoliage = true;
        g.add(mesh);
        return mesh;
      },
    };
  }
  function branch(
    g: T.Group,
    a: Point,
    b: Point,
    r0: number,
    r1: number,
    color = '#68543c',
  ) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b),
      v = end.clone().sub(start);
    const m = new T.Mesh(
      new T.CylinderGeometry(r1, r0, v.length(), 10),
      material(color),
    );
    m.position.copy(start.add(end).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), v.normalize());
    m.castShadow = true;
    g.add(m);
    return m;
  }
  function limb(g: T.Group, points: Point[], r0: number, r1: number) {
    const curve = new T.CatmullRomCurve3(
      points.map((p) => new T.Vector3(...p)),
    );
    const steps = detailed ? 12 : 3,
      sides = detailed ? 10 : 4,
      frames = curve.computeFrenetFrames(steps, false);
    const positions: number[] = [],
      colors: number[] = [],
      indices: number[] = [],
      uvs: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        center = curve.getPoint(t),
        radius = T.MathUtils.lerp(r0, r1, Math.pow(t, 0.8));
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * Math.PI * 2,
          furrow = Math.sin(a * 7 + t * 3);
        const p = center
          .clone()
          .addScaledVector(
            frames.normals[i],
            Math.cos(a) * radius * (1 + furrow * 0.055),
          )
          .addScaledVector(
            frames.binormals[i],
            Math.sin(a) * radius * (1 + furrow * 0.055),
          );
        positions.push(p.x, p.y, p.z);
        uvs.push(t * curve.getLength(), (j / sides) * Math.PI * 2 * r0);
        const c = new T.Color('#726650').multiplyScalar(0.92 + furrow * 0.11);
        colors.push(c.r, c.g, c.b);
        if (i < steps && j < sides) {
          const n = i * (sides + 1) + j;
          indices.push(
            n,
            n + 1,
            n + sides + 1,
            n + 1,
            n + sides + 2,
            n + sides + 1,
          );
        }
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.userData.longitudinalUV = true;
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    // The circumference closes at two UV coordinates; its lighting must remain continuous.
    const normals = geometry.getAttribute('normal');
    for (let row = 0; row <= steps; row++) {
      const a = row * (sides + 1),
        b = a + sides;
      const n = new T.Vector3()
        .fromBufferAttribute(normals, a)
        .add(new T.Vector3().fromBufferAttribute(normals, b))
        .normalize();
      normals.setXYZ(a, n.x, n.y, n.z);
      normals.setXYZ(b, n.x, n.y, n.z);
    }
    const bark = material('#ffffff', 'bark').clone();
    bark.vertexColors = true;
    const mesh = new T.Mesh(geometry, bark);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.craft = 'tapered-living-branch';
    g.add(mesh);
    return curve;
  }
  function tree(g: T.Group, x: number, z: number, size = 1, autumn = false) {
    const seed = Math.round(
      (g.position.x + x) * 123 + (g.position.z + z) * 791,
    );
    const p = (a: number, b: number, c: number): Point => [
      x + a * size,
      b * size,
      z + c * size,
    ];
    const lean = (random(seed + 4) - 0.5) * 0.18,
      height = 1.67 + random(seed + 9) * 0.22;
    const trunk = limb(
      g,
      [
        p(0, 0.01, 0),
        p(lean * 0.3, 0.52, 0.016),
        p(-lean * 0.3, 1.05, -0.028),
        p(lean, height, 0.034),
      ],
      0.097 * size,
      0.017 * size,
    );
    for (let i = 0; i < (detailed ? 5 : 3); i++) {
      const a = i * 2.399 + random(seed) * 2;
      limb(
        g,
        [
          p(0, 0.23, 0),
          p(Math.cos(a) * 0.085, 0.055, Math.sin(a) * 0.085),
          p(Math.cos(a) * 0.18, 0.007, Math.sin(a) * 0.18),
        ],
        0.039 * size,
        0.005 * size,
      );
    }
    const leaves = surfaces(g, true);
    const greens = autumn
      ? ['#907b44', '#a08b50', '#b29c5f', '#b6a570']
      : ['#416f50', '#537e54', '#6b915d', '#8da869'];
    let leafCount = 0;
    // Overview trees carry fewer, larger leaves so crowns still read as crowns.
    const leafScale = detailed ? 1 : 1.55,
      leafSpread = detailed ? 0.23 : 0.31;
    for (let branchId = 0; branchId < (detailed ? 9 : 5); branchId++) {
      const n = seed + branchId * 701,
        a = branchId * 2.399 + random(n) * 0.6;
      const r = 0.27 + random(n + 1) * 0.13,
        by = 0.75 + random(n + 2) * 0.5;
      const anchor = trunk.getPoint(by / height).toArray() as Point;
      const end = p(
        Math.cos(a) * r,
        1.3 + random(n + 3) * 0.5,
        Math.sin(a) * r,
      );
      const bough = limb(
        g,
        [
          anchor,
          p(Math.cos(a) * r * 0.52, by + 0.23, Math.sin(a) * r * 0.52),
          end,
        ],
        0.039 * size,
        0.008 * size,
      );
      for (let fork = 0; fork < 2; fork++) {
        const at = bough.getPoint(0.65 + fork * 0.29),
          turn = a + (fork ? 1 : -1) * 0.72;
        const tip = new T.Vector3(
          end[0] + Math.cos(turn) * 0.12 * size,
          end[1] + (0.02 + fork * 0.07) * size,
          end[2] + Math.sin(turn) * 0.12 * size,
        );
        limb(
          g,
          [
            at.toArray() as Point,
            at
              .clone()
              .lerp(tip, 0.55)
              .add(new T.Vector3(0, 0.028 * size, 0))
              .toArray() as Point,
            tip.toArray() as Point,
          ],
          0.014 * size,
          0.002 * size,
        );
        for (let i = 0; i < (detailed ? 26 : 9); i++) {
          const k = n + fork * 197 + i * 13,
            theta = random(k) * Math.PI * 2,
            vertical = random(k + 1) * 2 - 1;
          const spread = Math.cbrt(random(k + 2)),
            circle = Math.sqrt(1 - vertical * vertical);
          const origin = tip
            .clone()
            .add(
              new T.Vector3(
                Math.cos(theta) * circle * leafSpread * spread * size,
                vertical * 0.19 * spread * size,
                Math.sin(theta) * circle * leafSpread * spread * size,
              ),
            );
          const q = new T.Quaternion().setFromEuler(
            new T.Euler(
              random(k + 3) * 0.95 - 0.35,
              theta,
              random(k + 4) * 0.9 - 0.45,
            ),
          );
          const len = (0.145 + random(k + 5) * 0.065) * size * leafScale;
          const tint = new T.Color(greens[Math.floor(random(k + 6) * 4)]);
          const point = (t: number, side: number): Point => {
            const edge =
              Math.sin(Math.PI * t) *
              0.33 *
              (1 + Math.sin(t * Math.PI * 6) * 0.1);
            const v = new T.Vector3(
              side * edge,
              Math.sin(t * Math.PI) * 0.1 - side * side * 0.045,
              t - 0.5,
            )
              .multiplyScalar(len)
              .applyQuaternion(q)
              .add(origin);
            return v.toArray() as Point;
          };
          for (let segment = 0; segment < (detailed ? 5 : 2); segment++)
            for (const side of [-1, 1]) {
              const t = segment / (detailed ? 5 : 2),
                next = (segment + 1) / (detailed ? 5 : 2);
              if (side < 0)
                leaves.quad(
                  point(t, 0),
                  point(t, side),
                  point(next, side),
                  point(next, 0),
                  tint,
                );
              else
                leaves.quad(
                  point(next, 0),
                  point(next, side),
                  point(t, side),
                  point(t, 0),
                  tint,
                );
            }
          leafCount++;
        }
      }
    }
    const mesh = leaves.finish('lobed-leaves');
    mesh.userData.leafCount = leafCount;
  }
  function slate(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    rise: number,
    axis: 'x' | 'z' = 'z',
  ) {
    if (!detailed) return null;
    const cross = axis === 'z' ? width : depth,
      run = axis === 'z' ? depth : width;
    const p = (u: number, v: number, h: number): Point =>
      axis === 'z' ? [x + u, y + h, z + v] : [x + v, y + h, z - u];
    const mesh = surfaces(g),
      base = new T.Color('#445c63');
    const rows = Math.max(4, Math.ceil(Math.hypot(cross / 2, rise) / 0.17)),
      columns = Math.ceil(run / 0.21),
      tile = run / columns;
    let count = 0;
    for (const side of [-1, 1])
      for (let row = 0; row < rows; row++)
        for (let col = -1; col < columns; col++) {
          const v0 = Math.max(
              -run / 2,
              -run / 2 + (col + (row % 2) * 0.5) * tile,
            ),
            v1 = Math.min(
              run / 2,
              -run / 2 + (col + 1 + (row % 2) * 0.5) * tile - 0.008,
            );
          if (v1 <= v0) continue;
          const t0 = row / rows,
            t1 = (row + 1) / rows,
            u0 = ((side * cross) / 2) * t0,
            u1 = ((side * cross) / 2) * t1;
          const h0 = rise * (1 - t0) + 0.015,
            h1 = rise * (1 - t1) + 0.023;
          const color = base
            .clone()
            .multiplyScalar(0.94 + random(row * 317 + col * 29 + side) * 0.1);
          if (side === 1)
            mesh.quad(
              p(u0, v0, h0),
              p(u0, v1, h0),
              p(u1, v1, h1),
              p(u1, v0, h1),
              color,
            );
          else
            mesh.quad(
              p(u1, v0, h1),
              p(u1, v1, h1),
              p(u0, v1, h0),
              p(u0, v0, h0),
              color,
            );
          const lip = color.clone().multiplyScalar(0.62);
          if (side === 1)
            mesh.quad(
              p(u1, v0, h1 - 0.018),
              p(u1, v0, h1),
              p(u1, v1, h1),
              p(u1, v1, h1 - 0.018),
              lip,
            );
          else
            mesh.quad(
              p(u1, v1, h1 - 0.018),
              p(u1, v1, h1),
              p(u1, v0, h1),
              p(u1, v0, h1 - 0.018),
              lip,
            );
          count++;
        }
    const result = mesh.finish('individual-slates');
    result.userData.tileCount = count;
    // Folded ridge caps follow both slopes; the skirts bed directly into the slates.
    const caps = surfaces(g);
    for (let i = 0; i < columns; i++) {
      const v0 = -run / 2 + i * tile + 0.004,
        v1 = Math.min(run / 2, v0 + tile - 0.008),
        r = 0.061;
      for (const side of [-1, 1]) {
        const top = p(0, v0, rise + 0.043),
          topEnd = p(0, v1, rise + 0.043);
        const edge = p(side * r, v0, rise - (rise / (cross / 2)) * r + 0.026),
          edgeEnd = p(side * r, v1, rise - (rise / (cross / 2)) * r + 0.026);
        if ((axis === 'z' && side > 0) || (axis === 'x' && side < 0))
          caps.quad(topEnd, edgeEnd, edge, top, new T.Color('#647573'));
        else caps.quad(top, edge, edgeEnd, topEnd, new T.Color('#647573'));
      }
    }
    caps.finish('ridge-caps');
    return result;
  }
  function thinRoof(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    rise: number,
    axis: 'x' | 'z' = 'z',
  ) {
    const group = new T.Group();
    group.position.set(x, y, z);
    g.add(group);
    const cross = axis === 'z' ? w : d,
      run = axis === 'z' ? d : w;
    for (const side of [-1, 1]) {
      const shape = new T.Shape();
      shape.moveTo(0, rise);
      shape.lineTo((side * cross) / 2, 0);
      shape.lineTo((side * cross) / 2, -0.045);
      shape.lineTo(0, rise - 0.045);
      shape.closePath();
      const mesh = new T.Mesh(
        new T.ExtrudeGeometry(shape, { depth: run, bevelEnabled: false }),
        material('#43525b', 'slate'),
      );
      if (axis === 'z') mesh.position.z = -run / 2;
      else {
        mesh.rotation.y = -Math.PI / 2;
        mesh.position.x = run / 2;
      }
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.craft = 'thin-roof-deck';
      group.add(mesh);
    }
    slate(group, 0, 0, 0, w, d, rise, axis);
    group.userData.roofThickness = 0.045;
    return group.children[0] as T.Mesh;
  }
  function gable(
    g: T.Group,
    width: number,
    rise: number,
    thickness: number,
    color: string,
  ) {
    const shape = new T.Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(width / 2, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const mesh = new T.Mesh(
      new T.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }),
      material(color, 'stone'),
    );
    mesh.position.z = -thickness;
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  }
  function terraceRoof(
    g: T.Group,
    w: number,
    d: number,
    y: number,
    rise = 0.85,
  ) {
    const roof = thinRoof(g, 0, y, 0, w, d, rise, 'x');
    for (const end of [-1, 1])
      for (const side of [-1, 1]) {
        const length = Math.hypot(d / 2, rise);
        const cap = box(
          g,
          end * (w / 2 - 0.027),
          y + rise / 2 + 0.038,
          (side * d) / 4,
          0.054,
          0.048,
          length,
          '#9aa09a',
          'stone',
        );
        cap.rotation.x = side * Math.atan(rise / (d / 2));
      }
    for (const side of [-1, 1]) {
      const gutter = new T.Mesh(
        new T.CylinderGeometry(0.032, 0.032, w, 12, 1, true, 0, Math.PI),
        material('#485759', 'metal'),
      );
      gutter.rotation.z = Math.PI / 2;
      gutter.position.set(0, y - 0.024, (side * d) / 2);
      g.add(gutter);
      box(g, 0, y - 0.056, side * (d / 2 - 0.045), w, 0.042, 0.085, '#887965');
      for (let x = -w / 2 + 0.09; x <= w / 2 - 0.03; x += 0.19)
        box(
          g,
          x,
          y - 0.09,
          side * (d / 2 - 0.07),
          0.055,
          0.11,
          0.12,
          '#b2a58a',
        );
    }
    return roof;
  }
  type Opening = { x: number; y: number; w: number; h: number };
  function wall(
    g: T.Group,
    w: number,
    h: number,
    z: number,
    color: string,
    openings: Opening[],
    base = 0.18,
    thickness = 0.13,
  ) {
    const xs = [
      -w / 2,
      w / 2,
      ...openings.flatMap((o) => [
        Math.max(-w / 2, o.x - o.w / 2),
        Math.min(w / 2, o.x + o.w / 2),
      ]),
    ].sort((a, b) => a - b);
    const ys = [
      base,
      base + h,
      ...openings.flatMap((o) => [
        Math.max(base, o.y - o.h / 2),
        Math.min(base + h, o.y + o.h / 2),
      ]),
    ].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++)
      for (let j = 0; j < ys.length - 1; j++) {
        const x = (xs[i] + xs[i + 1]) / 2,
          y = (ys[j] + ys[j + 1]) / 2,
          dw = xs[i + 1] - xs[i],
          dh = ys[j + 1] - ys[j];
        if (
          dw < 0.0001 ||
          dh < 0.0001 ||
          openings.some(
            (o) =>
              Math.abs(x - o.x) < o.w / 2 - 0.00001 &&
              Math.abs(y - o.y) < o.h / 2 - 0.00001,
          )
        )
          continue;
        const piece = box(g, x, y, z - thickness / 2, dw, dh, thickness, color);
        piece.userData.craft = 'open-masonry-wall';
      }
    g.userData.openings = openings;
    g.userData.wallThickness = thickness;
  }
  function stoneFace(
    g: T.Group,
    w: number,
    h: number,
    z: number,
    color: string,
    holes: { x: number; y: number; w: number; h: number }[] = [],
  ) {
    if (!detailed) return;
    const detail = surfaces(g),
      base = new T.Color(color),
      rows = Math.ceil(h / 0.145),
      rowH = h / rows;
    let count = 0;
    for (let row = 0; row < rows; row++)
      for (let col = -1; col < Math.ceil(w / 0.3); col++) {
        const rawLeft = -w / 2 + (col + (row % 2) * 0.5) * 0.3 + 0.008;
        const left = Math.max(-w / 2 + 0.01, rawLeft),
          right = Math.min(w / 2 - 0.01, rawLeft + 0.283);
        if (right - left < 0.015) continue;
        const bottom = 0.31 + row * rowH,
          top = bottom + rowH - 0.012;
        if (
          holes.some(
            (a) =>
              right > a.x - a.w / 2 &&
              left < a.x + a.w / 2 &&
              top > a.y - a.h / 2 &&
              bottom < a.y + a.h / 2,
          )
        )
          continue;
        const tint = base
          .clone()
          .multiplyScalar(0.97 + random(row * 213 + col * 67) * 0.055);
        detail.quad(
          [left, bottom, z],
          [right, bottom, z],
          [right, top, z],
          [left, top, z],
          tint,
        );
        count++;
      }
    const mesh = detail.finish('sandstone-courses');
    mesh.userData.blockCount = count;
  }
  function window(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    w = 0.42,
    h = 0.65,
    recess = 0.052,
  ) {
    const frame = '#ddd6c5',
      reveal = '#a59b85',
      glassZ = z - recess;
    // Four real reveals enclose an empty aperture. The glass is behind the wall face.
    for (const side of [-1, 1]) {
      box(
        g,
        x + side * (w / 2 + 0.025),
        y,
        z - recess / 2,
        0.05,
        h + 0.1,
        recess + 0.038,
        reveal,
      );
      box(
        g,
        x,
        y + side * (h / 2 + 0.027),
        z - recess / 2,
        w,
        0.054,
        recess + 0.038,
        reveal,
      );
      box(g, x + (side * w) / 2, y, glassZ + 0.009, 0.025, h, 0.022, frame);
      box(g, x, y + (side * h) / 2, glassZ + 0.009, w, 0.025, 0.022, frame);
    }
    const glazing = box(
      g,
      x,
      y,
      glassZ - 0.009,
      w - 0.019,
      h - 0.018,
      0.013,
      '#719b9b',
    );
    glazing.userData.craft = 'recessed-glazing';
    glazing.castShadow = false;
    for (const side of [-1, 1])
      box(g, x + (side * w) / 6, y, glassZ + 0.019, 0.011, h, 0.014, frame);
    box(g, x, y, glassZ + 0.021, w, 0.027, 0.025, frame);
    box(g, x, y - h / 2 - 0.057, z + 0.025, w + 0.12, 0.06, 0.15, '#d2c6ac');
    box(g, x, y + h / 2 + 0.059, z + 0.007, w + 0.1, 0.065, 0.052, '#cabda2');
    return glazing;
  }
  function bay(g: T.Group, x: number, y: number, z: number, color: string) {
    const body = new T.Group();
    body.position.set(x, 0, z);
    g.add(body);
    // One continuous canted bay, supported from the plinth to its shallow roof.
    const outline: [number, number][] = [
      [-0.31, 0],
      [-0.17, 0.21],
      [0.17, 0.21],
      [0.31, 0],
    ];
    for (let i = 0; i < 3; i++) {
      const [a, b] = [outline[i], outline[i + 1]],
        dx = b[0] - a[0],
        dz = b[1] - a[1];
      const face = new T.Group();
      face.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
      face.rotation.y = -Math.atan2(dz, dx);
      body.add(face);
      const width = Math.hypot(dx, dz),
        windowWidth = i === 1 ? 0.255 : 0.14;
      wall(
        face,
        width,
        2.35,
        0,
        color,
        [0.95, 1.98].map((y) => ({ x: 0, y, w: windowWidth + 0.015, h: 0.7 })),
        0.3,
        0.06,
      );
      for (const level of [0.95, 1.98])
        window(face, 0, level, 0, windowWidth, 0.66, 0.027);
    }
    const shape = new T.Shape();
    outline.forEach(([x, z], i) =>
      i ? shape.lineTo(x, -z) : shape.moveTo(x, -z),
    );
    shape.closePath();
    for (const level of [0.29, 1.43, 2.63]) {
      const slab = new T.Mesh(
        new T.ExtrudeGeometry(shape, { depth: 0.046, bevelEnabled: false }),
        material('#c6b99c', 'stone'),
      );
      slab.rotation.x = -Math.PI / 2;
      slab.position.y = level;
      slab.castShadow = slab.receiveShadow = true;
      body.add(slab);
    }
    body.userData.craft = 'continuous-canted-bay';
    return body;
  }
  function planter(g: T.Group, x: number, y: number, z: number, w = 0.42) {
    box(g, x, y + 0.07, z, w, 0.14, 0.16, '#81624c');
    box(g, x, y + 0.139, z, w - 0.035, 0.015, 0.125, '#4b5140');
    for (const dx of [-w / 2, w / 2])
      box(g, x + dx, y + 0.135, z, 0.018, 0.055, 0.18, '#b79a6a');
    herbs(
      g,
      x,
      y + 0.15,
      z,
      w - 0.04,
      0.11,
      Math.round(x * 331 + z * 109),
      0.13,
    );
  }
  function herbs(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    seed = 1,
    height = 0.24,
  ) {
    const leaves = surfaces(g, true),
      flowers = surfaces(g, true);
    const count = detailed ? Math.max(7, Math.ceil(w * d * 90)) : 3;
    for (let i = 0; i < count; i++) {
      const k = seed + i * 17,
        rx = x + (random(k) - 0.5) * w * 0.78,
        rz = z + (random(k + 1) - 0.5) * d * 0.68;
      for (let j = 0; j < 5; j++) {
        const angle = j * 2.399 + random(k + 2),
          h = height * (0.5 + random(k + j + 3) * 0.45),
          reach = Math.min(w, d) * 0.21;
        const p = (t: number, side: number): Point => [
          rx +
            Math.cos(angle) * reach * t * t -
            Math.sin(angle) * side * 0.018 * Math.sin(Math.PI * t),
          y + h * (1.8 * t - 0.95 * t * t),
          rz +
            Math.sin(angle) * reach * t * t +
            Math.cos(angle) * side * 0.018 * Math.sin(Math.PI * t),
        ];
        for (let s = 0; s < 5; s++) {
          const c = new T.Color('#527650').lerp(new T.Color('#9caf77'), s / 8);
          leaves.quad(
            p(s / 5, -1),
            p(s / 5, 1),
            p((s + 1) / 5, 1),
            p((s + 1) / 5, -1),
            c,
          );
        }
      }
      if (i % 3 === 0) {
        const top = y + height * (0.8 + random(k + 9) * 0.2),
          bend = 0.017;
        branch(g, [rx, y, rz], [rx + bend, top, rz], 0.0035, 0.002, '#58754a');
        const c = new T.Color(i % 2 ? '#d3ccb7' : '#a59db3');
        for (let petal = 0; petal < 5; petal++) {
          const a = petal * Math.PI * 0.4,
            point = (r: number, turn: number, h: number): Point => [
              rx + bend + Math.cos(a + turn) * r,
              top + h,
              rz + Math.sin(a + turn) * r,
            ];
          flowers.quad(
            point(0, 0, -0.006),
            point(0.024, -0.45, 0),
            point(0.033, 0, 0.006),
            point(0.024, 0.45, 0),
            c,
          );
        }
      }
    }
    leaves.finish('curved-ground-cover');
    flowers.finish('five-petal-flowers');
  }
  function door(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    color: string,
    facade = z,
  ) {
    box(g, x, y, z, 0.44, 0.86, 0.05, color);
    for (const dx of [-0.108, 0.108])
      for (const dy of [-0.225, 0.15]) {
        box(g, x + dx, y + dy, z + 0.028, 0.15, 0.255, 0.013, '#324f4a');
        box(g, x + dx, y + dy, z + 0.039, 0.124, 0.225, 0.011, color);
      }
    box(g, x + 0.14, y - 0.03, z + 0.056, 0.018, 0.026, 0.025, '#c8a96e');
    box(g, x, y + 0.065, z + 0.045, 0.12, 0.018, 0.012, '#baa56f');
    box(g, x + 0.41, y + 0.25, facade + 0.03, 0.105, 0.16, 0.06, '#385348');
    box(g, x + 0.41, y + 0.25, facade + 0.065, 0.066, 0.105, 0.015, '#e8d2a0');
    box(g, x + 0.41, y + 0.345, facade + 0.03, 0.14, 0.028, 0.09, '#385348');
  }
  function rail(g: T.Group, x: number, z: number, w: number, base = 0.2) {
    box(g, x, base + 0.26, z, w, 0.026, 0.03, '#3d574c');
    box(g, x, base + 0.08, z, w, 0.024, 0.027, '#3d574c');
    for (let dx = -w / 2; dx <= w / 2 + 0.001; dx += w / Math.ceil(w / 0.105)) {
      box(g, x + dx, base + 0.18, z, 0.021, 0.36, 0.021, '#3d574c');
      const finial = new T.Mesh(
        new T.ConeGeometry(0.027, 0.06, 4),
        material('#3d574c'),
      );
      finial.position.set(x + dx, base + 0.39, z);
      g.add(finial);
    }
  }
  return {
    tree,
    slate,
    terraceRoof,
    thinRoof,
    gable,
    wall,
    bay,
    stoneFace,
    window,
    planter,
    herbs,
    door,
    rail,
    branch,
  };
}
