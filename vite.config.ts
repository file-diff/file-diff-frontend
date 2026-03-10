import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function shortenGitCommit(commit?: string) {
  return commit?.trim().slice(0, 7) ?? ''
}

function readGitCommit() {
  const configuredCommit = shortenGitCommit(process.env.VITE_GIT_COMMIT)
  if (configuredCommit) {
    return configuredCommit
  }

  const githubCommit = shortenGitCommit(process.env.GITHUB_SHA)
  if (githubCommit) {
    return githubCommit
  }

  const cloudflareCommit = shortenGitCommit(process.env.CF_PAGES_COMMIT_SHA)
  if (cloudflareCommit) {
    return cloudflareCommit
  }

  try {
    return shortenGitCommit(
      execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
    )
  } catch {
    return ''
  }
}

const buildVersion = process.env.VITE_BUILD_VERSION?.trim() || process.env.npm_package_version || '0.0.0'
const gitCommit = readGitCommit()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BUILD_VERSION': JSON.stringify(buildVersion),
    'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(gitCommit),
  },
})
