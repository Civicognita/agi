---
name: project-hosting
description: How projects are created, hosted, and accessed in Aionima
domain: utility
triggers:
  - create project
  - new project
  - host project
  - run project
  - start project
  - project url
  - localhost
  - dev server
  - npm run
  - npm start
  - container
  - deploy project
  - test project
  - open project
  - project not working
  - how to access
priority: 7
direct_invoke: true
---

## CRITICAL: How Projects Work in Aionima

**Projects run inside Podman containers, NOT directly on the host.**

NEVER run `npm run dev`, `npm start`, `node server.js`, `python app.py`, or any runtime command directly. This runs on the host machine, not in the project's container, and causes port conflicts, wrong dependencies, and security issues.

### Project Lifecycle

1. **Create** — `manage_project` action `create` creates a folder in `~/_projects/{slug}/`
2. **Write code** — Use `file_write` to add application files
3. **Start hosting** — `manage_project` action `host` with the project path starts the container
4. **Container starts** — The hosting system builds and runs a Podman container with the appropriate stack
5. **Access via URL** — The project is available at `https://{slug}.ai.on`
6. **After code changes** — `manage_project` action `restart` to rebuild the container
7. **Check status** — `manage_project` action `info` returns container status with hints on what to do next

### manage_project Actions

| Action | What it does |
|--------|-------------|
| `create` | Create new project folder. Returns path + hint to use `host` next. |
| `host` | Start the project container. Enables hosting, starts Podman, sets up Caddy. |
| `restart` | Restart the project container after code changes. |
| `unhost` | Stop the project container and disable hosting. |
| `info` | Get project status including container state. Returns a `hint` field with next steps. |
| `list` | List all workspace projects. |
| `update` | Update project metadata. |
| `delete` | Permanently delete a project. |

### Project URLs

Every hosted project gets a local URL: `https://{slug}.ai.on`
- Example: project "kronos-trader" → `https://kronos-trader.ai.on`
- Served via Caddy reverse proxy with auto-HTTPS (internal CA)
- The `.ai.on` domain resolves locally via dnsmasq

Projects can also get a public tunnel URL via Cloudflare for external access.

### What NOT To Do

- NEVER run `npm run dev`, `python manage.py runserver`, or similar on the host
- NEVER use `localhost:3000` or any localhost port — use the `.ai.on` URL
- NEVER install dependencies on the host — they go in the container
- NEVER try to `curl localhost:{port}` to test — the container has its own network

### What TO Do

After creating a project and writing code:
1. Tell the user to enable hosting in the project's settings on the dashboard
2. Tell them the project URL: `https://{slug}.ai.on`
3. Use `manage_project info` to check hosting status and get the URL
4. If the project needs specific stacks, mention which ones to add

### Testing a Project

To verify a project is working:
1. Use `manage_project info` to check if hosting is enabled and the container is running
2. Tell the user to open the project URL in their browser
3. If there are issues, check the container logs via the dashboard Logs page

### Stacks

Stacks define the runtime environment for a project:
- `stack-react-vite` — React frontend with Vite
- `stack-nextjs` — Next.js full-stack
- `stack-node-app` — Node.js backend
- `stack-fastapi` — Python FastAPI backend
- `stack-django` — Python Django backend
- `stack-flask` — Python Flask backend
- `stack-php-app` — PHP application
- `stack-go-app` — Go application
- `stack-rust-app` — Rust application
- `stack-static-hosting` — Static HTML/CSS/JS

### AI App Projects

For AI apps that use HuggingFace models:
- Add `aiModels` to the project config to declare model dependencies
- The hosting system injects `AIONIMA_MODEL_{ALIAS}_URL` env vars into the container
- The project code reads the env var to call the model's API
- See the `ai-apps` skill for architecture patterns

### Taskmaster

For complex multi-step tasks (like building a full application), use `worker_dispatch` to create background worker jobs. Workers handle:
- Code generation (worker-code)
- Testing (worker-code-tester)
- UI design (worker-ux)
- Documentation (worker-comm)

For simple tasks (create one file, answer a question), just do them directly.
