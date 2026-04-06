import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function readGitCommit() {
  const configuredCommit = process.env.VITE_GIT_COMMIT?.trim()
  if (configuredCommit) {
    return configuredCommit
  }

  const githubCommit = process.env.GITHUB_SHA?.trim()
  if (githubCommit) {
    return githubCommit.slice(0, 7)
  }

  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

const buildVersion = process.env.VITE_BUILD_VERSION?.trim() || process.env.npm_package_version || '0.0.0'
const gitCommit = readGitCommit()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: "https://127.0.0.1:12986", // Local development server
        changeOrigin: true,            // Needed for virtual hosted sites
        rewrite: (path) => path.replace(/^\/api/, '/api'), // Keep the /api prefix
        secure: false,                 // If your remote uses self-signed SSL
      }
    },
  },
  define: {
    'import.meta.env.VITE_BUILD_VERSION': JSON.stringify(buildVersion),
    'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(gitCommit),
  },
})
