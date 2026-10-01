import React, { useEffect, useRef } from 'react';
import { createScene, paintScene, createBackdrop, W, H, LOGO_BOX, LOGO_COLOR, BRAND, LogoMask } from './particleEngine';
import logoUrl from '../../assets/forza-logo.png';

export interface ParticleHumanoidProps {
  paused?: boolean;
  speed?: number;
  restartKey?: number;
  quality?: string;
  statusRef?: React.MutableRefObject<any> | { current: any };
  audioLevelRef?: React.MutableRefObject<number> | { current: number };
  onStats?: (stats: { fps: number | null; tier: string; renderMs: number }) => void;
  className?: string;
}

let logoPromise: Promise<{ tint: HTMLCanvasElement; mask: LogoMask } | null> | null = null;

function loadLogo(): Promise<{ tint: HTMLCanvasElement; mask: LogoMask } | null> {
  if (logoPromise) return logoPromise;
  logoPromise = new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const tint = document.createElement('canvas');
      tint.width = img.naturalWidth || 640;
      tint.height = img.naturalHeight || 424;
      const t = tint.getContext('2d');
      if (t) {
        t.drawImage(img, 0, 0);
        t.globalCompositeOperation = 'source-in';
        t.fillStyle = LOGO_COLOR;
        t.fillRect(0, 0, tint.width, tint.height);
      }
      const mw = 320;
      const mh = Math.round((mw * (img.naturalHeight || 424)) / (img.naturalWidth || 640));
      const m = document.createElement('canvas');
      m.width = mw;
      m.height = mh;
      const mc = m.getContext('2d', { willReadFrequently: true });
      if (mc) {
        mc.drawImage(img, 0, 0, mw, mh);
        const imgData = mc.getImageData(0, 0, mw, mh);
        resolve({ tint, mask: { data: imgData.data, w: mw, h: mh } });
      } else {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = logoUrl;
  });
  return logoPromise;
}

export const ParticleHumanoid: React.FC<ParticleHumanoidProps> = ({
  paused = false,
  speed = 1,
  restartKey = 0,
  quality = 'auto',
  onStats,
  className = '',
}) => {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const settings = useRef({ paused, speed, quality, onStats });
  settings.current = { paused, speed, quality, onStats };

  useEffect(() => {
    wake.current?.();
  }, [paused, speed, quality]);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    let teardown: (() => void) | undefined;
    const target = canvas.current;
    if (!target) return;
    const context = target.getContext('2d', { alpha: false });
    if (!context) return;

    loadLogo().then(logo => {
      if (cancelled || !context) return;
      const ctx2d = context;
      const scene = createScene(logo?.mask);
      const backdrop = createBackdrop();
      const layer = document.createElement('canvas');
      layer.width = W;
      layer.height = H;
      const ink = layer.getContext('2d');
      if (!ink) return;

      const glowA = document.createElement('canvas');
      glowA.width = W / 4;
      glowA.height = H / 4;
      const a = glowA.getContext('2d')!;

      let tier = quality === 'low' ? 0 : quality === 'balanced' ? 1 : 2;
      let width = 1;
      let height = 1;
      let dpr = 1;
      let previous = 0;
      let time = 0;
      let dirty = true;
      let statsStart = 0;
      let statFrames = 0;
      const aim = { x: 0, y: 0 };
      const camera = { x: 0, y: 0 };
      const motion = matchMedia('(prefers-reduced-motion: reduce)');

      function resize() {
        if (!target) return;
        const rect = target.getBoundingClientRect();
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        // Smart DPR capping for blazing fast fillrate
        dpr = Math.min(window.devicePixelRatio || 1, tier === 2 ? 1.25 : 1.0);
        target.width = Math.max(1, Math.round(width * dpr));
        target.height = Math.max(1, Math.round(height * dpr));
        dirty = true;
      }

      function schedule() {
        if (!cancelled && !document.hidden && !frame) frame = requestAnimationFrame(draw);
      }

      function invalidate() {
        dirty = true;
        previous = 0;
        schedule();
      }

      function pointer(event: PointerEvent) {
        if (motion.matches || settings.current.paused || event.pointerType === 'touch' || !target) return;
        const rect = target.getBoundingClientRect();
        aim.x = ((event.clientX - rect.left) / rect.width - 0.5) * 8;
        aim.y = ((event.clientY - rect.top) / rect.height - 0.5) * 5;
      }

      function leave() {
        aim.x = 0;
        aim.y = 0;
      }

      function visibility() {
        if (document.hidden) {
          cancelAnimationFrame(frame);
          frame = 0;
        } else {
          invalidate();
        }
      }

      function draw(now: number) {
        frame = 0;
        if (cancelled || document.hidden || !target) return;
        const running = !settings.current.paused && !motion.matches;
        const started = performance.now();

        const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
        previous = now;

        if (running) {
          time += delta * Math.max(0.1, settings.current.speed);
          camera.x += (aim.x - camera.x) * 0.15;
          camera.y += (aim.y - camera.y) * 0.15;
        }

        // 1. Paint scene to layer
        const { breathY, logoAlpha } = paintScene(ink!, scene, time, tier);

        // 2. Clear main canvas & fill background
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.globalAlpha = 1;
        ctx2d.globalCompositeOperation = 'source-over';
        ctx2d.fillStyle = BRAND.background;
        ctx2d.fillRect(0, 0, width, height);

        const usableHeight = Math.max(180, height - (height > 420 ? 136 : 80));
        const scale = Math.min((width - 24) / 700, usableHeight / 635);
        const x = (width - W * scale) / 2 + camera.x;
        const y = (height - H * scale) / 2 - 10 + camera.y;
        const dw = W * scale;
        const dh = H * scale;

        // 3. Draw backdrop
        ctx2d.drawImage(backdrop, x, y, dw, dh);

        // 4. Lightweight soft bloom (1 downscale pass on high/balanced)
        if (tier > 0) {
          a.clearRect(0, 0, glowA.width, glowA.height);
          a.drawImage(layer, 0, 0, glowA.width, glowA.height);
          ctx2d.globalCompositeOperation = 'screen';
          ctx2d.globalAlpha = 0.55;
          ctx2d.drawImage(glowA, x, y, dw, dh);
        }

        // 5. Blit main layer
        ctx2d.globalCompositeOperation = 'screen';
        ctx2d.globalAlpha = 1;
        ctx2d.drawImage(layer, x, y, dw, dh);
        ctx2d.globalCompositeOperation = 'source-over';

        // 6. Blit sharp chest logo
        if (logo && logoAlpha > 0) {
          ctx2d.globalAlpha = logoAlpha;
          ctx2d.drawImage(
            logo.tint,
            x + LOGO_BOX.x * scale,
            y + (LOGO_BOX.y + breathY) * scale,
            LOGO_BOX.w * scale,
            LOGO_BOX.h * scale
          );
          ctx2d.globalAlpha = 1;
        }

        const renderMs = Math.round((performance.now() - started) * 10) / 10;
        statFrames++;
        if (!statsStart) statsStart = now;
        if (now - statsStart >= 1000) {
          const fps = Math.round((statFrames * 1000) / Math.max(1, now - statsStart));
          settings.current.onStats?.({
            fps: running ? fps : 60,
            tier: tier === 2 ? 'ULTRA' : tier === 1 ? 'BALANCED' : 'ECO',
            renderMs,
          });
          statsStart = now;
          statFrames = 0;
        }

        if (running) schedule();
      }

      observer = new ResizeObserver(() => {
        resize();
        invalidate();
      });
      observer.observe(target);
      document.addEventListener('visibilitychange', visibility);
      target.addEventListener('pointermove', pointer, { passive: true });
      target.addEventListener('pointerleave', leave);
      wake.current = invalidate;
      teardown = () => {
        document.removeEventListener('visibilitychange', visibility);
        target.removeEventListener('pointermove', pointer);
        target.removeEventListener('pointerleave', leave);
      };
      resize();
      schedule();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      teardown?.();
      wake.current = null;
    };
  }, [restartKey, quality]);

  return (
    <canvas
      ref={canvas}
      className={`particle-canvas ${className}`}
      role="img"
      aria-label="FORZA particle humanoid"
    />
  );
};

export default ParticleHumanoid;
