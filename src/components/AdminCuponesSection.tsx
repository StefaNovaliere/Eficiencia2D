"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, RefreshCw, Ticket } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getPlanes, type Plan } from "@/services/planes";
import {
  createCupon,
  datetimeLocalToIso,
  formatCuponBeneficio,
  formatCuponDate,
  isCuponActive,
  listCupones,
  updateCupon,
  type CreateCuponPayload,
  type Cupon,
  type CuponesListFilters,
} from "@/services/cupones";

type BeneficioTipo = "porcentaje" | "monto" | "plan";
type TipoFilter = "" | "plan" | "descuento";
type DescuentoTipoFilter = "" | "porcentaje" | "monto";
type ActivoFilter = "" | "true" | "false";

const DEFAULT_FILTERS = {
  tipo: "" as TipoFilter,
  descuento_tipo: "" as DescuentoTipoFilter,
  plan_id: "",
  activo: "" as ActivoFilter,
  fecha_inicio_desde: "",
  fecha_inicio_hasta: "",
};

const EMPTY_FORM = {
  codigo: "",
  descripcion: "",
  beneficioTipo: "porcentaje" as BeneficioTipo,
  descuento_porcentaje: "20",
  descuento_monto: "1500",
  plan_id: "",
  limite_usos: "100",
  limite_usos_por_usuario: "1",
  fecha_inicio: "",
  fecha_expiracion: "",
  activo: true,
};

export default function AdminCuponesSection() {
  const { token } = useAuth();
  const [cupones, setCupones] = useState<Cupon[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [listMeta, setListMeta] = useState({ total: 0, total_pages: 0, page_size: 20 });
  const [form, setForm] = useState(EMPTY_FORM);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [hideFilters, setHideFilters] = useState(true);

  const buildListFilters = useCallback((): CuponesListFilters => {
    const query: CuponesListFilters = { page, page_size: 20 };
    if (filters.activo === "true") query.activo = true;
    if (filters.activo === "false") query.activo = false;
    if (filters.tipo) query.tipo = filters.tipo;
    if (filters.descuento_tipo) query.descuento_tipo = filters.descuento_tipo;
    if (filters.plan_id) {
      const planId = Number(filters.plan_id);
      if (Number.isFinite(planId)) query.plan_id = planId;
    }
    const desde = datetimeLocalToIso(filters.fecha_inicio_desde);
    const hasta = datetimeLocalToIso(filters.fecha_inicio_hasta);
    if (desde) query.fecha_inicio_desde = desde;
    if (hasta) query.fecha_inicio_hasta = hasta;
    return query;
  }, [filters, page]);

  const loadCupones = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await listCupones(token, buildListFilters());
      setCupones(result.cupones);
      setListMeta({
        total: result.total,
        total_pages: result.total_pages,
        page_size: result.page_size,
      });
    } catch (err) {
      setCupones([]);
      setListMeta({ total: 0, total_pages: 0, page_size: 20 });
      setError(err instanceof Error ? err.message : "No se pudieron cargar los cupones");
    } finally {
      setIsLoading(false);
    }
  }, [token, buildListFilters]);

  useEffect(() => {
    void loadCupones();
  }, [loadCupones]);

  useEffect(() => {
    getPlanes()
      .then(setPlanes)
      .catch(() => setPlanes([]));
  }, []);

  function applyFilters(next: Partial<typeof DEFAULT_FILTERS>) {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  const visibleCupones = cupones;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    const codigo = form.codigo.trim();
    const descripcion = form.descripcion.trim();
    const limiteUsos = Number(form.limite_usos);

    if (!codigo) {
      setError("El código es obligatorio");
      return;
    }
    if (!descripcion) {
      setError("La descripción es obligatoria");
      return;
    }
    if (!Number.isFinite(limiteUsos) || limiteUsos < 1) {
      setError("El límite de usos total debe ser un número mayor o igual a 1");
      return;
    }

    const limitePorUsuario = form.limite_usos_por_usuario.trim()
      ? Number(form.limite_usos_por_usuario)
      : undefined;
    if (
      limitePorUsuario != null &&
      (!Number.isFinite(limitePorUsuario) || limitePorUsuario < 1)
    ) {
      setError("El límite por usuario debe ser un número mayor a 0");
      return;
    }

    let payload: CreateCuponPayload;

    if (form.beneficioTipo === "porcentaje") {
      const descuento = Number(form.descuento_porcentaje);
      if (!Number.isFinite(descuento) || descuento <= 0 || descuento > 100) {
        setError("El descuento porcentual debe estar entre 1 y 100");
        return;
      }
      payload = {
        codigo,
        descripcion,
        limite_usos: limiteUsos,
        limite_usos_por_usuario: limitePorUsuario,
        descuento_porcentaje: descuento,
        fecha_inicio: datetimeLocalToIso(form.fecha_inicio),
        fecha_expiracion: datetimeLocalToIso(form.fecha_expiracion),
        activo: form.activo,
      };
    } else if (form.beneficioTipo === "monto") {
      const monto = Number(form.descuento_monto);
      if (!Number.isFinite(monto) || monto <= 0) {
        setError("El descuento fijo debe ser un monto mayor a 0");
        return;
      }
      payload = {
        codigo,
        descripcion,
        limite_usos: limiteUsos,
        limite_usos_por_usuario: limitePorUsuario,
        descuento_monto: monto,
        fecha_inicio: datetimeLocalToIso(form.fecha_inicio),
        fecha_expiracion: datetimeLocalToIso(form.fecha_expiracion),
        activo: form.activo,
      };
    } else {
      const planId = Number(form.plan_id);
      if (!Number.isFinite(planId) || planId < 1) {
        setError("Seleccioná un plan para el cupón de acceso");
        return;
      }
      payload = {
        codigo,
        descripcion,
        limite_usos: limiteUsos,
        limite_usos_por_usuario: limitePorUsuario,
        plan_id: planId,
        fecha_inicio: datetimeLocalToIso(form.fecha_inicio),
        fecha_expiracion: datetimeLocalToIso(form.fecha_expiracion),
        activo: form.activo,
      };
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const created = await createCupon(token, payload);
      setCupones((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
      setForm(EMPTY_FORM);
      setShowForm(false);
      setSuccess(`Cupón ${created.codigo} creado correctamente.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el cupón");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleActivo(cupon: Cupon) {
    if (!token) return;

    setTogglingId(cupon.id);
    setError(null);
    setSuccess(null);

    try {
      const updated = await updateCupon(token, cupon.id, { activo: !cupon.activo });
      setCupones((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setSuccess(
        updated.activo
          ? `Cupón ${updated.codigo} reactivado.`
          : `Cupón ${updated.codigo} desactivado.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el cupón");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <section className="space-y-4 pt-2 border-t border-base-300/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary shrink-0">
            <Ticket size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-base-content">Cupones</h3>
            <p className="text-xs text-base-content/55 mt-0.5">
              Descuentos en planes de pago o acceso directo a un plan.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={() => void loadCupones()}
            disabled={isLoading}
            title="Actualizar lista"
            aria-label="Actualizar lista"
          >
            <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm rounded-xl gap-1"
            onClick={() => {
              setShowForm((v) => !v);
              setError(null);
              setSuccess(null);
            }}
          >
            <Plus size={16} />
            Nuevo cupón
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="rounded-xl border border-base-300/60 bg-base-100/50 p-4 md:p-5 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="form-control w-full sm:col-span-1">
              <span className="label-text text-xs font-medium mb-1">Código *</span>
              <input
                type="text"
                className="input input-bordered input-sm w-full uppercase"
                placeholder="VERANO2026"
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
                required
              />
            </label>
            <label className="form-control w-full sm:col-span-2">
              <span className="label-text text-xs font-medium mb-1">Descripción *</span>
              <input
                type="text"
                className="input input-bordered input-sm w-full"
                placeholder="20% off en plan Pro"
                value={form.descripcion}
                onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                required
              />
            </label>

            <label className="form-control w-full sm:col-span-2">
              <span className="label-text text-xs font-medium mb-1">Tipo de beneficio *</span>
              <select
                className="select select-bordered select-sm w-full"
                value={form.beneficioTipo}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    beneficioTipo: e.target.value as BeneficioTipo,
                  }))
                }
              >
                <option value="porcentaje">Descuento porcentual (%)</option>
                <option value="monto">Descuento fijo (monto)</option>
                <option value="plan">Acceso a un plan (sin pago)</option>
              </select>
            </label>

            {form.beneficioTipo === "porcentaje" && (
              <label className="form-control w-full">
                <span className="label-text text-xs font-medium mb-1">Descuento (%) *</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input input-bordered input-sm w-full"
                  value={form.descuento_porcentaje}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, descuento_porcentaje: e.target.value }))
                  }
                  required
                />
              </label>
            )}

            {form.beneficioTipo === "monto" && (
              <label className="form-control w-full">
                <span className="label-text text-xs font-medium mb-1">Descuento fijo (ARS) *</span>
                <input
                  type="number"
                  min={1}
                  className="input input-bordered input-sm w-full"
                  value={form.descuento_monto}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, descuento_monto: e.target.value }))
                  }
                  required
                />
              </label>
            )}

            {form.beneficioTipo === "plan" && (
              <label className="form-control w-full sm:col-span-2">
                <span className="label-text text-xs font-medium mb-1">Plan incluido *</span>
                <select
                  className="select select-bordered select-sm w-full"
                  value={form.plan_id}
                  onChange={(e) => setForm((f) => ({ ...f, plan_id: e.target.value }))}
                  required
                >
                  <option value="">Seleccioná un plan</option>
                  {planes.map((plan) => (
                    <option key={plan.id} value={plan.plan_id}>
                      {plan.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="form-control w-full">
              <span className="label-text text-xs font-medium mb-1">Límite de usos total *</span>
              <input
                type="number"
                min={1}
                className="input input-bordered input-sm w-full"
                placeholder="100"
                value={form.limite_usos}
                onChange={(e) => setForm((f) => ({ ...f, limite_usos: e.target.value }))}
                required
              />
            </label>
            <label className="form-control w-full">
              <span className="label-text text-xs font-medium mb-1">Límite por usuario</span>
              <input
                type="number"
                min={1}
                className="input input-bordered input-sm w-full"
                placeholder="1"
                value={form.limite_usos_por_usuario}
                onChange={(e) =>
                  setForm((f) => ({ ...f, limite_usos_por_usuario: e.target.value }))
                }
              />
            </label>
            <label className="form-control w-full">
              <span className="label-text text-xs font-medium mb-1">Válido desde</span>
              <input
                type="datetime-local"
                className="input input-bordered input-sm w-full"
                value={form.fecha_inicio}
                onChange={(e) => setForm((f) => ({ ...f, fecha_inicio: e.target.value }))}
              />
            </label>
            <label className="form-control w-full">
              <span className="label-text text-xs font-medium mb-1">Expira</span>
              <input
                type="datetime-local"
                className="input input-bordered input-sm w-full"
                value={form.fecha_expiracion}
                onChange={(e) => setForm((f) => ({ ...f, fecha_expiracion: e.target.value }))}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={form.activo}
              onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
            />
            <span className="text-sm">Cupón activo al crearlo</span>
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="btn btn-primary btn-sm rounded-xl"
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear cupón"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm rounded-xl"
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_FORM);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="alert alert-error rounded-xl text-sm py-3">
          <span>{error}</span>
        </div>
      )}

      {success && !error && (
        <div className="alert alert-success rounded-xl text-sm py-3">
          <span>{success}</span>
        </div>
      )}

      <div className="rounded-xl border border-base-300/60 bg-base-100/40 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-base-content/70">Filtros</p>
          <button
            type="button"
            onClick={() => setHideFilters((v) => !v)}
            className="btn btn-outline btn-sm rounded-xl border-base-300 gap-2"
            aria-expanded={!hideFilters}
            aria-label={hideFilters ? "Mostrar filtros" : "Ocultar filtros"}
          >
            {hideFilters ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
        <div className={`space-y-3 ${hideFilters ? "hidden" : ""}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <label className="form-control w-full">
            <span className="label-text text-xs mb-1">Estado en BD</span>
            <select
              className="select select-bordered select-sm w-full"
              value={filters.activo}
              onChange={(e) => applyFilters({ activo: e.target.value as ActivoFilter })}
            >
              <option value="">Todos</option>
              <option value="true">Activos</option>
              <option value="false">Desactivados</option>
            </select>
          </label>
          <label className="form-control w-full">
            <span className="label-text text-xs mb-1">Tipo de cupón</span>
            <select
              className="select select-bordered select-sm w-full"
              value={filters.tipo}
              onChange={(e) => {
                const tipo = e.target.value as TipoFilter;
                applyFilters({
                  tipo,
                  descuento_tipo: tipo === "plan" ? "" : filters.descuento_tipo,
                  plan_id: tipo === "descuento" ? "" : filters.plan_id,
                });
              }}
            >
              <option value="">Todos</option>
              <option value="plan">Acceso a plan</option>
              <option value="descuento">Descuento</option>
            </select>
          </label>
          <label className="form-control w-full">
            <span className="label-text text-xs mb-1">Tipo de descuento</span>
            <select
              className="select select-bordered select-sm w-full"
              value={filters.descuento_tipo}
              disabled={filters.tipo === "plan"}
              onChange={(e) =>
                applyFilters({ descuento_tipo: e.target.value as DescuentoTipoFilter })
              }
            >
              <option value="">Todos</option>
              <option value="porcentaje">Porcentaje</option>
              <option value="monto">Monto fijo</option>
            </select>
          </label>
          <label className="form-control w-full">
            <span className="label-text text-xs mb-1">Plan específico</span>
            <select
              className="select select-bordered select-sm w-full"
              value={filters.plan_id}
              disabled={filters.tipo === "descuento"}
              onChange={(e) => applyFilters({ plan_id: e.target.value })}
            >
              <option value="">Todos</option>
              {planes.map((plan) => (
                <option key={plan.id} value={String(plan.plan_id)}>
                  {plan.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control w-full">
            <span className="label-text text-xs mb-1">Inicio desde</span>
            <input
              type="datetime-local"
              className="input input-bordered input-sm w-full"
              value={filters.fecha_inicio_desde}
              onChange={(e) => applyFilters({ fecha_inicio_desde: e.target.value })}
            />
          </label>
          <label className="form-control w-full">
            <span className="label-text text-xs mb-1">Inicio hasta</span>
            <input
              type="datetime-local"
              className="input input-bordered input-sm w-full"
              value={filters.fecha_inicio_hasta}
              onChange={(e) => applyFilters({ fecha_inicio_hasta: e.target.value })}
            />
          </label>
        </div>
        <button type="button" className="btn btn-ghost btn-xs" onClick={resetFilters}>
          Limpiar filtros
        </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-base-content/55">
          {listMeta.total} cupón{listMeta.total === 1 ? "" : "es"}
          {listMeta.total_pages > 1
            ? ` · página ${page} de ${listMeta.total_pages}`
            : ""}
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-base-content/50 py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando cupones…
        </div>
      ) : visibleCupones.length === 0 ? (
        <p className="text-sm text-base-content/55 py-2">
          No hay cupones que coincidan con los filtros.
        </p>
      ) : (
        <>
        <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {visibleCupones.map((cupon) => {
            const activeNow = isCuponActive(cupon);
            const isToggling = togglingId === cupon.id;

            return (
              <li
                key={cupon.id}
                className="rounded-xl border border-base-300/60 bg-base-100/50 px-3 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-mono font-semibold text-sm tracking-wide">
                        {cupon.codigo}
                      </p>
                      <span
                        className={`badge badge-sm ${
                          cupon.tipo === "plan" ? "badge-secondary" : "badge-primary"
                        }`}
                      >
                        {formatCuponBeneficio(cupon)}
                      </span>
                      {!cupon.activo ? (
                        <span className="badge badge-warning badge-outline badge-sm">
                          Desactivado
                        </span>
                      ) : activeNow ? (
                        <span className="badge badge-success badge-outline badge-sm">Activo</span>
                      ) : (
                        <span className="badge badge-ghost badge-sm">Inactivo</span>
                      )}
                    </div>
                    {cupon.descripcion && (
                      <p className="text-xs text-base-content/60 mt-1">{cupon.descripcion}</p>
                    )}
                    <p className="text-xs text-base-content/45 mt-1.5 leading-relaxed">
                      {cupon.limite_usos != null
                        ? `Usos: ${cupon.usos_actuales ?? 0}/${cupon.limite_usos}`
                        : "Sin límite total"}
                      {cupon.limite_usos_por_usuario != null
                        ? ` · ${cupon.limite_usos_por_usuario} por usuario`
                        : ""}
                    </p>
                    <p className="text-xs text-base-content/45 mt-0.5">
                      Desde {formatCuponDate(cupon.fecha_inicio)} · Hasta{" "}
                      {formatCuponDate(cupon.fecha_expiracion)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`btn btn-sm rounded-xl shrink-0 ${
                      cupon.activo ? "btn-outline btn-error" : "btn-outline btn-success"
                    }`}
                    disabled={isToggling || isSaving}
                    onClick={() => void handleToggleActivo(cupon)}
                  >
                    {isToggling ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : cupon.activo ? (
                      "Desactivar"
                    ) : (
                      "Reactivar"
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {listMeta.total_pages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              type="button"
              className="btn btn-sm btn-outline rounded-xl"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <span className="text-xs text-base-content/55">
              {page} / {listMeta.total_pages}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-outline rounded-xl"
              disabled={page >= listMeta.total_pages || isLoading}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </button>
          </div>
        )}
        </>
      )}
    </section>
  );
}
