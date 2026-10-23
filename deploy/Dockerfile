FROM node:24-bookworm-slim AS staff
WORKDIR /src/PrintingDashboard
COPY PrintingDashboard/package*.json ./
RUN npm ci --no-audit --no-fund
COPY PrintingDashboard/src ./src
COPY PrintingDashboard/public ./public
COPY PrintingDashboard/tsconfig.json ./
ENV PUBLIC_URL=/staff
RUN npm run build

FROM node:24-bookworm-slim AS requester
WORKDIR /src/MandirTickets
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY --from=requester /src/MandirTickets/dist ./dist
COPY --from=staff /src/PrintingDashboard/build ./staff
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 STAFF_BUILD_DIR=/app/staff DATA_DIR=/app/data COOKIE_SECURE=true
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
