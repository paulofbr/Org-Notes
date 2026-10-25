import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: Object.fromEntries(['/api', '/login', '/logout', '/signin-google', '/signin-microsoft'].map((p) => [p, 'http://localhost:5080'])) },
  build: { outDir: '../server/wwwroot', emptyOutDir: true },
})
