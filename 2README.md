# Discord2Playlist Bot

## Setup repo:
```
git clone
npm i
```

## Edit .env file with discord and youtube auth info:
TODO

## Deploy commands and start discord bot script to receive commands:
```
npm run deploy:guild
npm start
```
## Invite bot to your server
TODO

## Run discord command and repeat every 1 hour:
```
/makeplaylists input_channel:#music-share output_channel:#debug_out save_json:True output_youtube_links:false embedd_youtube_links:false youtube_playlist_id: PLpQuORMLvnZYNvmEiFPLxpjAKv9UDSQaN repeat:0 * * * *
```
## Run YouTube playlist update and repeat every 30 minutes:
```
node youtube-sync-scheduler.js "*/30 * * * *" --skip-prefetch
```

todo:
discord api setup
youtube api setup
100% local run guide
deployment guide (api):
/getCallbackURL
/runCommand
/getYouTubeIds
