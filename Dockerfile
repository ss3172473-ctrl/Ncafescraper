FROM node:20-bookworm

WORKDIR /app

# Copy package files first to leverage cache
COPY package*.json ./

# Install dependencies
RUN npm install

# Install Playwright browsers and dependencies
# --with-deps installs system dependencies required by browsers
RUN npx playwright install chromium --with-deps

# Copy the rest of the application
COPY . .

# Generate Prisma Client
# Need DATABASE_URL for some schema features, but usually fine for generate
# If build fails, might need ARG DATABASE_URL
RUN npx prisma generate

# Build Next.js
RUN npm run build

# Expose port
EXPOSE 3000

# Default command (can be overridden by Railway Start Command)
CMD ["npm", "run", "start"]
