# How to create a Discord bot bot with valid api access and add it to servers:
- Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
- Create a new bot
- Under "General Information", copy "Application ID" and save to .env as `DISCORD_CLIENT_ID`.
- Under "Bot" section: 
    - Click "Reset Token" and save to .env as `DISCORD_TOKEN`. 
    - Add permisions: `Send Messages` and `Read Message History`
    - Enable all 3 "Privileged Gateway Intents"
- Get Link: Under "OAuth2" section: 
    - Create a bot invite link with the following permissions:
        - `bot`
        - `applications.commands`
        - `send messages`
        - `Read Message History`
- Choose `Guild Install` and copy the "Generated URL"
- Use this URL to invite the bot to your Discord server:
    https://discord.com/oauth2/authorize?client_id=1444823985215901865&permissions=67584&integration_type=0&scope=bot+applications.commands
  
# How to setup and run this Discord bot fully locally and free:
- Clone this repo, cd into it and run `npm i`
- Copy .env-template-new and save as file `.env`
- Add the Discord bot api keys and YouTube ai keys.
- Deploy the discord bot commands: `npm run deploy`
- Start the bot (must be running for commands to work): `npm start` 

# Discord commands to run in order to use this bot:
- Copy and paste this discord command into your server with the bot to do the following:
    - Fetch every message from input_channel with media links (youtube/bandcamp/soundcloud/spotify)
    - Save media links to json file locally (same location where you ran `npm start`)
    - Print bot output to output_channel
    - Repeat message based on cron expression `0 0 */3 * *` which means every 3 days
    ```
    /makeplaylists input_channel:#music-share output_channel:#debug_out save_json:True repeat:0 0 */3 * *
    ```
    - Or this command to repeat every 1 hour:
    ```
    /makeplaylists input_channel:#music-share output_channel:#debug_out save_json:True repeat:0 * * * *
    ```
- Once command has finished, you will have a json file of all the media links saved as `input_channel_name.json`

# How to upload links to a YouTube playlist:
- First we need to setup a Google Cloud account with YouTube API Setup enabled.
- Create a new google cloud project, add youtube api v3, in the oauth2 tab save `GCP_CLIENT_ID` and `GCP_CLIENT_SECRET` to the .env file.
- Add the YouTube playlist id to the file under `const YOUTUBE_PLAYLIST_ID = "abc";`
- Run this script to add them to your youtube playlist: `node add_to_youtube_playlist.js`

- Start discord bot: `npm run deploy && npm start`
- Auto run discord command every 1 hour: 
```
/makeplaylists input_channel:#music-share output_channel:#debug_out save_json:True repeat:0 * * * *
```
- Auto run add-to-youtube-playlist on a schedule: `npm run youtube:sync` (default: every hour) or pass a cron expression, e.g. `npm run youtube:sync -- "*/30 * * * *"` (every 30 min)