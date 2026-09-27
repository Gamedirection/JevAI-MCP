import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.DASHBOARD_DEV_TARGET ?? "http://localhost:8080";

export default defineConfig({
   plugins: [react()],
   server: {
      port: 5173,
      proxy: {
         "/api": { target, changeOrigin: true },
         "/health": { target, changeOrigin: true },
         "/metrics": { target, changeOrigin: true },
         "/mcp": { target, changeOrigin: true },
            },
        },
   build: {
      outDir: "dist",
      sourcemap: true,
      target: "es2022",
        },
    });
