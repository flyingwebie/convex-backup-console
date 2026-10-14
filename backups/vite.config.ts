import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  ssr: { external: ['better-sqlite3'] },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
