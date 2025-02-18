# Use Puppeteer base image
FROM ghcr.io/puppeteer/puppeteer:24.2.1

# Set environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH="/usr/bin/google-chrome-stable"

# Set working directory
WORKDIR /usr/src/app

# Copy package.json files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Install Google Chrome manually
RUN apt-get update && apt-get install -y wget gnupg \
    && wget -qO- https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | tee /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y google-chrome-stable

# Copy project files
COPY . .

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "index.js"]
