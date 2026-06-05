FROM node:24-slim

ENV NODE_ENV=production
ENV OPENMAS_ENV=development

WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
  && npm cache clean --force

COPY --chown=node:node . .
RUN chown -R node:node /app

USER node

STOPSIGNAL SIGTERM

CMD ["npx", "openmas", "os", "watch", "--interval", "1000"]
