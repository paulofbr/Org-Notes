import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:5080' } },
  build: { outDir: '../server/wwwroot', emptyOutDir: true },
})
