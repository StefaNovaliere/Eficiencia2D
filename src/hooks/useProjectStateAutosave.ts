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
  const tokenRef = useRef(token);
  const projectIdRef = useRef(projectId);
  const enabledRef = useRef(enabled);

  tokenRef.current = token;
  projectIdRef.current = projectId;
  enabledRef.current = enabled;

  const flushPatch = useCallback(async (opts?: { keepalive?: boolean }) => {
    const activeToken = tokenRef.current;
    const activeProjectId = projectIdRef.current;
    if (!enabledRef.current || !activeToken || !activeProjectId) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (Object.keys(pendingRef.current).length === 0) return;
    if (inFlightRef.current) return;

    const patch = pendingRef.current;
    pendingRef.current = {};
    inFlightRef.current = true;

    try {
      await patchProjectState(activeToken, activeProjectId, patch, {
        keepalive: opts?.keepalive,
      });
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
  }, []);

  const queuePatch = useCallback((patch: ProjectStatePatch) => {
    if (!enabledRef.current || !tokenRef.current || !projectIdRef.current) return;

    pendingRef.current = { ...pendingRef.current, ...patch };

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flushPatch();
    }, AUTOSAVE_DELAY_MS);
  }, [flushPatch]);

  useEffect(() => {
    const flushOnLeave = () => {
      void flushPatch({ keepalive: true });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushOnLeave();
    };

    window.addEventListener("pagehide", flushOnLeave);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushOnLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void flushPatch({ keepalive: true });
    };
  }, [flushPatch]);

  return { queuePatch, flushPatch };
}
