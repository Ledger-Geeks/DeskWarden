import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    // Vercel serves dist/ at the domain root; everywhere else the app lives under /deskwarden/.
    base: process.env.VERCEL ? "/" : "/deskwarden/",
    plugins: [react()],
    // Dev only: same-origin /api keeps the session cookie first-party and avoids CORS.
    server: {
      proxy: {
        // 127.0.0.1, not localhost: the API listens on IPv4 loopback only.
        "/api": `http://127.0.0.1:${env.PORT || 8787}`,
      },
    },
  };
});
