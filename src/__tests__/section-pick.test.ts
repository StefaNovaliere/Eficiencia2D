import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { sectionPlaneParams } from "@/core/section-plane";

/**
 * El plano de sección recorta el DIBUJO (clipping) pero no el raycast. La
 * selección filtra los hits con `plane.distanceToPoint(point) >= -eps`, así que
 * ese criterio DEBE coincidir con el lado que three.js conserva (distancia ≥ 0).
 * Este test fija esa convención sobre el MISMO plano que arma el visor.
 */
describe("filtrado de selección bajo el plano de sección", () => {
  const min = { x: 0, y: 0, z: 0 };
  const max = { x: 10, y: 10, z: 10 };
  const center = { x: 5, y: 5, z: 5 };

  function planeFor(axis: "x" | "y" | "z", pos: number): THREE.Plane {
    const { normal, constant } = sectionPlaneParams(axis, pos, min, max, center);
    return new THREE.Plane(
      new THREE.Vector3(normal.x, normal.y, normal.z),
      constant,
    );
  }

  it("conserva el lado de coordenada menor (visible) y descarta el recortado", () => {
    // Corte en x a la mitad: cutModel=5 → cutWorld=0.
    const plane = planeFor("x", 0.5);
    // world = model − center. model x=2 → world −3 (lado visible).
    const visible = new THREE.Vector3(-3, 0, 0);
    // model x=8 → world 3 (lado recortado por la cámara).
    const clipped = new THREE.Vector3(3, 0, 0);
    expect(plane.distanceToPoint(visible)).toBeGreaterThanOrEqual(0);
    expect(plane.distanceToPoint(clipped)).toBeLessThan(0);
  });

  it("funciona en otros ejes (y)", () => {
    const plane = planeFor("y", 0.25); // cutModel=2.5 → cutWorld=-2.5
    const visible = new THREE.Vector3(0, -4, 0); // model y=1
    const clipped = new THREE.Vector3(0, 0, 0); // model y=5 → world 0 > -2.5 → recortado
    expect(plane.distanceToPoint(visible)).toBeGreaterThanOrEqual(0);
    expect(plane.distanceToPoint(clipped)).toBeLessThan(0);
  });
});
