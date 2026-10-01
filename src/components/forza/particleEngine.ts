// High-Performance Geometry & Particle Engine
// Design plane: 1200 × 760
// Ultra-optimized for zero lag & lively speech articulation.

export const W = 1200, H = 760;
const TAU = Math.PI * 2;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (v: number) => {
  v = clamp(v);
  return v * v * (3 - 2 * v);
};

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cubic(p: number[], t: number): [number, number] {
  const q = 1 - t;
  return [
    q * q * q * p[0] + 3 * q * q * t * p[2] + 3 * q * t * t * p[4] + t * t * t * p[6],
    q * q * q * p[1] + 3 * q * q * t * p[3] + 3 * q * t * t * p[5] + t * t * t * p[7],
  ];
}

// Brand palette
export const BRAND = {
  primary: '#e06518',
  secondary: '#55565a',
  white: '#ffffff',
  background: '#101012',
};

export const PALETTE = [
  '#55565a', // 0  secondary: inner contours
  '#8b8c90', // 1  secondary tint: head latitudes / accents
  '#d4d4d6', // 2  near white: silhouette edge
  '#ffffff', // 3  white: brightest edge strands
  '#ffffff', // 4  spare
  '#9c4610', // 5  primary shade: clavicle accents
  '#e06518', // 6  primary: neck filaments
  '#f39a5c', // 7  primary tint: bright filament
  '#a84b12', // 8  face heat 1
  '#e06518', // 9  face heat 2 (primary)
  '#f2915a', // 10 face heat 3
  '#ffe2cc', // 11 face heat core (white-hot)
  '#e06518', // 12 logo particles (primary)
];

export const LOGO_COLOR = BRAND.primary;

const outline = [
  [600, 104, 682, 101, 728, 152, 717, 235],
  [717, 235, 731, 244, 727, 280, 715, 292],
  [715, 292, 706, 343, 659, 420, 600, 437],
];

const shoulder = [
  [677, 373, 669, 433, 673, 477, 706, 496],
  [706, 496, 750, 526, 823, 529, 865, 574],
  [865, 574, 889, 597, 905, 623, 915, 661],
];

export const LOGO_BOX = (() => {
  const w = 156, h = (w * 424) / 640, cx = 600, cy = 604;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
})();

const PAD = 12;

const inLogoZone = (x: number, y: number) => {
  const rx = LOGO_BOX.w / 2 + PAD + 6, ry = LOGO_BOX.h / 2 + PAD + 4;
  const dx = (x - (LOGO_BOX.x + LOGO_BOX.w / 2)) / rx;
  const dy = (y - (LOGO_BOX.y + LOGO_BOX.h / 2)) / ry;
  return dx * dx + dy * dy < 1;
};

export interface ParticlePoint {
  x: number;
  y: number;
  color: number;
  alpha: number;
  size: number;
  kind: number;
  seed: number;
  phase: number;
  sx: number;
  sy: number;
}

export interface DustPoint {
  x: number;
  y: number;
  phase: number;
  rate: number;
  size: number;
  alpha: number;
}

export interface LogoMask {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export interface ParticleScene {
  points: ParticlePoint[];
  dust: DustPoint[];
  live: ParticlePoint[][];
  still: ParticlePoint[][];
  baked: HTMLCanvasElement | null;
}

/** logoMask: optional { data: Uint8ClampedArray (RGBA), w, h } sampled from the logo. */
export function createScene(logoMask?: LogoMask | null): ParticleScene {
  const random = rng(18742);
  const points: ParticlePoint[] = [];
  const dust: DustPoint[] = [];

  function add(x: number, y: number, color = 2, alpha = 0.6, size = 1, kind = 0) {
    points.push({
      x,
      y,
      color,
      alpha,
      size,
      kind,
      seed: random(),
      phase: random() * TAU,
      sx: 600 + (random() - 0.5) * 990,
      sy: 610 + (random() - 0.5) * 270,
    });
  }

  // Edge particles: optimized count for high FPS
  for (const side of [-1, 1]) {
    for (const segment of [...outline, ...shoulder]) {
      for (let k = 0; k < 130; k++) {
        const [px, py] = cubic(segment, random());
        const jitter = random() + random() + random() - 1.5;
        const x = 600 + side * (px - 600) + jitter * 3.5;
        const y = py + (random() - 0.5) * 3;
        add(x, y, random() > 0.75 ? 3 : 2, 0.7, 1.5 + random() * 0.9, 1);
        if (k % 5 === 0) {
          dust.push({
            x: x + side * random() * 29,
            y: y + (random() - 0.5) * 42,
            phase: random() * TAU,
            rate: 0.2 + random() * 0.8,
            size: 0.8,
            alpha: random() * 0.4,
          });
        }
      }
    }
  }

  // Horizontal latitude contours: smooth head & mouth heat contours
  for (let row = 0; row < 42; row++) {
    const y = 111 + row * 7.5;
    let half: number;
    if (y < 206) half = 117 * Math.sqrt(Math.max(0, 1 - ((y - 206) / 103) ** 2));
    else if (y < 270) half = 117 + (y - 206) * 0.018;
    else half = 120 * Math.pow(Math.max(0.015, 1 - ((y - 269) / 174) ** 1.4), 0.64);

    for (let x = -half; x <= half; x += 3.6) {
      const u = x / Math.max(half, 1);
      const curve = (-15 + 45 * smooth((y - 210) / 220)) * (1 - u * u);
      const yy = y + curve;
      const heat = Math.exp(-(((x / 58) ** 2 + ((yy - 325) / 52) ** 2) * 1.3));
      const color = heat > 0.72 ? 11 : heat > 0.4 ? 10 : heat > 0.18 ? 9 : heat > 0.07 ? 8 : 1;
      add(600 + x, yy, color, heat > 0.07 ? 0.88 : 0.45, 1.2 + heat * 1.4, 2);
    }
  }

  for (const side of [-1, 1]) {
    // Shoulder contours
    for (let i = 0; i < 9; i++) {
      const inset = i * 12.2;
      const joinX = 730 - inset * 0.55, joinY = 525 + i * 7.2;
      const segments = [
        [674 - inset * 0.18, 394 + i * 4, 646 - inset * 0.3, 472 + i * 2.5, joinX - 46, joinY - 13, joinX, joinY],
        [joinX, joinY, joinX + 46, joinY + 13, 876 - inset * 0.7, 593 + i * 3.7, 903 - inset * 0.72, 670],
      ];
      for (const p of segments) {
        for (let j = 0; j < 60; j++) {
          const [x, y] = cubic(p, j / 59);
          if (inLogoZone(600 + side * (x - 600), y)) continue;
          add(600 + side * (x - 600), y, i % 4 === 0 ? 1 : 0, 0.55 * clamp((690 - y) / 48), 1.1, 3);
        }
      }
    }

    // Pectoral arches
    for (let i = 0; i < 5; i++) {
      const p = [891 - i * 12, 669, 864 - i * 8, 549 + i * 8, 679 + i * 3.5, 542 + i * 11, 623 + i * 5, 674];
      for (let j = 0; j < 80; j++) {
        const [x, y] = cubic(p, j / 79);
        if (inLogoZone(600 + side * (x - 600), y)) continue;
        add(600 + side * (x - 600), y, i % 3 === 0 ? 1 : 0, 0.35, 1, 3);
      }
    }

    // Inner clavicle arcs
    for (let i = 0; i < 6; i++) {
      const p = [641 + i * 7.5, 443 + i * 4.5, 619 + i * 6.5, 521, 610 + i * 10.5, 550, 609 + i * 13, 674];
      for (let j = 0; j < 50; j++) {
        const [x, y] = cubic(p, j / 49);
        if (inLogoZone(600 + side * (x - 600), y)) continue;
        add(600 + side * (x - 600), y, i < 3 ? 5 : 0, 0.32, 0.9, 3);
      }
    }

    // Orange neck filaments
    const endY = LOGO_BOX.y - PAD - 2;
    for (let strand = 0; strand < 4; strand++) {
      for (let j = 0; j < 70; j++) {
        const t = j / 69, y = 424 + t * (endY - 424);
        const x = 600 + side * (7 + strand * 5 + (42 - strand * 4) * (1 - t) ** 2
          + Math.sin(t * 14 + strand * 0.6) * Math.sin(t * Math.PI) * 4.2);
        add(x, y, strand === 1 ? 7 : 6, 0.75 * (1 - t * 0.4), 1.2, 4);
      }
    }
  }

  // Logo particles
  if (logoMask) {
    const { data, w, h } = logoMask;
    const step = 1.9;
    for (let y = 0; y < LOGO_BOX.h; y += step) {
      for (let x = 0; x < LOGO_BOX.w; x += step) {
        const mx = Math.min(w - 1, (x / LOGO_BOX.w * w) | 0);
        const my = Math.min(h - 1, (y / LOGO_BOX.h * h) | 0);
        const idx = (my * w + mx) * 4;
        const alpha = data[idx + 3];
        const brightness = Math.max(data[idx], data[idx + 1], data[idx + 2]);
        if (alpha > 120 && brightness > 60) {
          add(LOGO_BOX.x + x + (random() - 0.5) * 0.6, LOGO_BOX.y + y + (random() - 0.5) * 0.6, 12, 0.9, 1.4, 5);
        }
      }
    }
  }

  // Ambient dust
  for (let i = 0; i < 70; i++) {
    dust.push({
      x: 600 + (random() - 0.5) * 760,
      y: 85 + random() * 610,
      phase: random() * TAU,
      rate: 0.12 + random() * 0.5,
      size: 0.7,
      alpha: 0.08 + random() * 0.08,
    });
  }

  const live: ParticlePoint[][] = PALETTE.map(() => []);
  const still: ParticlePoint[][] = PALETTE.map(() => []);
  for (const p of points) {
    (p.kind === 2 ? live : still)[p.color].push(p);
  }
  return { points, dust, live, still, baked: null };
}

export const SETTLE_TIME = 0.28 + 0.75 + 0.46 + 2.85 + 0.05;

// Batch drawing by color with animated mouth talking articulation
function drawBucket(
  ctx: CanvasRenderingContext2D,
  buckets: ParticlePoint[][],
  time: number,
  arrival: number,
  breathY: number,
  speech: number,
  isLive: boolean,
) {
  for (let color = 0; color < PALETTE.length; color++) {
    const list = buckets[color];
    if (!list.length) continue;
    ctx.fillStyle = PALETTE[color];

    const warmth = color >= 8 && color <= 11 ? 0.8 + speech * 0.45 : 1;
    const baseAlpha = isLive ? clamp(0.75 * warmth * (0.3 + 0.7 * arrival)) : clamp(0.8 * (0.3 + 0.7 * arrival));
    ctx.globalAlpha = baseAlpha;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const delay = (p.y / 760) * 0.75 + p.seed * 0.46;
      const a = smooth((time - 0.28 - delay) / 2.85);
      if (a <= 0) continue;
      const disperse = 1 - a;
      let x = p.x, y = p.y;
      if (disperse > 0) {
        x += (p.sx - p.x) * disperse + Math.sin(p.phase + time * 2.1) * disperse * 96;
        y += (p.sy - p.y) * disperse + Math.cos(p.phase + time * 1.6) * disperse * 64;
      }
      if (isLive) {
        const dx = p.x - 600, dy = p.y - 325;
        const mouthFocus = Math.exp(-(((dx / 56) ** 2 + (dy / 46) ** 2)));

        if (mouthFocus > 0.01) {
          // Dynamic talking motion: opens and closes mouth vertically in rhythm with speech
          const speechPulse = Math.sin(time * 12.5) * 0.5 + Math.sin(time * 7.8) * 0.35 + Math.sin(time * 18.2) * 0.15;
          const mouthOpen = Math.max(0, speech * (0.45 + 0.55 * speechPulse));

          if (dy >= 0) {
            // Lower jaw moves down
            y += mouthFocus * mouthOpen * 11.5;
          } else {
            // Upper lip moves up slightly
            y -= mouthFocus * mouthOpen * 4.5;
          }

          // Phonetic wave flutter across mouth
          y += mouthFocus * Math.sin(dx * 0.09 + time * 8.5) * (2.0 + speech * 3.5);
          x += dx * mouthFocus * speech * 0.04;
        } else {
          // General face ambient movement
          const faceFocus = Math.exp(-(((dx / 85) ** 2 + (dy / 80) ** 2)));
          if (faceFocus > 0.01) {
            y += faceFocus * (Math.sin(dx * 0.06 + time * 4.2) * 3.0 + Math.sin(dx * 0.1 - time * 5.0) * 1.5) * (0.5 + speech * 0.5);
          }
        }
      }
      y += breathY;
      ctx.fillRect(x, y, p.size, p.size);
    }
  }
}

/** Returns the breath offset so the caller can move the crisp logo with the body. */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  scene: ParticleScene,
  time: number,
  speechModulation?: number,
): { breathY: number; logoAlpha: number } {
  ctx.clearRect(0, 0, W, H);
  const arrival = smooth((time - 0.35) / 4.0);
  const settled = smooth((time - 2.4) / 2.2);
  const breathY = Math.sin(time * 1.65) * 0.75 * settled;

  let speech = (0.45 + 0.25 * Math.sin(time * 2.7) + 0.21 * Math.sin(time * 5.4)) * (0.7 + 0.3 * Math.sin(time * 0.53) ** 2);
  if (typeof speechModulation === 'number' && speechModulation > 0) {
    speech = Math.max(speech, speechModulation);
  }

  // Warm glowing emission behind mouth & face that pulsates with speech
  if (settled > 0) {
    const mouthPulse = 1 + speech * 0.35;
    ctx.globalAlpha = settled * (0.35 + speech * 0.35);
    const heat = ctx.createRadialGradient(600, 325, 0, 600, 325, 80 * mouthPulse);
    heat.addColorStop(0, '#e06518cc');
    heat.addColorStop(0.4, '#e0651845');
    heat.addColorStop(1, '#e0651800');
    ctx.fillStyle = heat;
    ctx.fillRect(490, 220, 220, 210);
  }

  // Soft orange halo behind the logo
  if (settled > 0) {
    ctx.globalAlpha = settled * 0.5;
    const cx = LOGO_BOX.x + LOGO_BOX.w / 2, cy = LOGO_BOX.y + LOGO_BOX.h / 2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, LOGO_BOX.w * 0.62);
    g.addColorStop(0, '#e0651838');
    g.addColorStop(1, '#e0651800');
    ctx.fillStyle = g;
    ctx.fillRect(cx - LOGO_BOX.w * 0.62, cy - LOGO_BOX.w * 0.62, LOGO_BOX.w * 1.24, LOGO_BOX.w * 1.24);
  }

  // Expanding rings: drawn with high-speed dashed paths
  if (settled > 0) {
    ctx.strokeStyle = BRAND.secondary;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 12]);
    for (let ring = 0; ring < 5; ring++) {
      const p = (time * 0.08 + ring / 5) % 1;
      const radius = 138 + p * 145;
      const ringAlpha = Math.sin(p * Math.PI) * 0.4 * settled * (0.7 + speech * 0.3);
      if (ringAlpha > 0.02) {
        ctx.globalAlpha = ringAlpha;
        ctx.beginPath();
        ctx.ellipse(600, 288, radius, radius * 1.06, 0, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  // Dust motes
  ctx.fillStyle = '#8b8c90';
  ctx.globalAlpha = 0.35 * arrival;
  for (const p of scene.dust) {
    ctx.fillRect(p.x + Math.sin(time * 0.42 + p.phase) * 4, p.y - Math.sin(time * p.rate + p.phase) * 8, p.size, p.size);
  }

  // Static body: bake once into offscreen canvas when settled
  if (time >= SETTLE_TIME) {
    if (!scene.baked && typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const bctx = c.getContext('2d');
      if (bctx) {
        drawBucket(bctx, scene.still, SETTLE_TIME + 10, 1, 0, 0, false);
        scene.baked = c;
      }
    }
    ctx.globalAlpha = 1;
    if (scene.baked) ctx.drawImage(scene.baked, 0, breathY);
  } else {
    drawBucket(ctx, scene.still, time, arrival, breathY, speech, false);
  }
  drawBucket(ctx, scene.live, time, arrival, breathY, speech, true);

  // Chest seed during assembly
  const seed = Math.max(0, 1 - smooth((time - 2.3) / 2.5));
  if (seed > 0) {
    const g = ctx.createRadialGradient(600, 652, 0, 600, 652, 48);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.1, '#ffd2b0');
    g.addColorStop(0.25, '#e06518');
    g.addColorStop(0.55, '#e0651844');
    g.addColorStop(1, '#e0651800');
    ctx.globalAlpha = seed;
    ctx.fillStyle = g;
    ctx.fillRect(550, 602, 100, 100);
  }
  ctx.globalAlpha = 1;
  return { breathY, logoAlpha: settled };
}
