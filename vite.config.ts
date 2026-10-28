import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { blygProxy } from "./vite-proxy";

export default defineConfig({
  plugins: [react(), blygProxy()],
  // `vite --host` is the dev script: the iPad reaches the dev server over the LAN.
  server: { host: true },
});
