"use client";

import { useMemo } from "react";

const SYMBOLS = [
  "½|a×b|",
  "n·p = d",
  "A = l×h",
  "∠90°",
  "1:100",
  "∑ aᵢ",
  "1:50",
  "△",
  "⊿",
  "⊥",
  "π",
  "∇f",
  "∫",
  "cos θ",
  "sin θ",
  "tan θ",
  "√2",
  "∥",
  "≈",
  "∠45°",
  "⌀ 20",
  "dx/dy",
  "ax + by + c",
  "x² + y²",
  "θ = 30°",
  "k · n",
  "h = 2.40 m",
  "1:25",
  "▲",
  "◢",
  "⬡",
  "Σ",
  "∮",
  "λ",
  "μ",
  "Δh",
  "r²",
  "📐",
  "📏",
  "Ω",
  "φ",
];

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Placed {
  symbol: string;
  left: number;
  top: number;
  size: number;
  rotation: number;
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
  opacity: number;
}

function buildPlacements(count: number): Placed[] {
  const rand = mulberry32(1337);
  const result: Placed[] = [];
  for (let i = 0; i < count; i++) {
    result.push({
      symbol: SYMBOLS[Math.floor(rand() * SYMBOLS.length)],
      left: rand() * 100,
      top: rand() * 100,
      size: 0.9 + rand() * 1.4,
      rotation: (rand() - 0.5) * 24,
      duration: 18 + rand() * 22,
      delay: -rand() * 30,
      driftX: (rand() - 0.5) * 80,
      driftY: -40 - rand() * 80,
      opacity: 0.05 + rand() * 0.05,
    });
  }
  return result;
}

export default function BackgroundSymbols() {
  const placements = useMemo(() => buildPlacements(48), []);

  return (
    <div className="bg-symbols" aria-hidden="true">
      {placements.map((p, i) => (
        <span
          key={i}
          className="bg-symbol"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            fontSize: `${p.size}rem`,
            opacity: p.opacity,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            ["--rot" as string]: `${p.rotation}deg`,
            ["--dx" as string]: `${p.driftX}px`,
            ["--dy" as string]: `${p.driftY}px`,
          }}
        >
          {p.symbol}
        </span>
      ))}
    </div>
  );
}
