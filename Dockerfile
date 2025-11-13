# Use the official Node.js 20 image from Docker Hub
FROM node:20-slim

# Set the working directory inside the container
WORKDIR /usr/src/app

# === THIS IS THE MAGIC FIX ===
# Install all the missing Linux libraries that Puppeteer/Chrome needs
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    --no-install-recommends

# Copy your 'package.json' and 'package-lock.json'
COPY package*.json ./

# Install your app's dependencies (including puppeteer, which bundles Chrome)
RUN npm install

# Copy the rest of your app's code (like server.js)
COPY . .

# Your app runs on port 3000
EXPOSE 3000

# The command to start your server
CMD [ "node", "server.js" ]
