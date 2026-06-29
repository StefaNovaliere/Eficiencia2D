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
  converge: [number, number, number];
  convergeRot: [number, number, number];
}

type Segment = [[number, number, number], [number, number, number]];

const INSET = 0.06;
const HOUSE_Y = -1.05;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Crossfade tipo disolución: las dos capas nunca desaparecen a la vez. */
function dissolveCrossfade(t: number): { sheets: number; house: number } {
  const blend = smoothstep(0.14, 0.74, t);
  return {
    sheets: Math.cos(blend * Math.PI * 0.5),
    house: Math.sin(blend * Math.PI * 0.5),
  };
}

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

function SimpleHouse({
  houseWeight,
  blend,
  primaryColor,
  secondaryColor,
}: {
  houseWeight: number;
  blend: number;
  primaryColor: string;
  secondaryColor: string;
}) {
  const { bodyLines, roofLines, doorLines } = useMemo(() => {
    const hw = 0.58;
    const hd = 0.44;
    const y0 = 0;
    const y1 = 0.72;
    const peakY = 1.08;
    const zf = hd;
    const p = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

    const bl = [p(-hw, y0, -hd), p(hw, y0, -hd), p(hw, y0, hd), p(-hw, y0, hd)];
    const tl = [p(-hw, y1, -hd), p(hw, y1, -hd), p(hw, y1, hd), p(-hw, y1, hd)];
    const peak = p(0, peakY, 0);

    const body: Segment[] = [
      [bl[0], bl[1]],
      [bl[1], bl[2]],
      [bl[2], bl[3]],
      [bl[3], bl[0]],
      [bl[0], tl[0]],
      [bl[1], tl[1]],
      [bl[2], tl[2]],
      [bl[3], tl[3]],
      [tl[0], tl[1]],
      [tl[1], tl[2]],
      [tl[2], tl[3]],
      [tl[3], tl[0]],
    ];

    const roof: Segment[] = [
      [tl[2], peak],
      [tl[3], peak],
      [tl[0], peak],
      [tl[1], peak],
    ];

    const dw = 0.16;
    const dh = 0.34;
    const door: Segment[] = [
      [p(-dw / 2, y0, zf), p(dw / 2, y0, zf)],
      [p(dw / 2, y0, zf), p(dw / 2, y0 + dh, zf)],
      [p(dw / 2, y0 + dh, zf), p(-dw / 2, y0 + dh, zf)],
      [p(-dw / 2, y0 + dh, zf), p(-dw / 2, y0, zf)],
    ];

    return { bodyLines: body, roofLines: roof, doorLines: door };
  }, []);

  if (houseWeight < 0.02) return null;

  const settle = smoothstep(0.35, 1, blend);
  const y = lerp(-0.55, HOUSE_Y, settle);
  const scale = lerp(0.22, 1, houseWeight);
  const lineW = lerp(1.05, 2.15, houseWeight);
  const roofW = lerp(1.1, 2.35, houseWeight);
  const opacity = houseWeight * 0.94;

  return (
    <group position={[0, y, lerp(0.35, 0.15, settle)]} scale={scale}>
      {bodyLines.map((pts, i) => (
        <Line
          key={`b-${i}`}
          points={pts}
          color={primaryColor}
          lineWidth={lineW}
          transparent
          opacity={opacity}
        />
      ))}
      {roofLines.map((pts, i) => (
        <Line
          key={`r-${i}`}
          points={pts}
          color={secondaryColor}
          lineWidth={roofW}
          transparent
          opacity={opacity * smoothstep(0.25, 0.85, blend)}
        />
      ))}
      {doorLines.map((pts, i) => (
        <Line
          key={`d-${i}`}
          points={pts}
          color={secondaryColor}
          lineWidth={lerp(0.9, 1.75, houseWeight)}
          transparent
          opacity={opacity * smoothstep(0.45, 1, blend) * 0.88}
        />
      ))}
    </group>
  );
}

function AestheticSheet({
  spec,
  primaryColor,
  secondaryColor,
  wallColor,
  floorColor,
  convergeT,
  sheetWeight,
  blend,
  index,
}: {
  spec: SheetSpec;
  primaryColor: string;
  secondaryColor: string;
  wallColor: string;
  floorColor: string;
  convergeT: number;
  sheetWeight: number;
  blend: number;
  index: number;
}) {
  const groupRef = useRef<Group>(null);
  const { position, rotation, width: W, height: H, panels, converge, convergeRot } = spec;

  const pos = lerp3(position, converge, convergeT);
  const rot: [number, number, number] = [
    lerp(rotation[0], convergeRot[0], convergeT),
    lerp(rotation[1], convergeRot[1], convergeT),
    lerp(rotation[2], convergeRot[2], convergeT),
  ];
  const scale = lerp(1, 0.18, convergeT);
  const fillAlpha = sheetWeight * (1 - smoothstep(0.08, 0.55, blend));
  const lineAlpha = sheetWeight * 0.92;
  const lineW = lerp(1.1, 1.35, 1 - convergeT);
  const outline = sheetOutline(W, H);
  const useDashed = blend < 0.22;

  useFrame((state) => {
    if (!groupRef.current || sheetWeight < 0.04) return;
    const t = state.clock.elapsedTime;
    const wobble = (1 - convergeT * 0.85) * sheetWeight;
    groupRef.current.rotation.x = rot[0] + Math.sin(t * 0.28 + index) * 0.035 * wobble;
    groupRef.current.rotation.y = rot[1] + Math.cos(t * 0.22 + index * 0.7) * 0.04 * wobble;
    groupRef.current.rotation.z = rot[2] + Math.sin(t * 0.32 + index) * 0.018 * wobble;
    groupRef.current.position.x = pos[0] + Math.sin(t * 0.4 + index) * 0.045 * wobble;
    groupRef.current.position.y = pos[1] + Math.cos(t * 0.35 + index) * 0.03 * wobble;
    groupRef.current.position.z = pos[2];
  });

  if (sheetWeight < 0.03) return null;

  return (
    <group ref={groupRef} scale={scale}>
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
            {fillAlpha > 0.04 && (
              <mesh position={[px, py, 0.001]}>
                <planeGeometry args={[pw, ph]} />
                <meshBasicMaterial color={fill} transparent opacity={0.38 * fillAlpha} />
              </mesh>
            )}
            {segs.map((pts, j) => (
              <Line
                key={j}
                points={pts}
                color={stroke}
                lineWidth={lineW}
                transparent
                opacity={lineAlpha}
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
          lineWidth={lineW + 0.15}
          transparent
          opacity={lineAlpha}
          dashed={useDashed}
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
  const morphRef = useRef<Group>(null);
  const particlesRef = useRef<Group>(null);

  const blend = smoothstep(0.1, 0.76, scrollProgress);
  const { sheets: sheetWeight, house: houseWeight } = dissolveCrossfade(scrollProgress);
  const convergeT = smoothstep(0.08, 0.72, scrollProgress);
  const floatIntensity = (1 - blend) * sheetWeight;

  const sheets: SheetSpec[] = useMemo(
    () => [
      {
        position: [0, 0.35, 0],
        rotation: [0.06, 0.14, 0.02],
        width: 2.7,
        height: 1.85,
        converge: [0, -0.42, 0.22],
        convergeRot: [-Math.PI / 2, 0.05, 0],
        panels: [
          { x: 0.02, y: 0.04, w: 0.38, h: 0.42, kind: "wall" },
          { x: 0.42, y: 0.04, w: 0.22, h: 0.28, kind: "wall" },
          { x: 0.66, y: 0.04, w: 0.3, h: 0.2, kind: "accent" },
          { x: 0.02, y: 0.5, w: 0.55, h: 0.44, kind: "floor" },
          { x: 0.6, y: 0.28, w: 0.36, h: 0.66, kind: "floor" },
        ],
      },
      {
        position: [-1.85, 0.05, 0.28],
        rotation: [-0.04, -0.2, 0.14],
        width: 1.75,
        height: 1.25,
        converge: [-0.38, -0.18, 0.08],
        convergeRot: [0, Math.PI / 2, 0.02],
        panels: [
          { x: 0.03, y: 0.05, w: 0.5, h: 0.35, kind: "floor" },
          { x: 0.55, y: 0.05, w: 0.4, h: 0.22, kind: "wall" },
          { x: 0.03, y: 0.44, w: 0.28, h: 0.5, kind: "wall" },
          { x: 0.33, y: 0.44, w: 0.62, h: 0.5, kind: "floor" },
        ],
      },
      {
        position: [1.82, 0.22, -0.18],
        rotation: [0.05, 0.24, -0.1],
        width: 1.55,
        height: 1.15,
        converge: [0.38, -0.18, 0.08],
        convergeRot: [0, -Math.PI / 2, -0.02],
        panels: [
          { x: 0.04, y: 0.04, w: 0.18, h: 0.88, kind: "wall" },
          { x: 0.24, y: 0.04, w: 0.18, h: 0.88, kind: "wall" },
          { x: 0.44, y: 0.04, w: 0.52, h: 0.4, kind: "floor" },
          { x: 0.44, y: 0.48, w: 0.3, h: 0.44, kind: "accent" },
          { x: 0.76, y: 0.48, w: 0.2, h: 0.44, kind: "wall" },
        ],
      },
      {
        position: [0.15, 1.15, -0.48],
        rotation: [-0.1, 0.08, 0.2],
        width: 1.35,
        height: 0.95,
        converge: [0.05, -0.05, -0.28],
        convergeRot: [-Math.PI / 2, 0.02, 0],
        panels: [
          { x: 0.05, y: 0.08, w: 0.4, h: 0.82, kind: "wall" },
          { x: 0.48, y: 0.08, w: 0.47, h: 0.35, kind: "floor" },
          { x: 0.48, y: 0.47, w: 0.22, h: 0.43, kind: "floor" },
          { x: 0.72, y: 0.47, w: 0.23, h: 0.43, kind: "wall" },
        ],
      },
      {
        position: [-0.95, 0.95, 0.55],
        rotation: [0.05, -0.32, 0.08],
        width: 1.1,
        height: 0.82,
        converge: [0, 0.28, 0.05],
        convergeRot: [-Math.PI / 2.1, 0.4, 0.05],
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
    if (morphRef.current) {
      const spin = (1 - blend * 0.92) * 0.038;
      morphRef.current.rotation.y = scrollProgress * Math.PI * 0.32 + t * spin;
      morphRef.current.rotation.x = lerp(0.12, 0.04, blend);
    }
    if (particlesRef.current) {
      particlesRef.current.rotation.y = t * 0.018 * (1 - blend * 0.85);
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
            opacity={0.5 * sheetWeight * (1 - blend * 0.5)}
            sizeAttenuation
          />
        </points>
      </group>

      <Float
        speed={0.85 * floatIntensity + 0.12}
        rotationIntensity={0.08 * floatIntensity + 0.02}
        floatIntensity={0.22 * floatIntensity + 0.04}
      >
        <group ref={morphRef}>
          <SimpleHouse
            houseWeight={houseWeight}
            blend={blend}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
          />
          {sheets.map((sheet, i) => (
            <AestheticSheet
              key={i}
              spec={sheet}
              primaryColor={primaryColor}
              secondaryColor={secondaryColor}
              wallColor={wallColor}
              floorColor={floorColor}
              convergeT={convergeT}
              sheetWeight={sheetWeight}
              blend={blend}
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
        camera={{ position: [0, -0.12, 5.9], fov: 42 }}
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
