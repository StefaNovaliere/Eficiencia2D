import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let refreshTimeout: number | null = null;
const sectionRevealRegistry = new Map<string, () => void>();

export function registerLandingSectionReveal(id: string, reveal: () => void): () => void {
  sectionRevealRegistry.set(id, reveal);
  return () => sectionRevealRegistry.delete(id);
}

function fireRevealForSnapTarget(scrollPos: number, sections: Element[]) {
  if (!sections.length) return;

  let closest = sections[0];
  let minDistance = Infinity;

  for (const section of sections) {
    const top = section.getBoundingClientRect().top + window.scrollY;
    const distance = Math.abs(top - scrollPos);
    if (distance < minDistance) {
      minDistance = distance;
      closest = section;
    }
  }

  sectionRevealRegistry.get(closest.id)?.();
}

export function scheduleLandingScrollRefresh(): () => void {
  if (typeof window === "undefined") return () => {};

  gsap.registerPlugin(ScrollTrigger);

  const run = () => {
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
  };

  if (refreshTimeout !== null) {
    window.clearTimeout(refreshTimeout);
  }

  refreshTimeout = window.setTimeout(run, 400);

  window.addEventListener("load", run);

  return () => {
    window.removeEventListener("load", run);
  };
}

export function whenLandingSectionsReady(ids: string[], callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  let cancelled = false;

  const run = () => {
    if (cancelled) return true;
    if (ids.every((id) => document.getElementById(id))) {
      callback();
      return true;
    }
    return false;
  };

  if (run()) return () => {
    cancelled = true;
  };

  const interval = window.setInterval(() => {
    if (run()) window.clearInterval(interval);
  }, 50);

  const timeout = window.setTimeout(() => window.clearInterval(interval), 5000);

  return () => {
    cancelled = true;
    window.clearInterval(interval);
    window.clearTimeout(timeout);
  };
}

/** Revela al entrar en pantalla (once, sin reverse). */
export function revealOnEnter(
  target: gsap.TweenTarget,
  from: gsap.TweenVars,
  to: gsap.TweenVars,
  options?: { trigger?: Element | null; start?: string },
): () => void {
  const trigger = options?.trigger ?? (target as Element);
  if (!trigger) return () => {};

  gsap.set(target, from);

  let played = false;
  const play = () => {
    if (played) return;
    played = true;
    gsap.to(target, { ...to, overwrite: "auto" });
  };

  const st = ScrollTrigger.create({
    trigger,
    start: options?.start ?? "top 82%",
    once: true,
    onEnter: play,
  });

  return () => st.kill();
}

/** Registra reveal por scroll + dispara también al aterrizar con snap magnético. */
export function revealOnSectionLand(
  section: Element,
  reveal: () => void,
  options?: { start?: string; landStart?: string },
): () => void {
  let played = false;
  const play = () => {
    if (played) return;
    played = true;
    reveal();
  };

  sectionRevealRegistry.set(section.id, play);

  const scrollSt = ScrollTrigger.create({
    trigger: section,
    start: options?.start ?? "top 85%",
    once: true,
    onEnter: play,
  });

  const landSt = ScrollTrigger.create({
    trigger: section,
    start: options?.landStart ?? "top 18%",
    once: true,
    onEnter: play,
  });

  return () => {
    sectionRevealRegistry.delete(section.id);
    scrollSt.kill();
    landSt.kill();
  };
}

/** Snap magnético al scrollear cerca del inicio de cada sección. */
export function setupLandingSectionSnap(sections: Element[]): () => void {
  if (!sections.length || typeof window === "undefined") return () => {};
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};

  gsap.registerPlugin(ScrollTrigger);

  let positions: number[] = [];

  const refreshPositions = () => {
    positions = sections
      .map((el) => Math.round(el.getBoundingClientRect().top + window.scrollY))
      .filter((value, index, array) => array.indexOf(value) === index);
  };

  refreshPositions();

  const magneticZone = () => window.innerHeight * 0.48;
  const zoneStart = () => Math.max(0, positions[0] - window.innerHeight * 0.65);
  const zoneEnd = () => (positions.at(-1) ?? 0) + window.innerHeight * 0.55;

  const snapTrigger = ScrollTrigger.create({
    start: 0,
    end: "max",
    onRefresh: refreshPositions,
    snap: {
      snapTo: (progress: number) => {
        if (!positions.length) return progress;
        
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        if (maxScroll <= 0) return progress;
        
        const scrollPos = progress * maxScroll;

        if (scrollPos < zoneStart() || scrollPos > zoneEnd()) return progress;

        const snapped = gsap.utils.snap(positions, scrollPos) as number;
        if (Math.abs(snapped - scrollPos) > magneticZone()) return progress;
        
        return snapped / maxScroll;
      },
      duration: { min: 0.35, max: 0.75 },
      delay: 0.03,
      ease: "power2.out",
      onComplete: (self) => {
        fireRevealForSnapTarget(self.scroll(), sections);
      },
    },
  });

  const refreshTimer = window.setTimeout(() => {
    refreshPositions();
    ScrollTrigger.refresh();
  }, 500);

  return () => {
    window.clearTimeout(refreshTimer);
    snapTrigger.kill();
  };
}

export function setupLandingTail(options: {
  snapSections: Element[];
  footer: HTMLElement | null;
  footerInner: HTMLElement | null;
}): () => void {
  const cleanups: Array<() => void> = [];

  cleanups.push(setupLandingSectionSnap(options.snapSections));

  if (options.footer && options.footerInner) {
    cleanups.push(
      revealOnEnter(
        options.footerInner,
        { y: 32, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.8, ease: "power2.out" },
        { trigger: options.footer, start: "top bottom" },
      ),
    );
  }

  ScrollTrigger.sort();
  ScrollTrigger.refresh();

  return () => cleanups.forEach((cleanup) => cleanup());
}
