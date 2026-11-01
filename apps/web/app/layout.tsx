/**
 * Layout raíz de Next.js (App Router): define <html lang="es">, los estilos globales y el título del sitio.
 * Envuelve TODAS las páginas.
 */
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Betel Solution | Contabilidad inteligente",
  description: "Plataforma contable colombiana para empresas en crecimiento",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
