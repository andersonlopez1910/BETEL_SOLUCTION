/**
 * Ruta "/": redirige al inicio (/inicio).
 */
import { redirect } from "next/navigation";
export default function Home() {
  redirect("/inicio");
}
