FROM node:17-alpine

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --only=production

COPY . .
EXPOSE 80
CMD ["node", "build/index.js"]