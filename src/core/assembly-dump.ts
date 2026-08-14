// ============================================================================
// Volcado de diagnóstico del instructivo (`?dumpPieza=A4`).
//
// El instructivo dibuja cada pieza por una cadena de respaldos, y cada eslabón
// explica un síntoma distinto: la malla cruda da piezas más grandes que las que
// se cortan, la caja de respaldo las da rotadas. Mirando la pantalla los tres
// se parecen. Esto imprime, por pieza: de qué fuente salió, el marco crudo tal
// como llegó, los números finales, y las comprobaciones de coplanaridad, área y
// esquina — para poder cruzarlas contra el backend en una sola corrida.
//
// Es sólo lectura: no toca la geometría ni cambia lo que se ve.
// ============================================================================

import type { Vec3 } from "./types";
import type { AssemblySequencePiece, LiftSource } from "./assembly-sequence";
import type { NestingPlacement } from "./final-pieces";

/** Marco ortonormal de una pieza, como lo manda el backend. */
export interface Frame {
  origin: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
  normal: Vec3;
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** `world = origin + u·uAxis + v·vAxis` — la fórmula del contrato, sin más. */
export function liftUV(frame: Frame, u: number, v: number): Vec3 {
  return {
    x: frame.origin.x + u * frame.uAxis.x + v * frame.vAxis.x,
    y: frame.origin.y + u * frame.uAxis.y + v * frame.vAxis.y,
    z: frame.origin.z + u * frame.uAxis.z + v * frame.vAxis.z,
  };
}

export interface CoplanarityCheck {
  /** `dot(esquina, normal)` para las cuatro esquinas del marco. */
  dots: number[];
  /** Diferencia entre el mayor y el menor, en metros. */
  spreadM: number;
  ok: boolean;
}

/**
 * D.1 — las cuatro esquinas mapeadas con la fórmula del contrato tienen que
 * caer en el mismo plano. Si no dan iguales, el marco no corresponde a la
 * pieza: el front no hace nada entre medio que pueda romperlo.
 */
export function checkCoplanarity(
  frame: Frame,
  widthM: number,
  heightM: number,
  toleranceM = 1e-6,
): CoplanarityCheck {
  const esquinas: Array<[number, number]> = [
    [0, 0],
    [widthM, 0],
    [widthM, heightM],
    [0, heightM],
  ];
  const dots = esquinas.map(([u, v]) => dot(liftUV(frame, u, v), frame.normal));
  const spreadM = Math.max(...dots) - Math.min(...dots);
  return { dots, spreadM, ok: spreadM <= toleranceM };
}

/**
 * D.2 — superficie realmente triangulada, sumando el área de cada triángulo.
 * Contra el `area_m2` del backend: si la dibujada da el doble, se está pintando
 * el rectángulo que contiene a la pieza y no la pieza.
 */
export function trianglesAreaM2(positions: number[]): number {
  let total = 0;
  const triCount = Math.floor(positions.length / 9);
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    const ux = positions[i + 3] - positions[i];
    const uy = positions[i + 4] - positions[i + 1];
    const uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i];
    const vy = positions[i + 7] - positions[i + 1];
    const vz = positions[i + 8] - positions[i + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    total += Math.hypot(cx, cy, cz) / 2;
  }
  return total;
}

export interface CornerHit {
  /** Etiqueta de la pieza vecina contra cuyo plano se midió. */
  vecina: string;
  /** Distancia con signo de la esquina al plano medio de la vecina, en metros. */
  distanciaM: number;
}

/**
 * D.3 — para cada esquina de una pieza, la distancia al plano medio de las
 * vecinas que la contienen. Debería dar media placa: 0 significa que las dos
 * comparten plano medio, y el espesor entero que una se apoya sobre la cara de
 * la otra en vez de encastrar.
 *
 * Sólo cuentan las vecinas cuya proyección de la esquina cae DENTRO de su
 * rectángulo (con margen): sin ese filtro, el plano infinito de cualquier pared
 * lejana pasa cerca de cualquier punto y el número no dice nada.
 */
export function cornerHits(
  frame: Frame,
  widthM: number,
  heightM: number,
  vecinas: Array<{ label: string; frame: Frame; widthM: number; heightM: number }>,
  margenM = 0.05,
): CornerHit[][] {
  const esquinas: Array<[number, number]> = [
    [0, 0],
    [widthM, 0],
    [widthM, heightM],
    [0, heightM],
  ];

  return esquinas.map(([u, v]) => {
    const punto = liftUV(frame, u, v);
    const hits: CornerHit[] = [];
    for (const vecina of vecinas) {
      const rel = sub(punto, vecina.frame.origin);
      const vu = dot(rel, vecina.frame.uAxis);
      const vv = dot(rel, vecina.frame.vAxis);
      const dentro =
        vu >= -margenM &&
        vu <= vecina.widthM + margenM &&
        vv >= -margenM &&
        vv <= vecina.heightM + margenM;
      if (!dentro) continue;
      hits.push({ vecina: vecina.label, distanciaM: dot(rel, vecina.frame.normal) });
    }
    return hits.sort((a, b) => Math.abs(a.distanciaM) - Math.abs(b.distanciaM));
  });
}

export interface PieceDump {
  /** C.3 — identificador de la pieza. */
  panelId: string;
  groupId: number | null;
  /** Cuál eslabón de la cadena dibujó la pieza. */
  fuente: LiftSource;
  /** C.1 — el marco crudo, tal como llegó del backend. */
  placement: NestingPlacement | null;
  /** Cuántas aristas trae el contorno de corte (0 = sin `outline`). */
  aristasOutline: number;
  /** C.2 — números finales que terminan en la escena. */
  triangulos: number;
  /** Primeros vértices en coordenadas de mundo, para pegar en un mail. */
  primerosVertices: Vec3[];
  espesorM: number;
  espesorDelBackend: boolean;
  /** D.1 / D.2 / D.3 — sólo cuando hay marco con qué calcularlas. */
  coplanaridad: CoplanarityCheck | null;
  areaDibujadaM2: number;
  areaDeclaradaM2: number | null;
  esquinas: CornerHit[][] | null;
}

export interface AssemblyDump {
  /** Cuántas piezas dibujó cada fuente — el reparto de toda la corrida. */
  porFuente: Record<LiftSource, number>;
  total: number;
  piezas: PieceDump[];
}

function frameDe(pl: NestingPlacement): Frame {
  return { origin: pl.origin, uAxis: pl.uAxis, vAxis: pl.vAxis, normal: pl.normal };
}

/**
 * Arma el volcado. `selector` filtra por etiqueta de pieza; `"*"` las trae
 * todas (el reparto por fuente siempre se calcula sobre todas).
 */
export function buildAssemblyDump(
  pieces: AssemblySequencePiece[],
  ctx: {
    labelToGroupId: Map<string, number>;
    placementByGroupId?: Map<number, NestingPlacement>;
  },
  selector: string,
  maxVertices = 12,
): AssemblyDump {
  const porFuente: Record<LiftSource, number> = {
    outline: 0,
    panel: 0,
    finalPiece: 0,
    faces: 0,
    box: 0,
  };
  for (const p of pieces) porFuente[p.liftSource ?? "box"]++;

  const quiere = (label: string) =>
    selector === "*" || label.trim().toLowerCase() === selector.trim().toLowerCase();

  // Vecinas para D.3: toda pieza con marco, incluida la propia (se descarta abajo).
  const conMarco: Array<{
    label: string;
    frame: Frame;
    widthM: number;
    heightM: number;
  }> = [];
  for (const p of pieces) {
    const gid = ctx.labelToGroupId.get(p.id.trim());
    const pl = gid == null ? undefined : ctx.placementByGroupId?.get(gid);
    if (!pl) continue;
    conMarco.push({
      label: p.id,
      frame: frameDe(pl),
      widthM: pl.widthM,
      heightM: pl.heightM,
    });
  }

  const piezas: PieceDump[] = [];
  for (const piece of pieces) {
    const label = piece.id.trim();
    if (!quiere(label)) continue;

    const groupId = ctx.labelToGroupId.get(label) ?? null;
    const placement =
      groupId == null ? null : ctx.placementByGroupId?.get(groupId) ?? null;
    const positions = piece.lifted?.positions ?? [];

    const primerosVertices: Vec3[] = [];
    for (let i = 0; i + 2 < positions.length && primerosVertices.length < maxVertices; i += 3) {
      primerosVertices.push({ x: positions[i], y: positions[i + 1], z: positions[i + 2] });
    }

    piezas.push({
      panelId: piece.id,
      groupId,
      fuente: piece.liftSource ?? "box",
      placement,
      aristasOutline: placement?.outline?.length ?? 0,
      triangulos: Math.floor(positions.length / 9),
      primerosVertices,
      espesorM: piece.depth_m,
      espesorDelBackend: piece.depthFromBackend === true,
      coplanaridad: placement
        ? checkCoplanarity(frameDe(placement), placement.widthM, placement.heightM)
        : null,
      areaDibujadaM2: trianglesAreaM2(positions),
      areaDeclaradaM2: placement && placement.areaM2 > 0 ? placement.areaM2 : null,
      esquinas: placement
        ? cornerHits(
            frameDe(placement),
            placement.widthM,
            placement.heightM,
            conMarco.filter((v) => v.label !== piece.id),
          )
        : null,
    });
  }

  return { porFuente, total: pieces.length, piezas };
}

function mm(m: number): string {
  return `${(m * 1000).toFixed(2)} mm`;
}

/** Imprime el volcado por consola, agrupado por pieza. */
export function logAssemblyDump(dump: AssemblyDump): void {
  /* eslint-disable no-console */
  console.group(`[instructivo] volcado — ${dump.piezas.length}/${dump.total} piezas`);
  console.log("Fuente de dibujo (todas las piezas de la corrida):", dump.porFuente);
  if (dump.porFuente.faces > 0 || dump.porFuente.box > 0) {
    console.warn(
      `⚠ ${dump.porFuente.faces} pieza(s) dibujadas con la malla CRUDA del modelo y ` +
        `${dump.porFuente.box} como caja: esas no son las medidas que se cortan.`,
    );
  }

  for (const p of dump.piezas) {
    console.group(`${p.panelId} (group ${p.groupId ?? "?"}) — fuente: ${p.fuente}`);
    console.log("C.1 placement crudo:", p.placement);
    console.log(
      `C.2 ${p.triangulos} triángulos · espesor ${mm(p.espesorM)}` +
        `${p.espesorDelBackend ? " (del backend)" : " (global del front)"}`,
    );
    console.log("C.2 primeros vértices (mundo):", p.primerosVertices);
    console.log(`Contorno: ${p.aristasOutline} aristas`);

    if (p.coplanaridad) {
      const c = p.coplanaridad;
      console.log(
        `D.1 coplanaridad: ${c.ok ? "OK" : "FALLA"} — spread ${mm(c.spreadM)}`,
        c.dots,
      );
    }

    if (p.areaDeclaradaM2 != null) {
      const ratio = p.areaDibujadaM2 / p.areaDeclaradaM2;
      console.log(
        `D.2 área dibujada ${p.areaDibujadaM2.toFixed(4)} m² vs declarada ` +
          `${p.areaDeclaradaM2.toFixed(4)} m² — ratio ${ratio.toFixed(3)}`,
      );
    } else {
      console.log(`D.2 área dibujada ${p.areaDibujadaM2.toFixed(4)} m² (sin area_m2 del backend)`);
    }

    if (p.esquinas) {
      p.esquinas.forEach((hits, i) => {
        if (hits.length === 0) {
          console.log(`D.3 esquina ${i}: sin vecina que la contenga`);
          return;
        }
        console.log(
          `D.3 esquina ${i}:`,
          hits.slice(0, 3).map((h) => `${h.vecina} @ ${mm(h.distanciaM)}`).join(" · "),
        );
      });
    }
    console.groupEnd();
  }
  console.groupEnd();
  /* eslint-enable no-console */
}
