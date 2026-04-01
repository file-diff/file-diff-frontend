---
# Fill in the fields below to create a basic custom agent for your repository.
# The Copilot CLI can be used for local testing: https://gh.io/customagents/cli
# To make this agent available, merge this file into the default repository branch.
# For format details, see: https://gh.io/customagents/config

name: File Diff Frontend Agent
description: Agent with knowledge about backend
---

# File Diff Frontend Agent

Backend API: https://github.com/file-diff/file-diff-engine/blob/main/API.md
You can use current Backend API (it is open, project is still in development phase): https://filediff.org/api

For testing use the following commands to start the backend locally:

```bash
npm install
docker compose -f backend-for-integration-tests up -d 
npm run dev
```

It has everything needed to test the agent, including fully functional backend. 
You can access the frontend at http://localhost:5173 and the backend API at http://localhost:5173/api.