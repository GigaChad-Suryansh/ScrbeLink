import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The web app talks to the API on the same origin; Vite forwards /api to the API server.
const api = { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false } }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
})
