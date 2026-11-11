# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
WORKDIR /app
COPY . .
# The existing prepare hook type-checks source, so copy it before installing.
# Keep this portable to Railway, whose validator does not accept secret mounts.
RUN npm ci --include=dev --strict-ssl=true && npm run build
# COPY preserves restrictive checkout modes but assigns root ownership. Code
# must be readable by node while staying root-owned and not writable by it.
# Local startup also needs a private writable database directory. A mounted
# Railway volume replaces that ownership; provision the mount for UID/GID 1000.
RUN chmod -R a+rX /app && mkdir -p /app/.wee-data && chown node:node /app/.wee-data && chmod 700 /app/.wee-data
ENV NODE_ENV=production
USER node
CMD ["node", "server/main.js", "--production"]
