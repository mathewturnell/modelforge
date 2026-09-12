import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {fileURLToPath} from "node:url";

export default defineConfig({
  base: "/workbench/",
  plugins: [react(), tailwindcss()],
  build: {
    modulePreload: false,
    outDir: fileURLToPath(
      new URL("../src/modelforge_workbench/workbench/static/workbench", import.meta.url),
    ),
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("monaco-editor")) return "monaco";
          if (id.includes("@xyflow")) return "xyflow";
          if (id.includes("recharts")) return "charts";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
});
