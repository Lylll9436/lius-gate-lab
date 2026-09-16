import * as T from 'three';
import type { BoxMaker } from './city-craft';
import type { SurfaceKind } from './city-materials';
type P = [number, number, number];
export function createStreetCraft(
  box: BoxMaker,
  material: (c: string, k?: SurfaceKind) => T.MeshStandardMaterial,
) {
  function tube(
    g: T.Group,
    a: P,
    b: P,
    r: number,
    c: string,
    k: SurfaceKind = 'metal',
    r2 = r,
  ) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b),
      delta = end.clone().sub(start);
    const m = new T.Mesh(
      new T.CylinderGeometry(r2, r, delta.length(), 10),
      material(c, k),
    );
    m.position.copy(start.add(end).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function lamp(g: T.Group) {
    const iron = '#3d5653',
      brass = '#9a8b67';
    tube(g, [0, 0, 0], [0, 0.11, 0], 0.078, iron);
    tube(g, [0, 0.1, 0], [0, 0.3, 0], 0.053, iron, 'metal', 0.038);
    tube(g, [0, 0.27, 0], [0, 1.72, 0], 0.029, iron, 'metal', 0.02);
    for (const y of [0.31, 1.53, 1.7])
      tube(g, [0, y, 0], [0, y + 0.022, 0], 0.041, brass);
    box(g, 0, 1.72, 0, 0.23, 0.04, 0.23, iron, 'metal');
    const glass = box(g, 0, 1.84, 0, 0.16, 0.21, 0.16, '#e5d1a7', 'glass');
    glass.material = new T.MeshStandardMaterial({
      color: '#e5d1a7',
      emissive: '#ffd39a',
      emissiveIntensity: 0,
      roughness: 0.3,
    });
    for (const x of [-0.095, 0.095])
      for (const z of [-0.095, 0.095])
        tube(g, [x, 1.72, z], [x * 0.83, 1.96, z * 0.83], 0.012, iron);
    const hood = new T.Mesh(
      new T.ConeGeometry(0.173, 0.115, 4),
      material(iron, 'metal'),
    );
    hood.rotation.y = Math.PI / 4;
    hood.position.y = 2.015;
    hood.castShadow = true;
    g.add(hood);
    tube(g, [0, 2.065, 0], [0, 2.14, 0], 0.02, brass, 'metal', 0.005);
    return glass;
  }
  function bench(g: T.Group) {
    for (let i = 0; i < 6; i++)
      box(
        g,
        0,
        0.31,
        -0.145 + i * 0.058,
        0.9,
        0.037,
        0.047,
        i % 2 ? '#9f7a52' : '#886344',
        'wood',
      );
    for (let i = 0; i < 3; i++) {
      const b = box(
        g,
        0,
        0.45 + i * 0.1,
        -0.16 - i * 0.012,
        0.9,
        0.074,
        0.04,
        '#95764e',
        'wood',
      );
      b.rotation.x = -0.12;
    }
    for (const x of [-0.34, 0.34]) {
      tube(g, [x, 0.03, -0.15], [x, 0.34, -0.12], 0.019, '#3e5550');
      tube(g, [x, 0.03, 0.16], [x, 0.34, 0.11], 0.019, '#3e5550');
      tube(g, [x, 0.29, 0.13], [x, 0.7, -0.2], 0.022, '#3e5550');
      for (const z of [-0.145, 0.145])
        box(g, x, 0.016, z, 0.1, 0.028, 0.08, '#3e5550', 'metal');
      for (const y of [0.45, 0.55, 0.65])
        for (const dx of [-0.015, 0.015])
          box(
            g,
            x + dx,
            y,
            -0.128 - (y - 0.45) * 0.12,
            0.01,
            0.01,
            0.008,
            '#b5ae91',
            'metal',
          );
    }
    for (const x of [-0.42, 0.42]) {
      tube(g, [x, 0.31, 0.11], [x, 0.51, 0.08], 0.015, '#3e5550');
      tube(g, [x, 0.51, 0.08], [x, 0.55, -0.15], 0.016, '#3e5550');
    }
  }
  function picnic(g: T.Group) {
    for (let i = 0; i < 5; i++)
      box(g, -0.208 + i * 0.104, 0.5, 0, 0.094, 0.042, 0.5, '#a17e58', 'wood');
    for (const x of [-0.19, 0.19])
      for (const z of [-0.16, 0.16])
        tube(g, [x, 0.02, z], [x * 0.7, 0.48, z * 0.7], 0.019, '#486158');
    tube(g, [-0.18, 0.18, 0], [0.18, 0.18, 0], 0.014, '#486158');
    for (const x of [-0.48, 0.48]) {
      for (const dx of [-0.095, 0.095])
        for (const dz of [-0.1, 0.1])
          tube(g, [x + dx, 0.02, dz], [x + dx, 0.3, dz], 0.012, '#486158');
      for (let z = -0.105; z < 0.13; z += 0.07)
        box(g, x, 0.3, z, 0.27, 0.03, 0.059, '#a17e58', 'wood');
      for (const dx of [-0.105, 0.105])
        tube(g, [x + dx, 0.28, -0.11], [x + dx, 0.57, -0.12], 0.012, '#486158');
      box(g, x, 0.51, -0.12, 0.27, 0.092, 0.022, '#a17e58', 'wood');
    }
    // A cup and a saucer on the shared table.
    tube(g, [0.1, 0.523, 0.06], [0.1, 0.53, 0.06], 0.048, '#e6dfc5', 'paint');
    tube(g, [0.1, 0.53, 0.06], [0.1, 0.586, 0.06], 0.027, '#dfcfae', 'paint');
  }
  function telephone(g: T.Group) {
    const red = '#a84a3c',
      frame = '#bd5d48';
    box(g, 0, 0.045, 0, 0.5, 0.09, 0.49, red, 'paint');
    box(g, 0, 0.22, 0, 0.46, 0.28, 0.45, red, 'paint');
    for (const x of [-0.228, 0.228])
      for (const z of [-0.22, 0.22])
        box(g, x, 0.81, z, 0.036, 1.17, 0.036, red, 'paint');
    for (const side of [-1, 1]) {
      box(g, side * 0.22, 0.86, 0, 0.014, 0.98, 0.42, '#678983', 'glass');
      box(g, 0, 0.86, side * 0.212, 0.42, 0.98, 0.014, '#678983', 'glass');
      for (const y of [0.47, 0.7, 0.93, 1.16, 1.35]) {
        box(g, side * 0.232, y, 0, 0.022, 0.026, 0.45, frame, 'paint');
        box(g, 0, y, side * 0.231, 0.45, 0.026, 0.022, frame, 'paint');
      }
      for (const x of [-0.075, 0.075]) {
        box(g, x, 0.9, side * 0.231, 0.02, 0.92, 0.022, frame, 'paint');
        box(g, side * 0.231, 0.9, x, 0.022, 0.92, 0.02, frame, 'paint');
      }
    }
    box(g, 0, 1.42, 0, 0.51, 0.14, 0.5, red, 'paint');
    box(g, 0, 1.432, 0.259, 0.36, 0.06, 0.01, '#e5d3b1', 'paint');
    const crown = new T.Mesh(
      new T.SphereGeometry(0.28, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      material(red, 'paint'),
    );
    crown.scale.set(1, 0.28, 0.98);
    crown.position.y = 1.49;
    g.add(crown);
    box(g, 0.163, 0.9, 0.25, 0.017, 0.14, 0.025, '#d6b886', 'metal');
  }
  function van(g: T.Group) {
    const paint = '#4e7a70',
      dark = '#344d49';
    const bodyProfile = new T.Shape();
    bodyProfile.moveTo(-0.76, 0.465);
    bodyProfile.lineTo(0.76, 0.465);
    bodyProfile.lineTo(0.76, 0.215);
    const archAngle = Math.asin(0.085 / 0.153);
    for (const x of [0.5, -0.5]) {
      bodyProfile.lineTo(x + Math.cos(archAngle) * 0.153, 0.215);
      bodyProfile.absarc(x, 0.13, 0.153, archAngle, Math.PI - archAngle, false);
    }
    bodyProfile.lineTo(-0.76, 0.215);
    bodyProfile.closePath();
    const bodywork = new T.Mesh(
      new T.ExtrudeGeometry(bodyProfile, {
        depth: 0.59,
        bevelEnabled: true,
        bevelSize: 0.005,
        bevelThickness: 0.005,
        bevelSegments: 2,
        steps: 1,
        curveSegments: 10,
      }),
      material(paint, 'paint'),
    );
    bodywork.position.z = -0.295;
    bodywork.castShadow = bodywork.receiveShadow = true;
    g.add(bodywork);
    box(g, 0, 0.255, 0, 1.1, 0.065, 0.37, dark, 'metal');
    for (const x of [-0.5, 0.5])
      tube(g, [x, 0.13, -0.29], [x, 0.13, 0.29], 0.025, dark);
    box(g, -0.19, 0.625, 0, 1.02, 0.43, 0.6, paint, 'paint');
    // Sloped front windscreen and a separate bonnet distinguish the cab from the body.
    const cab = new T.Shape();
    cab.moveTo(-0.29, 0.47);
    cab.lineTo(0.69, 0.47);
    cab.lineTo(0.49, 0.82);
    cab.lineTo(-0.29, 0.82);
    cab.closePath();
    const mesh = new T.Mesh(
      new T.ExtrudeGeometry(cab, {
        depth: 0.56,
        bevelEnabled: true,
        bevelSize: 0.015,
        bevelThickness: 0.015,
        bevelSegments: 2,
        steps: 1,
      }),
      material(paint, 'paint'),
    );
    mesh.position.z = -0.28;
    g.add(mesh);
    box(g, -0.08, 0.845, 0, 1.2, 0.045, 0.62, '#dfdbc6', 'paint');
    const front = box(
      g,
      0.597,
      0.646,
      0,
      0.02,
      0.285,
      0.51,
      '#86aaa7',
      'glass',
    );
    front.rotation.z = 0.52;
    for (const z of [-0.307, 0.307]) {
      for (const x of [-0.43, -0.12, 0.23])
        box(g, x, 0.665, z, 0.235, 0.225, 0.012, '#a9c7bd', 'glass');
      for (const x of [-0.59, 0.07, 0.43])
        box(g, x, 0.574, z, 0.012, 0.45, 0.014, '#34584f', 'paint');
      box(g, -0.16, 0.434, z, 0.06, 0.012, 0.018, '#cabf9d', 'metal');
      box(g, 0.405, 0.478, z, 0.055, 0.012, 0.018, '#cabf9d', 'metal');
      tube(g, [0.53, 0.62, z], [0.57, 0.63, z * 1.1], 0.008, dark);
      box(g, 0.57, 0.655, z * 1.1, 0.038, 0.057, 0.025, dark, 'metal');
      box(g, 0, 0.24, z, 0.6, 0.035, 0.032, '#c4c9b9', 'metal');
    }
    for (const x of [-0.5, 0.5])
      for (const z of [-0.29, 0.29]) {
        tube(
          g,
          [x, 0.13, z - 0.035],
          [x, 0.13, z + 0.035],
          0.13,
          '#344440',
          'paint',
        );
        const outer = z + Math.sign(z) * 0.039;
        tube(
          g,
          [x, 0.13, outer],
          [x, 0.13, outer + Math.sign(z) * 0.009],
          0.066,
          '#aab5ab',
        );
        tube(
          g,
          [x, 0.13, outer],
          [x, 0.13, outer + Math.sign(z) * 0.014],
          0.024,
          '#526c64',
        );
      }
    box(g, 0.767, 0.29, 0, 0.035, 0.065, 0.61, '#aeb9ae', 'metal');
    box(g, -0.772, 0.29, 0, 0.026, 0.06, 0.6, '#aeb9ae', 'metal');
    for (const z of [-0.205, 0.205]) {
      box(g, 0.765, 0.423, z, 0.019, 0.066, 0.09, '#f1dca5', 'glass');
      box(g, -0.771, 0.424, z, 0.014, 0.08, 0.037, '#ab6046', 'paint');
    }
    for (let z = -0.11; z < 0.13; z += 0.037)
      box(g, 0.778, 0.36, z, 0.015, 0.045, 0.013, dark, 'metal');
    box(g, 0.79, 0.286, 0, 0.01, 0.036, 0.11, '#ece3ca', 'paint');
  }
  function boat(g: T.Group) {
    // Curved sections form a keel, flared sides, transom and tapered bow.
    const sections = [
      [-0.8, 0.22],
      [-0.55, 0.28],
      [0.18, 0.28],
      [0.58, 0.19],
      [0.93, 0.008],
    ];
    const vertices: number[] = [],
      indices: number[] = [];
    for (const [x, w] of sections)
      for (const [y, z] of [
        [0.015, 0],
        [0.09, -w * 0.76],
        [0.24, -w],
        [0.24, w],
        [0.09, w * 0.76],
      ])
        vertices.push(x, y, z);
    for (let i = 0; i < sections.length - 1; i++)
      for (let k = 0; k < 5; k++) {
        const a = i * 5 + k,
          b = i * 5 + ((k + 1) % 5),
          c = (i + 1) * 5 + k,
          d = (i + 1) * 5 + ((k + 1) % 5);
        indices.push(a, b, d, a, d, c);
      }
    indices.push(0, 4, 3, 0, 3, 2, 0, 2, 1, 20, 21, 22, 20, 22, 23, 20, 23, 24);
    const hullGeo = new T.BufferGeometry();
    hullGeo.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    hullGeo.setIndex(indices);
    hullGeo.computeVertexNormals();
    const hullMat = material('#e2d0ac', 'paint');
    const hull = new T.Mesh(hullGeo, hullMat);
    hull.castShadow = hull.receiveShadow = true;
    g.add(hull);
    for (const side of [-1, 1])
      for (let i = 0; i < sections.length - 1; i++) {
        const a = sections[i],
          b = sections[i + 1];
        tube(
          g,
          [a[0], 0.245, a[1] * side],
          [b[0], 0.245, b[1] * side],
          0.019,
          '#8e7653',
          'wood',
        );
      }
    box(g, -0.16, 0.275, 0, 1.12, 0.035, 0.41, '#a58a61', 'wood');
    for (let x = -0.68; x < 0.35; x += 0.11)
      box(g, x, 0.295, 0, 0.007, 0.004, 0.39, '#75684e', 'wood');
    box(g, -0.25, 0.445, 0, 0.52, 0.3, 0.36, '#a8734e', 'wood');
    for (const z of [-0.188, 0.188]) {
      for (const x of [-0.4, -0.22, -0.05])
        box(g, x, 0.49, z, 0.12, 0.14, 0.015, '#8cadab', 'glass');
      box(g, -0.23, 0.36, z, 0.55, 0.025, 0.025, '#dcc399', 'wood');
    }
    box(g, 0.023, 0.49, 0, 0.014, 0.16, 0.28, '#8cadab', 'glass');
    box(g, -0.25, 0.615, 0, 0.63, 0.055, 0.43, '#eddfc1', 'paint');
    tube(g, [0.34, 0.28, 0], [0.34, 1.1, 0], 0.015, '#66746b');
    box(g, 0.2, 1.035, 0, 0.26, 0.16, 0.012, '#b87346', 'fabric');
    for (const x of [-0.69, 0.55])
      tube(g, [x, 0.25, 0], [x, 0.3, 0], 0.026, '#53675d');
    for (const side of [-1, 1]) {
      tube(
        g,
        [-0.67, 0.25, side * 0.21],
        [-0.67, 0.42, side * 0.21],
        0.012,
        '#6f8178',
      );
      tube(
        g,
        [-0.67, 0.42, side * 0.21],
        [-0.52, 0.42, side * 0.25],
        0.012,
        '#6f8178',
      );
      const ring = new T.Mesh(
        new T.TorusGeometry(0.067, 0.018, 8, 16),
        material('#b97448', 'paint'),
      );
      ring.position.set(-0.25, 0.41, side * 0.24);
      g.add(ring);
    }
  }
  return { tube, lamp, bench, picnic, telephone, van, boat };
}
