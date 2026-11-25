/**
 * Layout raíz de Next.js (App Router): define <html lang="es">, los estilos globales y el título del sitio.
 * Envuelve TODAS las páginas.
 */
import type { Metadata } from "next";
import { ToastProvider } from "../components/toast-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Betel Solution | Contabilidad inteligente",
  description: "Plataforma contable colombiana para empresas en crecimiento",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: extensiones del navegador (p. ej. LanguageTool, Grammarly) inyectan
    // atributos en <html>/<body> antes de que React hidrate. Solo afecta a estos elementos, no a sus hijos.
    <html lang="es" suppressHydrationWarning>
      <body suppressHydrationWarning><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
