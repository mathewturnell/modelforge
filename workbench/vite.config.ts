import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";
export default defineConfig({base: "/workbench/", plugins: [react()], build: {modulePreload: false, outDir: fileURLToPath(new URL("../src/modelforge_workbench/workbench/static/workbench", import.meta.url)), emptyOutDir: true, sourcemap: false, target: "es2022"}});
