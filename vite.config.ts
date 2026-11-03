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
      // @simplewebauthn/server imports the CommonJS reflect-metadata polyfill before tsyringe,
      // but the bundler runs CommonJS lazily, so tsyringe loads first and throws (on Workers).
      // An ES-module polyfill keeps the import order intact.
      alias: { "reflect-metadata": "@abraham/reflection" },
      // Node runs this with an in-process scheduler; Cloudflare gets a cron trigger.
      scheduledTasks: {
        "*/10 * * * *": ["google:sync"],
        "*/30 * * * *": ["duplicates:scan"],
      },
    }),
  ],
});
