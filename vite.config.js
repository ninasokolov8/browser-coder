import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Proxy API requests to the backend server
      // Uses env var in Docker, falls back to localhost for local dev
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/lsp': {
        target: process.env.VITE_API_URL?.replace('http', 'ws') || 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  optimizeDeps: {
    include: ["monaco-editor"],
  },
  // Allow importing from languages folder outside src
  resolve: {
    alias: {
      "@languages": "/languages",
    },
  },
  // Ensure raw file imports work for starter code
  assetsInclude: ["**/*.py", "**/*.java", "**/*.php"],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "monaco-editor": ["monaco-editor"],
        },
      },
    },
  },
});
