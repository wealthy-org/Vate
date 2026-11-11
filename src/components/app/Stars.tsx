'use client';

import { useEffect, useRef } from 'react';

/** Quiet starfield behind the app: dark specks on ivory, twinkling slowly. Purely decorative. */
export function Stars() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let stars: { x: number; y: number; r: number; p: number }[] = [];
    let raf = 0;
    let last = 0;

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#142D35';
      for (const s of stars) {
        ctx.globalAlpha = 0.07 + 0.16 * (0.5 + 0.5 * Math.sin(t * 0.0012 + s.p));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round((width * height) / 11000) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 0.9 + 0.3,
        p: Math.random() * 6.3,
      }));
      draw(last);
    };
    const loop = (t: number) => {
      // ~20 fps is plenty for a slow twinkle and keeps the main thread free for the form.
      if (t - last > 48) {
        last = t;
        draw(t);
      }
      raf = requestAnimationFrame(loop);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) raf = requestAnimationFrame(loop);
    };
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return <canvas ref={ref} className="stars" aria-hidden="true" />;
}
