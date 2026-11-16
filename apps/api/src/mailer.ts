/**
 * Envío de correos por SMTP (nodemailer).
 *
 * Variables de entorno (ver .env.example):
 *   SMTP_HOST, SMTP_PORT (587 por defecto), SMTP_SECURE ("true" para 465), SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Sin SMTP_HOST el envío está deshabilitado: la API responde 503 explicando qué falta, en lugar de
 * fingir que el correo salió. En desarrollo se puede usar Mailpit (docker compose --profile mail up),
 * que recibe los correos sin entregarlos y los muestra en http://localhost:8025.
 */
import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

/** true si hay un servidor SMTP configurado. */
export function mailerConfigured() {
  return !!process.env.SMTP_HOST;
}

function getTransporter() {
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

/** Envía un correo. Lanza el error del servidor SMTP si falla (quien llama lo registra como FAILED). */
export async function sendMail(message: { to: string; subject: string; html: string; text: string }) {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? "Betel Solution <no-reply@betel.local>",
    ...message,
  });
}
