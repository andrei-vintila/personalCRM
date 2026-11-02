import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nitro({
      serverDir: "./server",
      compatibilityDate: "2026-10-01",
      experimental: { tasks: true },
      // Node runs this with an in-process scheduler; Cloudflare gets a cron trigger.
      scheduledTasks: { "*/10 * * * *": ["google:sync"] },
    }),
  ],
});
