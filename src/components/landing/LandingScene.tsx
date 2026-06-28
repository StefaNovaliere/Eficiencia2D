"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Line } from "@react-three/drei";
import type { Group } from "three";

interface LandingSceneProps {
  scrollProgress: number;
  primaryColor: string;
  secondaryColor: string;
  wallColor: string;
  floorColor: string;
}

interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "wall" | "floor" | "accent";
}

interface SheetSpec {
  position: [number, number, number];
  rotation: [number, number, number];
  width: number;
  height: number;
  panels: PanelRect[];
}

type Segment = [[number, number, number], [number, number, number]];

const INSET = 0.06;

function panelSegs(x: number, y: number, w: number, h: number, W: number, H: number): Segment[] {
  const map = (nx: number, ny: number): [number, number, number] => [
    (INSET + nx * (1 - 2 * INSET) - 0.5) * W,
    (INSET + ny * (1 - 2 * INSET) - 0.5) * H,
    0.002,
  ];
  const x0 = x;
  const y0 = y;
  const x1 = x + w;
  const y1 = y + h;
  return [
    [map(x0, y0), map(x1, y0)],
    [map(x1, y0), map(x1, y1)],
    [map(x1, y1), map(x0, y1)],
    [map(x0, y1), map(x0, y0)],
  ];
}

function sheetOutline(W: number, H: number): Segment[] {
  const m = INSET;
  const map = (nx: number, ny: number): [number, number, number] => [
    (m + nx * (1 - 2 * m) - 0.5) * W,
    (m + ny * (1 - 2 * m) - 0.5) * H,
    0,
  ];
  return [
    [map(0, 0), map(1, 0)],
    [map(1, 0), map(1, 1)],
    [map(1, 1), map(0, 1)],
    [map(0, 1), map(0, 0)],
  ];
}

function AestheticSheet({
  spec,
  primaryColor,
  secondaryColor,
  wallColor,
  floorColor,
  scrollProgress,
  index,
}: {
  spec: SheetSpec;
  primaryColor: string;
  secondaryColor: string;
  wallColor: string;
  floorColor: string;
  scrollProgress: number;
  index: number;
}) {
  const groupRef = useRef<Group>(null);
  const { position, rotation, width: W, height: H, panels } = spec;

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;
    groupRef.current.rotation.z =
      rotation[2] + scrollProgress * 0.1 + Math.sin(t * 0.32 + index) * 0.018;
  });

  const outline = sheetOutline(W, H);

  return (
    <group ref={groupRef} position={position} rotation={rotation}>
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[W * 1.02, H * 1.02]} />
        <meshBasicMaterial color={primaryColor} transparent opacity={0.07} />
      </mesh>

      {panels.map((p, i) => {
        const fill =
          p.kind === "floor" ? floorColor : p.kind === "accent" ? secondaryColor : wallColor;
        const stroke = p.kind === "accent" ? secondaryColor : primaryColor;
        const cx = INSET + (p.x + p.w / 2) * (1 - 2 * INSET);
        const cy = INSET + (p.y + p.h / 2) * (1 - 2 * INSET);
        const pw = p.w * (1 - 2 * INSET) * W * 0.94;
        const ph = p.h * (1 - 2 * INSET) * H * 0.94;
        const px = (cx - 0.5) * W;
        const py = (cy - 0.5) * H;
        const segs = panelSegs(p.x, p.y, p.w, p.h, W, H);

        return (
          <group key={i}>
            <mesh position={[px, py, 0.001]}>
              <planeGeometry args={[pw, ph]} />
              <meshBasicMaterial color={fill} transparent opacity={0.38} />
            </mesh>
            {segs.map((pts, j) => (
              <Line
                key={j}
                points={pts}
                color={stroke}
                lineWidth={1.1}
                transparent
                opacity={0.88}
              />
            ))}
          </group>
        );
      })}

      {outline.map((pts, i) => (
        <Line
          key={`o-${i}`}
          points={pts}
          color={primaryColor}
          lineWidth={1.4}
          transparent
          opacity={0.92}
          dashed
          dashSize={0.08}
          gapSize={0.05}
        />
      ))}
    </group>
  );
}

function SceneCore({
  scrollProgress,
  primaryColor,
  secondaryColor,
  wallColor,
  floorColor,
}: LandingSceneProps) {
  const coreRef = useRef<Group>(null);
  const particlesRef = useRef<Group>(null);

  const sheets: SheetSpec[] = useMemo(
    () => [
      {
        position: [0, 0.08, 0],
        rotation: [0.06, 0.14, 0.02],
        width: 2.7,
        height: 1.85,
        panels: [
          { x: 0.02, y: 0.04, w: 0.38, h: 0.42, kind: "wall" },
          { x: 0.42, y: 0.04, w: 0.22, h: 0.28, kind: "wall" },
          { x: 0.66, y: 0.04, w: 0.3, h: 0.2, kind: "accent" },
          { x: 0.02, y: 0.5, w: 0.55, h: 0.44, kind: "floor" },
          { x: 0.6, y: 0.28, w: 0.36, h: 0.66, kind: "floor" },
        ],
      },
      {
        position: [-1.85, -0.38, 0.28],
        rotation: [-0.04, -0.2, 0.14],
        width: 1.75,
        height: 1.25,
        panels: [
          { x: 0.03, y: 0.05, w: 0.5, h: 0.35, kind: "floor" },
          { x: 0.55, y: 0.05, w: 0.4, h: 0.22, kind: "wall" },
          { x: 0.03, y: 0.44, w: 0.28, h: 0.5, kind: "wall" },
          { x: 0.33, y: 0.44, w: 0.62, h: 0.5, kind: "floor" },
        ],
      },
      {
        position: [1.82, -0.12, -0.18],
        rotation: [0.05, 0.24, -0.1],
        width: 1.55,
        height: 1.15,
        panels: [
          { x: 0.04, y: 0.04, w: 0.18, h: 0.88, kind: "wall" },
          { x: 0.24, y: 0.04, w: 0.18, h: 0.88, kind: "wall" },
          { x: 0.44, y: 0.04, w: 0.52, h: 0.4, kind: "floor" },
          { x: 0.44, y: 0.48, w: 0.3, h: 0.44, kind: "accent" },
          { x: 0.76, y: 0.48, w: 0.2, h: 0.44, kind: "wall" },
        ],
      },
      {
        position: [0.15, 1.02, -0.48],
        rotation: [-0.1, 0.08, 0.2],
        width: 1.35,
        height: 0.95,
        panels: [
          { x: 0.05, y: 0.08, w: 0.4, h: 0.82, kind: "wall" },
          { x: 0.48, y: 0.08, w: 0.47, h: 0.35, kind: "floor" },
          { x: 0.48, y: 0.47, w: 0.22, h: 0.43, kind: "floor" },
          { x: 0.72, y: 0.47, w: 0.23, h: 0.43, kind: "wall" },
        ],
      },
      {
        position: [-0.95, 0.78, 0.55],
        rotation: [0.05, -0.32, 0.08],
        width: 1.1,
        height: 0.82,
        panels: [
          { x: 0.06, y: 0.1, w: 0.88, h: 0.28, kind: "floor" },
          { x: 0.06, y: 0.42, w: 0.4, h: 0.48, kind: "wall" },
          { x: 0.5, y: 0.42, w: 0.44, h: 0.22, kind: "accent" },
          { x: 0.5, y: 0.66, w: 0.44, h: 0.24, kind: "wall" },
        ],
      },
    ],
    [],
  );

  const particlePositions = useMemo(() => {
    const n = 100;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 14;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 10;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1;
    }
    return arr;
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (coreRef.current) {
      coreRef.current.rotation.y = scrollProgress * Math.PI * 0.42 + t * 0.035;
      coreRef.current.rotation.x = 0.15 + scrollProgress * 0.1;
    }
    if (particlesRef.current) {
      particlesRef.current.rotation.y = t * 0.018;
    }
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[4, 3, 5]} intensity={1.3} color={primaryColor} />
      <pointLight position={[-4, -2, 4]} intensity={0.85} color={secondaryColor} />

      <group ref={particlesRef}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[particlePositions, 3]} />
          </bufferGeometry>
          <pointsMaterial
            size={0.032}
            color={primaryColor}
            transparent
            opacity={0.5}
            sizeAttenuation
          />
        </points>
      </group>

      <Float speed={0.9} rotationIntensity={0.08} floatIntensity={0.22}>
        <group ref={coreRef}>
          {sheets.map((sheet, i) => (
            <AestheticSheet
              key={i}
              spec={sheet}
              primaryColor={primaryColor}
              secondaryColor={secondaryColor}
              wallColor={wallColor}
              floorColor={floorColor}
              scrollProgress={scrollProgress}
              index={i}
            />
          ))}
        </group>
      </Float>
    </>
  );
}

export default function LandingScene({
  scrollProgress,
  primaryColor,
  secondaryColor,
  wallColor,
  floorColor,
}: LandingSceneProps) {
  return (
    <div className="landing-scene absolute inset-0 -z-10">
      <Canvas
        camera={{ position: [0, 0, 5.9], fov: 42 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <SceneCore
          scrollProgress={scrollProgress}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          wallColor={wallColor}
          floorColor={floorColor}
        />
      </Canvas>
    </div>
  );
}
