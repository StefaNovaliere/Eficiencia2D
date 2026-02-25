import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Eficiencia2D — Instant Architectural Plans",
  description: "Upload a raw .skp file and get 2D plans in seconds.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
