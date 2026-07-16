import { defineConfig } from "vite";

export default defineConfig({
  // Build every generated URL relative to the document. The IDE is mounted
  // behind Arc Academy at /coder/, so root URLs such as /assets/... escape
  // the reverse-proxy location and are served by the Laravel application.
  // Relative URLs keep the entry bundle, lazy chunks, Monaco workers, CSS and
  // fonts under the same public mount path in every environment.
  base: "./",

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
  assetsInclude: ["**/*.py", "**/*.java", "**/*.php", "**/*.cs"],
  build: {
    // Memory optimizations for low-RAM servers
    sourcemap: false,
    minify: 'esbuild', // faster and uses less memory than terser
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          "monaco-editor": ["monaco-editor"],
        },
      },
      // Reduce memory during build
      maxParallelFileOps: 2,
    },
  },
});
