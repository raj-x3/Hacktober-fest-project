import { useEffect, useSyncExternalStore, type RefObject } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';
const FINE_HOVER = '(hover: hover) and (pointer: fine)';

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (t: number): number => t * t * (3 - 2 * t);

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(REDUCED);
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/** Marks every [data-reveal] element under root with data-in the first time it scrolls into view. */
export function useReveal(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const items: HTMLElement[] = [...root.querySelectorAll<HTMLElement>('[data-reveal]')];
    if (!('IntersectionObserver' in window)) {
      for (const item of items) item.dataset.in = '1';
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.in = '1';
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    for (const item of items) observer.observe(item);
    return () => observer.disconnect();
  }, [rootRef]);
}

/** Fills a vertical line (scaleY) as its container scrolls through the viewport. */
export function useScrollLine(
  containerRef: RefObject<HTMLElement | null>,
  fillRef: RefObject<HTMLElement | null>,
  reduce: boolean,
): void {
  useEffect(() => {
    const container = containerRef.current;
    const fill = fillRef.current;
    if (!container || !fill) return;
    if (reduce) {
      fill.style.transform = 'scaleY(1)';
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = container.getBoundingClientRect();
      const progress = clamp01((window.innerHeight * 0.65 - rect.top) / rect.height);
      fill.style.transform = `scaleY(${progress})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [containerRef, fillRef, reduce]);
}

/** Small pointer tilt on [data-tilt] elements. Only for mouse-like pointers and when motion is allowed. */
export function useTilt(rootRef: RefObject<HTMLElement | null>, reduce: boolean): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduce || !window.matchMedia(FINE_HOVER).matches) return;
    let active: HTMLElement | null = null;
    const reset = (el: HTMLElement | null) => {
      if (el) el.style.transform = '';
    };
    const onMove = (event: PointerEvent) => {
      const el = (event.target as HTMLElement).closest<HTMLElement>('[data-tilt]');
      if (el !== active) {
        reset(active);
        active = el;
      }
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      el.style.transform = `perspective(900px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg)`;
    };
    const onLeave = () => {
      reset(active);
      active = null;
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    return () => {
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      reset(active);
    };
  }, [rootRef, reduce]);
}

/** Thin page-scroll progress bar. Writes scaleX directly; no layout reads inside the frame. */
export function useScrollProgress(barRef: RefObject<HTMLElement | null>, reduce: boolean): void {
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || reduce) return;
    let frame = 0;
    let last = -1;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const value = max > 0 ? clamp01(window.scrollY / max) : 0;
      if (Math.abs(value - last) < 0.0005) return;
      last = value;
      bar.style.transform = `scaleX(${value.toFixed(4)})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [barRef, reduce]);
}

/** Counts up to `to` once when scrolled into view. The final value is always in the accessible name. */
export function useCountUp(ref: RefObject<HTMLElement | null>, to: number, reduce: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const format = (n: number) => Math.round(n).toLocaleString('en-US');
    el.textContent = format(to);
    if (reduce || !('IntersectionObserver' in window)) return;
    el.textContent = '0';
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const duration = 900;
        const step = (now: number) => {
          const t = clamp01((now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 4);
          el.textContent = format(to * eased);
          if (t < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      el.textContent = format(to);
    };
  }, [ref, to, reduce]);
}

/** Critically damped spring toward a target. Returns [value, velocity]. */
export function damp(current: number, target: number, velocity: number, smoothTime: number, dt: number): [number, number] {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  return [target + (change + temp) * decay, (velocity - omega * temp) * decay];
}

/** A spider on a thread that drops when you scroll and eases back up. Writes transforms only, and only while moving. */
export function useSpider(
  threadRef: RefObject<HTMLElement | null>,
  spiderRef: RefObject<HTMLElement | null>,
  reduce: boolean,
): void {
  useEffect(() => {
    const thread = threadRef.current;
    const spider = spiderRef.current;
    if (!thread || !spider) return;
    const REST = 56;
    const write = (length: number) => {
      thread.style.transform = `scaleY(${(length / 100).toFixed(4)})`;
      spider.style.transform = `translate3d(-50%, ${length.toFixed(2)}px, 0)`;
    };
    write(REST);
    if (reduce) return;
    let length = REST;
    let velocity = 0;
    let target = REST;
    let lastY = window.scrollY;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      target = REST + (target - REST) * Math.exp(-dt * 3);
      [length, velocity] = damp(length, target, velocity, 0.28, dt);
      write(length);
      if (Math.abs(length - REST) > 0.3 || Math.abs(velocity) > 0.3) frame = requestAnimationFrame(tick);
      else {
        frame = 0;
        write(REST);
      }
    };
    const onScroll = () => {
      const dy = window.scrollY - lastY;
      lastY = window.scrollY;
      target = Math.min(200, Math.max(18, target + dy * 1.6));
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [threadRef, spiderRef, reduce]);
}
