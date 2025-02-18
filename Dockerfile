# Use Puppeteer official base image
FROM ghcr.io/puppeteer/puppeteer:24.2.1

# Switch to root user to install Chrome
USER root

# Install Google Chrome (Fixed)
RUN apt-get update && apt-get install -y wget gnupg \
    && wget -qO - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /usr/share/keyrings/google-chrome-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | tee /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y google-chrome-stable

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH="/usr/bin/google-chrome-stable"

# Set working directory
WORKDIR /usr/src/app

# Copy package.json files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy project files
COPY . .

# Expose port
EXPOSE 3000

# Switch back to the default non-root user
USER pptruser

# Start application
CMD ["node", "index.js"]
