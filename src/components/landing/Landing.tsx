'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Mark } from '@/components/shared/Mark';
import { QueryProvider } from '@/components/shared/QueryProvider';
import { TokenChip } from '@/components/shared/TokenChip';
import { SITE } from '@/config/site';
import { useRanking } from '@/hooks/useMarketData';
import { kv, storageKeys } from '@/lib/storage';
import { ECOSYSTEM, FEATURES, LORE, PRINCIPLES, YEARS } from './content';
import { Ambient, decode, stopDecode } from './fx/audio';
import { mountSphere, mountStars } from './fx/canvas';
import { astrolabeMarkup, orbitsMarkup, portraitMarkup } from './fx/markup';

const Arrow = ({ width }: { width?: number }) => (
  <svg viewBox="0 0 12 12" width={width} aria-hidden="true">
    <path d="M2 10 L10 2 M3.5 2 H10 V8.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const StarGlyph = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg className={className} style={style} viewBox="-50 -50 100 100" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M0 -48 L6 -6 L48 0 L6 6 L0 48 L-6 6 L-48 0 L-6 -6Z" />
      <path d="M0 -26 L3 -3 L26 0 L3 3 L0 26 L-3 3 L-26 0 L-3 -3Z" transform="rotate(45)" />
      <circle r="9" />
      <circle r="2.5" fill="currentColor" />
    </g>
    <text x="0" y="-38" fontSize="7" fill="currentColor" textAnchor="middle" fontFamily="var(--f-m)" dx="9">N</text>
  </svg>
);

export function Landing() {
  return (
    <QueryProvider>
      <LandingInner />
    </QueryProvider>
  );
}

function Hud() {
  const { ranking, loading } = useRanking();
  const pick = ranking.pick;
  return (
    <div className="hud" aria-hidden="true">
      <div className="n">001</div>
      <div className="t">
        VATE Pick
        <br />
        <span>
          {pick ? (
            <>
              {pick.market.name} · <b>{pick.market.apy?.toFixed(2)}% APY</b>
            </>
          ) : loading ? (
            'scanning vaults…'
          ) : (
            'open the app →'
          )}
        </span>
      </div>
    </div>
  );
}

function LandingInner() {
  const root = useRef<HTMLDivElement>(null);
  const ambient = useRef<Ambient | null>(null);
  const lenisRef = useRef<Lenis | null>(null);
  const api = useRef<{ enter: () => void; next: () => void } | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const [activeFeat, setActiveFeat] = useState(0);
  const [openEco, setOpenEco] = useState<number | null>(null);
  const [activeNav, setActiveNav] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const [principle, setPrinciple] = useState(0);

  const astro = useMemo(() => ({ __html: astrolabeMarkup() }), []);
  const orbits = useMemo(() => ({ __html: orbitsMarkup() }), []);
  const portraits = useMemo(() => PRINCIPLES.map((p, i) => ({ __html: portraitMarkup(p.numeral, i) })), []);

  const tick = useCallback(() => ambient.current?.tick(), []);

  const toggleSound = useCallback(() => {
    const a = ambient.current;
    if (!a) return;
    const on = a.set(!a.on);
    setSoundOn(on);
    if (on) kv.set(storageKeys.sound, '1');
    else kv.remove(storageKeys.sound);
  }, []);

  const scrollTo = useCallback(
    (id: string) => (e: ReactMouseEvent) => {
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      tick();
      if (lenisRef.current) lenisRef.current.scrollTo(target, { offset: 0, duration: 1.6 });
      else target.scrollIntoView();
    },
    [tick],
  );

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const one = <T extends Element>(s: string) => el.querySelector<T>(s);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobile = () => window.innerWidth <= 960;
    gsap.registerPlugin(ScrollTrigger);
    const cleanups: (() => void)[] = [];
    const sound = new Ambient();
    ambient.current = sound;

    // A sound preference saved earlier is honoured on the first gesture (browsers require one).
    if (kv.get(storageKeys.sound) === '1') {
      const resume = () => {
        window.removeEventListener('pointerdown', resume);
        window.removeEventListener('keydown', resume);
        if (!sound.on) setSoundOn(sound.set(true));
      };
      window.addEventListener('pointerdown', resume);
      window.addEventListener('keydown', resume);
      cleanups.push(() => {
        window.removeEventListener('pointerdown', resume);
        window.removeEventListener('keydown', resume);
      });
    }

    const stars = one<HTMLCanvasElement>('canvas.stars');
    const sphere = one<HTMLCanvasElement>('canvas.sphere');
    if (stars) cleanups.push(mountStars(stars, reduce));
    if (sphere) cleanups.push(mountSphere(sphere, reduce));

    // ---- smooth scrolling (skipped when motion is reduced) --------------------------------
    let lenis: Lenis | null = null;
    if (!reduce) {
      lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      const raf = (t: number) => lenis?.raf(t * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);
      const instance = lenis;
      cleanups.push(() => {
        gsap.ticker.remove(raf);
        instance.destroy();
      });
    }
    lenisRef.current = lenis;

    // ---- year ruler follows scroll progress ---------------------------------------------
    const track = one<HTMLElement>('.ruler-track');
    const ticks = [...el.querySelectorAll<HTMLElement>('.tick')];
    let lastIdx = -1;
    let rulerRaf = 0;
    const updateRuler = () => {
      rulerRaf = 0;
      const limit = document.documentElement.scrollHeight - window.innerHeight;
      const idx = (limit > 0 ? Math.min(1, Math.max(0, window.scrollY / limit)) : 0) * (YEARS.length - 1);
      if (track) track.style.transform = `translateY(${-idx * 52}px)`;
      const r = Math.round(idx);
      if (r !== lastIdx) {
        ticks[lastIdx]?.classList.remove('on');
        ticks[r]?.classList.add('on');
        lastIdx = r;
      }
    };
    const onScroll = () => {
      if (!rulerRaf) rulerRaf = requestAnimationFrame(updateRuler);
    };
    updateRuler();
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanups.push(() => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rulerRaf);
    });

    // ---- marginalia decode on hover -------------------------------------------------------
    const lore = [...el.querySelectorAll<HTMLElement>('[data-decode]')];
    if (!reduce) {
      for (const p of lore) {
        const onEnter = () => decode(p);
        p.addEventListener('mouseenter', onEnter);
        cleanups.push(() => {
          p.removeEventListener('mouseenter', onEnter);
          stopDecode(p);
        });
      }
    }

    // ---- custom cursor (fine pointers only) -----------------------------------------------
    const cur = one<HTMLElement>('.cursor');
    const dot = one<HTMLElement>('.cursor-dot');
    if (cur && dot && !reduce && window.matchMedia('(pointer:fine)').matches) {
      let x = window.innerWidth / 2;
      let y = window.innerHeight / 2;
      let cx = x;
      let cy = y;
      const move = (e: MouseEvent) => {
        x = e.clientX;
        y = e.clientY;
        dot.style.transform = `translate(${x}px,${y}px)`;
        cur.classList.add('live');
        dot.classList.add('live');
      };
      const follow = () => {
        cx += (x - cx) * 0.16;
        cy += (y - cy) * 0.16;
        cur.style.transform = `translate(${cx}px,${cy}px)`;
      };
      const over = (e: Event) => {
        cur.classList.toggle('hover', !!(e.target as Element | null)?.closest?.('a,button,[data-hover],.feat'));
      };
      window.addEventListener('mousemove', move);
      document.addEventListener('mouseover', over);
      gsap.ticker.add(follow);
      cleanups.push(() => {
        window.removeEventListener('mousemove', move);
        document.removeEventListener('mouseover', over);
        gsap.ticker.remove(follow);
      });
    }

    // ---- principle deck ------------------------------------------------------------------
    const cards = [...el.querySelectorAll<HTMLElement>('.pcard')];
    let order = cards.map((_, i) => i);
    let deckBusy = false;

    const ctx = gsap.context(() => {
      const layoutDeck = (animate: boolean) => {
        order.forEach((ci, pos) => {
          gsap.to(cards[ci] as HTMLElement, {
            x: pos * 26,
            y: pos * 26,
            scale: 1 - pos * 0.07,
            opacity: pos > 2 ? 0 : 1 - pos * 0.3,
            rotation: 0,
            zIndex: 10 - pos,
            duration: animate && !reduce ? 0.7 : 0,
            ease: 'expo.out',
          });
        });
        setPrinciple(order[0] ?? 0);
        if (animate && !reduce) {
          gsap.fromTo(q('.team-info > *:not(.team-ctrl)'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.06, ease: 'power3.out' });
        }
      };
      layoutDeck(false);
      const next = () => {
        if (deckBusy || cards.length === 0) return;
        sound.tick();
        const advance = () => {
          order = [...order.slice(1), order[0] as number];
          ctx.add(() => layoutDeck(true));
          deckBusy = false;
        };
        if (reduce) return advance();
        deckBusy = true;
        ctx.add(() => {
          gsap.to(cards[order[0] as number] as HTMLElement, { x: -260, y: -30, rotation: -14, opacity: 0, duration: 0.45, ease: 'power2.in', onComplete: advance });
        });
      };

      // ---- intro ---------------------------------------------------------------------------
      const intro = one<HTMLElement>('.intro');
      let entered = false;
      const finishIntro = () => {
        document.documentElement.classList.remove('lp-locked');
        setIntroDone(true);
        lenis?.start();
        ScrollTrigger.refresh();
      };
      const enter = () => {
        if (entered) return;
        entered = true;
        if (reduce || !intro) {
          gsap.set(q('.ruler, .hud'), { opacity: 1 });
          finishIntro();
          return;
        }
        ctx.add(() => {
          gsap
            .timeline({ defaults: { ease: 'expo.out' } })
            .to(q('.intro-inner'), { scale: 2.6, opacity: 0, duration: 1.4, ease: 'power3.in' })
            .to(intro, { opacity: 0, duration: 0.6, onComplete: finishIntro }, '-=.5')
            .from(q('.nav'), { y: -30, opacity: 0, duration: 1.2 }, '-=.2')
            .from(q('.hero-title .line > span'), { yPercent: 115, duration: 1.4, stagger: 0.14 }, '<')
            .from(q('.hero p.sub'), { y: 20, opacity: 0, duration: 1.2 }, '-=1')
            .from(q('.hero-ca'), { y: 16, opacity: 0, duration: 1.1 }, '-=.9')
            .from(q('canvas.sphere'), { opacity: 0, scale: 0.9, duration: 2 }, '<')
            .to(q('.ruler, .hud'), { opacity: 1, duration: 1 }, '-=1.2')
            .add(() => {
              el.querySelectorAll<HTMLElement>('.hero [data-decode]').forEach(decode);
            }, '-=1.4');
        });
      };
      api.current = { enter, next };

      // No intro when motion is reduced, or when the CSS failsafe already dismissed it because
      // scripts arrived late: go straight to the content.
      if (reduce || !intro || window.getComputedStyle(intro).visibility === 'hidden') {
        entered = true;
        gsap.set(q('.ruler, .hud'), { opacity: 1 });
        finishIntro();
      } else {
        document.documentElement.classList.add('lp-locked');
        lenis?.stop();
        window.scrollTo(0, 0);
        const strokes = q('.intro .astro circle, .intro .astro line, .intro .astro path') as unknown as SVGElement[];
        strokes.forEach((s) => {
          s.setAttribute('pathLength', '1');
          s.style.strokeDasharray = '1';
          s.style.strokeDashoffset = '1';
        });
        gsap.set(q('.intro .astro text'), { opacity: 0 });
        intro.classList.add('live'); // cancels the CSS failsafe: scripts are in charge now
        const counter = { v: 0 };
        const count = one<HTMLElement>('.intro-count');
        gsap
          .timeline()
          .to(strokes, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut', stagger: { amount: 1.6, from: 'random' } }, 0)
          .to(q('.intro .astro text'), { opacity: 0.7, duration: 0.6, stagger: 0.04 }, 1.6)
          .to(counter, { v: 100, duration: 2.8, ease: 'power1.inOut', onUpdate: () => { if (count) count.textContent = String(Math.round(counter.v)).padStart(3, '0'); } }, 0)
          .to(q('.intro .a-rete'), { rotation: 120, svgOrigin: '0 0', duration: 3, ease: 'power2.out' }, 0.4)
          .add(() => one('.intro-enter')?.classList.add('show'), 2.9);
      }

      // ---- nav + feature activation (state only: works with reduced motion too) -------------
      (['home', 'features', 'ecosystem'] as const).forEach((id, i) => {
        ScrollTrigger.create({ trigger: `#${id}`, start: 'top 50%', end: 'bottom 50%', onToggle: (s) => { if (s.isActive) setActiveNav(i); } });
      });
      q('.feat').forEach((f, i) => {
        ScrollTrigger.create({ trigger: f, start: 'top 62%', end: 'bottom 62%', onToggle: (s) => { if (s.isActive) { setActiveFeat(i); sound.tick(); } } });
      });
      ScrollTrigger.create({
        trigger: '.lp-footer',
        start: 'top 75%',
        onToggle: (s) => { if (entered) gsap.to(q('.ruler, .hud'), { opacity: s.isActive ? 0 : 1, duration: 0.4, overwrite: 'auto' }); },
      });

      if (reduce) return;

      // ---- scroll-linked motion -------------------------------------------------------------
      gsap.to(q('.hero-copy'), { yPercent: -30, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
      gsap.to(q('canvas.sphere'), { yPercent: 18, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
      q('[data-reveal]').forEach((h) => {
        gsap.from(h.querySelectorAll('.line > span'), { yPercent: 110, duration: 1.2, ease: 'expo.out', stagger: 0.1, scrollTrigger: { trigger: h, start: 'top 82%' } });
      });
      q('[data-reveal-line]').forEach((l) => {
        gsap.from(l.firstElementChild, { yPercent: 110, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: l, start: 'top 85%' } });
      });
      q('[data-reveal-p], .core-copy p').forEach((p) => {
        gsap.from(p, { y: 30, opacity: 0, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: p, start: 'top 88%' } });
      });
      lore.filter((p) => !p.closest('.hero')).forEach((p) => {
        ScrollTrigger.create({ trigger: p, start: 'top 85%', once: true, onEnter: () => decode(p) });
      });
      gsap.fromTo(q('.simplicity > span'), { xPercent: 40 }, { xPercent: -4, ease: 'none', scrollTrigger: { trigger: '.auto', start: 'top bottom', end: 'center center', scrub: 1 } });
      gsap.fromTo(q('.your-yield > span'), { xPercent: 35 }, { xPercent: 0, ease: 'none', scrollTrigger: { trigger: '.partners', start: 'top bottom', end: 'top 45%', scrub: 1 } });
      gsap.from(q('.orbits'), { scale: 0.7, opacity: 0, rotation: -40, ease: 'none', scrollTrigger: { trigger: '.auto', start: 'top bottom', end: 'center center', scrub: 1 } });
      gsap.to(q('.core .a-rete'), { rotation: 220, svgOrigin: '0 0', ease: 'none', scrollTrigger: { trigger: '.core', start: 'top bottom', end: 'bottom top', scrub: 1 } });
      gsap.to(q('.core .a-rule'), { rotation: -140, svgOrigin: '0 0', ease: 'none', scrollTrigger: { trigger: '.core', start: 'top bottom', end: 'bottom top', scrub: 1 } });
      gsap.from(q('.core .astro-wrap'), { yPercent: 20, rotation: -20, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.core', start: 'top bottom', end: 'top 20%', scrub: 1 } });
      gsap.from(q('.deck'), { x: 120, opacity: 0, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: '.deck', start: 'top 85%' } });
      gsap.from(q('.wordmark'), { yPercent: 40, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.lp-footer', start: 'top bottom', end: 'bottom bottom', scrub: 1 } });
      q('.gridpatch').forEach((g) => {
        gsap.to(g, { yPercent: -40, ease: 'none', scrollTrigger: { trigger: g.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
      });

      // Rays from a vanishing point to the astrolabe rim, drawn with scroll.
      const raySvg = one<SVGSVGElement>('svg.rays');
      const core = one<HTMLElement>('.core');
      const wrap = one<HTMLElement>('.core .astro-wrap');
      let rays: { l: SVGLineElement; ox: number; oy: number; tx: number; ty: number }[] = [];
      const setRays = (p: number) => {
        rays.forEach((r, i) => {
          const k = gsap.utils.clamp(0, 1, p * 1.6 - i * 0.03);
          r.l.setAttribute('x2', String(r.ox + (r.tx - r.ox) * k));
          r.l.setAttribute('y2', String(r.oy + (r.ty - r.oy) * k));
          r.l.style.opacity = String(0.2 + k * 0.5);
        });
      };
      const rayTrigger = ScrollTrigger.create({ trigger: '.core', start: 'top 70%', end: 'center center', scrub: 1, onUpdate: (s) => setRays(s.progress) });
      const buildRays = () => {
        if (!raySvg || !core || !wrap) return;
        const sec = core.getBoundingClientRect();
        const a = wrap.getBoundingClientRect();
        raySvg.setAttribute('viewBox', `0 0 ${sec.width} ${sec.height}`);
        raySvg.replaceChildren();
        rays = [];
        if (isMobile()) return;
        const ox = sec.width * 0.04;
        const oy = a.top - sec.top + a.height * 0.3;
        const acx = a.left - sec.left + a.width / 2;
        const acy = a.top - sec.top + a.height / 2;
        const ar = a.width * 0.43;
        const NS = 'http://www.w3.org/2000/svg';
        for (let i = 0; i < 14; i++) {
          const ang = Math.PI * (0.55 + (i / 13) * 0.9);
          const l = document.createElementNS(NS, 'line');
          for (const k of ['x1', 'x2']) l.setAttribute(k, String(ox));
          for (const k of ['y1', 'y2']) l.setAttribute(k, String(oy));
          raySvg.appendChild(l);
          rays.push({ l, ox, oy, tx: acx + Math.cos(ang) * ar, ty: acy + Math.sin(ang) * ar });
        }
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', String(ox));
        c.setAttribute('cy', String(oy));
        c.setAttribute('r', '3');
        c.setAttribute('fill', '#087F75');
        raySvg.appendChild(c);
        setRays(rayTrigger.progress);
      };
      ScrollTrigger.addEventListener('refresh', buildRays);
      cleanups.push(() => ScrollTrigger.removeEventListener('refresh', buildRays));
      buildRays();
    }, el);

    const onResize = () => ScrollTrigger.refresh();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      api.current = null;
      ctx.revert();
      cleanups.forEach((fn) => fn());
      sound.dispose();
      ambient.current = null;
      lenisRef.current = null;
      document.documentElement.classList.remove('lp-locked');
    };
  }, []);

  const p = PRINCIPLES[principle] ?? PRINCIPLES[0]!;

  return (
    <div className="lp" ref={root}>
      <div className="bg-glow" />
      <canvas className="stars" aria-hidden="true" />
      <div className="grain" />
      <div className="vignette" />
      <div className="cursor" aria-hidden="true" />
      <div className="cursor-dot" aria-hidden="true" />

      {introDone ? null : (
        <div
          className="intro"
          role="button"
          tabIndex={0}
          aria-label="Enter VATE"
          onClick={() => api.current?.enter()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
              e.preventDefault();
              api.current?.enter();
            }
          }}
        >
          <StarGlyph className="intro-corner" />
          <div className="intro-inner">
            <svg className="intro-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="49" pathLength={600} /></svg>
            <svg className="astro" viewBox="-240 -262 480 500" aria-hidden="true" dangerouslySetInnerHTML={astro} />
            <div className="intro-count" aria-hidden="true">000</div>
            <div className="intro-enter">CLICK TO ENTER</div>
          </div>
        </div>
      )}

      <header className="nav">
        <a className="logo" href="#home" onClick={scrollTo('home')} aria-label="VATE home"><Mark /></a>
        <nav className="links" aria-label="Main">
          <a href="#home" className={activeNav === 0 ? 'active' : undefined} onClick={scrollTo('home')} onMouseEnter={tick}>Home</a>
          <a href="#features" className={activeNav === 1 ? 'active' : undefined} onClick={scrollTo('features')} onMouseEnter={tick}>Features</a>
          <a href="#ecosystem" className={activeNav === 2 ? 'active' : undefined} onClick={scrollTo('ecosystem')} onMouseEnter={tick}>Ecosystem</a>
          <Link href="/docs" onMouseEnter={tick}>Docs</Link>
        </nav>
        <div className="nav-r">
          <button className="sound" type="button" aria-pressed={soundOn} aria-label="Ambient sound" title={soundOn ? 'Turn ambient sound off' : 'Turn ambient sound on'} onClick={toggleSound}>
            <span /><span /><span /><span /><span />
          </button>
          <Link className="launch" href="/app" onMouseEnter={tick}>Launch App <Arrow /></Link>
        </div>
      </header>

      <aside className="ruler" aria-hidden="true">
        <div className="ruler-track">
          {YEARS.map((y) => <div className="tick" key={y}><span>{y} AD</span></div>)}
        </div>
        <span className="ruler-ptr" />
      </aside>

      <main>
        <section className="hero" id="home">
          <canvas className="sphere" aria-hidden="true" />
          <div className="gridpatch" style={{ left: '26%', top: '30%', width: 520, height: 420 }} />
          <p className="lore" lang="la" aria-hidden="true" data-decode style={{ left: 'calc(var(--gut) + 70px)', top: '16vh' }}>{LORE.heroLeft}</p>
          <p className="lore" lang="la" aria-hidden="true" data-decode style={{ right: 'var(--gut)', top: '46vh', textAlign: 'right' }}>{LORE.heroRight}</p>
          <div className="wrap hero-copy">
            <h1 className="big hero-title">
              <span className="line outline"><span>Charting the course</span></span>
              <span className="line"><span className="solid">of USDG yield</span></span>
            </h1>
            <p className="sub">
              Put your USDG in orbit on Robinhood Chain. <em>VATE Ranking</em> scores curated vaults by live yield, depth and
              withdrawable liquidity, and shows its working. You choose, you sign, and you earn straight from your own wallet.
            </p>
            <TokenChip className="hero-ca" />
          </div>
          <div className="scrollhint label" aria-hidden="true"><i />Scroll</div>
        </section>

        <section className="core" id="core">
          <svg className="rays" aria-hidden="true" />
          <div className="gridpatch" style={{ left: '20%', top: 0, width: 600, height: 480 }} />
          <div className="astro-wrap"><svg className="astro" viewBox="-240 -262 480 500" aria-hidden="true" dangerouslySetInnerHTML={astro} /></div>
          <div className="wrap">
            <h2 className="big core-h" data-reveal>
              <span className="line outline"><span>Core logic of</span></span>
              <span className="line"><span className="solid">VATE</span></span>
            </h2>
            <div className="core-copy">
              <p>
                VATE Ranking takes the guesswork out of comparing vaults. Instead of chasing headline APYs, it weighs each vault’s
                yield against how much is deposited and how much could be withdrawn today, then highlights the best fit, with the
                formula in plain sight.
              </p>
              <p className="serif">VATE is non-custodial by design: your funds never pass through us, and only you can move them.</p>
            </div>
          </div>
        </section>

        <section className="auto" id="auto">
          <div className="gridpatch" style={{ left: '30%', top: '36vh', width: 640, height: 520 }} />
          <StarGlyph className="star" style={{ right: '8vw', top: '14vh' }} />
          <svg className="orbits" viewBox="0 0 560 560" aria-hidden="true" dangerouslySetInnerHTML={orbits} />
          <div className="wrap">
            <h2 className="big">
              <span className="line outline" data-reveal-line><span>Automation and</span></span>
              <span className="line l2 simplicity"><span className="solid serif">Simplicity</span></span>
            </h2>
            <p className="note serif" data-reveal-p>
              VATE Ranking has one job: do the comparing for you, around the clock. The deciding, and every signature, stay yours.
            </p>
            <p className="lore" lang="la" aria-hidden="true" data-decode>{LORE.auto}</p>
          </div>
        </section>

        <section className="features" id="features">
          <div className="wrap">
            <div className="label" style={{ marginBottom: 26 }}>What VATE does</div>
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`feat${activeFeat === i ? ' active' : ''}`}
                tabIndex={0}
                onMouseEnter={() => setActiveFeat(i)}
                onFocus={() => setActiveFeat(i)}
                onClick={() => setActiveFeat(i)}
              >
                <span className="dot" />
                <span className="num">{String(i + 1).padStart(2, '0')} / {String(FEATURES.length).padStart(2, '0')}</span>
                <h3>{f.title}</h3>
                <div className="body"><div><p>{f.body}</p></div></div>
                <span className="bar" />
              </div>
            ))}
          </div>
        </section>

        <section className="partners" id="ecosystem">
          <div className="wrap">
            <h2 className="big">
              <span className="line outline" data-reveal-line><span>Your wallet,</span></span>
              <span className="line l2 your-yield"><span className="solid">your yield</span></span>
            </h2>
            <div className="plist">
              <div className="label">Built on &amp; works with</div>
              {ECOSYSTEM.map((item, i) => (
                <button
                  key={item.name}
                  type="button"
                  className="p-item"
                  data-hover=""
                  aria-expanded={openEco === i}
                  onClick={() => { setOpenEco(openEco === i ? null : i); tick(); }}
                  onMouseEnter={tick}
                >
                  <span className="top">{item.name}<Arrow /></span>
                  <span className="desc"><span><span>{item.body}</span></span></span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="team" id="principles">
          <div className="gridpatch" style={{ right: '6%', top: '30%', width: 640, height: 520 }} />
          <div className="wrap">
            <h2 className="big" data-reveal>
              <span className="line outline"><span>Meet</span></span>
              <span className="line outline"><span>the core</span></span>
              <span className="line"><span className="solid">principles</span></span>
            </h2>
            <div className="team-grid">
              <div className="team-info" aria-live="polite">
                <div className="name">{p.name}</div>
                <div className="role label">{p.role}</div>
                <p>{p.body}</p>
                <div className="team-ctrl">
                  <button type="button" onClick={() => api.current?.next()}>Next <Arrow width={12} /></button>
                  <span className="label">{String(principle + 1).padStart(2, '0')} / {String(PRINCIPLES.length).padStart(2, '0')}</span>
                </div>
              </div>
              <div className="deck" onClick={() => api.current?.next()} aria-hidden="true">
                {PRINCIPLES.map((item, i) => (
                  <div className="pcard" data-hover="" key={item.name}>
                    <svg viewBox="0 0 330 412" dangerouslySetInnerHTML={portraits[i]} />
                    <span className="tag">PRINCIPLE {String(i + 1).padStart(2, '0')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="fgrid">
          <div>
            Curated USDG yield on Robinhood Chain: ranked in the open, non-custodial, and always in your control.
            <br />
            <TokenChip />
          </div>
          <div className="c">VATE {SITE.year}</div>
          <div className="soc">
            {SITE.xUrl ? (
              <a href={SITE.xUrl} target="_blank" rel="noopener noreferrer">X / Twitter ↗</a>
            ) : (
              <span>Official social accounts have not been announced yet.</span>
            )}
          </div>
          <div className="flinks">
            <a href="#home" onClick={scrollTo('home')}>Home</a>
            <a href="#features" onClick={scrollTo('features')}>Features</a>
            <Link href="/privacy">Privacy Policy</Link>
          </div>
          <div className="c"><div className="orb" /></div>
          <div className="flinks r">
            <div>
              <Link href="/docs">Docs</Link>
              <Link href="/app">Launch App</Link>
              <Link href="/terms">Terms &amp; Conditions</Link>
            </div>
            <span className="label">© {SITE.year}</span>
          </div>
        </div>
        <div className="wordmark" aria-hidden="true">VATE</div>
      </footer>

      <Hud />
    </div>
  );
}
