# agi-runtime:lamp — multi-repo single-container hosting base image
#
# Owner directive 2026-04-29 cycle 124: "Not node-only, some projects are
# php projects that have a vite servers while developing but apache and
# php is the runtime that often will include a start command that fires
# an npm command."
#
# This image is the v0.4.x default for multi-repo project containers
# (s130 t515 B4). It bundles:
#   - PHP 8.3 + Apache (mod_php, mod_rewrite enabled)
#   - Node.js 22 + pnpm + npm + npx (for vite, fastify, etc.)
#   - concurrently (global install — owner-chosen process supervisor)
#   - dumb-init (PID 1, signal forwarding)
#   - git (project source operations from inside the container)
#   - curl + ca-certificates (HTTP probes, package fetches)
#
# Image philosophy: predictable, sized for development. ~1.2GB on disk.
# Polyglot beyond LAMP defers to v0.5.x (per-repo runtime declaration +
# image selection per the multi-repo-hosting-plan.md doc).
#
# Usage from hosting-manager (B4 wires this):
#   FROM agi-runtime:lamp
#   # bind mounts: /srv/repos/<name>/ per repo
#   # entrypoint: dumb-init -- npx concurrently --names ... --kill-others-on-fail=false ...

FROM debian:12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_VERSION=22 \
    PNPM_HOME=/usr/local/share/pnpm \
    PATH=/usr/local/share/pnpm:$PATH

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dumb-init \
        git \
        gnupg \
    ; \
    # NodeSource repo for Node 22
    mkdir -p /etc/apt/keyrings; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        nodejs \
        php8.2 \
        php8.2-cli \
        php8.2-curl \
        php8.2-mbstring \
        php8.2-mysql \
        php8.2-pgsql \
        php8.2-sqlite3 \
        php8.2-xml \
        php8.2-zip \
        libapache2-mod-php8.2 \
        apache2 \
    ; \
    # Enable Apache mod_rewrite + mod_php
    a2enmod rewrite php8.2; \
    # pnpm via corepack (no separate install)
    corepack enable; \
    corepack prepare pnpm@latest --activate; \
    # concurrently globally available for the container's startup wrapper
    npm install -g concurrently@^9; \
    # Cleanup apt cache to keep image lean
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

# Apache listens on 80 by default; let the container caller override via
# ports.conf if needed. Most multi-repo projects in practice will run
# vite/node servers on bespoke ports (5173/5174/...) and only one Apache
# (PHP repo) on whatever port that repo declares.
EXPOSE 80

# Default working dir matches the hosting-manager mount path convention
# (B4 will mount each repo at /srv/repos/<name>/)
WORKDIR /srv

# Health probe — concurrently exits non-zero on critical failure; the
# container's restart=always handles recovery. Apache's own healthcheck
# is up to the project's startCommand to define.

# dumb-init as PID 1 → forwards signals correctly to concurrently +
# child processes. Container caller appends `npx concurrently ...` as
# the actual command via `podman run ... agi-runtime:lamp dumb-init -- npx concurrently ...`.
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Default CMD is a placeholder — hosting-manager always overrides via
# the `--entrypoint` or by appending tokens after the image name.
CMD ["bash", "-lc", "echo 'agi-runtime:lamp ready — caller did not provide a start command'; sleep infinity"]
