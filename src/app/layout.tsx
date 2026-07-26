import type { Metadata } from "next";
import { Chakra_Petch, JetBrains_Mono } from "next/font/google";
import "@/styles/globals.css";

/*
 * Tipografía del tema cyberpunk: display técnica para títulos/eyebrows y una
 * mono real para cifras y datos (el CSS ya pedía "JetBrains Mono", pero nunca
 * se cargaba y caía al stack del sistema). Se exponen como CSS vars y se
 * enganchan en `@theme` de globals.css.
 */
const display = Chakra_Petch({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono-e2d",
  display: "swap",
});
import { AuthProvider } from "@/context/AuthContext";
import { ProjectProvider } from "@/context/ProjectContext";
import { SettingsProvider, SettingsThemeSync } from "@/context/SettingsContext";
import { CameraNavigationProvider } from "@/context/CameraNavigationContext";
import { UserProfileProvider } from "@/context/UserProfileContext";
import { SubscriptionProvider } from "@/context/SubscriptionContext";
import { ThemeProvider } from "@/context/ThemeContext";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Eficiencia2D — Planos Arquitectónicos al Instante",
  description:
    "Sube un archivo .skp o .obj y obtén planos 2D acotados en segundos. " +
    "Todo se procesa en tu navegador — tu archivo nunca sale de tu máquina.",
  icons: {
    icon: "/images/favicon.png",
    shortcut: "/images/favicon.png",
    apple: "/images/favicon.png",
  },
};

const themeInitScript = `
(function () {
  var valid = ["neon","light","dark","aqua","valentine","sunset","halloween"];
  try {
    var saved = localStorage.getItem("theme");
    if (saved && valid.indexOf(saved) !== -1) {
      document.documentElement.setAttribute("data-theme", saved);
      return;
    }
    // Sin preferencia guardada: el look por defecto de la app es "neon"
    // (cyberpunk). El usuario puede elegir otro tema en Configuración.
    document.documentElement.setAttribute("data-theme", "neon");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "neon");
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning className={`${display.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-base-200 text-base-content antialiased font-sans">
        <AuthProvider>
          <UserProfileProvider>
            <SettingsProvider>
              <ThemeProvider>
                <SettingsThemeSync />
                <CameraNavigationProvider>
                  <SubscriptionProvider>
                    <ProjectProvider>
                      <AppShell>{children}</AppShell>
                    </ProjectProvider>
                  </SubscriptionProvider>
                </CameraNavigationProvider>
              </ThemeProvider>
            </SettingsProvider>
          </UserProfileProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
