/**
 * Trace Challenge — a small self-contained fireworks burst for the results screen
 * (v1.2 game). Pure canvas + requestAnimationFrame, no external dependency
 * (CSP-safe). Decorative and non-interactive (pointer-events: none).
 */
import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const COLORS = ['#e8912d', '#5fb4e0', '#7fcf7f', '#d8412f', '#a07de0', '#f2c94c'];

export function Fireworks({ durationMs = 4000 }: { durationMs?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };
    resize();

    const particles: Particle[] = [];
    const burst = (cx: number, cy: number) => {
      const hue = COLORS[Math.floor(Math.random() * COLORS.length)]!;
      const n = 26 + Math.floor(Math.random() * 18);
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
        const sp = 1.5 + Math.random() * 3.5;
        particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color: hue });
      }
    };

    let raf = 0;
    const start = performance.now();
    let lastBurst = 0;
    const tick = (t: number) => {
      const elapsed = t - start;
      const W = canvas.width;
      const H = canvas.height;
      // A new burst every ~500ms while active.
      if (elapsed < durationMs && t - lastBurst > 480) {
        lastBurst = t;
        burst(W * (0.2 + Math.random() * 0.6), H * (0.2 + Math.random() * 0.4));
      }
      ctx.clearRect(0, 0, W, H);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.04; // gravity
        p.vx *= 0.99;
        p.life -= 0.012;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (elapsed < durationMs || particles.length > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [durationMs]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}
