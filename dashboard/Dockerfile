# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile || yarn install

COPY . .

# Build args for env vars needed at build time
# Use a valid placeholder; actual URL set via Cloud Run env vars at runtime
ENV NEXTAUTH_URL=http://localhost:3000

RUN yarn build

# Stage 2: Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080
CMD ["node", "server.js"]
