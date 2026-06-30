import { describe, expect, it } from "vitest";
import { isAdminUser, normalizeAuthUser } from "@/services/auth";
import { ADMIN_ROL_ID } from "@/services/rols";

describe("normalizeAuthUser", () => {
  it("incluye rol_id cuando el backend envía rol como objeto", () => {
    const user = normalizeAuthUser({
      id: "1",
      email: "admin@test.com",
      nombre: "Admin",
      estado: "activo",
      rol: { id: ADMIN_ROL_ID, rol: "admin" },
    });

    expect(user.rol_id).toBe(ADMIN_ROL_ID);
    expect(user.rol).toBe("admin");
  });

  it("incluye rol_id cuando el backend envía rol_id directo", () => {
    const user = normalizeAuthUser({
      id: "1",
      email: "admin@test.com",
      nombre: "Admin",
      estado: "activo",
      rol_id: ADMIN_ROL_ID,
      rol: "admin",
    });

    expect(user.rol_id).toBe(ADMIN_ROL_ID);
    expect(user.rol).toBe("admin");
  });

  it("usa estudiante por defecto si rol no viene", () => {
    const user = normalizeAuthUser({
      id: "2",
      email: "user@test.com",
      nombre: null,
      estado: "activo",
    });

    expect(user.rol_id).toBe(1);
    expect(user.rol).toBe("estudiante");
  });
});

describe("isAdminUser", () => {
  it("devuelve true solo para rol_id admin", () => {
    expect(
      isAdminUser({
        id: "1",
        email: "a@test.com",
        nombre: null,
        estado: "activo",
        rol_id: ADMIN_ROL_ID,
        rol: "admin",
      }),
    ).toBe(true);

    expect(
      isAdminUser({
        id: "2",
        email: "b@test.com",
        nombre: null,
        estado: "activo",
        rol_id: 1,
        rol: "estudiante",
      }),
    ).toBe(false);
  });
});
