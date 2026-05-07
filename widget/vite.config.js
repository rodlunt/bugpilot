import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'),
      name: 'BugPilot',
      formats: ['es', 'umd', 'iife'],
      // Single default export — IIFE exposes window.BugPilot directly

      fileName: (format) => `bugpilot.${format}.js`,
    },
    rollupOptions: {
      // html2canvas is bundled — consumers shouldn't need to install it separately
    },
  },
  // Dev server points at the test harness
  root: '.',
  server: {
    open: '/test/index.html',
  },
})
