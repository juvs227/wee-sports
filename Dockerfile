FROM node:24-bookworm-slim
WORKDIR /app
COPY . .
# The existing prepare hook type-checks source, so copy it before installing.
RUN npm ci --include=dev && npm run build
ENV NODE_ENV=production
USER node
CMD ["node", "server/main.js", "--production"]
