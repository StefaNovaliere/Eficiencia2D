"use client";

import { useCallback, useEffect, useRef } from "react";
import { patchProjectState } from "@/services/projects";
import type { ProjectStatePatch } from "@/services/project-state";

const AUTOSAVE_DELAY_MS = 1200;

interface UseProjectStateAutosaveOptions {
  token: string | null;
  projectId: string | null;
  enabled?: boolean;
}

export function useProjectStateAutosave({
  token,
  projectId,
  enabled = true,
}: UseProjectStateAutosaveOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<ProjectStatePatch>({});
  const inFlightRef = useRef(false);

  const flushPatch = useCallback(async () => {
    if (!enabled || !token || !projectId) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const patch = pendingRef.current;
    if (Object.keys(patch).length === 0 || inFlightRef.current) return;

    pendingRef.current = {};
    inFlightRef.current = true;

    try {
      await patchProjectState(token, projectId, patch);
    } catch (err) {
      console.warn("No se pudo guardar el estado del proyecto:", err);
      pendingRef.current = { ...patch, ...pendingRef.current };
    } finally {
      inFlightRef.current = false;
      if (Object.keys(pendingRef.current).length > 0) {
        timerRef.current = setTimeout(() => {
          void flushPatch();
        }, AUTOSAVE_DELAY_MS);
      }
    }
  }, [enabled, token, projectId]);

  const queuePatch = useCallback(
    (patch: ProjectStatePatch) => {
      if (!enabled || !token || !projectId) return;

      pendingRef.current = { ...pendingRef.current, ...patch };

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flushPatch();
      }, AUTOSAVE_DELAY_MS);
    },
    [enabled, token, projectId, flushPatch],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { queuePatch, flushPatch };
}
