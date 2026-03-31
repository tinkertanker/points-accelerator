FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package.json
COPY tsconfig.base.json tsconfig.base.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json

RUN npm install

COPY . .

RUN npm --workspace apps/backend run prisma:generate
RUN npm --workspace apps/backend run build

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/dist ./dist
COPY --from=build /app/apps/backend/package.json ./package.json
COPY --from=build /app/apps/backend/prisma ./prisma

CMD ["node", "dist/index.js"]

