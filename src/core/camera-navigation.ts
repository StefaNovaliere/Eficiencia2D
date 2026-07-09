import { MOUSE, TOUCH } from "three";

/** Estilos de navegación de cámara disponibles en el visor 3D. */
export type CameraNavigationStyle =
  | "blender"
  | "cad"
  | "touchpad"
  | "tinkercad"
  | "revit";

export const CAMERA_NAVIGATION_STYLES: CameraNavigationStyle[] = [
  "blender",
  "cad",
  "touchpad",
  "tinkercad",
  "revit",
];

export const DEFAULT_CAMERA_NAVIGATION_STYLE: CameraNavigationStyle = "blender";

export const CAMERA_NAVIGATION_STORAGE_KEY = "e2d_camera_navigation";

/** Icono semántico para cada acción (mapeado a Lucide en la UI). */
export type NavigationCommandIcon =
  | "rotate"
  | "pan"
  | "zoom"
  | "mouse-middle"
  | "mouse-right"
  | "mouse-left"
  | "shift"
  | "pinch"
  | "touch";

export interface NavigationCommandHint {
  icon: NavigationCommandIcon;
  label: string;
}

export interface CameraNavigationConfig {
  mouseButtons: {
    LEFT: number | null;
    MIDDLE: number | null;
    RIGHT: number | null;
  };
  touches: {
    ONE: number;
    TWO: number;
  };
  minPolarAngle: number;
  maxPolarAngle: number;
  enableRotate: boolean;
  enablePan: boolean;
  enableZoom: boolean;
  screenSpacePanning: boolean;
}

export interface CameraNavigationPreset {
  id: CameraNavigationStyle;
  label: string;
  summary: string;
  commands: NavigationCommandHint[];
  config: CameraNavigationConfig;
}

/** Límites de órbita completa (sin restricción vertical). */
const FULL_ORBIT_POLAR = { minPolarAngle: 0.02, maxPolarAngle: Math.PI - 0.02 };

/** Revit: mantiene la maqueta sobre el horizonte (sin voltearla). */
const REVIT_POLAR = {
  minPolarAngle: 0.08,
  maxPolarAngle: Math.PI / 2 - 0.08,
};

/**
 * Diccionario de presets de navegación.
 *
 * OrbitControls intercambia acciones con Shift automáticamente:
 * - botón en ROTATE + Shift → paneo
 * - botón en PAN + Shift → órbita
 */
export const CAMERA_NAVIGATION_PRESETS: Record<
  CameraNavigationStyle,
  CameraNavigationPreset
> = {
  blender: {
    id: "blender",
    label: "Blender",
    summary: "Órbita con rueda · Paneo con Shift + rueda",
    commands: [
      { icon: "rotate", label: "Órbita — botón central del mouse" },
      { icon: "shift", label: "Paneo — Shift + botón central" },
      { icon: "zoom", label: "Zoom — rueda del mouse" },
      { icon: "mouse-left", label: "Selección — clic izquierdo (app)" },
    ],
    config: {
      mouseButtons: { LEFT: null, MIDDLE: MOUSE.ROTATE, RIGHT: null },
      touches: { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN },
      ...FULL_ORBIT_POLAR,
      enableRotate: true,
      enablePan: true,
      enableZoom: true,
      screenSpacePanning: true,
    },
  },

  cad: {
    id: "cad",
    label: "CAD",
    summary: "Paneo con rueda · Órbita con Shift + rueda o clic derecho",
    commands: [
      { icon: "pan", label: "Paneo — botón central del mouse" },
      { icon: "shift", label: "Órbita — Shift + botón central" },
      { icon: "rotate", label: "Órbita — clic derecho" },
      { icon: "zoom", label: "Zoom — rueda del mouse" },
      { icon: "mouse-left", label: "Selección — clic izquierdo (app)" },
    ],
    config: {
      mouseButtons: { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE },
      touches: { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE },
      ...FULL_ORBIT_POLAR,
      enableRotate: true,
      enablePan: true,
      enableZoom: true,
      screenSpacePanning: true,
    },
  },

  touchpad: {
    id: "touchpad",
    label: "Touchpad",
    summary: "Pellizco para zoom · Deslizar para orbitar/panear",
    commands: [
      { icon: "pinch", label: "Zoom — pellizco (pinch) con dos dedos" },
      { icon: "touch", label: "Órbita — un dedo / deslizar" },
      { icon: "touch", label: "Paneo — dos dedos (deslizar)" },
      { icon: "zoom", label: "Zoom — rueda / Ctrl + desplazamiento" },
      { icon: "mouse-left", label: "Selección — clic izquierdo (app)" },
    ],
    config: {
      mouseButtons: { LEFT: null, MIDDLE: null, RIGHT: null },
      touches: { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN },
      ...FULL_ORBIT_POLAR,
      enableRotate: true,
      enablePan: true,
      enableZoom: true,
      screenSpacePanning: true,
    },
  },

  tinkercad: {
    id: "tinkercad",
    label: "TinkerCAD",
    summary: "Órbita con clic derecho · Paneo con botón central",
    commands: [
      { icon: "rotate", label: "Órbita — clic derecho" },
      { icon: "pan", label: "Paneo — botón central del mouse" },
      { icon: "zoom", label: "Zoom — rueda del mouse" },
      { icon: "mouse-left", label: "Selección — clic izquierdo (app)" },
    ],
    config: {
      mouseButtons: { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE },
      touches: { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN },
      ...FULL_ORBIT_POLAR,
      enableRotate: true,
      enablePan: true,
      enableZoom: true,
      screenSpacePanning: true,
    },
  },

  revit: {
    id: "revit",
    label: "Revit",
    summary: "Paneo con rueda · Órbita con Shift + rueda · Sin voltear",
    commands: [
      { icon: "pan", label: "Paneo — botón central del mouse" },
      { icon: "shift", label: "Órbita — Shift + botón central" },
      { icon: "rotate", label: "Eje vertical bloqueado (sin ponerse de cabeza)" },
      { icon: "zoom", label: "Zoom — rueda del mouse" },
      { icon: "mouse-left", label: "Selección — clic izquierdo (app)" },
    ],
    config: {
      mouseButtons: { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: null },
      touches: { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN },
      ...REVIT_POLAR,
      enableRotate: true,
      enablePan: true,
      enableZoom: true,
      screenSpacePanning: true,
    },
  },
};

export function isCameraNavigationStyle(value: unknown): value is CameraNavigationStyle {
  return (
    typeof value === "string" &&
    (CAMERA_NAVIGATION_STYLES as string[]).includes(value)
  );
}

export function getStoredCameraNavigationStyle(): CameraNavigationStyle {
  if (typeof window === "undefined") return DEFAULT_CAMERA_NAVIGATION_STYLE;
  try {
    const raw = localStorage.getItem(CAMERA_NAVIGATION_STORAGE_KEY);
    return isCameraNavigationStyle(raw) ? raw : DEFAULT_CAMERA_NAVIGATION_STYLE;
  } catch {
    return DEFAULT_CAMERA_NAVIGATION_STYLE;
  }
}

/** Subconjunto de OrbitControls que mutamos al cambiar el preset. */
export interface OrbitControlsLike {
  mouseButtons: { LEFT: number | null; MIDDLE: number | null; RIGHT: number | null };
  touches: { ONE: number; TWO: number };
  minPolarAngle: number;
  maxPolarAngle: number;
  enableRotate: boolean;
  enablePan: boolean;
  enableZoom: boolean;
  screenSpacePanning: boolean;
}

/** Aplica un preset directamente al controlador de cámara (OrbitControls). */
export function applyCameraNavigationToControls(
  controls: OrbitControlsLike,
  style: CameraNavigationStyle,
): void {
  const { config } = CAMERA_NAVIGATION_PRESETS[style];
  controls.mouseButtons = { ...config.mouseButtons };
  controls.touches = { ...config.touches };
  controls.minPolarAngle = config.minPolarAngle;
  controls.maxPolarAngle = config.maxPolarAngle;
  controls.enableRotate = config.enableRotate;
  controls.enablePan = config.enablePan;
  controls.enableZoom = config.enableZoom;
  controls.screenSpacePanning = config.screenSpacePanning;
}
