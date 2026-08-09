"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
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
  computeSequenceCenter,
  computeSequenceDiag,
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
/**
 * Piezas que el backend marcó en conflicto (se atraviesan, quedan sin apoyo…).
 * Va por contexto para no enhebrar la prop por toda la jerarquía de piezas.
 */
const ConflictContext = createContext<ReadonlySet<string>>(new Set<string>());
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
  const conflicts = useContext(ConflictContext);
  const inConflict = conflicts.has(piece.id);
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
        color={inConflict ? CONFLICT_COLOR : pieceBaseColor(piece)}
        emissive={inConflict ? CONFLICT_COLOR : 0x000000}
        emissiveIntensity={inConflict ? 0.3 : 0}
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
  const conflicts = useContext(ConflictContext);
  const inConflict = conflicts.has(piece.id);

  if (!slab?.cap) return <StaticPiece piece={piece} />;

  return (
    <group>
      <mesh geometry={slab.cap} frustumCulled={false} castShadow receiveShadow>
        <meshStandardMaterial
          color={inConflict ? CONFLICT_COLOR : MDF_COLOR}
          emissive={inConflict ? CONFLICT_COLOR : 0x000000}
          emissiveIntensity={inConflict ? 0.3 : 0}
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
}: {
  pieces: AssemblySequencePiece[];
  currentStep: number;
  centerOffset: THREE.Vector3;
  diag: number;
  conflictPoints: Vec3[];
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
    </group>
  );
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
  className?: string;
}

export default function InteractiveAssemblyViewer({
  steps,
  pieces,
  viewerSchema,
  slabThicknessM,
  warnings,
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
    if (!slabThicknessM || slabThicknessM <= 0) return prepared;
    return prepared.map((p) => ({ ...p, depth_m: slabThicknessM }));
  }, [pieces, viewerSchema, slabThicknessM]);

  const visiblePieces = useMemo(
    () => renderPieces.filter((p) => p.stepIndex <= currentStep),
    [renderPieces, currentStep],
  );

  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    for (const w of warnings ?? []) for (const id of w.pieces) ids.add(id);
    return ids;
  }, [warnings]);

  const conflictPoints = useMemo(
    () => (warnings ?? []).map((w) => w.at).filter((at): at is Vec3 => at != null),
    [warnings],
  );

  const center = useMemo(
    () => computeSequenceCenter(visiblePieces.length > 0 ? visiblePieces : renderPieces),
    [visiblePieces, renderPieces],
  );
  const centerVec = useMemo(
    () => new THREE.Vector3(center.x, center.y, center.z),
    [center.x, center.y, center.z],
  );
  const diag = useMemo(
    () => Math.max(computeSequenceDiag(visiblePieces.length > 0 ? visiblePieces : renderPieces), 3),
    [visiblePieces, renderPieces],
  );
  const camDist = diag * 1.35;

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
        <directionalLight position={[diag * 2, diag * 3, diag]} intensity={1.4} castShadow />
        <directionalLight position={[-diag, diag * 0.5, -diag]} intensity={0.5} />

        <SupportMarksContext.Provider value={showSupportMarks}>
          <ConflictContext.Provider value={conflictIds}>
            <AssemblyScene
              pieces={visiblePieces.length > 0 ? visiblePieces : renderPieces}
              currentStep={currentStep}
              centerOffset={centerVec}
              diag={diag}
              conflictPoints={conflictPoints}
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
