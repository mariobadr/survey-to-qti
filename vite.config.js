import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  // Under vitest, force Vite to resolve the "svelte" package's client build
  // rather than its server (SSR) build -- otherwise component tests fail
  // with "mount(...) is not available on the server". See
  // https://svelte.dev/docs/svelte/testing
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
});
