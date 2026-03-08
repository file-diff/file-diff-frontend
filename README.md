# git-diff-online

A React + Vite application for comparing directory trees and files from two repositories side by side.

## Features

- **Tree Comparison**: Paste the output of `tree` commands to compare two directory structures. Highlights added, removed, and common entries.
- **File Comparison** *(coming soon)*: Compare individual file contents side by side.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

To override the default indexing backend, set `VITE_JOBS_API_URL` before
starting the app. Otherwise the frontend uses
`https://filediff.org/api/jobs`.

## Usage

1. Run `tree` in two different repository directories.
2. Paste the outputs into the left and right text areas.
3. View the side-by-side comparison with color-coded differences.

Sample data is provided for quick demonstration — click **Load Large Sample** or **Load Small Sample**.

## Tech Stack

- React 19 + TypeScript
- Vite
- React Router

## Deployment

GitHub Actions now deploys to Cloudflare Pages on pushes to `main`.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
