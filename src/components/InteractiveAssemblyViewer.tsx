"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  AssemblySequencePiece,
  AssemblySequenceStep,
} from "@/core/assembly-sequence";
import {
  computeSequenceCenter,
  computeSequenceDiag,
  prepareAssemblyPiecesForRender,
} from "@/core/assembly-sequence";

const DROP_HEIGHT_FACTOR = 0.35;
const PAST_COLOR = 0x94a3b8;
const HIGHLIGHT_COLOR = 0xfbbf24;
const HIGHLIGHT_EMISSIVE = 0xf59e0b;
// Colores neón por categoría para las piezas de corte lifteadas.
const WALL_COLOR = 0x22d3ee; // cian
const FLOOR_COLOR = 0xff2bd6; // rosa
const OPENING_COLOR = 0x0f172a; // aberturas (corte)
const MARK_COLOR = 0xdc2626; // aberturas grabadas (marca, rojo)
const SLOT_COLOR = 0xfacc15; // ranuras de encastre (overlay v2, ámbar)

function isLifted(piece: AssemblySequencePiece): boolean {
  return (piece.lifted?.positions?.length ?? 0) >= 9;
}

function pieceCategoryColor(piece: AssemblySequencePiece): number {
  if (piece.category === "floor") return FLOOR_COLOR;
  if (piece.category === "wall") return WALL_COLOR;
  return piece.color ? hexToNumber(piece.color) : PAST_COLOR;
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
        color={pieceBaseColor(piece)}
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

/** Pieza de corte ya colocada — contorno real (con aberturas) lifteado a 3D. */
function StaticLiftedPiece({ piece }: { piece: AssemblySequencePiece }) {
  const lifted = piece.lifted;
  const geom = useMemo(
    () => (lifted ? buildMeshGeometry(lifted.positions) : null),
    [lifted],
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

  if (!geom) return <StaticPiece piece={piece} />;

  return (
    <group>
      <mesh geometry={geom} frustumCulled={false} castShadow receiveShadow>
        <meshStandardMaterial
          color={pieceCategoryColor(piece)}
          roughness={0.55}
          metalness={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {slotGeom && (
        <mesh geometry={slotGeom} frustumCulled={false}>
          <meshStandardMaterial color={SLOT_COLOR} roughness={0.6} metalness={0.1} side={THREE.DoubleSide} />
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
  const geom = useMemo(
    () => (lifted ? buildMeshGeometry(lifted.positions) : null),
    [lifted],
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
  const baseColor = pieceCategoryColor(piece);

  useLayoutEffect(() => {
    if (!geom) return;
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
  }, [dropHeight, baseColor, geom]);

  if (!geom) return <DroppingPiece piece={piece} dropHeight={dropHeight} />;

  return (
    <group ref={groupRef}>
      <mesh geometry={geom} frustumCulled={false} castShadow receiveShadow>
        <meshStandardMaterial
          ref={matRef}
          color={HIGHLIGHT_COLOR}
          emissive={HIGHLIGHT_EMISSIVE}
          emissiveIntensity={0.45}
          roughness={0.55}
          metalness={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {slotGeom && (
        <mesh geometry={slotGeom} frustumCulled={false}>
          <meshStandardMaterial color={SLOT_COLOR} roughness={0.6} metalness={0.1} side={THREE.DoubleSide} />
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
}: {
  pieces: AssemblySequencePiece[];
  currentStep: number;
  centerOffset: THREE.Vector3;
  diag: number;
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
    </group>
  );
}

export interface InteractiveAssemblyViewerProps {
  steps: AssemblySequenceStep[];
  pieces: AssemblySequencePiece[];
  viewerSchema?: string;
  className?: string;
}

export default function InteractiveAssemblyViewer({
  steps,
  pieces,
  viewerSchema,
  className = "",
}: InteractiveAssemblyViewerProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const stepsKey = useMemo(
    () => steps.map((s) => `${s.title}:${s.panel_ids.join(",")}`).join("|"),
    [steps],
  );
  const piecesKey = useMemo(() => pieces.map((p) => p.id).join("|"), [pieces]);

  useEffect(() => {
    setCurrentStep(0);
  }, [stepsKey, piecesKey]);

  const renderPieces = useMemo(
    () => prepareAssemblyPiecesForRender(pieces, { viewerSchema }),
    [pieces, viewerSchema],
  );

  const visiblePieces = useMemo(
    () => renderPieces.filter((p) => p.stepIndex <= currentStep),
    [renderPieces, currentStep],
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

        <AssemblyScene
          pieces={visiblePieces.length > 0 ? visiblePieces : renderPieces}
          currentStep={currentStep}
          centerOffset={centerVec}
          diag={diag}
        />

        <OrbitControls
          makeDefault
          target={orbitTarget}
          minDistance={diag * 0.2}
          maxDistance={diag * 8}
          maxPolarAngle={Math.PI * 0.48}
          minPolarAngle={0.05}
        />
      </Canvas>

      <div className="absolute top-0 inset-x-0 z-10 pointer-events-none p-4 sm:p-6">
        <div className="max-w-xl mx-auto rounded-2xl bg-base-100/90 backdrop-blur-md border border-base-300/40 shadow-xl px-5 py-4 pointer-events-auto">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/70 mb-1">
            Paso {currentStep + 1} de {steps.length}
          </p>
          <h2 className="text-lg sm:text-xl font-bold text-base-content leading-tight">
            {step.title}
          </h2>
          <p className="text-sm text-base-content/65 mt-1.5 leading-relaxed">
            {step.description}
          </p>
          <p className="text-xs text-base-content/45 mt-2 font-mono">
            {step.panel_ids.length} pieza{step.panel_ids.length !== 1 ? "s" : ""} en este paso
          </p>
          <p className="text-[11px] text-base-content/35 mt-1 font-mono">
            {renderPieces.length} piezas totales · {placedCount} colocadas
            {viewerSchema === "oriented_box_v1" ? " · oriented_box_v1" : ""}
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
