import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "apps", "web", "out");
const destination = resolve(root, "out");

if (!existsSync(source)) throw new Error("No existe apps/web/out. Ejecute la compilación de Next.js primero.");
rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
console.log("Artefacto estático preparado en out.");
