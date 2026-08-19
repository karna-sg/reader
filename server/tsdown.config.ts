import { defineConfig } from "tsdown";

// Bundle the CLI entry (which wires up serve/poll/probe/import-opml) to dist/.
// ESM, Node platform, external deps left to node_modules at runtime.
export default defineConfig({
  entry: ["src/entry.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  clean: true,
  dts: false,
  sourcemap: true,
});
