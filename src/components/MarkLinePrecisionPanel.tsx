"use client";

import { useEffect, useState } from "react";
import {
  formatMarkDegreesInput,
  formatMarkMetersInput,
  parseMarkDegreesInput,
  parseMarkMetersInput,
  type MarkHorizontalEdge,
  type MarkLinePrecisionSpec,
  type MarkVerticalEdge,
  type MarkRectPrecisionSpec,
  type MarkCirclePrecisionSpec,
} from "@/core/mark-lines";
import type { MarkLineMode } from "@/components/MarkLineToolOverlay";

// ─── Common sub-components ────────────────────────────────────────────────────

function MLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="label py-0.5">
      <span className="label-text text-[10px] uppercase tracking-wide text-base-content/55">
        {children}
      </span>
    </span>
  );
}

function MInput({
  value, disabled, onChange, unit,
}: {
  value: string; disabled: boolean; onChange: (v: string) => void; unit: string;
}) {
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        className="input input-bordered input-xs w-full font-mono pr-7"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-base-content/40">
        {unit}
      </span>
    </div>
  );
}

function MEdgeHSelect({
  value, disabled, onChange,
}: {
  value: MarkHorizontalEdge; disabled: boolean; onChange: (v: MarkHorizontalEdge) => void;
}) {
  return (
    <select
      className="select select-bordered select-xs w-full"
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value as MarkHorizontalEdge)}
    >
      <option value="left">Izquierda</option>
      <option value="right">Derecha</option>
    </select>
  );
}

function MEdgeVSelect({
  value, disabled, onChange,
}: {
  value: MarkVerticalEdge; disabled: boolean; onChange: (v: MarkVerticalEdge) => void;
}) {
  return (
    <select
      className="select select-bordered select-xs w-full"
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value as MarkVerticalEdge)}
    >
      <option value="top">Techo / arriba</option>
      <option value="bottom">Piso / abajo</option>
    </select>
  );
}

// ─── Straight line panel ──────────────────────────────────────────────────────

interface StraightPanelProps {
  spec: MarkLinePrecisionSpec;
  disabled?: boolean;
  liveFromDrag?: boolean;
  onChange: (next: MarkLinePrecisionSpec) => void;
}

function StraightPanel({ spec, disabled = false, liveFromDrag = false, onChange }: StraightPanelProps) {
  const [local, setLocal] = useState(spec);
  const [lengthText, setLengthText] = useState(() => formatMarkMetersInput(spec.lengthM));
  const [angleText, setAngleText] = useState(() => formatMarkDegreesInput(spec.angleDeg));
  const [offsetHText, setOffsetHText] = useState(() => formatMarkMetersInput(spec.offsetHorizontalM));
  const [offsetVText, setOffsetVText] = useState(() => formatMarkMetersInput(spec.offsetVerticalM));

  useEffect(() => {
    setLocal(spec);
    setLengthText(formatMarkMetersInput(spec.lengthM));
    setAngleText(formatMarkDegreesInput(spec.angleDeg));
    setOffsetHText(formatMarkMetersInput(spec.offsetHorizontalM));
    setOffsetVText(formatMarkMetersInput(spec.offsetVerticalM));
  }, [spec]);

  const commit = (next: MarkLinePrecisionSpec) => { setLocal(next); onChange(next); };
  const fd = disabled || liveFromDrag;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <MLabel>Largo</MLabel>
          <MInput value={lengthText} disabled={fd} unit="m" onChange={(v) => {
            setLengthText(v);
            const p = parseMarkMetersInput(v);
            if (p != null) commit({ ...local, lengthM: p });
          }} />
        </label>
        <label className="form-control w-full min-w-0">
          <MLabel>Ángulo</MLabel>
          <MInput value={angleText} disabled={fd} unit="°" onChange={(v) => {
            setAngleText(v);
            const p = parseMarkDegreesInput(v);
            if (p != null) commit({ ...local, angleDeg: p });
          }} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <MLabel>Borde horiz.</MLabel>
          <MEdgeHSelect value={local.horizontalEdge} disabled={fd}
            onChange={(v) => commit({ ...local, horizontalEdge: v })} />
        </label>
        <label className="form-control w-full min-w-0">
          <MLabel>{local.horizontalEdge === "left" ? "Desde izq." : "Desde der."}</MLabel>
          <MInput value={offsetHText} disabled={fd} unit="m" onChange={(v) => {
            setOffsetHText(v);
            const p = parseMarkMetersInput(v);
            if (p != null) commit({ ...local, offsetHorizontalM: p });
          }} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <MLabel>Borde vert.</MLabel>
          <MEdgeVSelect value={local.verticalEdge} disabled={fd}
            onChange={(v) => commit({ ...local, verticalEdge: v })} />
        </label>
        <label className="form-control w-full min-w-0">
          <MLabel>{local.verticalEdge === "top" ? "Desde arriba" : "Desde abajo"}</MLabel>
          <MInput value={offsetVText} disabled={fd} unit="m" onChange={(v) => {
            setOffsetVText(v);
            const p = parseMarkMetersInput(v);
            if (p != null) commit({ ...local, offsetVerticalM: p });
          }} />
        </label>
      </div>
    </>
  );
}

// ─── Rectangle panel ──────────────────────────────────────────────────────────

interface RectPanelProps {
  spec: MarkRectPrecisionSpec;
  disabled?: boolean;
  liveFromDrag?: boolean;
  onChange: (next: MarkRectPrecisionSpec) => void;
}

function RectPanel({ spec, disabled = false, liveFromDrag = false, onChange }: RectPanelProps) {
  const [local, setLocal] = useState(spec);
  const [wText, setWText] = useState(() => formatMarkMetersInput(spec.widthM));
  const [hText, setHText] = useState(() => formatMarkMetersInput(spec.heightM));
  const [offsetHText, setOffsetHText] = useState(() => formatMarkMetersInput(spec.offsetHorizontalM));
  const [offsetVText, setOffsetVText] = useState(() => formatMarkMetersInput(spec.offsetVerticalM));

  useEffect(() => {
    setLocal(spec);
    setWText(formatMarkMetersInput(spec.widthM));
    setHText(formatMarkMetersInput(spec.heightM));
    setOffsetHText(formatMarkMetersInput(spec.offsetHorizontalM));
    setOffsetVText(formatMarkMetersInput(spec.offsetVerticalM));
  }, [spec]);

  const commit = (next: MarkRectPrecisionSpec) => { setLocal(next); onChange(next); };
  const fd = disabled || liveFromDrag;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <MLabel>Ancho</MLabel>
          <MInput value={wText} disabled={fd} unit="m" onChange={(v) => {
            setWText(v);
            const p = parseMarkMetersInput(v);
            if (p != null) commit({ ...local, widthM: p });
          }} />
        </label>
        <label className="form-control w-full min-w-0">
          <MLabel>Alto</MLabel>
          <MInput value={hText} disabled={fd} unit="m" onChange={(v) => {
            setHText(v);
            const p = parseMarkMetersInput(v);
            if (p != null) commit({ ...local, heightM: p });
          }} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <MLabel>Borde horiz.</MLabel>
          <MEdgeHSelect value={local.horizontalEdge} disabled={fd}
            onChange={(v) => commit({ ...local, horizontalEdge: v })} />
        </label>
        <label className="form-control w-full min-w-0">
          <MLabel>{local.horizontalEdge === "left" ? "Desde izq." : "Desde der."}</MLabel>
          <MInput value={offsetHText} disabled={fd} unit="m" onChange={(v) => {
            setOffsetHText(v);
            const p = parseMarkMetersInput(v);
            if (p != null) commit({ ...local, offsetHorizontalM: p });
          }} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <MLabel>Borde vert.</MLabel>
          <MEdgeVSelect value={local.verticalEdge} disabled={fd}
            onChange={(v) => commit({ ...local, verticalEdge: v })} />
        </label>
        <label className="form-control w-full min-w-0">
          <MLabel>{local.verticalEdge === "top" ? "Desde arriba" : "Desde abajo"}</MLabel>
          <MInput value={offsetVText} disabled={fd} unit="m" onChange={(v) => {
            setOffsetVText(v);
            const p = parseMarkMetersInput(v);
            if (p != null) commit({ ...local, offsetVerticalM: p });
          }} />
        </label>
      </div>
    </>
  );
}

// ─── Circle / Ellipse panel ───────────────────────────────────────────────────

interface CirclePanelProps {
  spec: MarkCirclePrecisionSpec;
  disabled?: boolean;
  liveFromDrag?: boolean;
  onChange: (next: MarkCirclePrecisionSpec) => void;
}

function CirclePanel({ spec, disabled = false, liveFromDrag = false, onChange }: CirclePanelProps) {
  const [local, setLocal] = useState(spec);
  const [ruText, setRuText] = useState(() => formatMarkMetersInput(spec.radiusUM));
  const [rvText, setRvText] = useState(() => formatMarkMetersInput(spec.radiusVM));
  const [offsetHText, setOffsetHText] = useState(() => formatMarkMetersInput(spec.offsetHorizontalM));
  const [offsetVText, setOffsetVText] = useState(() => formatMarkMetersInput(spec.offsetVerticalM));

  useEffect(() => {
    setLocal(spec);
    setRuText(formatMarkMetersInput(spec.radiusUM));
    setRvText(formatMarkMetersInput(spec.radiusVM));
    setOffsetHText(formatMarkMetersInput(spec.offsetHorizontalM));
    setOffsetVText(formatMarkMetersInput(spec.offsetVerticalM));
  }, [spec]);

  const commit = (next: MarkCirclePrecisionSpec) => { setLocal(next); onChange(next); };
  const fd = disabled || liveFromDrag;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <MLabel>Radio H</MLabel>
          <MInput value={ruText} disabled={fd} unit="m" onChange={(v) => {
            setRuText(v);
            const p = parseMarkMetersInput(v);
            if (p != null) commit({ ...local, radiusUM: p });
          }} />
        </label>
        <label className="form-control w-full min-w-0">
          <MLabel>Radio V</MLabel>
          <MInput value={rvText} disabled={fd} unit="m" onChange={(v) => {
            setRvText(v);
            const p = parseMarkMetersInput(v);
            if (p != null) commit({ ...local, radiusVM: p });
          }} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <MLabel>Borde horiz.</MLabel>
          <MEdgeHSelect value={local.horizontalEdge} disabled={fd}
            onChange={(v) => commit({ ...local, horizontalEdge: v })} />
        </label>
        <label className="form-control w-full min-w-0">
          <MLabel>{local.horizontalEdge === "left" ? "Centro desde izq." : "Centro desde der."}</MLabel>
          <MInput value={offsetHText} disabled={fd} unit="m" onChange={(v) => {
            setOffsetHText(v);
            const p = parseMarkMetersInput(v);
            if (p != null) commit({ ...local, offsetHorizontalM: p });
          }} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="form-control w-full min-w-0">
          <MLabel>Borde vert.</MLabel>
          <MEdgeVSelect value={local.verticalEdge} disabled={fd}
            onChange={(v) => commit({ ...local, verticalEdge: v })} />
        </label>
        <label className="form-control w-full min-w-0">
          <MLabel>{local.verticalEdge === "top" ? "Centro desde arriba" : "Centro desde abajo"}</MLabel>
          <MInput value={offsetVText} disabled={fd} unit="m" onChange={(v) => {
            setOffsetVText(v);
            const p = parseMarkMetersInput(v);
            if (p != null) commit({ ...local, offsetVerticalM: p });
          }} />
        </label>
      </div>
    </>
  );
}

// ─── Main exported component ──────────────────────────────────────────────────

type PrecisionPanelProps =
  | { mode: "straight"; spec: MarkLinePrecisionSpec; liveFromDrag?: boolean; disabled?: boolean; onChange: (next: MarkLinePrecisionSpec) => void; }
  | { mode: "rect";     spec: MarkRectPrecisionSpec;   liveFromDrag?: boolean; disabled?: boolean; onChange: (next: MarkRectPrecisionSpec) => void; }
  | { mode: "circle";   spec: MarkCirclePrecisionSpec; liveFromDrag?: boolean; disabled?: boolean; onChange: (next: MarkCirclePrecisionSpec) => void; };

const MODE_TITLE: Record<MarkLineMode, string> = {
  straight: "Línea roja precisa",
  rect:     "Rectángulo rojo preciso",
  circle:   "Círculo/Elipse rojo preciso",
  freehand: "",
};

export default function MarkLinePrecisionPanel(props: PrecisionPanelProps) {
  const { mode, liveFromDrag = false } = props;

  return (
    <div
      data-viewer-chrome
      className="absolute bottom-3 right-3 z-30 w-[min(100%-1.5rem,19rem)] rounded-xl border border-error/30 bg-base-100/95 shadow-xl backdrop-blur-sm p-3 space-y-2 pointer-events-auto"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-error/80">
          {MODE_TITLE[mode]}
        </p>
        {liveFromDrag && (
          <span className="badge badge-error badge-outline badge-xs shrink-0">En vivo</span>
        )}
      </div>

      {mode === "straight" && (
        <StraightPanel
          spec={props.spec}
          disabled={props.disabled}
          liveFromDrag={liveFromDrag}
          onChange={props.onChange}
        />
      )}
      {mode === "rect" && (
        <RectPanel
          spec={props.spec}
          disabled={props.disabled}
          liveFromDrag={liveFromDrag}
          onChange={props.onChange}
        />
      )}
      {mode === "circle" && (
        <CirclePanel
          spec={props.spec}
          disabled={props.disabled}
          liveFromDrag={liveFromDrag}
          onChange={props.onChange}
        />
      )}

    </div>
  );
}
