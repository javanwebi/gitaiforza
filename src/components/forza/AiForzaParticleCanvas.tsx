import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export type ForzaStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

interface AiForzaParticleCanvasProps {
  statusRef: { current: ForzaStatus };
  audioLevelRef: { current: number };
  className?: string;
}

const FACE_CENTER = new THREE.Vector3(0, 0.95, 0.32);
const CHEST_CENTER = new THREE.Vector3(0, -0.34, 0.32);

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function cyanShade(r: number): THREE.Color {
  const c = new THREE.Color();
  c.setHSL((0.52 + r * 0.05) % 1, 1.0, 0.55 + r * 0.23);
  return c;
}

function orangeShade(r: number, heat: number): THREE.Color {
  const c = new THREE.Color();
  const h = (0.045 + heat * 0.06 + r * 0.02) % 1;
  const s = 1.0 - heat * 0.25;
  const l = Math.min(0.92, 0.5 + heat * 0.28 + r * 0.08);
  c.setHSL(h, s, l);
  return c;
}

function randomDir(out: THREE.Vector3): THREE.Vector3 {
  out.set(gauss(), gauss(), gauss());
  if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
  return out.normalize();
}

const clamp01 = (v: number) => Math.max(-1, Math.min(1, v));

// directional light baked into brightness (key light from upper-left)
const LIGHT = new THREE.Vector3(-0.5, 0.7, 0.5).normalize();
function lightFactor(nx: number, ny: number, nz: number): number {
  const len = Math.hypot(nx, ny, nz) || 1;
  const d = (nx / len) * LIGHT.x + (ny / len) * LIGHT.y + (nz / len) * LIGHT.z;
  return 0.72 + 0.28 * Math.max(0, d);
}

// flowing wave-terrain height for the side waves
function ridgeH(x: number, z: number): number {
  return (
    0.55 * Math.sin(x * 1.7 + 1.3) * Math.sin(z * 2.1 + 0.7) +
    0.3 * Math.sin(x * 3.1 + z * 1.2) +
    0.18 * Math.sin(x * 5.3 + z * 3.7)
  );
}

function makeGlowTexture(inner: string, mid: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.35, mid);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function distToFace(x: number, y: number, z: number): number {
  const dx = x - FACE_CENTER.x;
  const dy = (y - FACE_CENTER.y) * 0.9;
  const dz = (z - FACE_CENTER.z) * 1.1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function distToChest(x: number, y: number, z: number): number {
  const dx = (x - CHEST_CENTER.x) * 1.1;
  const dy = y - CHEST_CENTER.y;
  const dz = (z - CHEST_CENTER.z) * 1.2;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/* ------------------------------------------------------------------ */
/* shared curve parameterization (used by BOTH lines and particles)    */
/* ------------------------------------------------------------------ */

const HC = { x: 0, y: 1.02, z: 0 };
const HR = { x: 0.78, y: 0.95, z: 0.7 };
const HEAD_RINGS = 64;
const NECK_RINGS = 14;
const SH_ARCS = 18;
const CH_ARCS = 8;

function headRingPoint(ri: number, a: number) {
  const t = -0.96 + (ri / (HEAD_RINGS - 1)) * 1.95;
  const cross = Math.sqrt(Math.max(0, 1 - t * t));
  const yBase = HC.y + t * HR.y;
  let taperX = 1;
  let taperZ = 1;
  if (t < -0.2) {
    const tt = Math.min(1, (-0.2 - t) / 0.8);
    taperX = 1 - 0.34 * tt;
    taperZ = 1 - 0.18 * tt;
  }
  const wob = 1 + 0.014 * Math.sin(a * 5 + yBase * 7) + 0.01 * Math.sin(a * 9 - yBase * 11);
  const rr = cross * wob;
  return {
    x: HC.x + Math.cos(a) * HR.x * rr * taperX,
    y: yBase,
    z: HC.z + Math.sin(a) * HR.z * rr * taperZ,
    t,
  };
}

function neckRingPoint(ri: number, a: number) {
  const y = 0.14 - (ri / (NECK_RINGS - 1)) * 0.28;
  const nr = 0.2 + (0.14 - y) * 0.12;
  return { x: Math.cos(a) * nr, y, z: Math.sin(a) * nr * 0.88 };
}

function shoulderArcPoint(s: number, k: number, u: number) {
  const rk = 0.36 + k * 0.074;
  const a = 0.12 + u * 1.15;
  return {
    x: s * Math.sin(a) * rk * 1.12,
    y: 0.12 - Math.cos(a) * rk * 0.72,
    z: 0.12 + 0.06 * Math.sin(a * 2),
    a,
    fade: 1 - (k / SH_ARCS) * 0.35,
  };
}

function chestArcPoint(s: number, k: number, u: number) {
  const rk = 0.3 + k * 0.1;
  const a = 0.3 + u * 0.9;
  return {
    x: s * Math.sin(a) * rk * 1.15,
    y: -0.5 - Math.cos(a) * rk * 0.8,
    z: 0.18,
    fade: 1 - (k / CH_ARCS) * 0.5,
  };
}

function makeNeuralCurves() {
  const defs: { pts: number[][]; seam?: boolean }[] = [
    { pts: [[0, 1.86, 0.44], [0, 1.45, 0.64], [0, 1.05, 0.7], [0, 0.66, 0.54], [0, 0.4, 0.34]], seam: true },
    { pts: [[-0.05, 0.52, 0.2], [-0.055, 0.2, 0.21], [-0.07, -0.12, 0.19]] },
    { pts: [[0.05, 0.52, 0.2], [0.055, 0.2, 0.21], [0.07, -0.12, 0.19]] },
    { pts: [[-0.11, 0.48, 0.17], [-0.13, 0.18, 0.17], [-0.16, -0.1, 0.14]] },
    { pts: [[0.11, 0.48, 0.17], [0.13, 0.18, 0.17], [0.16, -0.1, 0.14]] },
    { pts: [[-0.05, 0.45, 0.26], [-0.12, 0.24, 0.2], [-0.22, 0.05, 0.13]] },
    { pts: [[0.05, 0.45, 0.26], [0.12, 0.24, 0.2], [0.22, 0.05, 0.13]] },
    { pts: [[-0.22, 0.03, 0.15], [-0.66, -0.08, 0.0], [-1.12, -0.32, -0.12]] },
    { pts: [[0.22, 0.03, 0.15], [0.66, -0.08, 0.0], [1.12, -0.32, -0.12]] },
    { pts: [[-0.55, -0.16, 0.31], [-0.36, -0.34, 0.37], [-0.1, -0.38, 0.36]] },
    { pts: [[0.55, -0.16, 0.31], [0.36, -0.34, 0.37], [0.1, -0.38, 0.36]] },
    { pts: [[0, -0.32, 0.35], [0, -0.64, 0.31], [0, -0.98, 0.18]] },
    { pts: [[-0.08, -0.64, 0.31], [-0.3, -0.8, 0.22], [-0.5, -1.0, 0.1]] },
    { pts: [[0.08, -0.64, 0.31], [0.3, -0.8, 0.22], [0.5, -1.0, 0.1]] },
    { pts: [[-1.12, -0.32, -0.12], [-1.3, -0.5, -0.14], [-1.38, -0.7, -0.12]] },
    { pts: [[1.12, -0.32, -0.12], [1.3, -0.5, -0.14], [1.38, -0.7, -0.12]] },
  ];
  return defs.map(d => ({
    curve: new THREE.CatmullRomCurve3(d.pts.map(p => new THREE.Vector3(p[0], p[1], p[2]))),
    seam: !!d.seam,
  }));
}

const WAVE_Y = -0.08;
function makeCrestCurves() {
  const out: THREE.CatmullRomCurve3[] = [];
  for (const s of [-1, 1]) {
    for (const zc of [0.15, -0.12, 0.42]) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 10; k++) {
        const ax = 1.0 + (k / 10) * 1.6;
        const wx = s * ax;
        pts.push(new THREE.Vector3(wx, WAVE_Y + ridgeH(wx, zc) + 0.04, zc));
      }
      out.push(new THREE.CatmullRomCurve3(pts));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* LINE field builder — the PRIMARY structure                          */
/* ------------------------------------------------------------------ */

interface LineVert {
  p: THREE.Vector3;
  color: THREE.Color;
  energy: number;
  depth: number;
  delay: number;
}

class LineBuilder {
  pos: number[] = [];
  col: number[] = [];
  phase: number[] = [];
  energy: number[] = [];
  scatter: number[] = [];
  delay: number[] = [];
  depth: number[] = [];
  tmp = new THREE.Vector3();

  private vert(v: LineVert, phase: number, scatterScale = 1) {
    this.pos.push(v.p.x, v.p.y, v.p.z);
    this.col.push(v.color.r, v.color.g, v.color.b);
    this.phase.push(phase);
    this.energy.push(Math.max(0, Math.min(1, v.energy)));
    randomDir(this.tmp).multiplyScalar(scatterScale * (1 + Math.random() * 1.5) * (1 - v.energy * 0.4));
    this.scatter.push(this.tmp.x, this.tmp.y, this.tmp.z);
    this.delay.push(v.delay);
    this.depth.push(clamp01(v.depth));
  }

  polyline(verts: LineVert[], phaseOffset: number, closed = false, scatterScale = 1) {
    const n = verts.length;
    if (n < 2) return;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const A = verts[i];
      const B = verts[(i + 1) % n];
      const pa = phaseOffset + (i / n) * Math.PI * 2;
      const pb = phaseOffset + ((i + 1) / n) * Math.PI * 2;
      this.vert(A, pa, scatterScale);
      this.vert(B, pb, scatterScale);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phase, 1));
    g.setAttribute('aEnergy', new THREE.Float32BufferAttribute(this.energy, 1));
    g.setAttribute('aScatter', new THREE.Float32BufferAttribute(this.scatter, 3));
    g.setAttribute('aDelay', new THREE.Float32BufferAttribute(this.delay, 1));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(this.depth, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function buildLineField(scale: number): THREE.BufferGeometry {
  const b = new LineBuilder();
  const SEG = (n: number) => Math.max(24, Math.round(n * scale));

  /* head latitude rings — dense continuous contour lines */
  for (let ri = 0; ri < HEAD_RINGS; ri++) {
    const t = -0.96 + (ri / (HEAD_RINGS - 1)) * 1.95;
    const cross = Math.sqrt(Math.max(0, 1 - t * t));
    if (cross < 0.06) continue;
    const segs = SEG(240);
    const ringBright = 1.5 + Math.random() * 0.2;
    const verts: LineVert[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const q = headRingPoint(ri, a);
      const f = Math.max(0, 1 - distToFace(q.x, q.y, q.z) / 0.52);
      let col = cyanShade(Math.random());
      let energy = 0;
      if (f > 0.02) {
        col = col.clone().lerp(orangeShade(Math.random(), f), Math.min(1, f * 1.15));
        energy = Math.min(1, f * 1.2);
      }
      // core illuminates nearby lines
      col.multiplyScalar(ringBright * (0.94 + 0.06 * Math.sin(a * 3 + ri)) * lightFactor(Math.cos(a), t * 0.7, Math.sin(a)) * (1 + f * 0.9));
      verts.push({
        p: new THREE.Vector3(q.x, q.y, q.z),
        color: col,
        energy,
        depth: q.z / HR.z,
        delay: 0.02 + Math.random() * 0.18,
      });
    }
    b.polyline(verts, ri * 0.7, true);
  }

  /* neck rings */
  for (let ri = 0; ri < NECK_RINGS; ri++) {
    const segs = SEG(180);
    const ringBright = 1.35 + Math.random() * 0.2;
    const verts: LineVert[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const q = neckRingPoint(ri, a);
      const col = cyanShade(Math.random()).multiplyScalar(ringBright * lightFactor(Math.cos(a), 0.1, Math.sin(a)));
      verts.push({
        p: new THREE.Vector3(q.x, q.y, q.z),
        color: col,
        energy: 0,
        depth: Math.max(-1, Math.min(1, q.z / 0.2)),
        delay: 0.15 + Math.random() * 0.2,
      });
    }
    b.polyline(verts, ri * 0.9 + 2.0, true);
  }

  /* shoulder arcs */
  for (const s of [-1, 1]) {
    for (let k = 0; k < SH_ARCS; k++) {
      const segs = SEG(150);
      const verts: LineVert[] = [];
      for (let i = 0; i <= segs; i++) {
        const q = shoulderArcPoint(s, k, i / segs);
        const a = 0.12 + (i / segs) * 1.15;
        const col = cyanShade(Math.random()).multiplyScalar(q.fade * 1.6 * lightFactor(s * Math.sin(a), -Math.cos(a), 0.35));
        verts.push({
          p: new THREE.Vector3(q.x, q.y, q.z),
          color: col,
          energy: 0,
          depth: Math.max(-1, Math.min(1, q.z / 0.5)),
          delay: 0.3 + Math.random() * 0.2,
        });
      }
      b.polyline(verts, k * 0.5 + (s > 0 ? 4.0 : 8.0), false);
    }
  }

  /* chest arcs */
  for (const s of [-1, 1]) {
    for (let k = 0; k < CH_ARCS; k++) {
      const segs = SEG(110);
      const verts: LineVert[] = [];
      for (let i = 0; i <= segs; i++) {
        const q = chestArcPoint(s, k, i / segs);
        if (q.y < -1.25) continue;
        const col = cyanShade(Math.random()).multiplyScalar(q.fade * 0.95);
        verts.push({
          p: new THREE.Vector3(q.x, q.y, q.z),
          color: col,
          energy: 0,
          depth: Math.max(-1, Math.min(1, q.z / 0.5)),
          delay: 0.45 + Math.random() * 0.18,
        });
      }
      b.polyline(verts, k * 0.6 + (s > 0 ? 12.0 : 16.0), false);
    }
  }

  /* gold neural pathways */
  for (const n of makeNeuralCurves()) {
    const segs = SEG(130);
    const verts: LineVert[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = n.curve.getPoint(t);
      let col: THREE.Color;
      let energy: number;
      if (n.seam) {
        col = new THREE.Color('#D8F8FF').lerp(new THREE.Color('#67E8F9'), Math.min(1, t * 0.85 + 0.15));
        energy = 0.6;
      } else {
        col = orangeShade(Math.random(), 0.35 + 0.5 * t);
        energy = 0.85;
      }
      verts.push({
        p,
        color: col,
        energy,
        depth: Math.max(-1, Math.min(1, p.z / 0.6)),
        delay: 0.2 + Math.random() * 0.25,
      });
    }
    b.polyline(verts, Math.random() * 6, false);
  }

  /* golden crest streams over the side waves */
  for (const curve of makeCrestCurves()) {
    const segs = SEG(170);
    const verts: LineVert[] = [];
    for (let i = 0; i <= segs; i++) {
      const p = curve.getPoint(i / segs);
      verts.push({
        p,
        color: orangeShade(Math.random(), 0.55),
        energy: 1,
        depth: Math.max(-1, Math.min(1, p.z / 1.5)),
        delay: 0.5 + Math.random() * 0.2,
      });
    }
    b.polyline(verts, Math.random() * 6, false, 0.5);
  }

  return b.build();
}

/* ------------------------------------------------------------------ */
/* POINT field builder — SECONDARY: accents on lines + core + edges    */
/* ------------------------------------------------------------------ */

class FieldBuilder {
  pos: number[] = [];
  col: number[] = [];
  size: number[] = [];
  phase: number[] = [];
  energy: number[] = [];
  drift: number[] = [];
  detach: number[] = [];
  scatter: number[] = [];
  delay: number[] = [];
  depth: number[] = [];
  wave: number[] = [];
  tmp = new THREE.Vector3();
  tmp2 = new THREE.Vector3();

  push(
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    size: number,
    energy: number,
    opts: {
      drift?: THREE.Vector3;
      detach?: number;
      depth?: number;
      delay?: number;
      scatterScale?: number;
      wave?: number;
    } = {},
  ) {
    const e = Math.max(0, Math.min(1, energy));
    this.pos.push(x, y, z);
    this.col.push(color.r, color.g, color.b);
    this.size.push(size);
    this.phase.push(Math.random() * Math.PI * 2);
    this.energy.push(e);
    const d = opts.drift || randomDir(this.tmp).multiplyScalar(0.4 + Math.random() * 0.6);
    this.drift.push(d.x, d.y, d.z);
    this.detach.push(opts.detach || 0);
    const ss = (opts.scatterScale ?? 1) * (1.5 + Math.random() * 2.5) * (1 - e * 0.45);
    randomDir(this.tmp2).multiplyScalar(ss);
    this.scatter.push(this.tmp2.x, this.tmp2.y, this.tmp2.z);
    this.delay.push(opts.delay ?? Math.random() * 0.45 * (1 - e * 0.5));
    this.depth.push(Math.max(-1, Math.min(1, opts.depth ?? 0)));
    this.wave.push(opts.wave || 0);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.size, 1));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phase, 1));
    g.setAttribute('aEnergy', new THREE.Float32BufferAttribute(this.energy, 1));
    g.setAttribute('aDrift', new THREE.Float32BufferAttribute(this.drift, 3));
    g.setAttribute('aDetach', new THREE.Float32BufferAttribute(this.detach, 1));
    g.setAttribute('aScatter', new THREE.Float32BufferAttribute(this.scatter, 3));
    g.setAttribute('aDelay', new THREE.Float32BufferAttribute(this.delay, 1));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(this.depth, 1));
    g.setAttribute('aWave', new THREE.Float32BufferAttribute(this.wave, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function buildPointField(scale: number): THREE.BufferGeometry {
  const b = new FieldBuilder();
  const S = (n: number) => Math.max(60, Math.round(n * scale));
  const tmp = new THREE.Vector3();

  /* riders: bright accents sitting directly ON the head/neck lines */
  for (let i = 0; i < S(16000); i++) {
    const onNeck = Math.random() < 0.12;
    let x: number;
    let y: number;
    let z: number;
    let depthRef = HR.z;
    if (onNeck) {
      const q = neckRingPoint(Math.floor(Math.random() * NECK_RINGS), Math.random() * Math.PI * 2);
      x = q.x + gauss() * 0.012;
      y = q.y + gauss() * 0.008;
      z = q.z + gauss() * 0.012;
      depthRef = 0.2;
    } else {
      const ri = Math.floor(Math.random() * HEAD_RINGS);
      const a = Math.random() * Math.PI * 2;
      const q = headRingPoint(ri, a);
      x = q.x + gauss() * 0.012;
      y = q.y + gauss() * 0.008;
      z = q.z + gauss() * 0.012;
    }
    const f = Math.max(0, 1 - distToFace(x, y, z) / 0.52);
    let col = cyanShade(Math.random());
    let energy = 0;
    if (f > 0.02) {
      col = col.clone().lerp(orangeShade(Math.random(), f), Math.min(1, f * 1.15));
      energy = Math.min(1, f * 1.2);
    }
    col.multiplyScalar(1.35 + Math.random() * 0.4);
    b.push(x, y, z, col, 0.05 + Math.random() * 0.06, energy, {
      depth: Math.max(-1, Math.min(1, z / depthRef)),
      delay: 0.02 + Math.random() * 0.2,
    });
  }

  /* riders on shoulder / chest arcs */
  for (let i = 0; i < S(4000); i++) {
    const s = Math.random() < 0.5 ? -1 : 1;
    let x: number;
    let y: number;
    let z: number;
    let fade = 1;
    let delay = 0.3;
    if (Math.random() < 0.7) {
      const q = shoulderArcPoint(s, Math.floor(Math.random() * SH_ARCS), Math.random());
      x = q.x + gauss() * 0.012;
      y = q.y + gauss() * 0.012;
      z = q.z + gauss() * 0.02;
      fade = q.fade;
      delay = 0.3 + Math.random() * 0.2;
    } else {
      const q = chestArcPoint(s, Math.floor(Math.random() * CH_ARCS), Math.random());
      x = q.x + gauss() * 0.012;
      y = q.y + gauss() * 0.012;
      z = q.z + gauss() * 0.02;
      fade = q.fade;
      delay = 0.45 + Math.random() * 0.18;
    }
    const col = cyanShade(Math.random()).multiplyScalar(fade * 1.4);
    b.push(x, y, z, col, 0.05 + Math.random() * 0.06, 0, {
      depth: Math.max(-1, Math.min(1, z / 0.5)),
      delay,
    });
  }

  /* riders on gold neural pathways */
  {
    const curves = makeNeuralCurves();
    for (let i = 0; i < S(1500); i++) {
      const n = curves[Math.floor(Math.random() * curves.length)];
      const t = Math.random();
      const p = n.curve.getPoint(t);
      let col: THREE.Color;
      let energy: number;
      if (n.seam) {
        col = new THREE.Color('#D8F8FF').lerp(new THREE.Color('#67E8F9'), Math.min(1, t * 0.85 + 0.15));
        energy = 0.6;
      } else {
        col = orangeShade(Math.random(), 0.35 + 0.5 * t);
        energy = 0.85;
      }
      b.push(p.x + gauss() * 0.014, p.y + gauss() * 0.014, p.z + gauss() * 0.014, col, 0.045 + Math.random() * 0.05, energy, {
        depth: Math.max(-1, Math.min(1, p.z / 0.6)),
        delay: 0.2 + Math.random() * 0.25,
      });
    }
  }

  /* orange face core: WHITE → YELLOW → ORANGE → AMBER → CYAN */
  const DEEP_ORANGE = new THREE.Color('#E85D04');
  for (let i = 0; i < S(8000); i++) {
    randomDir(tmp);
    const fr = Math.cbrt(Math.random());
    const x = FACE_CENTER.x + tmp.x * 0.34 * fr;
    let y = FACE_CENTER.y + tmp.y * 0.4 * fr;
    let z = FACE_CENTER.z + tmp.z * 0.27 * fr;
    y = Math.round(y / 0.04) * 0.04 + gauss() * 0.01;
    z += 0.02 * Math.sin(x * 12 + y * 18);
    const heat = Math.max(0, 1 - fr);
    const col = orangeShade(Math.random(), heat * 0.7).lerp(DEEP_ORANGE, 0.35);
    b.push(x, y, z, col, 0.05 + Math.random() * 0.06, 0.9, {
      depth: z / HR.z,
      delay: 0.02 + Math.random() * 0.15,
    });
  }

  /* face hot center */
  for (let i = 0; i < S(2500); i++) {
    const x = FACE_CENTER.x + gauss() * 0.13;
    let y = FACE_CENTER.y + gauss() * 0.17;
    const z = FACE_CENTER.z + gauss() * 0.11;
    y = Math.round(y / 0.04) * 0.04 + gauss() * 0.01;
    const col = new THREE.Color('#FFF3C4').lerp(orangeShade(Math.random(), 0.9), 0.35).multiplyScalar(1.1);
    b.push(x, y, z, col, 0.05 + Math.random() * 0.06, 1, {
      depth: z / HR.z,
      delay: 0.02 + Math.random() * 0.12,
    });
  }

  /* transition halo inside the head */
  for (let i = 0; i < S(2000); i++) {
    randomDir(tmp);
    const rr = 0.5 + Math.random() * 0.3;
    const x = FACE_CENTER.x + tmp.x * rr;
    const y = FACE_CENTER.y + tmp.y * rr * 1.15;
    const z = FACE_CENTER.z + tmp.z * rr * 0.9;
    const t = Math.min(1, Math.max(0, (rr - 0.5) / 0.3));
    const col = orangeShade(Math.random(), 1 - t).lerp(cyanShade(Math.random()), t);
    b.push(x, y, z, col, 0.05 + Math.random() * 0.07, (1 - t) * 0.7, {
      depth: z / HR.z,
      delay: 0.05 + Math.random() * 0.2,
    });
  }

  /* faint neck volume behind the neck rings */
  for (let i = 0; i < S(2500); i++) {
    const y = 0.0 + Math.random() * 0.5;
    const a = Math.random() * Math.PI * 2;
    const rr = 0.17 + (0.5 - y) * 0.15 + gauss() * 0.022;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr * 0.88;
    const col = cyanShade(Math.random()).multiplyScalar(0.7 * lightFactor(Math.cos(a), 0.2, Math.sin(a)));
    b.push(x, y, z, col, 0.045 + Math.random() * 0.05, 0, {
      depth: Math.max(-1, Math.min(1, z / 0.2)),
      delay: 0.15 + Math.random() * 0.2,
    });
  }

  /* faint shoulder volume */
  for (let i = 0; i < S(1500); i++) {
    const s = Math.random() * 2 - 1;
    const x = s * 1.38 + gauss() * 0.075;
    const y = 0.04 - 0.46 * s * s + gauss() * 0.11;
    const z = -0.06 - 0.24 * s * s + gauss() * 0.09;
    const col = cyanShade(Math.random()).multiplyScalar(0.55 + Math.random() * 0.25);
    b.push(x, y, z, col, 0.045 + Math.random() * 0.05, 0, {
      depth: Math.max(-1, Math.min(1, z / 0.5)),
      delay: 0.3 + Math.random() * 0.2,
    });
  }

  /* faint chest shell */
  const CC = { x: 0, y: -0.55, z: 0 };
  const CR = { x: 1.08, y: 0.68, z: 0.5 };
  for (let i = 0; i < S(2500); i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(1 - Math.random() * 1.15);
    const sx = Math.sin(phi) * Math.cos(theta);
    const sy = Math.cos(phi);
    const sz = Math.sin(phi) * Math.sin(theta);
    const x = CC.x + CR.x * sx + gauss() * 0.03;
    const y = CC.y + CR.y * sy + gauss() * 0.03;
    const z = CC.z + CR.z * sz * 0.9 + gauss() * 0.03;
    if (y < -1.22) continue;
    const f = Math.max(0, 1 - distToChest(x, y, z) / 0.42);
    let col = cyanShade(Math.random()).multiplyScalar((0.7 + Math.random() * 0.25) * lightFactor(sx, sy, sz));
    let energy = 0;
    if (f > 0.02) {
      col = col.clone().lerp(orangeShade(Math.random(), f), Math.min(1, f * 1.2));
      energy = Math.min(1, f * 1.1);
    }
    b.push(x, y, z, col, 0.045 + Math.random() * 0.05, energy, {
      depth: Math.max(-1, Math.min(1, z / CR.z)),
      delay: 0.45 + Math.random() * 0.18,
    });
  }

  /* chest energy core */
  for (let i = 0; i < S(1500); i++) {
    const x = CHEST_CENTER.x + gauss() * 0.1;
    const y = CHEST_CENTER.y + gauss() * 0.13;
    const z = CHEST_CENTER.z + gauss() * 0.09;
    const heat = Math.max(0, 1 - distToChest(x, y, z) / 0.34);
    const col = orangeShade(Math.random(), Math.min(1, heat + 0.15));
    b.push(x, y, z, col, 0.05 + Math.random() * 0.08, 1, {
      depth: Math.max(-1, Math.min(1, z / CR.z)),
      delay: 0.45 + Math.random() * 0.15,
    });
  }

  /* strong neon silhouette contour */
  for (let i = 0; i < S(4200); i++) {
    if (i % 2 === 0) {
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * 0.81 + gauss() * 0.006;
      const y = 1.02 + Math.sin(a) * 0.98 + gauss() * 0.004;
      const z = gauss() * 0.2;
      const col = new THREE.Color('#BFF6FF').lerp(cyanShade(Math.random()), 0.45).multiplyScalar(1.7);
      b.push(x, y, z, col, 0.13 + Math.random() * 0.12, 0.1, {
        depth: Math.max(-1, Math.min(1, z / HR.z)),
        delay: 0.02 + Math.random() * 0.2,
        drift: new THREE.Vector3(-Math.sin(a) * 0.81, Math.cos(a) * 0.98, 0).normalize().multiplyScalar(0.5 + Math.random() * 0.5),
      });
    } else {
      const s = Math.random() * 2 - 1;
      const x = s * 1.4 + gauss() * 0.008;
      const y = 0.06 - 0.48 * s * s + gauss() * 0.006;
      const z = 0.02 + gauss() * 0.06;
      const col = new THREE.Color('#BFF6FF').lerp(cyanShade(Math.random()), 0.5).multiplyScalar(1.55);
      b.push(x, y, z, col, 0.11 + Math.random() * 0.11, 0, {
        depth: Math.max(-1, Math.min(1, z / 0.5)),
        delay: 0.3 + Math.random() * 0.2,
      });
    }
  }

  /* ear glow points */
  for (const s of [-1, 1]) {
    for (let i = 0; i < S(350); i++) {
      const x = s * 0.8 + gauss() * 0.05;
      const y = 1.02 + gauss() * 0.06;
      const z = 0.08 + gauss() * 0.05;
      const col = new THREE.Color('#FFFFFF').lerp(cyanShade(Math.random()), 0.35).multiplyScalar(1.5);
      b.push(x, y, z, col, 0.07 + Math.random() * 0.07, 0.5, {
        depth: Math.max(-1, Math.min(1, z / HR.z)),
        delay: 0.05 + Math.random() * 0.2,
      });
    }
  }

  /* crown dissolution */
  for (let i = 0; i < S(2500); i++) {
    const y = 1.98 + Math.pow(Math.random(), 1.4) * 0.95;
    const spread = 0.22 + (y - 1.98) * 0.6;
    const x = gauss() * spread;
    const z = gauss() * spread * 0.8;
    const fade = Math.max(0.2, 1 - ((y - 1.98) / 0.95) * 0.8);
    const col = cyanShade(Math.random()).multiplyScalar(fade * 0.95);
    b.push(x, y, z, col, 0.04 + Math.random() * 0.05, 0, {
      drift: new THREE.Vector3(x * 0.3, 0.8 + Math.random() * 0.5, z * 0.3),
      detach: 1,
      depth: Math.max(-1, Math.min(1, z)),
      delay: 0.1 + Math.random() * 0.25,
    });
  }

  /* side flowing waves */
  for (const s of [-1, 1]) {
    for (let i = 0; i < S(5500); i++) {
      const ax = 1.05 + Math.pow(Math.random(), 2.0) * 1.55;
      const x = s * ax;
      const z = gauss() * 0.7;
      const h = ridgeH(x, z);
      const surface = Math.random() < 0.7;
      const y = surface ? WAVE_Y + h + gauss() * 0.06 : WAVE_Y + h - Math.pow(Math.random(), 1.5) * 0.9;
      const fade = 1 - ((ax - 1.05) / 1.55) * 0.55;
      let col = cyanShade(Math.random()).multiplyScalar(fade * (surface ? 1 : 0.55));
      let energy = 0;
      if (h > 0.5 && Math.random() < 0.55) {
        col = col.clone().lerp(orangeShade(Math.random(), 0.7), 0.75);
        energy = 0.8;
      }
      b.push(x, y, z, col, 0.06 + Math.random() * 0.075, energy, {
        depth: Math.max(-1, Math.min(1, z / 1.5)),
        delay: 0.5 + Math.random() * 0.2,
        scatterScale: 0.5,
        wave: 1,
      });
    }
  }

  /* outer halo */
  const anchors = [
    new THREE.Vector3(0, 1.0, 0),
    new THREE.Vector3(-0.7, -0.1, 0),
    new THREE.Vector3(0.7, -0.1, 0),
    new THREE.Vector3(0, -0.55, 0),
  ];
  for (let i = 0; i < S(2000); i++) {
    const anchor = anchors[Math.floor(Math.random() * anchors.length)];
    randomDir(tmp);
    const dist = 0.25 + Math.pow(Math.random(), 2.0) * 2.4;
    const x = anchor.x + tmp.x * dist;
    const y = anchor.y + tmp.y * dist * 0.9;
    const z = anchor.z + tmp.z * dist;
    const fade = Math.max(0.15, 1 - dist / 2.9);
    const col = new THREE.Color('#164E63').lerp(cyanShade(Math.random()), 0.4).multiplyScalar(fade);
    const rise = Math.random() < 0.3 ? 1 : 0;
    const drift = rise
      ? new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3)
      : undefined;
    b.push(x, y, z, col, 0.04 + Math.random() * 0.06, 0, {
      drift,
      detach: rise,
      depth: Math.max(-1, Math.min(1, z / 2)),
      delay: 0.55 + Math.random() * 0.2,
      scatterScale: 0.7,
    });
  }

  /* dim ambient dust */
  for (let i = 0; i < S(1200); i++) {
    const x = (Math.random() * 2 - 1) * 2.6;
    const y = -1.6 + Math.random() * 4.2;
    const z = -1.8 + Math.random() * 2.6;
    const col = new THREE.Color('#164E63').lerp(cyanShade(Math.random()), 0.3).multiplyScalar(0.7);
    const rise = Math.random() < 0.35 ? 1 : 0;
    const drift = rise
      ? new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3)
      : undefined;
    b.push(x, y, z, col, 0.04 + Math.random() * 0.05, 0, {
      drift,
      detach: rise,
      depth: Math.max(-1, Math.min(1, z / 2)),
      delay: 0.55 + Math.random() * 0.2,
      scatterScale: 0.7,
    });
  }

  return b.build();
}

/* ------------------------------------------------------------------ */
/* shaders                                                             */
/* ------------------------------------------------------------------ */

const LINE_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aPhase;
attribute float aEnergy;
attribute vec3 aScatter;
attribute float aDelay;
attribute float aDepth;

uniform float uTime;
uniform float uAudioLevel;
uniform float uBreath;
uniform float uBoost;
uniform float uPulseSpeed;
uniform float uAssemble;
uniform vec3 uFaceCenter;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 p = position;
  float t = uTime * uPulseSpeed;

  // flowing ripple: energy traveling through the lines
  p.y += sin(t * 2.2 + aPhase * 3.0) * 0.008;
  p.x += sin(t * 1.4 + aPhase * 2.0) * 0.006;

  // energy pulse traveling along the line
  float pulse = pow(0.5 + 0.5 * sin(t * 2.6 - aPhase * 4.0), 3.0);

  // speaking swell
  float speak = uAudioLevel * aEnergy;
  vec3 fromCore = p - uFaceCenter;
  p += (fromCore / max(length(fromCore), 0.0001)) * speak * 0.04;

  // intro assembly: gather from scatter into the line structure
  float ae = clamp((uAssemble - aDelay) / max(1.0 - aDelay, 0.001), 0.0, 1.0);
  ae = ae * ae * (3.0 - 2.0 * ae);
  p = mix(position + aScatter, p, ae);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;

  float breath = 1.0 + uBreath * 0.25 * aEnergy;
  float frontness = clamp(aDepth * 0.5 + 0.5, 0.0, 1.0);
  float depthB = 0.55 + 0.45 * frontness;
  depthB = mix(depthB, 1.0, aEnergy * 0.6);

  vec3 col = aColor * breath * depthB;
  col += aColor * (pulse * 0.55 + speak * 1.2);
  col *= uBoost;

  float farFade = clamp(1.0 - (dist - 4.2) * 0.22, 0.25, 1.0);
  vColor = col;
  vAlpha = farFade * (0.2 + 0.8 * ae);
  gl_Position = projectionMatrix * mv;
}
`;

const LINE_FRAG = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor, vAlpha);
}
`;

const VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
attribute float aEnergy;
attribute vec3 aDrift;
attribute float aDetach;
attribute vec3 aScatter;
attribute float aDelay;
attribute float aDepth;
attribute float aWave;

uniform float uTime;
uniform float uPixelRatio;
uniform float uAudioLevel;
uniform float uBreath;
uniform float uBoost;
uniform float uPulseSpeed;
uniform float uAssemble;
uniform vec3 uFaceCenter;

varying vec3 vColor;
varying float vAlpha;
varying float vEdge;

void main() {
  vec3 p = position;
  float t = uTime * uPulseSpeed;
  float rnd = fract(aPhase * 0.159);

  // slow circulation around the vertical axis
  float sw = sin(t * 0.35 + p.y * 1.8) * 0.035;
  float cx = cos(sw);
  float sx = sin(sw);
  p.xz = mat2(cx, -sx, sx, cx) * p.xz;

  // gentle living drift
  vec3 sway = aDrift * sin(t * (0.35 + rnd * 0.55) + aPhase) * 0.03;
  p += sway;

  // microscopic vibration
  p += vec3(
    sin(t * 6.3 + aPhase * 7.0),
    sin(t * 5.1 + aPhase * 5.0),
    sin(t * 6.9 + aPhase * 9.0)
  ) * 0.0025;

  // side-wave flow
  float waveGlow = 0.0;
  if (aWave > 0.5) {
    float ax = abs(position.x);
    waveGlow = 0.5 + 0.5 * sin(t * 2.0 - ax * 2.4 + position.y * 1.2);
    p.y += sin(t * 1.6 + aPhase) * 0.03;
    p.x += sign(position.x) * sin(t * 1.1 + aPhase) * 0.05;
  }

  // detach lifecycle
  float life = fract(uTime * 0.07 + rnd);
  float detachEnv = 1.0;
  if (aDetach > 0.5) {
    p += aDrift * life * 1.1;
    detachEnv = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.45, 1.0, life));
  }

  // speaking reaction
  float speak = uAudioLevel * aEnergy;
  vec3 fromCore = p - uFaceCenter;
  float coreDist = length(fromCore);
  vec3 dirOut = fromCore / max(coreDist, 0.0001);
  p += dirOut * speak * 0.05;

  // intro assembly
  float ae = clamp((uAssemble - aDelay) / max(1.0 - aDelay, 0.001), 0.0, 1.0);
  ae = ae * ae * (3.0 - 2.0 * ae);
  vec3 scattered = position + aScatter;
  p = mix(scattered, p, ae);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;

  float tw = 0.82 + 0.18 * sin(t * (1.4 + rnd * 2.2) + aPhase * 3.1);
  tw += waveGlow * 0.4 * aWave;
  float breath = 1.0 + uBreath * 0.3 * aEnergy;
  float depthSize = 1.0 + aDepth * 0.30;
  float size = aSize * tw * breath * (1.0 + speak * 1.1) * uBoost * depthSize;
  float ps = size * uPixelRatio * (150.0 / dist);
  gl_PointSize = clamp(ps, 1.0, 12.0 * uPixelRatio);

  float farFade = clamp(1.0 - (dist - 4.2) * 0.22, 0.2, 1.0);
  float nearFade = smoothstep(1.6, 2.6, dist);
  float a = (0.55 + 0.45 * tw) * farFade * mix(1.0, nearFade, 0.7);
  a *= mix(1.0, detachEnv, aDetach);
  a *= 0.75 + 0.45 * aEnergy;
  a *= 0.15 + 0.85 * ae;
  vAlpha = clamp(a, 0.0, 1.0);

  float frontness = clamp(aDepth * 0.5 + 0.5, 0.0, 1.0);
  float depthB = 0.62 + 0.38 * frontness;
  depthB = mix(depthB, 1.0, aEnergy * 0.65);
  vec3 col = aColor * (0.65 + 0.35 * breath) * depthB;
  col += aColor * speak * 1.4;
  col += aColor * waveGlow * aWave * 0.4;
  col *= uBoost;
  vColor = col;
  vEdge = mix(0.05, 0.20, frontness);

  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
varying float vEdge;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  float disc = smoothstep(0.5, vEdge, d);
  float hot = smoothstep(0.16, 0.0, d);
  vec3 col = vColor + vec3(1.0, 0.97, 0.92) * hot * 0.28;
  float a = disc * vAlpha;
  if (a < 0.012) discard;
  gl_FragColor = vec4(col, a);
}
`;

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

function makeSharedUniforms(pixelRatio: number) {
  return {
    uTime: { value: 0 },
    uPixelRatio: { value: pixelRatio },
    uAudioLevel: { value: 0 },
    uBreath: { value: 0.5 },
    uBoost: { value: 1 },
    uPulseSpeed: { value: 1 },
    uAssemble: { value: 0 },
    uFaceCenter: { value: FACE_CENTER },
  };
}

export const AiForzaParticleCanvas: React.FC<AiForzaParticleCanvasProps> = ({
  statusRef,
  audioLevelRef,
  className = '',
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setClearColor(new THREE.Color('#04060a'), 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#04060a');

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
    let camBaseZ = 4.35;
    const camBaseY = 0.3;
    camera.position.set(0, camBaseY, camBaseZ);

    const group = new THREE.Group();
    scene.add(group);

    const isMobile =
      typeof window !== 'undefined' &&
      (window.innerWidth < 768 || Math.min(window.innerWidth, window.innerHeight) < 700);
    const fScale = isMobile ? 0.4 : 1;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    /* PRIMARY: energy line structure */
    const lineGeometry = buildLineField(fScale);
    const lineMaterial = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms: makeSharedUniforms(pixelRatio),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    lines.frustumCulled = false;
    group.add(lines);

    /* SECONDARY: particle accents */
    const pointGeometry = buildPointField(fScale);
    const pointMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: makeSharedUniforms(pixelRatio),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(pointGeometry, pointMaterial);
    points.frustumCulled = false;
    group.add(points);

    /* faint volumetric atmosphere (procedural glow, no image assets) */
    const texOrange = makeGlowTexture('rgba(255,170,60,0.9)', 'rgba(224,101,24,0.35)');
    const texGold = makeGlowTexture('rgba(255,200,90,0.85)', 'rgba(255,140,0,0.3)');
    const texCyan = makeGlowTexture('rgba(80,220,255,0.5)', 'rgba(20,120,200,0.18)');

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texCyan, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.12 }),
    );
    halo.position.set(0, 0.3, -0.7);
    halo.scale.set(6.4, 5.2, 1);
    scene.add(halo);

    const faceGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texOrange, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.13 }),
    );
    faceGlow.position.copy(FACE_CENTER);
    faceGlow.scale.set(1.2, 1.34, 1);
    group.add(faceGlow);

    const chestGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texGold, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.12 }),
    );
    chestGlow.position.copy(CHEST_CENTER);
    chestGlow.scale.set(0.9, 0.9, 1);
    group.add(chestGlow);

    /* pointer parallax (fine pointers only) */
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
    const onPointerMove = (e: PointerEvent) => {
      pointer.tx = Math.max(-0.5, Math.min(0.5, e.clientX / window.innerWidth - 0.5));
      pointer.ty = Math.max(-0.5, Math.min(0.5, e.clientY / window.innerHeight - 0.5));
    };
    if (finePointer) window.addEventListener('pointermove', onPointerMove);

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      const aspect = w / h;
      camera.aspect = aspect;
      camBaseZ = aspect >= 1.2 ? 4.35 : aspect >= 0.9 ? 5.0 : 6.1;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      pointMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    };
    resize();
    window.addEventListener('resize', resize);

    const clock = new THREE.Clock();
    let raf = 0;
    let curBoost = 1;
    let curPulse = 1;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const st = statusRef.current;

      const targetBoost = st === 'thinking' ? 1.22 : st === 'listening' ? 1.12 : st === 'speaking' ? 1.06 : 1.0;
      const targetPulse = st === 'thinking' ? 1.6 : st === 'listening' ? 1.15 : 1.0;
      curBoost += (targetBoost - curBoost) * Math.min(1, dt * 3);
      curPulse += (targetPulse - curPulse) * Math.min(1, dt * 3);

      // intro: lines form head → neck → shoulders → chest
      const asmRaw = Math.min(1, Math.max(0, (t - 0.25) / 3.4));
      const asm = asmRaw * asmRaw * (3 - 2 * asmRaw);

      const breath = 0.5 + 0.5 * Math.sin(t * 1.35);
      const audio = Math.max(0, Math.min(1, audioLevelRef.current));

      for (const m of [lineMaterial, pointMaterial]) {
        m.uniforms.uTime.value = t;
        m.uniforms.uAudioLevel.value = audio;
        m.uniforms.uBreath.value = breath;
        m.uniforms.uBoost.value = curBoost;
        m.uniforms.uPulseSpeed.value = curPulse;
        m.uniforms.uAssemble.value = asm;
      }

      const glowRamp = 0.25 + 0.75 * asm;
      (faceGlow.material as THREE.SpriteMaterial).opacity = (0.13 + breath * 0.07 + audio * 0.28) * glowRamp;
      const fs = 1.2 + breath * 0.07 + audio * 0.22;
      faceGlow.scale.set(fs, fs * 1.12, 1);
      (chestGlow.material as THREE.SpriteMaterial).opacity = (0.12 + breath * 0.07 + audio * 0.2) * glowRamp;
      const cs = 0.9 + breath * 0.05 + audio * 0.16;
      chestGlow.scale.set(cs, cs, 1);
      (halo.material as THREE.SpriteMaterial).opacity = 0.12 + (st === 'listening' ? 0.04 : 0) + audio * 0.05;

      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 2.5);
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 2.5);

      group.rotation.y = Math.sin(t * 0.18) * 0.06 + pointer.x * 0.1;
      group.rotation.x = Math.sin(t * 0.15) * 0.02 - pointer.y * 0.06;
      camera.position.x = Math.sin(t * 0.16) * 0.06 + pointer.x * 0.18;
      camera.position.y = camBaseY + Math.sin(t * 0.13) * 0.05 + pointer.y * 0.12;
      camera.position.z = camBaseZ;
      camera.lookAt(0, 0.22, 0);

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      if (finePointer) window.removeEventListener('pointermove', onPointerMove);
      lineGeometry.dispose();
      lineMaterial.dispose();
      pointGeometry.dispose();
      pointMaterial.dispose();
      texOrange.dispose();
      texGold.dispose();
      texCyan.dispose();
      halo.material.dispose();
      faceGlow.material.dispose();
      chestGlow.material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <div
        className={`relative w-full h-full bg-[#04060a] flex items-center justify-center overflow-hidden ${className}`}
      >
        <div className="absolute w-[420px] h-[420px] rounded-full bg-cyan-500/20 blur-[120px]" />
        <div className="absolute w-[220px] h-[220px] rounded-full bg-orange-500/25 blur-[90px]" />
        <p className="relative text-white/60 text-sm">مرورگر شما از WebGL پشتیبانی نمی‌کند</p>
      </div>
    );
  }

  return <div ref={hostRef} className={`relative w-full h-full ${className}`} />;
};
