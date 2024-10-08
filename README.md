1. Working /ping -> 'ping' response
- Followed this discord.js guide: https://discordjs.guide/preparations/setting-up-a-bot-application.html
- Create Discord Bot https://discord.com/developers/applications/
- Create invite link on oauth2 page with 'bot', 'application.commands', and 'send messages' permissions
- Past invite link into brower, install onto test server
- Copy .env-template to create local .env file and fill out secrets.
- Get secret from Discord App / Bot Page / Token.
```
    applicationId=
    publicKey=
    clientId=
    clientSecret=
    token=
    # The development server's id (Enable developer mode > Right-click the server title > "Copy ID")
    guildId=
```
- Run `node deploy-commands.js` to deploy the /slash commands we created.
- Run `node index.js` to start bot.
- In discord server where we installed bot, run `/ping` command to test functionality.
- Should return with "pong"

2. Command to get all youtube messages from the channel: 
- run ` node deploy-commands.js && node index.js ` to setup commands and start bot
- in discord, run `/getAllChannelMessages`

3. Javascript file that uses google oauth2 to sign in, and create a plstlist and/or add song(s) to a/the playlist
- Create a GCP project, add API "YouTube Data API v3", create oauth2 credentials with calback url: http://localhost:3000/oauth2callback, add scopes "https://www.googleapis.com/auth/youtube.force-ssl" and "https://www.googleapis.com/auth/youtube"
- Fill in google OAuth2 vars to .env
- Run `node youtube-oauth-playlist-adder.js`
!! Run this script first to generate the tokens.json file for youtube auth !!

4. Discord command to fetch all youtube urls and add them to a playlist
- /getallchannelmessages

5. YouTube API V3 quota limit: https://developers.google.com/youtube/v3/determine_quota_cost
- playlistItems - insert cost 50 points
- Queries per day	Quota		10,000
- Queries per minute per user	Quota		180,000
- Queries per minute	Quota		1,800,000