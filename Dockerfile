FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3300
ENV HOSTNAME=0.0.0.0
ENV DATA_DIR=/data
RUN addgroup -S opendot && adduser -S opendot -G opendot \
  && mkdir -p /data \
  && chown -R opendot:opendot /data
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER opendot
EXPOSE 3300
CMD ["node", "server.js"]
