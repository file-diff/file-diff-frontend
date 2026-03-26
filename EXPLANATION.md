# Script explanation

This frontend repository does **not** currently contain any Python scripts.
Because of that, the notes below explain the scripts that do exist in this
repository and call out the lack of Python automation here.

## Python scripts

- No `*.py` files are present in this repository.
- If you were expecting Python helpers from the main `file-diff` project, they
  are not part of this frontend repository clone.

## npm scripts in `package.json`

- `npm run dev`  
  Starts the Vite development server for local frontend work.

- `npm run build`  
  Runs the TypeScript project build (`tsc -b`) and then creates the production
  frontend bundle with Vite.

- `npm run build:client`  
  Builds only the browser bundle into `dist/client`.

- `npm run build:server`  
  Builds the server-side-rendering entry point from `src/entry-server.tsx` into
  `dist/server`.

- `npm run build:all`  
  Runs the TypeScript build first, then builds both the client bundle and the
  server-side-rendered bundle.

- `npm run start`  
  Starts the Node/Express server in `server.js`, which serves the built frontend
  and the SSR health endpoint.

- `npm run lint`  
  Runs ESLint across the repository.

- `npm run preview`  
  Starts Vite's preview server so you can inspect the production build locally.

## Other script-like files in the repository root

- `deploy.sh`  
  Recreates the Docker Compose deployment for the frontend. It resolves a short
  git commit SHA for the build metadata and then runs `docker compose down`
  followed by `docker compose up -d --force-recreate --build`.

- `server.js`  
  Production Express server that serves static files from `dist/client`,
  server-renders `/ssr-health`, optionally caches that HTML in Redis, and falls
  back to `index.html` for other routes.

- `vite.config.ts`  
  Vite configuration for local development and builds. It enables the React
  plugin, proxies `/api` requests to `https://filediff.org`, and injects build
  version and git commit metadata into the frontend.

- `eslint.config.js`  
  ESLint flat config for the TypeScript/React codebase. It ignores `dist`,
  enables the recommended ESLint, TypeScript, React Hooks, and Vite React
  Refresh rules, and uses browser globals.
