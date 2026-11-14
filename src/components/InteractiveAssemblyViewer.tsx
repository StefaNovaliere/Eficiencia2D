"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  AssemblySequencePiece,
  AssemblySequenceStep,
} from "@/core/assembly-sequence";
import type { Vec3 } from "@/core/types";
import type { AssemblyWarning } from "@/core/final-pieces";
import {
  segmentosDeProblema,
  type EstadoVerificacion,
  type FocoVerificacion,
  type Verificacion,
} from "@/core/verificacion";
import {
  computeSequenceBounds,
  prepareAssemblyPiecesForRender,
} from "@/core/assembly-sequence";
import { buildSlab, buildInwardSlab, faceNormalFromPositions } from "@/core/assembly-slab";

const DROP_HEIGHT_FACTOR = 0.35;
const PAST_COLOR = 0x94a3b8;
const HIGHLIGHT_COLOR = 0xfbbf24;
const HIGHLIGHT_EMISSIVE = 0xf59e0b;
const OPENING_COLOR = 0x0f172a; // aberturas (corte)
const MARK_COLOR = 0xdc2626; // aberturas grabadas (marca, rojo)
const SLOT_COLOR = 0xfacc15; // ranuras de encastre (overlay v2, ámbar)
// Material físico (slab con grosor real): caras claras + canto quemado. Un modelo
// es de un solo material; MDF por defecto (cambiar a cartón = un color global
// cuando exista un selector de material).
const SUPPORT_MARK_COLOR = 0xdc2626; // marcas de apoyo (rojo, capa MARK)
const CONFLICT_COLOR = 0xef4444; // piezas que choca el chequeo de ensamble
/** Muestra/oculta las marcas de apoyo rojas en el instructivo. */
const SupportMarksContext = createContext(false);
/** Colores por estado de la verificación (ver CONTRATO_verificacion.md). */
const ESTADO_COLOR: Record<EstadoVerificacion, number> = {
  ok: 0x22c55e,
  revisar: 0xeab308,
  no_arma: 0xef4444,
};

/**
 * Cómo se pinta cada pieza: por el estado que le da la verificación, o en rojo
 * si el chequeo viejo la marcó en conflicto. Y cuáles se atenúan porque hay un
 * problema seleccionado que no las incluye. Va por contexto para no enhebrar la
 * prop por toda la jerarquía de piezas.
 */
interface Pintado {
  color: (id: string) => number | null;
  atenuada: (id: string) => boolean;
}
const PINTADO_NEUTRO: Pintado = { color: () => null, atenuada: () => false };
const ConflictContext = createContext<Pintado>(PINTADO_NEUTRO);

/** Props de material para una pieza según su pintado. */
function materialDePintado(pintado: Pintado, id: string, base: number) {
  const c = pintado.color(id);
  const dim = pintado.atenuada(id);
  return {
    color: c ?? base,
    emissive: c ?? 0x000000,
    emissiveIntensity: c != null ? 0.25 : 0,
    transparent: dim,
    opacity: dim ? 0.12 : 1,
    depthWrite: !dim,
  };
}
const MDF_COLOR = 0xc9a97e; // tan cálido (MDF)
const EDGE_BURNT = 0x7a5c3c; // canto de MDF (chamuscado, apenas más oscuro que la cara)

function isLifted(piece: AssemblySequencePiece): boolean {
  return (piece.lifted?.positions?.length ?? 0) >= 9;
}

function sanitizePositions(positions: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      out.push(x, y, z);
    }
  }
  return out;
}

function buildMeshGeometry(positions: number[]): THREE.BufferGeometry | null {
  const clean = sanitizePositions(positions);
  if (clean.length < 9) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(clean, 3));
  try {
    g.computeVertexNormals();
  } catch {
    g.dispose();
    return null;
  }
  return g;
}

/**
 * Engrosa el contorno lifteado a un slab sólido de espesor `depth`.
 * Con `inward` + `outwardNormal`: fachada fija, grosor hacia adentro (MDF fiel).
 * Si no, slab centrado ±depth/2.
 */
function buildSlabGeometries(
  positions: number[],
  depth: number,
  opts?: { inward?: boolean; outwardNormal?: { x: number; y: number; z: number } },
): { cap: THREE.BufferGeometry | null; wall: THREE.BufferGeometry | null } {
  if (opts?.inward && opts.outwardNormal) {
    const { caps, walls } = buildInwardSlab(positions, opts.outwardNormal, depth);
    return { cap: buildMeshGeometry(caps), wall: buildMeshGeometry(walls) };
  }
  const normal = opts?.outwardNormal ?? faceNormalFromPositions(positions);
  if (!normal) return { cap: buildMeshGeometry(positions), wall: null };
  const { caps, walls } = buildSlab(positions, normal, depth);
  return { cap: buildMeshGeometry(caps), wall: buildMeshGeometry(walls) };
}

function buildLineGeometry(segments: number[]): THREE.BufferGeometry | null {
  const clean = sanitizePositions(segments);
  if (clean.length < 6) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(clean, 3));
  return g;
}

function hexToNumber(hex: string): number {
  const cleaned = hex.replace("#", "");
  const n = parseInt(cleaned, 16);
  return Number.isFinite(n) ? n : PAST_COLOR;
}

function pieceBaseColor(piece: AssemblySequencePiece): number {
  return piece.color ? hexToNumber(piece.color) : PAST_COLOR;
}

function safeDim(n: number, min = 0.012): number {
  return Number.isFinite(n) && n > 0 ? n : min;
}

function piecePosition(piece: AssemblySequencePiece): [number, number, number] {
  return [
    Number.isFinite(piece.position.x) ? piece.position.x : 0,
    Number.isFinite(piece.position.y) ? piece.position.y : 0,
    Number.isFinite(piece.position.z) ? piece.position.z : 0,
  ];
}

function pieceRotation(piece: AssemblySequencePiece): [number, number, number] {
  const r = piece.rotation ?? { x: 0, y: 0, z: 0 };
  return [
    Number.isFinite(r.x) ? r.x : 0,
    Number.isFinite(r.y) ? r.y : 0,
    Number.isFinite(r.z) ? r.z : 0,
  ];
}

function pieceSize(piece: AssemblySequencePiece): [number, number, number] {
  return [
    safeDim(piece.width_m),
    safeDim(piece.height_m),
    safeDim(piece.depth_m),
  ];
}

/** Pieza ya colocada — caja orientada con color sólido. */
function StaticPiece({ piece }: { piece: AssemblySequencePiece }) {
  // El rojo de conflicto tiene que salir también acá: una pieza que se dibuja
  // como caja (sin contorno) es justamente la que más necesita el aviso.
  const pintado = useContext(ConflictContext);
  return (
    <mesh
      position={piecePosition(piece)}
      rotation={pieceRotation(piece)}
      frustumCulled={false}
      castShadow
      receiveShadow
    >
      <boxGeometry args={pieceSize(piece)} />
      <meshStandardMaterial
        {...materialDePintado(pintado, piece.id, pieceBaseColor(piece))}
        roughness={0.5}
        metalness={0.1}
      />
    </mesh>
  );
}

/** Pieza del paso actual — cae en Y con rotación aplicada. */
function DroppingPiece({
  piece,
  dropHeight,
}: {
  piece: AssemblySequencePiece;
  dropHeight: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const fadeTweenRef = useRef<gsap.core.Tween | null>(null);
  const [x, y, z] = piecePosition(piece);
  const rot = pieceRotation(piece);
  const size = pieceSize(piece);
  const baseColor = pieceBaseColor(piece);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    mesh.position.set(x, y + dropHeight, z);
    mesh.rotation.set(rot[0], rot[1], rot[2]);

    const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
    if (!mat) return;
    mat.color.setHex(HIGHLIGHT_COLOR);
    mat.emissive.setHex(HIGHLIGHT_EMISSIVE);
    mat.emissiveIntensity = 0.45;

    fadeTweenRef.current?.kill();

    const dropTween = gsap.to(mesh.position, {
      y,
      duration: 0.85,
      ease: "power2.out",
      onComplete: () => {
        fadeTweenRef.current = gsap.to(mat, {
          emissiveIntensity: 0,
          duration: 0.55,
          ease: "power1.out",
          onUpdate: () => {
            mat.color.lerp(new THREE.Color(baseColor), 0.1);
            mat.emissive.lerp(new THREE.Color(0x000000), 0.12);
          },
        });
      },
    });

    return () => {
      dropTween.kill();
      fadeTweenRef.current?.kill();
    };
  }, [x, y, z, rot, dropHeight, baseColor]);

  return (
    <mesh
      ref={meshRef}
      position={[x, y + dropHeight, z]}
      rotation={rot}
      frustumCulled={false}
      castShadow
      receiveShadow
    >
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={HIGHLIGHT_COLOR}
        emissive={HIGHLIGHT_EMISSIVE}
        emissiveIntensity={0.45}
        roughness={0.5}
        metalness={0.1}
      />
    </mesh>
  );
}

/** Pieza de corte ya colocada — malla lifteada engrosada a slab 3D. */
function StaticLiftedPiece({ piece }: { piece: AssemblySequencePiece }) {
  const lifted = piece.lifted;
  const slab = useMemo(
    () =>
      lifted
        ? buildSlabGeometries(lifted.positions, safeDim(piece.depth_m), {
            inward: lifted.inwardSlab === true,
            outwardNormal: lifted.outwardNormal,
          })
        : null,
    [lifted, piece.depth_m],
  );
  const lineGeom = useMemo(
    () =>
      lifted && (lifted.openings?.length ?? 0) >= 6
        ? buildLineGeometry(lifted.openings)
        : null,
    [lifted],
  );
  const slotGeom = useMemo(
    () => (lifted && (lifted.slots?.length ?? 0) >= 9 ? buildMeshGeometry(lifted.slots!) : null),
    [lifted],
  );
  const supportGeom = useMemo(
    () =>
      lifted && (lifted.supportMarks?.length ?? 0) >= 9
        ? buildMeshGeometry(lifted.supportMarks!)
        : null,
    [lifted],
  );
  const showSupport = useContext(SupportMarksContext);
  const pintado = useContext(ConflictContext);
  const atenuada = pintado.atenuada(piece.id);

  if (!slab?.cap) return <StaticPiece piece={piece} />;

  return (
    <group>
      <mesh geometry={slab.cap} frustumCulled={false} castShadow={!atenuada} receiveShadow>
        <meshStandardMaterial
          {...materialDePintado(pintado, piece.id, MDF_COLOR)}
          roughness={0.7}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
      {slab.wall && (
        <mesh geometry={slab.wall} frustumCulled={false} castShadow={!atenuada} receiveShadow>
          <meshStandardMaterial
            color={EDGE_BURNT}
            roughness={0.85}
            metalness={0.05}
            side={THREE.DoubleSide}
            transparent={atenuada}
            opacity={atenuada ? 0.12 : 1}
            depthWrite={!atenuada}
          />
        </mesh>
      )}
      {slotGeom && (
        <mesh geometry={slotGeom} frustumCulled={false}>
          <meshStandardMaterial color={SLOT_COLOR} roughness={0.6} metalness={0.1} side={THREE.DoubleSide} />
        </mesh>
      )}
      {showSupport && supportGeom && (
        <mesh geometry={supportGeom} frustumCulled={false} renderOrder={2}>
          <meshStandardMaterial
            color={SUPPORT_MARK_COLOR}
            emissive={SUPPORT_MARK_COLOR}
            emissiveIntensity={0.35}
            roughness={0.5}
            side={THREE.DoubleSide}
            depthTest={false}
            transparent
          />
        </mesh>
      )}
      {lineGeom && (
        <lineSegments geometry={lineGeom}>
          <lineBasicMaterial color={piece.isMark ? MARK_COLOR : OPENING_COLOR} />
        </lineSegments>
      )}
    </group>
  );
}

/** Pieza de corte del paso actual — cae a su pose final lifteada. */
function DroppingLiftedPiece({
  piece,
  dropHeight,
}: {
  piece: AssemblySequencePiece;
  dropHeight: number;
}) {
  const lifted = piece.lifted;
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const fadeTweenRef = useRef<gsap.core.Tween | null>(null);
  const slab = useMemo(
    () =>
      lifted
        ? buildSlabGeometries(lifted.positions, safeDim(piece.depth_m), {
            inward: lifted.inwardSlab === true,
            outwardNormal: lifted.outwardNormal,
          })
        : null,
    [lifted, piece.depth_m],
  );
  const lineGeom = useMemo(
    () =>
      lifted && (lifted.openings?.length ?? 0) >= 6
        ? buildLineGeometry(lifted.openings)
        : null,
    [lifted],
  );
  const slotGeom = useMemo(
    () => (lifted && (lifted.slots?.length ?? 0) >= 9 ? buildMeshGeometry(lifted.slots!) : null),
    [lifted],
  );
  const supportGeom = useMemo(
    () =>
      lifted && (lifted.supportMarks?.length ?? 0) >= 9
        ? buildMeshGeometry(lifted.supportMarks!)
        : null,
    [lifted],
  );
  const showSupport = useContext(SupportMarksContext);
  const baseColor = MDF_COLOR;

  useLayoutEffect(() => {
    if (!slab?.cap) return;
    const grp = groupRef.current;
    const mat = matRef.current;
    if (!grp || !mat) return;

    grp.position.set(0, dropHeight, 0);
    mat.color.setHex(HIGHLIGHT_COLOR);
    mat.emissive.setHex(HIGHLIGHT_EMISSIVE);
    mat.emissiveIntensity = 0.45;

    fadeTweenRef.current?.kill();

    const dropTween = gsap.to(grp.position, {
      y: 0,
      duration: 0.85,
      ease: "power2.out",
      onComplete: () => {
        fadeTweenRef.current = gsap.to(mat, {
          emissiveIntensity: 0,
          duration: 0.55,
          ease: "power1.out",
          onUpdate: () => {
            mat.color.lerp(new THREE.Color(baseColor), 0.1);
            mat.emissive.lerp(new THREE.Color(0x000000), 0.12);
          },
        });
      },
    });

    return () => {
      dropTween.kill();
      fadeTweenRef.current?.kill();
    };
  }, [dropHeight, baseColor, slab]);

  if (!slab?.cap) return <DroppingPiece piece={piece} dropHeight={dropHeight} />;

  return (
    <group ref={groupRef}>
      <mesh geometry={slab.cap} frustumCulled={false} castShadow receiveShadow>
        <meshStandardMaterial
          ref={matRef}
          color={HIGHLIGHT_COLOR}
          emissive={HIGHLIGHT_EMISSIVE}
          emissiveIntensity={0.45}
          roughness={0.7}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
      {slab.wall && (
        <mesh geometry={slab.wall} frustumCulled={false} castShadow receiveShadow>
          <meshStandardMaterial color={EDGE_BURNT} roughness={0.85} metalness={0.05} side={THREE.DoubleSide} />
        </mesh>
      )}
      {slotGeom && (
        <mesh geometry={slotGeom} frustumCulled={false}>
          <meshStandardMaterial color={SLOT_COLOR} roughness={0.6} metalness={0.1} side={THREE.DoubleSide} />
        </mesh>
      )}
      {showSupport && supportGeom && (
        <mesh geometry={supportGeom} frustumCulled={false} renderOrder={2}>
          <meshStandardMaterial
            color={SUPPORT_MARK_COLOR}
            emissive={SUPPORT_MARK_COLOR}
            emissiveIntensity={0.35}
            roughness={0.5}
            side={THREE.DoubleSide}
            depthTest={false}
            transparent
          />
        </mesh>
      )}
      {lineGeom && (
        <lineSegments geometry={lineGeom}>
          <lineBasicMaterial color={piece.isMark ? MARK_COLOR : OPENING_COLOR} />
        </lineSegments>
      )}
    </group>
  );
}

function AssemblyPiece({
  piece,
  currentStep,
  dropHeight,
}: {
  piece: AssemblySequencePiece;
  currentStep: number;
  dropHeight: number;
}) {
  if (piece.stepIndex > currentStep) return null;
  const lifted = isLifted(piece);
  if (piece.stepIndex < currentStep) {
    return lifted ? <StaticLiftedPiece piece={piece} /> : <StaticPiece piece={piece} />;
  }
  if (lifted) {
    return (
      <DroppingLiftedPiece
        key={`${piece.id}-step-${currentStep}`}
        piece={piece}
        dropHeight={dropHeight}
      />
    );
  }
  return (
    <DroppingPiece
      key={`${piece.id}-step-${currentStep}`}
      piece={piece}
      dropHeight={dropHeight}
    />
  );
}

function AssemblyScene({
  pieces,
  currentStep,
  centerOffset,
  diag,
  conflictPoints,
  segmentos = [],
}: {
  pieces: AssemblySequencePiece[];
  currentStep: number;
  centerOffset: THREE.Vector3;
  diag: number;
  conflictPoints: Vec3[];
  /** Tramos de las uniones del problema seleccionado, coloreados por estado. */
  segmentos?: Array<{ a: Vec3; b: Vec3; estado: EstadoVerificacion }>;
}) {
  const dropHeight = diag * DROP_HEIGHT_FACTOR;

  return (
    <group position={[-centerOffset.x, -centerOffset.y, -centerOffset.z]}>
      <Grid
        infiniteGrid
        cellSize={Math.max(diag / 12, 0.2)}
        sectionSize={Math.max(diag / 3, 1)}
        cellColor="#334155"
        sectionColor="#475569"
        fadeDistance={diag * 5}
        position={[0, 0, 0]}
      />
      {pieces.map((piece) => (
        <AssemblyPiece
          key={piece.id}
          piece={piece}
          currentStep={currentStep}
          dropHeight={dropHeight}
        />
      ))}
      {conflictPoints.map((pt, i) => (
        <mesh key={i} position={[pt.x, pt.y, pt.z]} renderOrder={3}>
          {/* Tamaño relativo al modelo: un radio fijo desaparece en una casa
              y tapa la pieza en una maqueta chica. */}
          <sphereGeometry args={[Math.max(diag * 0.012, 0.02), 16, 16]} />
          <meshStandardMaterial
            color={CONFLICT_COLOR}
            emissive={CONFLICT_COLOR}
            emissiveIntensity={0.8}
            depthTest={false}
            transparent
          />
        </mesh>
      ))}
      {segmentos.map((sg, i) => (
        <Line
          key={`sg-${i}`}
          points={[
            [sg.a.x, sg.a.y, sg.a.z],
            [sg.b.x, sg.b.y, sg.b.z],
          ]}
          color={ESTADO_COLOR[sg.estado]}
          lineWidth={6}
          depthTest={false}
          renderOrder={4}
        />
      ))}
    </group>
  );
}

/**
 * Lleva la cámara al punto de un problema: centra la órbita ahí y se acerca a
 * una distancia proporcional al modelo, sin cambiar el ángulo de vista.
 */
function CamaraAlPunto({ punto, distancia }: { punto: THREE.Vector3 | null; distancia: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | null;
  const destino = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null);

  useEffect(() => {
    if (!punto || !controls) return;
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(1, 1, 1);
    dir.normalize().multiplyScalar(distancia);
    destino.current = { target: punto.clone(), pos: punto.clone().add(dir) };
  }, [punto, distancia, camera, controls]);

  useFrame(() => {
    const d = destino.current;
    if (!d || !controls) return;
    controls.target.lerp(d.target, 0.15);
    camera.position.lerp(d.pos, 0.15);
    controls.update();
    if (controls.target.distanceTo(d.target) < 1e-3 && camera.position.distanceTo(d.pos) < 1e-3) {
      destino.current = null;
    }
  });
  return null;
}

export interface InteractiveAssemblyViewerProps {
  steps: AssemblySequenceStep[];
  pieces: AssemblySequencePiece[];
  viewerSchema?: string;
  /** Espesor del material (m mundo, ya × escala de impresión). Si viene, sustituye
   *  al `depth_m` de cada pieza para que el grosor sea visible y fiel a la maqueta. */
  slabThicknessM?: number;
  /**
   * Choques que detectó el backend al armar la maqueta. Las piezas involucradas
   * se pintan en rojo y cada punto de conflicto lleva un marcador: es lo que
   * hoy se descubre recién pegando el MDF.
   */
  warnings?: AssemblyWarning[];
  /**
   * Veredicto del backend sobre las piezas que se cortan. Si viene (objeto o
   * null), reemplaza a `warnings`: las piezas se pintan por su estado.
   */
  verificacion?: Verificacion | null;
  /**
   * Lo seleccionado en la lista: se va a su punto y se aíslan sus piezas. Un
   * nudo (v2) muestra sólo sus piezas; un problema atenúa el resto.
   */
  problemaActivo?: FocoVerificacion | null;
  /** Pintar por estado (verde/amarillo/rojo) o dejar el color del MDF. */
  colorPorEstado?: boolean;
  className?: string;
}

export default function InteractiveAssemblyViewer({
  steps,
  pieces,
  viewerSchema,
  slabThicknessM,
  warnings,
  verificacion,
  problemaActivo = null,
  colorPorEstado = true,
  className = "",
}: InteractiveAssemblyViewerProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [showSupportMarks, setShowSupportMarks] = useState(false);

  const stepsKey = useMemo(
    () => steps.map((s) => `${s.title}:${s.panel_ids.join(",")}`).join("|"),
    [steps],
  );
  const piecesKey = useMemo(() => pieces.map((p) => p.id).join("|"), [pieces]);

  useEffect(() => {
    setCurrentStep(0);
  }, [stepsKey, piecesKey]);

  const renderPieces = useMemo(() => {
    const prepared = prepareAssemblyPiecesForRender(pieces, { viewerSchema });
    // Grosor sensible a la escala: el material físico (p.ej. MDF 3 mm) a escala
    // 1:N mide `3mm × N` en el mundo real del visor. El `depth_m` por defecto
    // (12 mm) es invisible sobre piezas de varios metros.
    // El espesor que manda el backend por pieza (`thickness_m` del placement)
    // manda sobre el global: pisarlo dejaba todas las placas del mismo grosor
    // aunque el backend las diferenciara.
    if (!slabThicknessM || slabThicknessM <= 0) return prepared;
    return prepared.map((p) =>
      p.depthFromBackend ? p : { ...p, depth_m: slabThicknessM },
    );
  }, [pieces, viewerSchema, slabThicknessM]);

  // Con un problema seleccionado se ve la maqueta entera: sus piezas pueden ser
  // de pasos que todavía no se revelaron.
  const pasoMostrado = problemaActivo ? Math.max(steps.length - 1, 0) : currentStep;
  const visiblePieces = useMemo(() => {
    const hastaElPaso = renderPieces.filter((p) => p.stepIndex <= pasoMostrado);
    // Un nudo se mira con SÓLO sus piezas, en su lugar: el resto tapa.
    if (problemaActivo?.soloEstas) {
      const ids = new Set(problemaActivo.piezas);
      return hastaElPaso.filter((p) => ids.has(p.id));
    }
    return hastaElPaso;
  }, [renderPieces, pasoMostrado, problemaActivo]);

  /**
   * Con verificación (objeto o null) el chequeo viejo deja de mostrarse: el
   * contrato pide no mezclar las dos fuentes. `null` no pinta nada — no se
   * pudo verificar, y pintar verde diría algo que no se comprobó.
   */
  const usaVerificacion = verificacion !== undefined;
  const pintado = useMemo((): Pintado => {
    const enProblema = problemaActivo ? new Set(problemaActivo.piezas) : null;
    const atenuada = (id: string) => enProblema !== null && !enProblema.has(id);
    if (usaVerificacion) {
      return {
        color: (id) => {
          if (!verificacion) return null;
          // Atenuada = fuera del problema: neutra, para que el color sea sólo
          // el de las piezas que importan.
          if (atenuada(id)) return null;
          if (!colorPorEstado && !enProblema?.has(id)) return null;
          const e = verificacion.piezas.get(id)?.estado;
          return e ? ESTADO_COLOR[e] : null;
        },
        atenuada,
      };
    }
    const ids = new Set<string>();
    for (const w of warnings ?? []) for (const id of w.pieces) ids.add(id);
    return { color: (id) => (ids.has(id) ? CONFLICT_COLOR : null), atenuada };
  }, [usaVerificacion, verificacion, colorPorEstado, problemaActivo, warnings]);

  const conflictPoints = useMemo(() => {
    if (usaVerificacion) return problemaActivo?.punto ? [problemaActivo.punto] : [];
    return (warnings ?? []).map((w) => w.at).filter((at): at is Vec3 => at != null);
  }, [usaVerificacion, problemaActivo, warnings]);

  const segmentos = useMemo(
    () => (verificacion && problemaActivo ? segmentosDeProblema(verificacion, problemaActivo) : []),
    [verificacion, problemaActivo],
  );

  // Centro y tamaño de la maqueta ENTERA, fijos para todos los pasos: si
  // dependieran de lo visible, la escena se correría en cada "Siguiente".
  const bounds = useMemo(() => computeSequenceBounds(renderPieces), [renderPieces]);
  const center = bounds.center;
  const centerVec = useMemo(
    () => new THREE.Vector3(center.x, center.y, center.z),
    [center.x, center.y, center.z],
  );
  const diag = Math.max(bounds.diag, 3);
  // La escena está corrida por `-center`: el punto del problema (en mundo) se
  // lleva al mismo marco antes de apuntarle la cámara.
  const puntoFoco = useMemo(() => {
    const pt = problemaActivo?.punto;
    return pt ? new THREE.Vector3(pt.x - center.x, pt.y - center.y, pt.z - center.z) : null;
  }, [problemaActivo, center.x, center.y, center.z]);

  const camDist = diag * 1.35;
  // Media extensión de la cámara de sombra: la luz mira al origen, así que tiene
  // que cubrir el modelo aunque no esté centrado ahí.
  const sombra = diag + Math.hypot(center.x, center.y, center.z);

  const step = steps[currentStep];
  const focus = step?.camera_focus;
  const orbitTarget = useMemo((): [number, number, number] => {
    if (!focus) return [0, 0, 0];
    const x = focus.x - center.x;
    const y = focus.y - center.y;
    const z = focus.z - center.z;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return [0, 0, 0];
    }
    return [x, y, z];
  }, [focus, center.x, center.y, center.z]);

  const atStart = currentStep === 0;
  const atEnd = currentStep >= steps.length - 1;
  const placedCount = renderPieces.filter((p) => p.stepIndex <= currentStep).length;

  if (steps.length === 0 || renderPieces.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-base-200 text-base-content/50 ${className}`}
      >
        <p className="text-sm">Sin pasos de ensamble para mostrar.</p>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full overflow-hidden bg-[#1a1d24] ${className}`}>
      <Canvas
        className="absolute inset-0"
        shadows
        camera={{
          position: [camDist * 0.75, camDist * 0.65, camDist * 0.75],
          fov: 42,
          near: 0.05,
          far: Math.max(camDist * 30, 500),
        }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["#1a1d24"]} />
        <ambientLight intensity={0.85} />
        {/*
          La cámara de sombra por defecto es un cubo de 10 m con un mapa de 512
          px y sin bias: sobre una maqueta de 17 m cada placa se hacía sombra a
          sí misma y los pisos salían rayados (shadow acne), que parecía una
          placa duplicada. Se dimensiona al modelo y se compensa con bias.
        */}
        <directionalLight
          position={[diag * 2, diag * 3, diag]}
          intensity={1.4}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-bias={-0.0005}
          shadow-normalBias={diag * 0.002}
          shadow-camera-left={-sombra}
          shadow-camera-right={sombra}
          shadow-camera-top={sombra}
          shadow-camera-bottom={-sombra}
          shadow-camera-near={0.1}
          shadow-camera-far={diag * 10}
        />
        <directionalLight position={[-diag, diag * 0.5, -diag]} intensity={0.5} />

        <SupportMarksContext.Provider value={showSupportMarks}>
          <ConflictContext.Provider value={pintado}>
            <AssemblyScene
              pieces={visiblePieces.length > 0 ? visiblePieces : renderPieces}
              currentStep={pasoMostrado}
              centerOffset={centerVec}
              diag={diag}
              conflictPoints={conflictPoints}
              segmentos={segmentos}
            />
          </ConflictContext.Provider>
        </SupportMarksContext.Provider>

        <OrbitControls
          makeDefault
          target={orbitTarget}
          minDistance={diag * 0.2}
          maxDistance={diag * 8}
          maxPolarAngle={Math.PI * 0.48}
          minPolarAngle={0.05}
        />
        <CamaraAlPunto punto={puntoFoco} distancia={diag * 0.6} />
      </Canvas>

      <div className="absolute top-2.5 right-2.5 sm:top-3 sm:right-3 z-10">
        <button
          type="button"
          onClick={() => setShowSupportMarks((v) => !v)}
          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium shadow-lg backdrop-blur-md transition-colors ${
            showSupportMarks
              ? "bg-error/20 text-error border-error/40"
              : "bg-base-100/90 text-base-content/70 border-base-300/40 hover:bg-base-200"
          }`}
          title="Muestra en rojo dónde se apoya/pega cada piso o estante"
          aria-pressed={showSupportMarks}
        >
          Marcas de apoyo
        </button>
      </div>

      <div className="absolute top-0 inset-x-0 z-10 pointer-events-none p-2.5 sm:p-3">
        <div className="max-w-xs mx-auto rounded-xl bg-base-100/90 backdrop-blur-md border border-base-300/40 shadow-lg px-3.5 py-2 pointer-events-auto">
          {problemaActivo ? (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/70 mb-0.5">
                {problemaActivo.soloEstas ? "Lugar · sólo sus piezas" : "Problema · maqueta completa"}
              </p>
              <h2 className="text-sm font-bold text-base-content leading-tight">
                {problemaActivo.titulo}
              </h2>
              <p className="text-xs text-base-content/60 mt-0.5 leading-snug">
                Piezas: {problemaActivo.piezas.join(", ")}
              </p>
            </>
          ) : (
          <>
          <div className="flex items-baseline justify-between gap-2 mb-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/70">
              Paso {currentStep + 1} de {steps.length}
            </p>
            <span
              className="text-[10px] text-base-content/40 font-mono tabular-nums"
              title={`${placedCount} de ${renderPieces.length} piezas colocadas${
                viewerSchema === "oriented_box_v1" ? " · oriented_box_v1" : ""
              }`}
            >
              {placedCount}/{renderPieces.length}
            </span>
          </div>
          <h2 className="text-sm sm:text-base font-bold text-base-content leading-tight">
            {step.title}
          </h2>
          <p className="text-xs text-base-content/60 mt-0.5 leading-snug line-clamp-2">
            {step.description}
          </p>
          </>
          )}
        </div>
      </div>

      <div className="absolute bottom-0 inset-x-0 z-10 flex justify-center p-4 sm:p-6 pointer-events-none">
        <div className="flex items-center gap-2 sm:gap-3 rounded-2xl bg-base-100/95 backdrop-blur-md border border-base-300/50 shadow-2xl px-3 py-2 sm:px-4 sm:py-3 pointer-events-auto">
          <button
            type="button"
            className="btn btn-sm btn-ghost gap-1 min-w-[6.5rem]"
            disabled={atStart}
            onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
          >
            <ChevronLeft className="w-4 h-4" />
            Anterior
          </button>

          <span className="px-2 text-xs sm:text-sm font-mono font-semibold text-base-content/70 tabular-nums whitespace-nowrap">
            {currentStep + 1} / {steps.length}
          </span>

          <button
            type="button"
            className="btn btn-sm btn-primary gap-1 min-w-[6.5rem]"
            disabled={atEnd}
            onClick={() => setCurrentStep((s) => Math.min(steps.length - 1, s + 1))}
          >
            Siguiente
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
