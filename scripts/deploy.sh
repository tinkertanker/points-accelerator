#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-tinkertanker@dev.tk.sg}"
REMOTE_PATH="${REMOTE_PATH:-/home/tinkertanker-server/Docker/economy-rice}"
REPO_URL="${REPO_URL:-https://github.com/tinkertanker/economy-rice.git}"
BRANCH="${BRANCH:-main}"
SSH_OPTS="${SSH_OPTS:--o IdentityAgent=none -o IdentitiesOnly=yes}"

ssh ${SSH_OPTS} "${REMOTE_HOST}" "mkdir -p \"${REMOTE_PATH}\""

ssh ${SSH_OPTS} "${REMOTE_HOST}" "
  set -euo pipefail
  if [ ! -d \"${REMOTE_PATH}/.git\" ]; then
    rm -rf \"${REMOTE_PATH}\"
    git clone \"${REPO_URL}\" \"${REMOTE_PATH}\"
  fi

  cd \"${REMOTE_PATH}\"
  git fetch origin
  git checkout \"${BRANCH}\"
  git pull --ff-only origin \"${BRANCH}\"

  if [ ! -f .env.production ]; then
    echo '.env.production is missing on the server. Copy .env.production.example to .env.production and fill in secrets.' >&2
    exit 1
  fi

  docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
  docker compose --env-file .env.production -f docker-compose.prod.yml exec -T backend npx prisma migrate deploy
  docker compose --env-file .env.production -f docker-compose.prod.yml ps
"
