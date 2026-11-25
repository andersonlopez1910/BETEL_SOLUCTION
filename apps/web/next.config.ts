import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El despliegue de revisión continúa siendo estático. En desarrollo Next actúa
  // como la única puerta de entrada y reenvía las llamadas de la API internamente.
  output: isDevelopment ? undefined : "export",
  async rewrites() {
    if (!isDevelopment) return [];

    return [
      { source: "/v1/:path*", destination: "http://127.0.0.1:4000/v1/:path*" },
      { source: "/api/:path*", destination: "http://127.0.0.1:4000/:path*" },
    ];
  },
};
export default nextConfig;
