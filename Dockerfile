FROM node:20-bookworm-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --no-audit --fund=false

COPY . .

EXPOSE 4200

CMD ["npm", "start", "--", "--host", "0.0.0.0", "--poll", "2000"]
