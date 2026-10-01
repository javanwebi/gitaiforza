import React, { useEffect, useRef } from 'react';
import { createScene, paintScene, W, H, LOGO_BOX, LOGO_COLOR, BRAND, LogoMask } from './particleEngine';
import logoUrl from '../../assets/forza-logo.png';

interface ParticleHumanoidProps {
  paused?: boolean;
  speed?: number;
  restartKey?: number;
  statusRef?: React.MutableRefObject<string>;
  audioLevelRef?: React.MutableRefObject<number>;
  className?: string;
}

function loadLogo(): Promise<{ tint: HTMLCanvasElement; mask: LogoMask } | null> {
  return new Promise(resolve => {
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
}

export const ParticleHumanoid: React.FC<ParticleHumanoidProps> = ({
  paused = false,
  speed = 1,
  restartKey = 0,
  statusRef,
  audioLevelRef,
  className = '',
}) => {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const settings = useRef({ paused, speed });
  settings.current = { paused, speed };

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let observer: ResizeObserver | null = null;
    const target = canvas.current;
    if (!target) return;
    const context = target.getContext('2d', { alpha: false });
    if (!context) return;

    loadLogo().then(logo => {
      if (cancelled) return;
      const scene = createScene(logo?.mask);
      const layer = document.createElement('canvas');
      layer.width = W;
      layer.height = H;
      const ink = layer.getContext('2d');
      if (!ink) return;

      // Single downscaled glow pass for smooth zero-lag bloom
      const glow = document.createElement('canvas');
      glow.width = W / 4;
      glow.height = H / 4;
      const glowCtx = glow.getContext('2d');

      const mainCtx = context;
      const inkCtx = ink;

      let width = 1;
      let height = 1;
      let dpr = 1;
      let previous = 0;
      let time = 0;
      let hasDrawnOnce = false;

      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      if (motion.matches) time = 7;

      function resize() {
        if (!target) return;
        const rect = target.getBoundingClientRect();
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);
        // Cap DPR to 1.25 to prevent 4K pixel overdraw on retina displays
        dpr = Math.min(window.devicePixelRatio || 1, 1.25);
        target.width = Math.round(width * dpr);
        target.height = Math.round(height * dpr);
      }

      observer = new ResizeObserver(resize);
      observer.observe(target);
      resize();

      function draw(now: number) {
        frame = requestAnimationFrame(draw);
        const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
        previous = now;
        if (document.hidden) return;

        const running = !settings.current.paused && !motion.matches;
        if (running) {
          time += delta * Math.max(0.1, settings.current.speed);
        } else if (hasDrawnOnce) {
          return;
        }
        hasDrawnOnce = true;

        let speechModulation: number | undefined;
        if (audioLevelRef && typeof audioLevelRef.current === 'number' && audioLevelRef.current > 0.03) {
          // Dynamic audio-synced talking
          speechModulation = Math.min(2.5, audioLevelRef.current * 3.8 + 0.3);
        } else if (statusRef && statusRef.current === 'speaking') {
          // Expressive talking articulation rhythm
          speechModulation = 1.1 + 0.55 * Math.sin(time * 12.0) + 0.35 * Math.cos(time * 17.5);
        }

        const { breathY, logoAlpha } = paintScene(inkCtx, scene, time, speechModulation);

        mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        mainCtx.fillStyle = BRAND.background;
        mainCtx.fillRect(0, 0, width, height);

        // Responsive scaling: Dedicated top position for mobile, cinematic center for desktop
        const isDesktop = width >= 768;
        const scale = isDesktop
          ? Math.min(width / 880, height / 620)
          : Math.min(width / 680, (height * 0.48) / 520);

        const x = isDesktop && width > 1100
          ? (width - W * scale) / 2 + 100 // Shift slightly right on desktop to leave room for left side panel
          : (width - W * scale) / 2;

        // On mobile, position AI at the top so text stays below; on desktop, vertically centered
        const y = isDesktop
          ? (height - H * scale) / 2 + 15
          : Math.max(10, height * 0.03);

        const dw = W * scale;
        const dh = H * scale;

        // Quick single glow blit
        if (glowCtx) {
          glowCtx.clearRect(0, 0, glow.width, glow.height);
          glowCtx.drawImage(layer, 0, 0, glow.width, glow.height);
          mainCtx.globalCompositeOperation = 'screen';
          mainCtx.globalAlpha = 0.85;
          mainCtx.drawImage(glow, x, y, dw, dh);
        }

        mainCtx.globalCompositeOperation = 'source-over';
        mainCtx.globalAlpha = 1;
        mainCtx.drawImage(layer, x, y, dw, dh);

        // Crisp logo on top, breathing with the body
        if (logo && logoAlpha > 0) {
          mainCtx.globalAlpha = logoAlpha;
          mainCtx.drawImage(
            logo.tint,
            x + LOGO_BOX.x * scale,
            y + (LOGO_BOX.y + breathY) * scale,
            LOGO_BOX.w * scale,
            LOGO_BOX.h * scale,
          );
          mainCtx.globalAlpha = 1;
        }
      }

      const redraw = () => {
        hasDrawnOnce = false;
      };
      observer.disconnect();
      observer = new ResizeObserver(() => {
        resize();
        redraw();
      });
      observer.observe(target);
      frame = requestAnimationFrame(draw);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [restartKey]);

  return (
    <canvas
      ref={canvas}
      className={`particle-canvas ${className}`}
      role="img"
      aria-label="Animated particle humanoid in orange, grey and white with the FORZA logo glowing in its chest."
    />
  );
};

export default ParticleHumanoid;
