1. Working /ping -> 'ping' response
- Followed this discord.js guide: https://discordjs.guide/preparations/setting-up-a-bot-application.html
- Create Discord Bot https://discord.com/developers/applications/
- Create invite link on oauth2 page with 'bot' and 'send message' permissions
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

2. 