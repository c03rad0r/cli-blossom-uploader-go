FROM node:18-slim

WORKDIR /app

# Install dependencies
COPY package.json .
RUN npm install

# Copy source code
COPY index.js .

ENTRYPOINT ["node", "/app/index.js"] 