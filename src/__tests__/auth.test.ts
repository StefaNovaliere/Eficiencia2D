import { describe, expect, it } from "vitest";
import { isAdminUser, normalizeAuthUser } from "@/services/auth";

describe("normalizeAuthUser", () => {
  it("incluye rol del backend", () => {
    const user = normalizeAuthUser({
      id: "1",
      email: "admin@test.com",
      nombre: "Admin",
      estado: "activo",
      rol: "admin",
    });

    expect(user.rol).toBe("admin");
  });

  it("usa estudiante si rol no viene", () => {
    const user = normalizeAuthUser({
      id: "2",
      email: "user@test.com",
      nombre: null,
      estado: "activo",
    });

    expect(user.rol).toBe("estudiante");
  });
});

describe("isAdminUser", () => {
  it("devuelve true solo para rol admin", () => {
    expect(
      isAdminUser({
        id: "1",
        email: "a@test.com",
        nombre: null,
        estado: "activo",
        rol: "admin",
      }),
    ).toBe(true);

    expect(
      isAdminUser({
        id: "2",
        email: "b@test.com",
        nombre: null,
        estado: "activo",
        rol: "estudiante",
      }),
    ).toBe(false);
  });
});
