FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src src
COPY fixtures fixtures
EXPOSE 3000
CMD ["node", "src/index.ts"]
