import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Shown in the sidebar. GIT_SHA is passed by CI as a Docker build arg.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify((process.env.GIT_SHA ?? '').slice(0, 7)),
  },
  ssr: { external: ['better-sqlite3'] },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})
