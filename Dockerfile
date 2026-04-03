FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# `npm run build` runs `prisma generate` then `react-router build` (schema must exist — copy app first).
RUN npm run build

CMD ["npm", "run", "docker-start"]
