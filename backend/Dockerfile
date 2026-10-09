# backend/Dockerfile — builds the React frontend AND serves it from the Node
# backend, so the whole app ships as ONE image and runs with a single
# `docker compose up` (open http://<pc>:4000 — no separate `npm start`).
#
# The build context is the repo root (see docker-compose.yml: `context: .`),
# so both frontend/ and backend/ are reachable from here.

# ---- Stage 1: build the React production bundle -----------------------------
FROM node:20-alpine AS frontend
WORKDIR /fe
# Install deps first (cached unless package files change). A full install (not
# --omit=dev) is required because the build uses Tailwind/PostCSS/Autoprefixer,
# which are devDependencies.
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
# Force the backend address to resolve at RUNTIME from the page's own origin
# (frontend/src/App.jsx -> resolveApiBase). We blank these so the build IGNORES
# frontend/.env.production, which targets a separate Netlify+Render cloud deploy
# — not this Reception-PC image. CRA/dotenv never overrides an already-set env
# var, so these empty values win, and one build then works on the LAN now and
# behind a public tunnel later with no rebuild.
ENV REACT_APP_API_BASE_URL="" \
    REACT_APP_SOCKET_URL=""
RUN npm run build

# ---- Stage 2: the backend runtime (also serves the build from stage 1) ------
FROM node:20-alpine

# PostgreSQL client tools (pg_dump / pg_restore) for the backup & restore
# feature. Pinned to major 16 to match the postgres:16-alpine database — a
# matching-major client is the safe, fully-supported combination. If you bump
# the Postgres image to a new major, bump this package to match (e.g.
# postgresql17-client).
RUN apk add --no-cache postgresql16-client

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

COPY backend/ ./

# Bring in the compiled frontend. server.js serves it from /app/public when the
# folder is present, and quietly runs API-only when it isn't (e.g. local dev,
# where the React dev server runs separately on :3000).
COPY --from=frontend /fe/build ./public

EXPOSE 4000

CMD ["node", "server.js"]
