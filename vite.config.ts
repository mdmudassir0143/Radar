import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/fac": {
        target: "https://facilitator.goplausible.xyz",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/fac/, ""),
      },
      "/idx": {
        target: "https://mainnet-idx.algonode.cloud",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/idx/, ""),
      },
    },
  },
});
