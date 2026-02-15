# Use Playwright official image (includes Node.js & Browsers)
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Copy package files first to leverage cache
COPY package*.json ./

# Install dependencies (browsers are already in the image)
RUN npm install

# Copy the rest of the application
COPY . .

# Set dummy env vars for build time (prisma generate & next build might need them)
ENV DATABASE_URL="postgresql://dummy:5432/dummy"
ENV APP_AUTH_SECRET="dummy_secret_for_build"

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
