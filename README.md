# Discord Setup
- Clone this repo, cd into it and run `npm i`
- Copy .env-template-new and save as file `.env`
- Setup Discord bot:
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

- Deploy the discord bot commands: `node deploy_discord_commands.js`
- Start the bot (must be running for commands to work): `node start_discord_bot.js` 
- Run the discord command and set save json = true `/makeplaylists input_channel:#music-share output_channel:#debug_out save_json:True`
- Once command has finished, you will have a json file of all the media messages

# YouTube API Setup
- Create a new google cloud project, add youtube api v3, in the oauth2 tab save `GCP_CLIENT_ID` and `GCP_CLIENT_SECRET` to the .env file.
- Add the YouTube playlist id to the file under `const YOUTUBE_PLAYLIST_ID = "abc";`
- Run this script to add them to your youtube playlist: `node add_to_youtube_playlist.js`