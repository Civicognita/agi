# agi-runtime:polyglot — Python 3.11 + Node 24 multi-repo base image
# (Debian 12/bookworm ships Python 3.11; upgrade base image for 3.12+)
#
# Use this when a multi-repo project mixes Python and Node.js services
# in the same container — for example, a FastAPI sim engine running
# alongside a Next.js frontend, supervised by concurrently.
#
# Bundles:
#   - Python 3.12 + pip + venv + common web server packages
#     (uvicorn, gunicorn, fastapi, flask, django, aiohttp, httpx)
#   - Node.js 24 + pnpm + npm + npx
#   - concurrently (global — process supervisor for multi-repo startup)
#   - dumb-init (PID 1, signal forwarding)
#   - git, curl, build-essential (compiled Python packages, source ops)
#
# Usage (hosting-manager sets this as baseImage in project.json):
#   podman run --name agi-<hostname> \
#     --network agi-net-<hostname> \
#     -v /path/to/frontend:/srv/repos/frontend:Z \
#     -v /path/to/api:/srv/repos/api:Z \
#     agi-runtime:polyglot \
#     dumb-init -- npx concurrently \
#       --names "frontend,api" \
#       --kill-others-on-fail=false \
#       "cd /srv/repos/frontend && npm run dev" \
#       "cd /srv/repos/api && uvicorn main:app --reload --host 0.0.0.0 --port 8000"

FROM debian:12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_VERSION=24 \
    PNPM_HOME=/usr/local/share/pnpm \
    PATH=/usr/local/share/pnpm:$PATH \
    # Keeps Python from generating .pyc files
    PYTHONDONTWRITEBYTECODE=1 \
    # Ensures stdout/stderr are unbuffered (logs appear immediately)
    PYTHONUNBUFFERED=1

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dumb-init \
        git \
        gnupg \
        # Build tools for compiled Python packages (numpy, pydantic, etc.)
        build-essential \
        libffi-dev \
        libssl-dev \
        # Python 3.12 from Debian bookworm (3.12 ships with Debian 12)
        python3 \
        python3-pip \
        python3-venv \
        python3-dev \
    ; \
    # NodeSource repo for Node 24
    mkdir -p /etc/apt/keyrings; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends nodejs; \
    # pnpm via corepack
    corepack enable; \
    corepack prepare pnpm@latest --activate; \
    # concurrently globally — multi-repo process supervisor
    npm install -g concurrently@^9; \
    # Common Python web server packages installed system-wide.
    # Projects that need exact versions should use a venv in their repo;
    # these are the "works out of the box" defaults for FastAPI/Flask/Django.
    pip3 install --no-cache-dir --break-system-packages \
        uvicorn[standard] \
        gunicorn \
        fastapi \
        flask \
        django \
        aiohttp \
        httpx \
        python-dotenv \
        pydantic \
        sqlalchemy \
    ; \
    # Cleanup
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /srv

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["bash", "-lc", "echo 'agi-runtime:polyglot ready — no start command provided'; sleep infinity"]
