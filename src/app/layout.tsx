import type { Metadata } from "next";
import "@/styles/globals.css";
import { ProjectProvider } from "@/context/ProjectContext";
export const metadata: Metadata = {
  title: "Eficiencia2D — Planos Arquitectónicos al Instante",
  description:
    "Sube un archivo .skp o .obj y obtén planos 2D acotados en segundos. " +
    "Todo se procesa en tu navegador — tu archivo nunca sale de tu máquina.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" data-theme="light">
      <body className="min-h-screen bg-base-200 text-base-content antialiased font-sans">
        <ProjectProvider>
          {children}
        </ProjectProvider>
      </body>
    </html>
  );
}
