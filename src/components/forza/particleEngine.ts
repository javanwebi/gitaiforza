// All geometry is generated here. Coordinates live on a 1200 × 760 design plane.
// A seeded PRNG makes reloads and recordings reproducible.
//
// Static mesh, rim, shoulders, outer face and logo bake once after assembly.
// Only the focused facial wave region remains live. Ring and glow sprites are
// cached too. Actual frame rates still depend on the browser and hardware.
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

// Brand palette: primary #e06518, secondary #55565a, white #ffffff.
// Only tints/shades of these three are used.
export const BRAND = { primary: '#e06518', secondary: '#55565a', white: '#f5f2ef', background: '#101012' };
const PALETTE = [
  '#55565a', // 0  secondary: inner contours
  '#8b8c90', // 1  secondary tint: head latitudes / accents
  '#d4d4d6', // 2  near white: silhouette edge
  '#f5f2ef', // 3  warm-white rim
  '#f5f2ef', // 4  warm-white highlights
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

// Logo sits in the middle of the chest. Design-plane rectangle.
export const LOGO_BOX = (() => {
  const w = 156, h = (w * 424) / 640, cx = 600, cy = 604;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
})();
const PAD = 12;

// Soft elliptical clearing around the logo (no hard box edge).
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

export interface Particle {
  x: number;
  y: number;
  color: number;
  alpha: number;
  size: number;
  kind: number;
  seed: number;
  phase: number;
  focus: number;
  sx: number;
  sy: number;
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
  points: Particle[];
  dust: DustParticle[];
  live: Particle[][];
  still: Particle[][];
  baked: HTMLCanvasElement | null;
  assets: SceneAssets | null;
}

export interface SceneAssets {
  face: HTMLCanvasElement;
  chest: HTMLCanvasElement;
  seed: HTMLCanvasElement;
  spark: HTMLCanvasElement;
  ring: HTMLCanvasElement;
  ribbon: HTMLCanvasElement;
}

/** logoMask: optional { data: Uint8ClampedArray (RGBA), w, h } sampled from the logo. */
export function createScene(logoMask?: LogoMask | null): Scene {
  const random = rng(18742);
  const points: Particle[] = [];
  const dust: DustParticle[] = [];

  function add(x: number, y: number, color = 2, alpha = .6, size = 1, kind = 0) {
    const dx = x - 600, dy = y - 327;
    points.push({
      x,
      y,
      color,
      alpha,
      size,
      kind,
      seed: random(),
      phase: random() * TAU,
      focus: Math.exp(-((dx / 74) ** 2 + (dy / 73) ** 2)),
      sx: 600 + (random() - .5) * 990,
      sy: 610 + (random() - .5) * 270,
    });
  }

  // Edge particles: multiple imperfect strands read as light.
  for (const side of [-1, 1]) {
    for (const segment of [...outline, ...shoulder]) {
      for (let k = 0; k < 290; k++) {
        const [px, py] = cubic(segment, random());
        const jitter = (random() + random() + random() - 1.5);
        const x = 600 + side * (px - 600) + jitter * 3.5, y = py + (random() - .5) * 3;
        add(x, y, random() > .75 ? 3 : 2, .65 + random() * .35, 1.6 + random() * 1.1, 1);
        if (k % 4 === 0) {
          dust.push({
            x: x + side * random() * 29,
            y: y + (random() - .5) * 42,
            phase: random() * TAU,
            rate: .2 + random() * .8,
            size: .6 + random() * .9,
            alpha: random() * .5,
          });
        }
      }
    }
  }

  // Horizontal latitude contours: smooth, featureless head (animated every frame).
  for (let row = 0; row < 53; row++) {
    const y = 111 + row * 6.02;
    let half: number;
    if (y < 206) half = 117 * Math.sqrt(Math.max(0, 1 - ((y - 206) / 103) ** 2));
    else if (y < 270) half = 117 + (y - 206) * .018;
    else half = 120 * Math.pow(Math.max(.015, 1 - ((y - 269) / 174) ** 1.4), .64);

    for (let x = -half; x <= half; x += 2.1) {
      const u = x / Math.max(half, 1);
      const curve = (-15 + 45 * smooth((y - 210) / 220)) * (1 - u * u);
      const yy = y + curve;
      const heat = Math.exp(-((x / 62) ** 2 + ((yy - 321) / 57) ** 2) * 1.28);
      const color = heat > .72 ? 11 : heat > .40 ? 10 : heat > .18 ? 9 : heat > .07 ? 8 : 1;
      add(600 + x, yy, color, heat > .07 ? .65 + heat * .35 : .42, 1.1 + heat * 1.5, 2);
    }
  }

  for (const side of [-1, 1]) {
    // Thin concentric shoulder / neck contours.
    for (let i = 0; i < 12; i++) {
      const inset = i * 9.2;
      const joinX = 730 - inset * .55, joinY = 525 + i * 6.2;
      const segments = [
        [674 - inset * .18, 394 + i * 4, 646 - inset * .30, 472 + i * 2.5, joinX - 46, joinY - 13, joinX, joinY],
        [joinX, joinY, joinX + 46, joinY + 13, 876 - inset * .7, 593 + i * 3.7, 903 - inset * .72, 670],
      ];
      for (const p of segments) {
        for (let j = 0; j < 130; j++) {
          const [x, y] = cubic(p, j / 129);
          if (inLogoZone(600 + side * (x - 600), y)) continue;
          add(600 + side * (x - 600), y, i % 4 === 0 ? 1 : 0, (.6 - i * .022) * clamp((690 - y) / 48), 1.1, 3);
        }
      }
    }

    // Nested pectoral arches.
    for (let i = 0; i < 7; i++) {
      const p = [891 - i * 9, 669, 864 - i * 6, 549 + i * 6, 679 + i * 2.5, 542 + i * 9, 623 + i * 4, 674];
      for (let j = 0; j < 170; j++) {
        const [x, y] = cubic(p, j / 169);
        if (inLogoZone(600 + side * (x - 600), y)) continue;
        add(600 + side * (x - 600), y, i % 3 === 0 ? 1 : 0, .32, 1, 3);
      }
    }

    // Inner clavicle arcs (kept outside the logo plate).
    for (let i = 0; i < 8; i++) {
      const p = [641 + i * 5.5, 443 + i * 3.5, 619 + i * 5, 521, 610 + i * 8.5, 550, 609 + i * 11, 674];
      for (let j = 0; j < 100; j++) {
        const [x, y] = cubic(p, j / 99);
        if (inLogoZone(600 + side * (x - 600), y)) continue;
        add(600 + side * (x - 600), y, i < 3 ? 5 : 0, .3, .9, 3);
      }
    }

    // Orange neck filaments, ending above the logo.
    const endY = LOGO_BOX.y - PAD - 2;
    for (let strand = 0; strand < 5; strand++) {
      for (let j = 0; j < 150; j++) {
        const t = j / 149, y = 424 + t * (endY - 424);
        const x = 600 + side * (7 + strand * 4 + (42 - strand * 3) * (1 - t) ** 2
          + Math.sin(t * 14 + strand * .6) * Math.sin(t * Math.PI) * 4.2);
        add(x, y, strand === 1 ? 7 : 6, (.7 + Math.sin(t * Math.PI) * .28) * (1 - t * .45), 1.2, 4);
      }
    }
  }

  // Logo particles: sampled from the logo alpha so it assembles with the body.
  if (logoMask) {
    const { data, w, h } = logoMask;
    const step = 1.35;
    for (let y = 0; y < LOGO_BOX.h; y += step) {
      for (let x = 0; x < LOGO_BOX.w; x += step) {
        const mx = Math.min(w - 1, (x / LOGO_BOX.w * w) | 0);
        const my = Math.min(h - 1, (y / LOGO_BOX.h * h) | 0);
        if (data[(my * w + mx) * 4 + 3] > 140) {
          add(LOGO_BOX.x + x + (random() - .5) * .6, LOGO_BOX.y + y + (random() - .5) * .6, 12, .9, 1.35, 5);
        }
      }
    }
  }

  // Longitude mesh: static depth pass.
  for (let meridian = -5; meridian <= 5; meridian++) {
    for (let j = 0; j < 130; j++) {
      const y = 119 + j * 2.32;
      const half = y < 206 ? 117 * Math.sqrt(Math.max(0, 1 - ((y - 206) / 103) ** 2))
        : y < 270 ? 117 + (y - 206) * .018
        : 120 * Math.pow(Math.max(.015, 1 - ((y - 269) / 174) ** 1.4), .64);
      const u = meridian / 6;
      const x = 600 + half * Math.sin(u * Math.PI / 2);
      add(x, y + (-15 + 45 * smooth((y - 210) / 220)) * (1 - u * u), meridian === 0 ? 5 : 1,
        .14 + Math.abs(u) * .08, .8, 3);
    }
  }

  // Broken highlights on the shoulders, ribs and temples.
  for (const side of [-1, 1]) {
    for (let j = 0; j < 260; j++) {
      const t = j / 259, x = 600 + side * (92 + t * 207), y = 507 + Math.pow(t, 1.8) * 139;
      if (!inLogoZone(x, y)) add(x, y, j % 7 === 0 ? 7 : 2, .16 + random() * .19, .8 + random() * .6, 3);
    }
    for (let j = 0; j < 95; j++) {
      const y = 172 + j * 1.15, x = 600 + side * (105 + Math.sin(j * .033) * 9);
      add(x, y, 7, .14 + random() * .16, .85, 3);
    }
  }

  // Low-density ambient dust.
  for (let i = 0; i < 160; i++) {
    dust.push({
      x: 600 + (random() - .5) * 760,
      y: 85 + random() * 610,
      phase: random() * TAU,
      rate: .12 + random() * .5,
      size: .6,
      alpha: .05 + random() * .09,
    });
  }

  // Split: animated (face) vs. bakeable (everything else), bucketed by colour.
  const live: Particle[][] = PALETTE.map(() => []);
  const still: Particle[][] = PALETTE.map(() => []);
  for (const p of points) {
    (p.kind === 2 && p.focus > .025 ? live : still)[p.color].push(p);
  }
  return { points, dust, live, still, baked: null, assets: null };
}

// Time at which every particle has reached its rest position.
const SETTLE_TIME = .28 + .75 + .46 + 2.85 + .05;

function drawBucket(
  ctx: CanvasRenderingContext2D,
  buckets: Particle[][],
  time: number,
  arrival: number,
  breathY: number,
  speech: number,
  isLive: boolean,
  quality = 2
) {
  for (let color = 0; color < PALETTE.length; color++) {
    const list = buckets[color];
    if (!list.length) continue;
    ctx.fillStyle = PALETTE[color];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (quality < 2 && time < SETTLE_TIME && p.kind !== 1 && p.kind !== 5 &&
        i % (quality === 0 ? 3 : 2) !== 0) continue;
      if (isLive && quality === 0 && i % 2) continue;
      const delay = (p.y / 760) * .75 + p.seed * .46;
      const a = time >= SETTLE_TIME ? 1 : smooth((time - .28 - delay) / 2.85);
      if (a <= 0) continue;
      const disperse = 1 - a;
      let x = p.x, y = p.y;
      if (disperse > 0) {
        x += (p.sx - p.x) * disperse + Math.sin(p.phase + time * 2.1) * disperse * 96;
        y += (p.sy - p.y) * disperse + Math.cos(p.phase + time * 1.6) * disperse * 64;
      }
      if (isLive) {
        const dx = p.x - 600, dy = p.y - 327;
        const focus = p.focus;
        if (focus > .01) {
          y += focus * (Math.sin(dx * .072 + time * 4.6) * 4.5 + Math.sin(dx * .12 - time * 5.5) * 1.7) * (.65 + speech);
          x += dx * focus * speech * .018;
        }
      }
      y += breathY;
      const flicker = isLive ? .78 + .22 * Math.sin(time * (1.5 + p.seed) + p.phase) ** 2 : .9;
      const warmth = color >= 8 && color <= 11 ? .77 + speech * .43 : 1;
      ctx.globalAlpha = clamp(p.alpha * flicker * warmth * (.20 + .80 * a));
      ctx.fillRect(x, y, p.size, p.size);
    }
  }
}

export function paintScene(ctx: CanvasRenderingContext2D, scene: Scene, time: number, quality = 2) {
  ctx.clearRect(0, 0, W, H);
  if (!scene.assets) scene.assets = createAssets();
  const assets = scene.assets;
  const arrival = smooth((time - .35) / 4.0), settled = smooth((time - 2.4) / 2.2);
  const breathY = Math.sin(time * 1.65) * .75 * settled;
  const speech = (.45 + .25 * Math.sin(time * 2.7) + .21 * Math.sin(time * 5.4)) * (.70 + .30 * Math.sin(time * .53) ** 2);

  // Warm emission behind the face.
  if (settled > 0) {
    ctx.globalAlpha = settled * (.38 + speech * .28);
    ctx.drawImage(assets.face, 512, 239, 176, 176);
  }
  // Soft orange halo behind the logo.
  if (settled > 0) {
    ctx.globalAlpha = settled * .55;
    const cx = LOGO_BOX.x + LOGO_BOX.w / 2, cy = LOGO_BOX.y + LOGO_BOX.h / 2;
    ctx.drawImage(assets.chest, cx - LOGO_BOX.w * .62, cy - LOGO_BOX.w * .62, LOGO_BOX.w * 1.24, LOGO_BOX.w * 1.24);
  }
  // Expanding rings (secondary grey).
  ctx.fillStyle = BRAND.secondary;
  for (let ring = 0; ring < (quality === 0 ? 3 : 5); ring++) {
    const p = ((time * .08 + ring / 5) % 1), radius = 143 + p * 138;
    ctx.globalAlpha = Math.sin(p * Math.PI) * .32 * settled;
    ctx.drawImage(assets.ring, 600 - radius, 288 - radius * 1.06, radius * 2, radius * 2.12);
  }
  // Dust motes.
  ctx.fillStyle = '#8b8c90';
  for (let i = 0; i < scene.dust.length; i += quality === 0 ? 3 : quality === 1 ? 2 : 1) {
    const p = scene.dust[i];
    ctx.globalAlpha = p.alpha * arrival * (.5 + .5 * Math.sin(time * p.rate + p.phase) ** 2);
    ctx.fillRect(p.x + Math.sin(time * .42 + p.phase) * 4, p.y - Math.sin(time * p.rate + p.phase) * 8, p.size, p.size);
  }
  // Static body: draw live until settled, then bake once.
  if (time >= SETTLE_TIME) {
    if (!scene.baked && typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      drawBucket(c.getContext('2d')!, scene.still, SETTLE_TIME + 10, 1, 0, 0, false);
      scene.baked = c;
    }
    ctx.globalAlpha = 1;
    if (scene.baked) ctx.drawImage(scene.baked, 0, breathY);
  } else {
    drawBucket(ctx, scene.still, time, arrival, breathY, speech, false, quality);
  }
  drawBucket(ctx, scene.live, time, arrival, breathY, speech, true, quality);

  // Travelling rim-light sparks.
  if (settled > 0 && quality > 0) {
    for (const side of [-1, 1]) {
      for (let pulse = 0; pulse < 4; pulse++) {
        const phase = (time * .095 + pulse * .25) % 1;
        const pathIndex = Math.min(2, Math.floor(phase * 3));
        const [px, py] = cubic(outline[pathIndex], (phase * 3) % 1);
        ctx.globalAlpha = settled * .42 * Math.sin(phase * Math.PI);
        ctx.drawImage(assets.spark, 600 + side * (px - 600) - 9, py + breathY - 9, 18, 18);
      }
      for (let pulse = 0; pulse < 3; pulse++) {
        const t = (time * .24 + pulse / 3) % 1;
        const endY = LOGO_BOX.y - PAD - 2;
        const px = 600 + side * (14 + 36 * (1 - t) ** 2), py = 424 + t * (endY - 424);
        ctx.globalAlpha = settled * .5 * Math.sin(t * Math.PI);
        ctx.drawImage(assets.spark, px - 7, py + breathY - 7, 14, 14);
      }
    }
  }

  // Scan ribbon across facial volume.
  if (settled > 0 && quality > 0) {
    const scan = (time * .065) % 1;
    const sy = 133 + scan * 257;
    const half = sy < 206 ? 112 * Math.sqrt(Math.max(0, 1 - ((sy - 206) / 103) ** 2))
      : sy < 270 ? 112 : 113 * Math.pow(Math.max(.015, 1 - ((sy - 269) / 174) ** 1.4), .64);
    ctx.globalAlpha = Math.sin(scan * Math.PI) * .22 * settled;
    ctx.drawImage(assets.ribbon, 600 - half, sy + breathY, half * 2, 12);
  }

  // Chest seed during assembly.
  const seed = Math.max(0, 1 - smooth((time - 2.3) / 2.5));
  if (seed > 0) {
    ctx.globalAlpha = seed;
    ctx.drawImage(assets.seed, 550, 602, 100, 100);
  }
  ctx.globalAlpha = 1;
  return { breathY, logoAlpha: settled };
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
  for (let j = 0; j < 420; j++) {
    const a = j / 420 * TAU;
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
    seed: glow(100, [[0, '#f5f2ef'], [.1, '#ffd2b0'], [.25, '#e06518'], [.55, '#e0651844'], [1, '#e0651800']]),
    spark: glow(32, [[0, '#f5dfcc'], [.1, '#f6b789'], [.3, '#e0651860'], [1, '#e0651800']]),
    ring,
    ribbon,
  };
}

// Baked studio environment: illumination, atmosphere, pedestal and grain.
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
  ctx.lineWidth = .65;
  ctx.globalAlpha = .23;
  for (let y = 690; y < 760; y += 17) {
    ctx.beginPath();
    ctx.ellipse(600, y, 305 + (y - 690) * 1.7, 11 + (y - 690) * .25, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = .38;
  ctx.strokeStyle = '#e06518';
  ctx.beginPath();
  ctx.ellipse(600, 692, 270, 16, 0, .12, Math.PI - .12);
  ctx.stroke();

  // Subtle fixed film grain.
  for (let i = 0; i < 11500; i++) {
    ctx.globalAlpha = random() * .045;
    ctx.fillStyle = i % 3 ? '#aba6a1' : '#e06518';
    ctx.fillRect(random() * W, random() * H, 1, 1);
  }
  ctx.globalAlpha = 1;
  return c;
}
