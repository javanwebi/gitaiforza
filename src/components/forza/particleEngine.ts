// Ultra-optimized geometry engine for FORZA particle humanoid.
// Design plane: 1200 × 760. Blazing fast 60+ FPS on all devices.

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
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
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

export const BRAND = { primary: '#e06518', secondary: '#55565a', white: '#f5f2ef', background: '#101012' };

const PALETTE = [
  '#55565a', // 0
  '#8b8c90', // 1
  '#d4d4d6', // 2
  '#f5f2ef', // 3
  '#f5f2ef', // 4
  '#9c4610', // 5
  '#e06518', // 6
  '#f39a5c', // 7
  '#a84b12', // 8
  '#e06518', // 9
  '#f2915a', // 10
  '#ffe2cc', // 11
  '#e06518', // 12
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
  const dx = (x - (LOGO_BOX.x + LOGO_BOX.w / 2)) / rx, dy = (y - (LOGO_BOX.y + LOGO_BOX.h / 2)) / ry;
  return dx * dx + dy * dy < 1;
};

export interface LogoMask {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export interface LiveParticle {
  x: number;
  y: number;
  color: number;
  alpha: number;
  size: number;
  dx: number;
  dy: number;
  focus: number;
  phase: number;
  seed: number;
}

export interface DustParticle {
  x: number;
  y: number;
  phase: number;
  rate: number;
  size: number;
  alpha: number;
}

export interface Scene {
  live: LiveParticle[][];
  dust: DustParticle[];
  baked: HTMLCanvasElement;
  assets: SceneAssets;
}

export interface SceneAssets {
  face: HTMLCanvasElement;
  chest: HTMLCanvasElement;
  ring: HTMLCanvasElement;
  ribbon: HTMLCanvasElement;
  spark: HTMLCanvasElement;
}

function surface(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function glow(size: number, stops: [number, string][]): HTMLCanvasElement {
  const c = surface(size, size), ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function createAssets(): SceneAssets {
  const ring = surface(576, 576), r = ring.getContext('2d')!;
  r.fillStyle = '#89878a';
  for (let j = 0; j < 240; j++) {
    const a = j / 240 * TAU;
    r.fillRect(288 + Math.cos(a) * 278, 288 + Math.sin(a) * 278, 1.4, 1.4);
  }
  const ribbon = surface(256, 16), s = ribbon.getContext('2d')!;
  const g = s.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, '#e0651800');
  g.addColorStop(.5, '#f6b789');
  g.addColorStop(1, '#e0651800');
  s.fillStyle = g;
  s.fillRect(0, 7, 256, 1.2);

  return {
    face: glow(176, [[0, '#e06518aa'], [.4, '#e0651840'], [1, '#e0651800']]),
    chest: glow(192, [[0, '#e0651838'], [1, '#e0651800']]),
    spark: glow(32, [[0, '#f5dfcc'], [.1, '#f6b789'], [.3, '#e0651860'], [1, '#e0651800']]),
    ring,
    ribbon,
  };
}

export function createScene(logoMask?: LogoMask | null): Scene {
  const random = rng(18742);
  const stillCanvas = surface(W, H);
  const sCtx = stillCanvas.getContext('2d')!;

  const live: LiveParticle[][] = PALETTE.map(() => []);
  const dust: DustParticle[] = [];

  // 1. Render static body silhouette directly to baked canvas
  for (const side of [-1, 1]) {
    for (const segment of [...outline, ...shoulder]) {
      for (let k = 0; k < 180; k++) {
        const [px, py] = cubic(segment, random());
        const jitter = (random() + random() + random() - 1.5);
        const x = 600 + side * (px - 600) + jitter * 3.2, y = py + (random() - .5) * 3;
        sCtx.fillStyle = random() > .75 ? PALETTE[3] : PALETTE[2];
        sCtx.globalAlpha = .7 + random() * .3;
        sCtx.fillRect(x, y, 1.6 + random() * 1.1, 1.6 + random() * 1.1);

        if (k % 6 === 0) {
          dust.push({
            x: x + side * random() * 26,
            y: y + (random() - .5) * 38,
            phase: random() * TAU,
            rate: .2 + random() * .8,
            size: .7 + random() * .8,
            alpha: random() * .4,
          });
        }
      }
    }
  }

  // 2. Latitude contours (outer head static, center face live)
  for (let row = 0; row < 50; row++) {
    const y = 111 + row * 6.3;
    let half: number;
    if (y < 206) half = 117 * Math.sqrt(Math.max(0, 1 - ((y - 206) / 103) ** 2));
    else if (y < 270) half = 117 + (y - 206) * .018;
    else half = 120 * Math.pow(Math.max(.015, 1 - ((y - 269) / 174) ** 1.4), .64);

    for (let x = -half; x <= half; x += 2.8) {
      const u = x / Math.max(half, 1);
      const curve = (-15 + 45 * smooth((y - 210) / 220)) * (1 - u * u);
      const yy = y + curve;
      const dx = x, dy = yy - 327;
      const focus = Math.exp(-((dx / 74) ** 2 + (dy / 73) ** 2));

      const heat = Math.exp(-((x / 62) ** 2 + ((yy - 321) / 57) ** 2) * 1.28);
      const color = heat > .72 ? 11 : heat > .40 ? 10 : heat > .18 ? 9 : heat > .07 ? 8 : 1;
      const alpha = heat > .07 ? .65 + heat * .35 : .42;
      const size = 1.1 + heat * 1.5;

      if (focus > 0.08) {
        live[color].push({
          x: 600 + x,
          y: yy,
          color,
          alpha,
          size,
          dx,
          dy,
          focus,
          phase: random() * TAU,
          seed: random(),
        });
      } else {
        sCtx.fillStyle = PALETTE[color];
        sCtx.globalAlpha = alpha;
        sCtx.fillRect(600 + x, yy, size, size);
      }
    }
  }

  // 3. Concentric shoulder / neck contours
  for (const side of [-1, 1]) {
    for (let i = 0; i < 10; i++) {
      const inset = i * 9.2;
      const joinX = 730 - inset * .55, joinY = 525 + i * 6.2;
      const segments = [
        [674 - inset * .18, 394 + i * 4, 646 - inset * .30, 472 + i * 2.5, joinX - 46, joinY - 13, joinX, joinY],
        [joinX, joinY, joinX + 46, joinY + 13, 876 - inset * .7, 593 + i * 3.7, 903 - inset * .72, 670],
      ];
      for (const p of segments) {
        for (let j = 0; j < 80; j++) {
          const [x, y] = cubic(p, j / 79);
          const px = 600 + side * (x - 600);
          if (inLogoZone(px, y)) continue;
          sCtx.fillStyle = i % 4 === 0 ? PALETTE[1] : PALETTE[0];
          sCtx.globalAlpha = (.55 - i * .02) * clamp((690 - y) / 48);
          sCtx.fillRect(px, y, 1.1, 1.1);
        }
      }
    }

    // Pectoral arches
    for (let i = 0; i < 6; i++) {
      const p = [891 - i * 9, 669, 864 - i * 6, 549 + i * 6, 679 + i * 2.5, 542 + i * 9, 623 + i * 4, 674];
      for (let j = 0; j < 90; j++) {
        const [x, y] = cubic(p, j / 89);
        const px = 600 + side * (x - 600);
        if (inLogoZone(px, y)) continue;
        sCtx.fillStyle = i % 3 === 0 ? PALETTE[1] : PALETTE[0];
        sCtx.globalAlpha = .3;
        sCtx.fillRect(px, y, 1, 1);
      }
    }

    // Clavicle arcs
    for (let i = 0; i < 6; i++) {
      const p = [641 + i * 5.5, 443 + i * 3.5, 619 + i * 5, 521, 610 + i * 8.5, 550, 609 + i * 11, 674];
      for (let j = 0; j < 60; j++) {
        const [x, y] = cubic(p, j / 59);
        const px = 600 + side * (x - 600);
        if (inLogoZone(px, y)) continue;
        sCtx.fillStyle = i < 3 ? PALETTE[5] : PALETTE[0];
        sCtx.globalAlpha = .28;
        sCtx.fillRect(px, y, 0.9, 0.9);
      }
    }

    // Orange neck filaments
    const endY = LOGO_BOX.y - PAD - 2;
    for (let strand = 0; strand < 4; strand++) {
      for (let j = 0; j < 90; j++) {
        const t = j / 89, y = 424 + t * (endY - 424);
        const x = 600 + side * (7 + strand * 4 + (42 - strand * 3) * (1 - t) ** 2
          + Math.sin(t * 14 + strand * .6) * Math.sin(t * Math.PI) * 4.2);
        sCtx.fillStyle = strand === 1 ? PALETTE[7] : PALETTE[6];
        sCtx.globalAlpha = (.7 + Math.sin(t * Math.PI) * .28) * (1 - t * .45);
        sCtx.fillRect(x, y, 1.2, 1.2);
      }
    }
  }

  // 4. Logo particles sampling
  if (logoMask) {
    const { data, w, h } = logoMask;
    const step = 2.0;
    sCtx.fillStyle = PALETTE[12];
    sCtx.globalAlpha = .9;
    for (let y = 0; y < LOGO_BOX.h; y += step) {
      for (let x = 0; x < LOGO_BOX.w; x += step) {
        const mx = Math.min(w - 1, (x / LOGO_BOX.w * w) | 0);
        const my = Math.min(h - 1, (y / LOGO_BOX.h * h) | 0);
        if (data[(my * w + mx) * 4 + 3] > 140) {
          sCtx.fillRect(LOGO_BOX.x + x + (random() - .5) * .5, LOGO_BOX.y + y + (random() - .5) * .5, 1.35, 1.35);
        }
      }
    }
  }

  // 5. Longitude mesh
  for (let meridian = -4; meridian <= 4; meridian++) {
    for (let j = 0; j < 70; j++) {
      const y = 119 + j * 4.3;
      const half = y < 206 ? 117 * Math.sqrt(Math.max(0, 1 - ((y - 206) / 103) ** 2))
        : y < 270 ? 117 + (y - 206) * .018
        : 120 * Math.pow(Math.max(.015, 1 - ((y - 269) / 174) ** 1.4), .64);
      const u = meridian / 5;
      const x = 600 + half * Math.sin(u * Math.PI / 2);
      sCtx.fillStyle = meridian === 0 ? PALETTE[5] : PALETTE[1];
      sCtx.globalAlpha = .14 + Math.abs(u) * .08;
      sCtx.fillRect(x, y + (-15 + 45 * smooth((y - 210) / 220)) * (1 - u * u), .8, .8);
    }
  }

  // Ambient dust
  for (let i = 0; i < 90; i++) {
    dust.push({
      x: 600 + (random() - .5) * 700,
      y: 85 + random() * 580,
      phase: random() * TAU,
      rate: .12 + random() * .5,
      size: .6,
      alpha: .05 + random() * .09,
    });
  }

  sCtx.globalAlpha = 1;

  return {
    live,
    dust,
    baked: stillCanvas,
    assets: createAssets(),
  };
}

export function paintScene(ctx: CanvasRenderingContext2D, scene: Scene, time: number, quality = 2) {
  ctx.clearRect(0, 0, W, H);
  const assets = scene.assets;
  const breathY = Math.sin(time * 1.65) * 0.75;
  const speech = (0.45 + 0.25 * Math.sin(time * 2.7) + 0.21 * Math.sin(time * 5.4)) * (0.70 + 0.30 * Math.sin(time * 0.53) ** 2);

  // 1. Warm face and chest emission glows
  ctx.globalAlpha = 0.45 + speech * 0.25;
  ctx.drawImage(assets.face, 512, 239, 176, 176);

  ctx.globalAlpha = 0.55;
  const cx = LOGO_BOX.x + LOGO_BOX.w / 2, cy = LOGO_BOX.y + LOGO_BOX.h / 2;
  ctx.drawImage(assets.chest, cx - LOGO_BOX.w * 0.62, cy - LOGO_BOX.w * 0.62, LOGO_BOX.w * 1.24, LOGO_BOX.w * 1.24);

  // 2. Secondary expanding rings (only 2 on low, 3 on high)
  ctx.fillStyle = BRAND.secondary;
  const ringCount = quality === 0 ? 1 : quality === 1 ? 2 : 3;
  for (let ring = 0; ring < ringCount; ring++) {
    const p = ((time * 0.08 + ring / 3) % 1), radius = 143 + p * 138;
    ctx.globalAlpha = Math.sin(p * Math.PI) * 0.28;
    ctx.drawImage(assets.ring, 600 - radius, 288 - radius * 1.06, radius * 2, radius * 2.12);
  }

  // 3. Static pre-baked body blit (ultra-fast 1 single drawImage call!)
  ctx.globalAlpha = 1;
  ctx.drawImage(scene.baked, 0, breathY);

  // 4. Live facial wave particles (batched by color group for maximum speed)
  for (let color = 0; color < PALETTE.length; color++) {
    const list = scene.live[color];
    if (!list.length) continue;
    ctx.fillStyle = PALETTE[color];
    const warmth = color >= 8 && color <= 11 ? 0.77 + speech * 0.43 : 1;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      let y = p.y + p.focus * (Math.sin(p.dx * 0.072 + time * 4.6) * 4.5 + Math.sin(p.dx * 0.12 - time * 5.5) * 1.7) * (0.65 + speech);
      let x = p.x + p.dx * p.focus * speech * 0.018;
      y += breathY;

      const flicker = 0.78 + 0.22 * Math.sin(time * (1.5 + p.seed) + p.phase) ** 2;
      ctx.globalAlpha = clamp(p.alpha * flicker * warmth);
      ctx.fillRect(x, y, p.size, p.size);
    }
  }

  // 5. Scan ribbon
  if (quality > 0) {
    const scan = (time * 0.065) % 1;
    const sy = 133 + scan * 257;
    const half = sy < 206 ? 112 * Math.sqrt(Math.max(0, 1 - ((sy - 206) / 103) ** 2))
      : sy < 270 ? 112 : 113 * Math.pow(Math.max(0.015, 1 - ((sy - 269) / 174) ** 1.4), 0.64);
    ctx.globalAlpha = Math.sin(scan * Math.PI) * 0.22;
    ctx.drawImage(assets.ribbon, 600 - half, sy + breathY, half * 2, 12);
  }

  ctx.globalAlpha = 1;
  return { breathY, logoAlpha: 1 };
}

export function createBackdrop(): HTMLCanvasElement {
  const c = surface(W, H), ctx = c.getContext('2d')!, random = rng(8720);
  ctx.fillStyle = BRAND.background;
  ctx.fillRect(0, 0, W, H);
  function wash(x: number, y: number, rx: number, ry: number, color: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, color);
    g.addColorStop(1, '#10101200');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  wash(600, 330, 350, 340, '#6d35162e');
  wash(382, 275, 160, 330, '#a7abb218');
  wash(818, 300, 170, 320, '#e0651819');
  wash(600, 700, 340, 55, '#e065182e');
  ctx.strokeStyle = '#55565a';
  ctx.lineWidth = 0.65;
  ctx.globalAlpha = 0.23;
  for (let y = 690; y < 760; y += 17) {
    ctx.beginPath();
    ctx.ellipse(600, y, 305 + (y - 690) * 1.7, 11 + (y - 690) * 0.25, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = '#e06518';
  ctx.beginPath();
  ctx.ellipse(600, 692, 270, 16, 0, 0.12, Math.PI - 0.12);
  ctx.stroke();

  // Subtle film grain
  for (let i = 0; i < 3500; i++) {
    ctx.globalAlpha = random() * 0.04;
    ctx.fillStyle = i % 3 ? '#aba6a1' : '#e06518';
    ctx.fillRect(random() * W, random() * H, 1, 1);
  }
  ctx.globalAlpha = 1;
  return c;
}
