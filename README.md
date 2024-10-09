# Discord2Playlist

**Discord2Playlist** is a Discord bot that automatically scans messages in a Discord channel, extracts YouTube video links, and adds them to a YouTube playlist. Perfect for curating playlists without manual effort.

## Features

- Fetch all YouTube links posted in a Discord channel.
- Automatically add YouTube videos to a selected YouTube playlist.
- OAuth2 authentication for users to sign in with their own YouTube account.
- Exponential backoff for YouTube quota management.

## Setup Instructions

### Prerequisites

- [Node.js](https://nodejs.org/) installed on your system.
- A Discord bot application.
- A Google Cloud Platform project with YouTube Data API enabled.
- YouTube OAuth2 credentials.

### 1. Clone the Repository

First, clone the repository and install the necessary dependencies:

```
git clone https://github.com/yourusername/discord2playlist.git
cd discord2playlist
npm install
```

### 2. Create a `.env` File

Create a `.env` file at the root of the project by copying the `.env-template`:

```
cp .env-template .env
```

Fill in the values in the `.env` file with the following:

```
DISCORD_TOKEN=your-discord-bot-token
GCP_CLIENT_ID=your-google-client-id
GCP_CLIENT_SECRET=your-google-client-secret
YOUTUBE_API_KEY=your-youtube-api-key
PLAYLIST_ID=your-youtube-playlist-id
```

### 3. Set Up Your Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Navigate to the "Bot" section, create a new bot, and copy the token.
3. Add your bot token to the `.env` file as `DISCORD_TOKEN`.
4. In the "OAuth2" section, create a bot invite link with the following permissions:
   - `bot`
   - `application.commands`
   - `send messages`
5. Use the generated invite link to invite the bot to your Discord server.

### 4. Set Up Google Cloud Project (GCP)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project.
3. Enable the **YouTube Data API v3** for your project.
4. Create OAuth2 credentials with a redirect URI: `http://localhost:3000/oauth2callback`.
5. Add the following scopes:
   - `https://www.googleapis.com/auth/youtube.force-ssl`
   - `https://www.googleapis.com/auth/youtube`
6. Download the OAuth2 client credentials and add the `GCP_CLIENT_ID` and `GCP_CLIENT_SECRET` to the `.env` file.

### 5. Deploy Discord Commands

Before you start the bot, deploy the commands to your Discord server:

```
node deploy-commands.js
```

### 6. Run the Bot

Run the bot using the following command:

```
node index.js
```

### 7. Authenticate with YouTube

When you run the bot for the first time, you'll be prompted to authenticate with YouTube:
1. The bot will generate a URL for you to visit.
2. Log in to your Google account and authorize the bot to manage your YouTube playlists.
3. Once authenticated, a `tokens.json` file will be created. This will store your access and refresh tokens for future use.

### 8. Use the Bot

1. In your Discord server, run the `/getAllChannelMessages` command to scan the current channel for YouTube links.
2. The bot will extract all YouTube links from the channel and add them to the specified playlist.

## Managing Quota Limits

The YouTube API has quota limits that are shared across all users. If the bot reaches the quota, it will retry using an exponential backoff strategy. This helps prevent hitting the quota too frequently while still processing all videos.

- **API quota info**: [YouTube API Quotas](https://developers.google.com/youtube/v3/getting-started#quota)
- **Exponential Backoff**: If the quota is exceeded, the bot will retry after a progressively longer delay.

## Contributing

Feel free to fork this repository and submit pull requests with improvements. Make sure to include detailed descriptions of your changes.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
