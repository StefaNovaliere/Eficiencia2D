"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Render del fallback cuando algo dentro tira una excepción. */
  fallback: (reset: () => void, error: Error) => ReactNode;
  /** Llamado al capturar (telemetría/log). */
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

/**
 * Error boundary genérico de cliente. Evita que una excepción de render (p. ej.
 * geometría 3D inválida en el instructivo) tumbe toda la página con el
 * "Application error" de Next. Muestra un fallback y permite reintentar.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
    console.error("ErrorBoundary capturó:", error);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return this.props.fallback(this.reset, this.state.error);
    }
    return this.props.children;
  }
}
