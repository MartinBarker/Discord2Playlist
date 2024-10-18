const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Path to the JSON file where YouTube links will be saved
const YOUTUBE_LINKS_JSON_PATH = path.join(__dirname, 'youtube_links.json');

// Helper function to load existing YouTube links from the JSON file
function loadYouTubeLinks() {
    if (fs.existsSync(YOUTUBE_LINKS_JSON_PATH)) {
        const data = fs.readFileSync(YOUTUBE_LINKS_JSON_PATH, 'utf-8');
        return JSON.parse(data);
    }
    return [];
}

// Helper function to save YouTube links to the JSON file
function saveYouTubeLinks(youtubeLinks) {
    fs.writeFileSync(YOUTUBE_LINKS_JSON_PATH, JSON.stringify(youtubeLinks, null, 2), 'utf-8');
}

// Helper function to extract YouTube video ID from a URL
function extractVideoId(url) {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]+)/);
    return match && match[1];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('saveyoutubelinks')
        .setDescription('Fetch all messages and save YouTube links to a JSON file'),
    async execute(interaction) {
        await interaction.deferReply();
        const channel = interaction.channel;

        try {
            let allMessages = [];
            let lastId;
            let youtubeLinks = [];

            // Regular expression to match YouTube links
            const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]+)/g;

            console.log(`Fetching messages from channel: ${channel.name} (ID: ${channel.id})`);

            while (true) {
                const options = { limit: 100 };
                if (lastId) {
                    options.before = lastId;
                }

                const messages = await channel.messages.fetch(options);
                allMessages = allMessages.concat(Array.from(messages.values()));

                lastId = messages.last()?.id;

                if (messages.size != 100 || !lastId) {
                    break;
                }
            }

            console.log(`Received ${allMessages.length} messages`);

            // Process each message to find YouTube links
            allMessages.forEach((message) => {
                if (message.content) {
                    const links = message.content.match(youtubeRegex);
                    if (links) {
                        youtubeLinks = youtubeLinks.concat(links);
                    }
                }

                // Check for YouTube links in embeds
                message.embeds.forEach(embed => {
                    if (embed.url && embed.url.match(youtubeRegex)) {
                        youtubeLinks.push(embed.url);
                    }
                });
            });

            // Remove duplicates from YouTube links
            youtubeLinks = [...new Set(youtubeLinks.map(link => extractVideoId(link)))];

            console.log(`Total YouTube links found: ${youtubeLinks.length}`);
            youtubeLinks.forEach((link, index) => {
                console.log(`${index + 1}. ${link}`);
            });

            // Load existing links and merge with new ones
            const existingLinks = loadYouTubeLinks();
            const allLinks = existingLinks.concat(
                youtubeLinks.map(link => ({ url: link, added: false }))
            );

            // Save to JSON file
            saveYouTubeLinks(allLinks);

            // Respond to the interaction
            await interaction.editReply(`Processed ${allMessages.length} messages from channel #${channel.name}. Saved ${youtubeLinks.length} new YouTube links to a JSON file.`);

        } catch (error) {
            console.error('Error fetching messages:', error);
            await interaction.editReply('An error occurred while fetching messages or saving YouTube links.');
        }
    },
};
