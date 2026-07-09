/**
 * Registro central de atajos de teclado.
 *
 * Al agregar un atajo nuevo en la app, añadilo acá para que aparezca
 * automáticamente en Configuración → Atajos de teclado.
 */

/** Una combinación de teclas, p. ej. ["Ctrl", "Z"]. */
export type KeyCombo = string[];

export interface KeyboardShortcutDef {
  id: string;
  label: string;
  detail?: string;
  /** Una o más combinaciones equivalentes (se muestran unidas con "o"). */
  combos: KeyCombo[];
}

export interface KeyboardShortcutSection {
  id: string;
  title: string;
  description?: string;
  shortcuts: KeyboardShortcutDef[];
}

/** Atajos globales de la pantalla de revisión del modelo 3D. */
export const REVIEW_KEYBOARD_SHORTCUTS: KeyboardShortcutSection[] = [
  {
    id: "general",
    title: "General",
    description: "Disponibles en la pantalla de revisión, salvo que estés escribiendo en un campo de texto.",
    shortcuts: [
      {
        id: "undo",
        label: "Deshacer",
        combos: [
          ["Ctrl", "Z"],
          ["⌘", "Z"],
        ],
      },
      {
        id: "redo",
        label: "Rehacer",
        combos: [
          ["Ctrl", "Y"],
          ["⌘", "Y"],
          ["Ctrl", "Shift", "Z"],
          ["⌘", "Shift", "Z"],
        ],
      },
      {
        id: "escape",
        label: "Salir de herramientas y limpiar selección",
        detail: "También cierra el menú contextual.",
        combos: [["Esc"]],
      },
    ],
  },
  {
    id: "tools",
    title: "Herramientas del visor",
    description: "Atajos para cambiar entre modos de trabajo en el visor 3D.",
    shortcuts: [
      {
        id: "cursor",
        label: "Cursor / selección",
        detail: "Desactiva cortes, medición y selección por caja.",
        combos: [["V"]],
      },
      {
        id: "frame",
        label: "Encuadrar la vista",
        detail: "Ajusta la cámara a la selección (o a todo el modelo si no hay selección).",
        combos: [["Z"]],
      },
      {
        id: "walk-move",
        label: "Caminar / volar (mientras el modo está activo)",
        detail: "WASD o flechas para moverte; Espacio/E sube, Shift/Q baja; Esc sale.",
        combos: [["W"], ["A"], ["S"], ["D"]],
      },
      {
        id: "box-select",
        label: "Selección por caja",
        combos: [["S"]],
      },
      {
        id: "cut-tool",
        label: "Herramienta de corte",
        detail: "Si ya está activa, cambia la forma (rectángulo, óvalo, línea).",
        combos: [["C"]],
      },
      {
        id: "measure-tool",
        label: "Herramienta de medición",
        detail: "Activa o desactiva medir distancias y áreas.",
        combos: [["M"]],
      },
      {
        id: "mark-line-tool",
        label: "Marcar con líneas rojas (grabar)",
        detail: "Si ya está activa, alterna entre trazo recto y libre. Supr borra la última.",
        combos: [["R"]],
      },
      {
        id: "merge",
        label: "Fusionar componentes seleccionados",
        detail: "Solo cuando hay más de un componente seleccionado y se pueden fusionar.",
        combos: [["F"]],
      },
      {
        id: "split",
        label: "Dividir fusión",
        detail: "Solo cuando el componente seleccionado es una fusión.",
        combos: [["D"]],
      },
    ],
  },
  {
    id: "cuts",
    title: "Cortes",
    description: "Mientras la herramienta de corte está activa.",
    shortcuts: [
      {
        id: "cut-shift",
        label: "Restricción al dibujar",
        detail: "Rectángulo cuadrado u óvalo circular, según la forma activa.",
        combos: [["Shift", "arrastrar"]],
      },
      {
        id: "cut-alt",
        label: "Desactivar bordes pegajosos",
        detail: "Mientras mantenés Alt, el imán a bordes no aplica.",
        combos: [["Alt", "mantener"]],
      },
    ],
  },
  {
    id: "measure",
    title: "Medición",
    description: "Mientras la herramienta de medición está activa.",
    shortcuts: [
      {
        id: "measure-delete",
        label: "Borrar última medida",
        combos: [["Supr"], ["Backspace"]],
      },
      {
        id: "measure-shift",
        label: "Restricción al dibujar",
        detail: "Línea ortogonal o rectángulo cuadrado.",
        combos: [["Shift", "arrastrar"]],
      },
      {
        id: "measure-alt",
        label: "Desactivar bordes pegajosos",
        detail: "Mientras mantenés Alt, el imán a bordes no aplica.",
        combos: [["Alt", "mantener"]],
      },
    ],
  },
];

/** Todas las secciones de atajos expuestas en Configuración. */
export const KEYBOARD_SHORTCUT_SECTIONS: KeyboardShortcutSection[] = [
  ...REVIEW_KEYBOARD_SHORTCUTS,
];
