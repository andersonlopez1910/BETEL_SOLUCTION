/**
 * Ruta "/": redirige al resumen (/resumen).
 */
import { redirect } from "next/navigation";
export default function Home() {
  redirect("/resumen");
}
