/**
 * Conversión de color para el selector del visor (rueda HSV ↔ hex).
 * Puro, sin dependencias — usado por el selector de colores del modelo
 * (paredes/pisos) y testeable de forma aislada.
 */

export interface Hsv {
  /** Matiz en grados [0, 360). */
  h: number;
  /** Saturación [0, 1]. */
  s: number;
  /** Valor / brillo [0, 1]. */
  v: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Normaliza una entrada a `#rrggbb` en minúsculas, o `null` si no es un hex válido. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toLowerCase()}`;
  }
  return null;
}

/** hex `#rrggbb` → HSV. Entradas inválidas caen a negro. */
export function hexToHsv(hex: string): Hsv {
  const norm = normalizeHex(hex) ?? "#000000";
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

/** HSV → hex `#rrggbb`. */
export function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp01(s);
  const vv = clamp01(v);

  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Posición de un color en la rueda (disco hue-saturación), normalizada a [-1, 1]
 * respecto del centro. Ángulo medido en sentido horario desde arriba (matiz 0 =
 * arriba), radio = saturación. Coincide con el `conic-gradient(from 0deg)` del CSS.
 */
export function hsvToWheelXY(h: number, s: number): { x: number; y: number } {
  const theta = (((h % 360) + 360) % 360) * (Math.PI / 180);
  const r = clamp01(s);
  return { x: r * Math.sin(theta), y: -r * Math.cos(theta) };
}

/**
 * Inverso de `hsvToWheelXY`: de una posición normalizada [-1,1] al par
 * (matiz, saturación). El radio se clampa a 1 (borde del disco).
 */
export function wheelXYToHs(x: number, y: number): { h: number; s: number } {
  const r = Math.min(1, Math.hypot(x, y));
  let theta = Math.atan2(x, -y) * (180 / Math.PI);
  if (theta < 0) theta += 360;
  return { h: theta, s: r };
}
