// Canvas effects for the landing page, recoloured for a light background: ink specks and orbit
// lines at low opacity, teal and sky blue for the active parts. Both return a cleanup function.
const INK = '#142D35';
const TEAL = '#087F75';
const SKY = '#2487D8';

export function mountStars(canvas: HTMLCanvasElement, reduce: boolean): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  let W = 0;
  let H = 0;
  let raf = 0;
  let stars: { x: number; y: number; r: number; z: number; p: number }[] = [];
  let shoot: { x: number; y: number; l: number } | null = null;

  const resize = () => {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * d);
    canvas.height = Math.round(H * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    stars = Array.from({ length: Math.round((W * H) / 8000) }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.1 + 0.3,
      z: Math.random(),
      p: Math.random() * 6.28,
    }));
    if (reduce) draw(0);
  };
  const draw = (t: number) => {
    ctx.clearRect(0, 0, W, H);
    const sy = window.scrollY;
    for (const s of stars) {
      const y = (((s.y - sy * s.z * 0.15) % H) + H) % H;
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.001 * (0.6 + s.z) + s.p));
      ctx.globalAlpha = a * (0.4 + s.z * 0.6) * (s.z > 0.93 ? 0.85 : 0.34);
      ctx.fillStyle = s.z > 0.93 ? TEAL : INK;
      ctx.beginPath();
      ctx.arc(s.x, y, s.r, 0, 6.283);
      ctx.fill();
    }
    if (!reduce) {
      if (!shoot && Math.random() < 0.004) shoot = { x: Math.random() * W, y: Math.random() * H * 0.5, l: 0 };
      if (shoot) {
        shoot.l += 14;
        const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - 120, shoot.y - 50);
        ctx.globalAlpha = Math.max(0, 1 - shoot.l / 500) * 0.6;
        g.addColorStop(0, SKY);
        g.addColorStop(1, 'rgba(36,135,216,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(shoot.x, shoot.y);
        ctx.lineTo(shoot.x - 120, shoot.y - 50);
        ctx.stroke();
        shoot.x += 9;
        shoot.y += 3.8;
        if (shoot.l > 500) shoot = null;
      }
    }
    ctx.globalAlpha = 1;
    if (!reduce) raf = requestAnimationFrame(draw);
  };
  resize();
  window.addEventListener('resize', resize);
  if (!reduce) raf = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}

type Vec = [number, number, number];

/** Armillary sphere of the hero: slowly rotating rings, labelled nodes and travelling packets. */
export function mountSphere(canvas: HTMLCanvasElement, reduce: boolean): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  let W = 0;
  let H = 0;
  let rot = 0.6;
  let mx = 0;
  let my = 0;
  let tmx = 0;
  let tmy = 0;
  let visible = true;
  let raf = 0;
  let cx = 0;
  let cy = 0;
  let RAD = 0;
  const tilt = -0.38;
  const ecliptic = (23.4 * Math.PI) / 180;

  const defs: [string, number, number][] = [
    ['USDG', 0.3, -0.25], ['VAULT I', 1.35, 0.35], ['VAULT II', 2.3, -0.55], ['VAULT III', 3.25, 0.15],
    ['VAULT IV', 4.2, -0.3], ['WALLET', 5.2, 0.55], ['VATE', 0.85, 0.85], ['L2', 2.9, -0.95],
  ];
  const nodes = defs.map(([n, lon, lat]) => ({
    n,
    v: [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)] as Vec,
    pulse: 0,
  }));
  type Node = (typeof nodes)[number];
  const packets: { a: Node; b: Node; t: number; sp: number; trail: Vec[] }[] = [];
  const spawn = (from: Node) => {
    let to: Node;
    do {
      to = nodes[(Math.random() * nodes.length) | 0] as Node;
    } while (to === from);
    packets.push({ a: from, b: to, t: 0, sp: 0.004 + Math.random() * 0.004, trail: [] });
  };
  for (let i = 0; i < 4; i++) spawn(nodes[i * 2] as Node);

  const resize = () => {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * d);
    canvas.height = Math.round(H * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (reduce) frame();
  };
  const onMove = (e: MouseEvent) => {
    tmx = (e.clientX / window.innerWidth) * 2 - 1;
    tmy = (e.clientY / window.innerHeight) * 2 - 1;
  };
  const io = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
  });
  io.observe(canvas);

  const R3 = ([x, y, z]: Vec): Vec => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const x1 = x * c + z * s;
    const z1 = -x * s + z * c;
    const tx = tilt + my * 0.18;
    const ct = Math.cos(tx);
    const st = Math.sin(tx);
    return [x1, y * ct - z1 * st, y * st + z1 * ct];
  };
  const P = (p: Vec): Vec => {
    const k = 3.4 / (3.4 + p[2]);
    return [cx + p[0] * RAD * k, cy + p[1] * RAD * k, p[2]];
  };
  const ring = (fn: (t: number) => Vec, color: string, w: number, rad = 1, steps = 120, base = 0.06, span = 0.5) => {
    let prev: Vec | null = null;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const p = fn(t);
      const q = P(R3([p[0] * rad, p[1] * rad, p[2] * rad]));
      if (prev) {
        ctx.globalAlpha = base + span * (1 - (q[2] / rad + 1) / 2);
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      }
      prev = q;
    }
  };
  const slerp = (a: Vec, b: Vec, t: number): Vec => {
    const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const om = Math.acos(d);
    const so = Math.sin(om) || 1e-6;
    const k1 = Math.sin((1 - t) * om) / so;
    const k2 = Math.sin(t * om) / so;
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  };

  function frame() {
    mx += (tmx - mx) * 0.04;
    my += (tmy - my) * 0.04;
    rot += reduce ? 0 : 0.0018 + mx * 0.0015;
    ctx!.clearRect(0, 0, W, H);
    const mob = W < 960;
    cx = mob ? W * 0.5 : W * 0.64;
    cy = mob ? H * 0.34 : H * 0.46;
    RAD = Math.min(W * (mob ? 0.4 : 0.26), H * 0.36);
    const g = ctx!.createRadialGradient(cx, cy, 0, cx, cy, RAD * 1.6);
    g.addColorStop(0, 'rgba(36,135,216,.10)');
    g.addColorStop(1, 'rgba(36,135,216,0)');
    ctx!.globalAlpha = 1;
    ctx!.fillStyle = g;
    ctx!.fillRect(0, 0, W, H);

    for (let lat = -60; lat <= 60; lat += 30) {
      const L = (lat * Math.PI) / 180;
      ring((t) => [Math.cos(L) * Math.cos(t), Math.sin(L), Math.cos(L) * Math.sin(t)], INK, 0.6, 1, 100, 0.04, 0.2);
    }
    for (let lon = 0; lon < 180; lon += 30) {
      const L = (lon * Math.PI) / 180;
      ring((t) => [Math.cos(t) * Math.cos(L), Math.sin(t), Math.cos(t) * Math.sin(L)], INK, 0.6, 1, 100, 0.04, 0.2);
    }
    ring((t) => [Math.cos(t), 0, Math.sin(t)], INK, 1.1, 1.18, 140, 0.1, 0.42);
    ring((t) => [Math.cos(t), 0, Math.sin(t)], INK, 0.5, 1.23, 140, 0.06, 0.28);
    ring((t) => [Math.cos(t), Math.sin(t), 0], INK, 1.1, 1.2, 140, 0.1, 0.42);
    ring((t) => [0, Math.sin(t), Math.cos(t)], INK, 0.5, 1.28, 140, 0.05, 0.25);
    ring((t) => [Math.cos(t), -Math.sin(t) * Math.sin(ecliptic), Math.sin(t) * Math.cos(ecliptic)], TEAL, 1.5, 1.12, 140, 0.18, 0.7);

    const a1 = P(R3([0, -1.5, 0]));
    const a2 = P(R3([0, 1.5, 0]));
    ctx!.globalAlpha = 0.35;
    ctx!.strokeStyle = INK;
    ctx!.lineWidth = 0.8;
    ctx!.setLineDash([3, 5]);
    ctx!.beginPath();
    ctx!.moveTo(a1[0], a1[1]);
    ctx!.lineTo(a2[0], a2[1]);
    ctx!.stroke();
    ctx!.setLineDash([]);

    for (let i = packets.length - 1; i >= 0; i--) {
      const k = packets[i]!;
      if (!reduce) k.t += k.sp;
      const tt = Math.min(k.t, 1);
      const v = slerp(k.a.v, k.b.v, tt);
      const lift = 1 + 0.28 * Math.sin(Math.PI * tt);
      const q = P(R3([v[0] * lift, v[1] * lift, v[2] * lift]));
      k.trail.push(q);
      if (k.trail.length > 26) k.trail.shift();
      ctx!.strokeStyle = TEAL;
      ctx!.lineWidth = 1.6;
      for (let j = 1; j < k.trail.length; j++) {
        const p0 = k.trail[j - 1]!;
        const p1 = k.trail[j]!;
        ctx!.globalAlpha = (j / k.trail.length) * 0.85;
        ctx!.beginPath();
        ctx!.moveTo(p0[0], p0[1]);
        ctx!.lineTo(p1[0], p1[1]);
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
      ctx!.fillStyle = SKY;
      ctx!.beginPath();
      ctx!.arc(q[0], q[1], 2.4, 0, 6.283);
      ctx!.fill();
      if (k.t >= 1) {
        k.b.pulse = 1;
        packets.splice(i, 1);
        spawn(k.b);
      }
    }

    ctx!.font = '500 10px ui-monospace, "JetBrains Mono", monospace';
    for (const n of nodes) {
      const q = P(R3(n.v));
      const al = q[2] < 0.15 ? 1 : 0.3;
      ctx!.globalAlpha = al;
      ctx!.fillStyle = TEAL;
      ctx!.beginPath();
      ctx!.arc(q[0], q[1], 3, 0, 6.283);
      ctx!.fill();
      if (n.pulse > 0) {
        ctx!.globalAlpha = n.pulse * al;
        ctx!.strokeStyle = TEAL;
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.arc(q[0], q[1], 3 + (1 - n.pulse) * 22, 0, 6.283);
        ctx!.stroke();
        n.pulse -= 0.02;
      }
      ctx!.globalAlpha = al * 0.85;
      ctx!.fillStyle = INK;
      ctx!.fillText(n.n, q[0] + 8, q[1] - 6);
      ctx!.globalAlpha = al * 0.35;
      ctx!.strokeStyle = INK;
      ctx!.lineWidth = 0.5;
      ctx!.beginPath();
      ctx!.moveTo(q[0] + 3, q[1] - 2);
      ctx!.lineTo(q[0] + 7, q[1] - 5);
      ctx!.stroke();
    }
    ctx!.globalAlpha = 1;
  }
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (visible) frame();
  };

  resize();
  window.addEventListener('resize', resize);
  if (reduce) {
    frame();
  } else {
    window.addEventListener('mousemove', onMove);
    raf = requestAnimationFrame(loop);
  }
  return () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('mousemove', onMove);
  };
}
