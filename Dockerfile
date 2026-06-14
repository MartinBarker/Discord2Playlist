FROM node:20-alpine

# Add non-root user for security
RUN addgroup -S botgroup && adduser -S botuser -G botgroup

WORKDIR /app

# Copy dependency files first (better layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source
COPY start_discord_bot.js ./
COPY deploy_discord_commands.js ./
COPY add_to_youtube_playlist.js ./
COPY youtube-sync-scheduler.js ./
COPY commands/ ./commands/
COPY db/ ./db/

# Create data directory for any runtime files (JSON exports, tokens)
RUN mkdir -p /app/data && chown -R botuser:botgroup /app/data

# Switch to non-root user
USER botuser

# Health check — bot process should be running
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

CMD ["node", "start_discord_bot.js"]
