import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "node",
    include: ["renderer/src/test/**/*.test.ts"],
  },
});
