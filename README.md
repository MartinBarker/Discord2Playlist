https://discordjs.guide/preparations/setting-up-a-bot-application.html

- Create Discord Bot https://discord.com/developers/applications/
- To create an invite link, head back to the My Apps page under the "Applications" section, click on your bot application, and open the OAuth2 page. In the sidebar, you'll find the OAuth2 URL generator. Select the bot and applications.commands options. Once you select the bot option, a list of permissions will appear, allowing you to configure the permissions your bot needs. Grab the link via the "Copy" button and enter it in your browser. You should see something like this (with your bot's username and avatar).
- Generated URL:
https://discord.com/oauth2/authorize?client_id=1250991988292063304&permissions=0&integration_type=0&scope=bot+applications.commands
- Get secret from Discord App / Bot Page / Token. Add to .env
