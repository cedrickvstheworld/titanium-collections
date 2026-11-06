// Generates one-piece, watertight titanium fastener models plus thumbnails:
//   public/models/<name>.glb   — 3D model for three.js
//   public/thumbs/<name>.png   — bitmap preview for the design picker
//
// Run: npm run generate:models
//
// Each model is ONE closed surface: a stack of rings swept from the tip
// centre, up the shank, over the head, then down into the Torx recess and its
// conical floor. A ring's radius may vary with angle (threads, fluted heads,
// milled grooves, Torx lobes), so no parts are glued together.
//
// Units: 1 unit = 1 cm, real-world sizes. Axis = +Y, tip at y = 0.
// Node extras carry landmarks (bearingY, topY, flangeR, tipZone, burnt) used
// by the app to place the heat-tinted "Burnt" gradient.
//
// Visual references: references/designs/*.jpg

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import * as THREE from "three";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ helpers
const range = (a, b, step) => {
  const n = Math.max(1, Math.round(Math.abs(b - a) / step));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const helixPhase = (theta, y, pitch) => (((y / pitch - theta / TAU) % 1) + 1) % 1;

// ISO-like trapezoid profile (machine thread), 0 = root, 1 = crest
const isoProfile = (u) =>
  u < 0.25 ? 0 : u < 0.5625 ? (u - 0.25) / 0.3125 : u < 0.6875 ? 1 : 1 - (u - 0.6875) / 0.3125;
// sharp, narrow-crest profile (self-tapping thread)
const tappingProfile = (u) => Math.max(0, 1 - Math.abs(u - 0.5) / 0.28);

// Hexalobular (Torx) recess outline
const torxFn = ({ rOut, rIn }) => (t) => rIn + (rOut - rIn) * Math.pow((1 + Math.cos(6 * t)) / 2, 1.4);

// ------------------------------------------------------------ shank builders
function machineShank({ d, pitch, threadLength, shankR }) {
  const depth = 0.613 * pitch;
  const rMin = d / 2 - depth;
  return {
    pitch,
    threadLength,
    shankR,
    ringsPerPitch: 12,
    tipStart: 0,
    fn(theta, y) {
      const threadR = rMin + depth * isoProfile(helixPhase(theta, y, pitch));
      let r = threadR;
      if (y > threadLength) r = threadR + (shankR - threadR) * smooth((y - threadLength) / pitch);
      return Math.min(r, rMin - 0.05 * d + y); // 45° tip chamfer
    },
  };
}

function tappingShank({ d, coreR, pitch, threadLength, tipLen }) {
  const depth = d / 2 - coreR;
  const shankR = coreR + 0.02;
  return {
    pitch,
    threadLength,
    shankR,
    ringsPerPitch: 20,
    tipStart: 0.004,
    fn(theta, y) {
      const taper = Math.min(1, y / tipLen); // pointed gimlet tip
      const core = coreR * Math.pow(taper, 0.85);
      let thread = depth * tappingProfile(helixPhase(theta, y, pitch)) * Math.min(1, taper * 1.6);
      if (y > threadLength) thread *= Math.max(0, 1 - (y - threadLength) / pitch);
      const plain = y > threadLength ? shankR : core;
      return Math.max(core + thread, Math.min(plain, core + 0.02 + (y - threadLength) * 0.5));
    },
  };
}

// ------------------------------------------------------------- head builders
// CNC 12-point flange head with rounded flutes (M6/M8/M10 "CNC head" bolts).
function cncHead(k) {
  const H = {
    flangeR: 0.68 * k,
    flangeEdge: 0.09 * k,
    flangeSlope: 0.14 * k,
    lobeR: 0.56 * k,
    flute: 0.11 * k,
    height: 0.78 * k,
  };
  const lobes = (t) => {
    const p = (((t * 12) / TAU) % 1 + 1) % 1; // 0 = lobe centre
    const g = Math.sqrt(clamp01(1 - ((p - 0.5) / 0.25) ** 2)); // U-shaped flute
    return H.lobeR - H.flute * g;
  };
  return {
    flangeR: H.flangeR,
    height: H.height,
    rings(yB, ring) {
      const yTop = yB + H.height;
      ring(yB, () => H.flangeR - 0.015 * k);
      ring(yB + 0.015 * k, () => H.flangeR);
      ring(yB + H.flangeEdge, () => H.flangeR);
      const s0 = yB + H.flangeEdge;
      const radius = (t, y) => {
        let r = lobes(t);
        if (y < s0 + H.flangeSlope) {
          const q = clamp01((y - s0) / H.flangeSlope);
          r = Math.max(r, H.flangeR + (H.lobeR - 0.1 * k - H.flangeR) * q);
        }
        return Math.min(r, H.lobeR - 0.07 * k + (yTop - y)); // 45° top chamfer
      };
      for (const y of [
        ...range(s0, s0 + H.flangeSlope, 0.012 * k).slice(1),
        ...range(s0 + H.flangeSlope, yTop - 0.1 * k, 0.05 * k).slice(1),
        ...range(yTop - 0.1 * k, yTop, 0.01 * k).slice(1),
      ])
        ring(y, radius);
      return yTop;
    },
  };
}

// Wide flange + conical top with a flat plateau ("body" bolts/screws, normal).
function conicalHead({ flangeR, edgeH, coneBaseR, topR, height }) {
  const slope = (height - edgeH) / (coneBaseR - topR); // dy per dr on the cone
  return {
    flangeR,
    height,
    rings(yB, ring) {
      const yTop = yB + height;
      ring(yB, () => flangeR - 0.012);
      ring(yB + 0.012, () => flangeR);
      ring(yB + edgeH - 0.012, () => flangeR);
      ring(yB + edgeH, () => coneBaseR + 0.006);
      const yc0 = yB + edgeH;
      for (const y of range(yc0, yTop, 0.02).slice(1)) ring(y, () => coneBaseR - (y - yc0) / slope);
      return yTop;
    },
  };
}

// CNC "star" head (references/designs/start-head-reference.png):
// low dome, round counterbore around the Torx, 6 straight raised spokes that
// widen into triangles at the rim, scalloped pockets between the spokes that
// break through the rim, and a drilled dot at the root of each spoke.
// The top is a height field: y(θ, r) = dome(r) − cut(θ, r).
function starHead({ flangeR: R, edgeH, height, cupR, cupDepth, pocketDepth }) {
  const SPOKE = TAU / 6;
  const dome = (r) => {
    const s = clamp01((R - r) / (R - cupR)); // 0 at rim → 1 at counterbore
    return edgeH + (height - edgeH) * (1 - (1 - s) ** 2); // convex, flat on top
  };
  const cut = (t, r) => {
    // distance to the nearest spoke centre-line
    const a = wrapAngle(t - Math.round(t / SPOKE) * SPOKE);
    const dSpoke = r * Math.abs(Math.sin(a));
    const halfW = 0.075 * R + Math.max(0, r - 0.78 * R) * 0.9; // triangles at the rim
    const soft = 0.03 * R;
    const mask = smooth((dSpoke - halfW) / soft) * smooth((r - (cupR + 0.09 * R)) / soft);
    // pocket floor: stepped scallops (concentric arcs around the pocket axis,
    // stepping down outward) that break through the rim
    const pa = Math.round((t - SPOKE / 2) / SPOKE) * SPOKE + SPOKE / 2;
    const cx = cupR * Math.cos(pa), cz = cupR * Math.sin(pa);
    const q = Math.hypot(r * Math.cos(t) - cx, r * Math.sin(t) - cz) / (0.19 * R);
    const fq = Math.floor(q);
    const terrace = fq + smooth((q - fq - 0.7) / 0.3);
    const floorY = Math.max(edgeH - 0.045, height - pocketDepth - 0.1 * terrace);
    let g = mask * Math.max(0, dome(r) - floorY);
    // drilled dot at each spoke root
    const sa = Math.round(t / SPOKE) * SPOKE;
    const rd = cupR + 0.13 * R;
    const dd = Math.hypot(r * Math.cos(t) - rd * Math.cos(sa), r * Math.sin(t) - rd * Math.sin(sa)) / (0.035 * R);
    g = Math.max(g, 0.06 * Math.sqrt(clamp01(1 - dd * dd)));
    return g;
  };
  return {
    flangeR: R,
    height,
    rings(yB, ring) {
      ring(yB, () => R - 0.012);
      ring(yB + 0.012, () => R);
      // flange edge top follows the pocket notches
      ring((t) => yB + edgeH - cut(t, R) - 0.012, () => R);
      for (const r of range(R - 0.008, cupR, 0.005)) ring((t) => yB + dome(r) - cut(t, r), () => r);
      // counterbore wall down to its flat floor
      ring(yB + height - cupDepth * 0.5, () => cupR - 0.004);
      ring(yB + height - cupDepth, () => cupR - 0.008);
      return yB + height - cupDepth;
    },
  };
}

// --------------------------------------------------------------- the lineup
function cncBolt(name, d, pitch, length, threadLength) {
  const k = d / 0.8;
  return {
    name,
    node: "Fastener",
    segments: 144,
    length,
    filletR: 0.04 * k,
    shank: machineShank({ d, pitch, threadLength, shankR: d / 2 - 0.015 * k }),
    head: cncHead(k),
    torx: { rOut: 0.3 * k, rIn: 0.215 * k, depth: 0.38 * k, cone: 0.12 * k },
    burnt: "height",
    tipZone: 0.55 * d,
  };
}

function bodyBolt(name, star) {
  const torx = { rOut: 0.27, rIn: 0.195, depth: 0.26, cone: 0.07 };
  return {
    name,
    node: "Fastener",
    segments: star ? 360 : 144,
    length: 1.6, // representative M6 length (sold in several lengths)
    filletR: 0.03,
    shank: machineShank({ d: 0.6, pitch: 0.1, threadLength: 1.45, shankR: 0.29 }),
    head: star
      ? starHead({ flangeR: 0.78, edgeH: 0.14, height: 0.5, cupR: 0.34, cupDepth: 0.05, pocketDepth: 0.1 })
      : conicalHead({ flangeR: 0.72, edgeH: 0.1, coneBaseR: 0.68, height: 0.5, topR: 0.42 }),
    torx,
    burnt: "radial",
    tipZone: 0.3,
  };
}

function bodyScrew(name, star) {
  const torx = { rOut: 0.225, rIn: 0.16, depth: 0.24, cone: 0.06 };
  return {
    name,
    node: "Fastener",
    segments: star ? 360 : 144,
    length: 1.9, // representative ST4.8 length (sold in several lengths)
    filletR: 0.025,
    shank: tappingShank({ d: 0.48, coreR: 0.17, pitch: 0.16, threadLength: 1.78, tipLen: 0.45 }),
    head: star
      ? starHead({ flangeR: 0.64, edgeH: 0.14, height: 0.5, cupR: 0.28, cupDepth: 0.045, pocketDepth: 0.09 })
      : conicalHead({ flangeR: 0.62, edgeH: 0.13, coneBaseR: 0.57, height: 0.52, topR: 0.36 }),
    torx,
    burnt: "radial",
    tipZone: 0.45,
  };
}

const MODELS = [
  // CNC lengths are representative — the real bolts come in many lengths
  cncBolt("cnc-m6", 0.6, 0.1, 4.5, 4.35), // full thread, slender (M6 x 45)
  cncBolt("cnc-m8", 0.8, 0.125, 4.2, 4.05), // full thread, slender (M8 x 42)
  cncBolt("cnc-m10", 1.0, 0.125, 5.0, 3.0), // M10 x 1.25, plain shank
  bodyBolt("body-bolt", false),
  bodyBolt("body-bolt-star", true),
  bodyScrew("body-screw", false),
  bodyScrew("body-screw-star", true),
];

// ------------------------------------------------------------------ builder
function build(M) {
  const N = M.segments;
  const thetas = Array.from({ length: N }, (_, i) => (i / N) * TAU);
  const S = M.shank;
  const yB = M.length;
  const torx = torxFn(M.torx);

  const rings = [];
  // y: number, or (θ) => y for height-field tops; fn: (θ, y) => radius
  const ring = (y, fn) =>
    rings.push(
      typeof y === "function"
        ? { y: Float64Array.from(thetas, (t) => y(t)), r: Float64Array.from(thetas, (t) => fn(t)) }
        : { y: new Float64Array(N).fill(y), r: Float64Array.from(thetas, (t) => fn(t, y)) },
    );

  // shank up to the fillet
  const yFillet = yB - M.filletR;
  const threadTop = Math.min(S.threadLength + S.pitch, yFillet);
  for (const y of range(S.tipStart, threadTop, S.pitch / S.ringsPerPitch)) ring(y, S.fn);
  for (const y of range(threadTop, yFillet, 0.1).slice(1)) ring(y, S.fn);
  // fillet under the head
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    const r = S.shankR + (1 - Math.cos(a)) * M.filletR;
    ring(yFillet + Math.sin(a) * M.filletR, () => r);
  }
  // head
  const yTop = M.head.rings(yB, ring);
  // top face → Torx recess → conical floor
  const { depth, cone } = M.torx;
  ring(yTop, (t) => torx(t) + 0.025);
  ring(yTop - 0.015, (t) => torx(t));
  for (const y of range(yTop - 0.015, yTop - depth, 0.04).slice(1)) {
    const k = 1 - 0.04 * ((yTop - y) / depth);
    ring(y, (t) => torx(t) * k);
  }
  for (let i = 1; i < 4; i++) {
    const s = 1 - i / 4;
    ring(yTop - depth - (1 - s) * cone, (t) => torx(t) * 0.96 * s);
  }

  // vertices
  const R = rings.length;
  const positions = new Float32Array((R * N + 2) * 3);
  let v = 0;
  const push = (x, y, z) => {
    positions[v++] = x;
    positions[v++] = y;
    positions[v++] = z;
  };
  push(0, 0, 0);
  for (const { y, r } of rings)
    for (let j = 0; j < N; j++) push(r[j] * Math.cos(thetas[j]), y[j], r[j] * Math.sin(thetas[j]));
  push(0, yTop - depth - cone, 0);
  const topC = R * N + 1;
  const idx = (i, j) => 1 + i * N + (j % N);

  const indices = [];
  for (let j = 0; j < N; j++) indices.push(0, idx(0, j + 1), idx(0, j));
  for (let i = 0; i < R - 1; i++)
    for (let j = 0; j < N; j++) {
      const a = idx(i, j), b = idx(i, j + 1), c = idx(i + 1, j), d = idx(i + 1, j + 1);
      indices.push(a, b, d, a, d, c);
    }
  for (let j = 0; j < N; j++) indices.push(topC, idx(R - 1, j), idx(R - 1, j + 1));

  // outward winding (positive signed volume)
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  let vol = 0;
  for (let t = 0; t < indices.length; t += 3) {
    A.fromArray(positions, indices[t] * 3);
    B.fromArray(positions, indices[t + 1] * 3);
    C.fromArray(positions, indices[t + 2] * 3);
    vol += A.dot(B.cross(C)) / 6;
  }
  if (vol < 0)
    for (let t = 0; t < indices.length; t += 3)
      [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];

  // watertight: every edge used exactly twice
  const edges = new Map();
  for (let t = 0; t < indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + ((e + 1) % 3)];
      const key = a < b ? a * 1e7 + b : b * 1e7 + a;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  const open = [...edges.values()].filter((n) => n !== 2).length;
  if (open) throw new Error(`${M.name}: not watertight (${open} bad edges)`);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.userData = {
    bearingY: yB,
    topY: yTop,
    flangeR: M.head.flangeR,
    tipZone: M.tipZone,
    burnt: M.burnt,
  };
  return geom;
}

// ------------------------------------------------------------------ GLB write
function writeGlb(geom, M, file) {
  const positions = geom.getAttribute("position").array;
  const normals = geom.getAttribute("normal").array;
  const vertCount = positions.length / 3;
  const IndexArray = vertCount > 65535 ? Uint32Array : Uint16Array;
  const indexData = IndexArray.from(geom.getIndex().array);
  const pad4 = (n) => (n + 3) & ~3;
  const [pB, nB, iB] = [positions.byteLength, normals.byteLength, indexData.byteLength];
  const binLen = pad4(pB) + pad4(nB) + pad4(iB);
  const bin = Buffer.alloc(binLen);
  Buffer.from(positions.buffer, positions.byteOffset, pB).copy(bin, 0);
  Buffer.from(normals.buffer, normals.byteOffset, nB).copy(bin, pad4(pB));
  Buffer.from(indexData.buffer).copy(bin, pad4(pB) + pad4(nB));
  const { min, max } = geom.boundingBox;

  const gltf = {
    asset: { version: "2.0", generator: "titanium-collections generate-models.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: M.node, mesh: 0, extras: geom.userData }],
    meshes: [{ name: M.name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [
      {
        name: "Titanium",
        pbrMetallicRoughness: { baseColorFactor: [0.75, 0.75, 0.78, 1], metallicFactor: 1, roughnessFactor: 0.28 },
      },
    ],
    buffers: [{ byteLength: binLen }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pB, target: 34962 },
      { buffer: 0, byteOffset: pad4(pB), byteLength: nB, target: 34962 },
      { buffer: 0, byteOffset: pad4(pB) + pad4(nB), byteLength: iB, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertCount, type: "VEC3", min: min.toArray(), max: max.toArray() },
      { bufferView: 1, componentType: 5126, count: vertCount, type: "VEC3" },
      { bufferView: 2, componentType: IndexArray === Uint32Array ? 5125 : 5123, count: indexData.length, type: "SCALAR" },
    ],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc(pad4(json.length) - json.length, 0x20)]);
  const u32 = (...n) => {
    const b = Buffer.alloc(4 * n.length);
    n.forEach((x, i) => b.writeUInt32LE(x, i * 4));
    return b;
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    Buffer.concat([
      u32(0x46546c67, 2, 12 + 8 + json.length + 8 + binLen),
      u32(json.length, 0x4e4f534a), json,
      u32(binLen, 0x004e4942), bin,
    ]),
  );
}

// ------------------------------------------------- thumbnail (software raster)
function writeThumb(geom, file, size = 256, view = "thumb") {
  const SS = 2; // supersampling
  const W = size * SS;
  const pos = geom.getAttribute("position").array;
  const nrm = geom.getAttribute("normal").array;
  const ix = geom.getIndex().array;
  const rgba = new Float32Array(W * W * 4);
  const zb = new Float32Array(W * W).fill(-Infinity);

  const { min, max } = geom.boundingBox;
  const center = min.clone().add(max).multiplyScalar(0.5);
  const tall = max.y - min.y > (max.x - min.x) * 1.6;
  // tall fasteners lie diagonally; stubby ones show their head at 3/4 view
  const rot = view === "top"
    ? new THREE.Matrix4()
        .makeRotationX(Math.PI / 2 - 0.35) // look down onto the head, slightly tilted
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -max.y + 0.3, -center.z))
    : new THREE.Matrix4()
    .makeRotationZ(tall ? -Math.PI / 4 : -Math.PI / 6)
    .multiply(new THREE.Matrix4().makeRotationX(tall ? 0.45 : 0.75))
    .multiply(new THREE.Matrix4().makeRotationY(0.5))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
  const nrot = new THREE.Matrix3().getNormalMatrix(rot);

  const tv = new THREE.Vector3(), tn = new THREE.Vector3();
  let ext = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    tv.fromArray(pos, i * 3).applyMatrix4(rot);
    if (view === "top" && tv.z < -0.6) continue; // frame the head only
    ext = Math.max(ext, Math.abs(tv.x), Math.abs(tv.y));
  }
  const scale = (W * 0.44) / ext;
  const L = new THREE.Vector3(-0.4, 0.6, 0.7).normalize();
  const H = L.clone().add(new THREE.Vector3(0, 0, 1)).normalize();
  const vs = [];
  for (let i = 0; i < pos.length / 3; i++) {
    tv.fromArray(pos, i * 3).applyMatrix4(rot);
    tn.fromArray(nrm, i * 3).applyMatrix3(nrot).normalize();
    const d = Math.max(0, tn.dot(L));
    const s = Math.pow(Math.max(0, tn.dot(H)), 40);
    const rim = Math.pow(1 - Math.max(0, tn.z), 3) * 0.25;
    vs.push([W / 2 + tv.x * scale, W / 2 - tv.y * scale, tv.z, 0.42 + 0.6 * d + 0.6 * s + rim]);
  }
  for (let t = 0; t < ix.length; t += 3) {
    const a = vs[ix[t]], b = vs[ix[t + 1]], c = vs[ix[t + 2]];
    const ar = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (ar >= 0) continue; // back-face
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(W - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / ar;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / ar;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const k = y * W + x;
        if (z <= zb[k]) continue;
        zb[k] = z;
        const s = w0 * a[3] + w1 * b[3] + w2 * c[3];
        rgba.set([0.78 * s, 0.79 * s, 0.82 * s, 1], k * 4);
      }
  }
  // downsample + encode PNG (RGBA)
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const k = ((y * SS + sy) * W + x * SS + sx) * 4;
          r += rgba[k]; g += rgba[k + 1]; b += rgba[k + 2]; al += rgba[k + 3];
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const div = al || 1;
      raw[o] = Math.min(255, (r / div) * 255);
      raw[o + 1] = Math.min(255, (g / div) * 255);
      raw[o + 2] = Math.min(255, (b / div) * 255);
      raw[o + 3] = (al / (SS * SS)) * 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

// clean out models from earlier lineups
rmSync(resolve(ROOT, "public/models"), { recursive: true, force: true });
rmSync(resolve(ROOT, "public/thumbs"), { recursive: true, force: true });

for (const M of MODELS) {
  const geom = build(M);
  writeGlb(geom, M, resolve(ROOT, `public/models/${M.name}.glb`));
  writeThumb(geom, resolve(ROOT, `public/thumbs/${M.name}.png`));
  // PREVIEW_DIR=/some/dir npm run generate:models → extra top-down head renders for checking
  if (process.env.PREVIEW_DIR) writeThumb(geom, resolve(process.env.PREVIEW_DIR, `${M.name}-top.png`), 512, "top");
  const kb = ((geom.getAttribute("position").count * 24 + geom.getIndex().count * 4) / 1024).toFixed(0);
  console.log(`${M.name}: ${geom.getAttribute("position").count} verts, watertight, ~${kb} KB`);
}
