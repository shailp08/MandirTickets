# Build context is the MandirTickets project root.
FROM node:24-bookworm-slim AS staff
WORKDIR /src/staff-dashboard
COPY staff-dashboard/package*.json ./
RUN npm ci --no-audit --no-fund
COPY staff-dashboard/src ./src
COPY staff-dashboard/public ./public
COPY staff-dashboard/tsconfig.json ./
ENV PUBLIC_URL=/staff
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY --from=staff /src/staff-dashboard/build ./staff
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 STAFF_BUILD_DIR=/app/staff DATA_DIR=/app/data COOKIE_SECURE=true
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
