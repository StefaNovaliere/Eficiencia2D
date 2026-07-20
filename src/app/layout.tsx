import type { Metadata } from "next";
import "@/styles/globals.css";
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
    var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
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
