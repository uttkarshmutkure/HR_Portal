# ─────────────────────────────────────────────────────────────────────────────
# STAGE 1 — Build the React/Vite app into static files
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS build

WORKDIR /app

# NOTE: your corporate/office network appears to intercept HTTPS traffic
# (a proxy or antivirus doing SSL inspection), causing
# SELF_SIGNED_CERT_IN_CHAIN errors inside the build container since it
# doesn't trust that intercepted certificate. Disabling strict-ssl here is
# a LOCAL-BUILD-ONLY workaround — fine for testing, but before any real
# deployment/Marketplace submission this should be replaced by installing
# your organization's actual root CA certificate into the image instead.
RUN npm config set strict-ssl false

# Copy only the dependency manifests first, so Docker can cache this layer
# and skip reinstalling packages when only source code changes.
# Using npm here since package-lock.json (not pnpm-lock.yaml) is what
# actually exists in this project.
COPY package.json package-lock.json ./
RUN npm install

# Copy the rest of the source
COPY . .

# ── Build-time env vars ──────────────────────────────────────────────────────
# These become ARGs so they can be passed in at `docker build` time (or from
# Helm/Terraform later), then exported as ENV so Vite's build step picks them
# up via import.meta.env, exactly like your local .env file already does.
ARG VITE_API_BASE_URL
ARG VITE_LIST_JOBS_URL
ARG VITE_RESUME_URL
ARG VITE_SEND_EMAIL_URL
ARG VITE_SAVE_SLOTS_URL
ARG VITE_SAVE_INTERVIEWER_URL
ARG VITE_DATA_MANAGER_URL
ARG VITE_CHAT_AGENT_URL
ARG VITE_RUN_PIPELINE_URL
ARG VITE_APP_ENV
ARG VITE_UPDATE_CANDIDATE_STATUS_URL
ARG VITE_GENERATE_QUESTIONS_URL
ARG VITE_OFFER_AGENT_URL
ARG VITE_UPLOAD_RESUME_URL
ARG VITE_REFER_CANDIDATE_URL
ARG VITE_GET_CANDIDATE_SLOTS_URL
ARG VITE_CHECK_LOGIN_URL

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_LIST_JOBS_URL=$VITE_LIST_JOBS_URL \
    VITE_RESUME_URL=$VITE_RESUME_URL \
    VITE_SEND_EMAIL_URL=$VITE_SEND_EMAIL_URL \
    VITE_SAVE_SLOTS_URL=$VITE_SAVE_SLOTS_URL \
    VITE_SAVE_INTERVIEWER_URL=$VITE_SAVE_INTERVIEWER_URL \
    VITE_DATA_MANAGER_URL=$VITE_DATA_MANAGER_URL \
    VITE_CHAT_AGENT_URL=$VITE_CHAT_AGENT_URL \
    VITE_RUN_PIPELINE_URL=$VITE_RUN_PIPELINE_URL \
    VITE_APP_ENV=$VITE_APP_ENV \
    VITE_UPDATE_CANDIDATE_STATUS_URL=$VITE_UPDATE_CANDIDATE_STATUS_URL \
    VITE_GENERATE_QUESTIONS_URL=$VITE_GENERATE_QUESTIONS_URL \
    VITE_OFFER_AGENT_URL=$VITE_OFFER_AGENT_URL \
    VITE_UPLOAD_RESUME_URL=$VITE_UPLOAD_RESUME_URL \
    VITE_REFER_CANDIDATE_URL=$VITE_REFER_CANDIDATE_URL \
    VITE_GET_CANDIDATE_SLOTS_URL=$VITE_GET_CANDIDATE_SLOTS_URL \
    VITE_CHECK_LOGIN_URL=$VITE_CHECK_LOGIN_URL

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 2 — Serve the built static files with nginx
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:alpine

# Remove nginx's default sample site config
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# Copy our own nginx config (handles React Router client-side routing)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built static files from Stage 1
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]