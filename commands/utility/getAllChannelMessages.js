const { SlashCommandBuilder, IntentsBitField } = require('discord.js');

// Make sure to update your main bot file to include the MessageContent intent
// const client = new Client({ intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages, IntentsBitField.Flags.MessageContent] });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('getallchannelmessages')
        .setDescription('v1.0 Fetch all messages and YouTube links sent in this channel'),
    async execute(interaction) {
        await interaction.deferReply();
        const channel = interaction.channel;

        try {
            let allMessages = [];
            let lastId;
            let youtubeLinks = [];

            // Regular expression to match YouTube links
            const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?(?:\S+)/g;

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
            
            // Process each message
            allMessages.forEach((message, index) => {
                console.log(`Message ${index + 1}:`);
                console.log(`Author: ${message.author.username}`);
                if (message.content) {
                    console.log(`Content: ${message.content}`);
                    
                    // Check for YouTube links
                    const links = message.content.match(youtubeRegex);
                    if (links) {
                        youtubeLinks = youtubeLinks.concat(links);
                        console.log(`YouTube links found: ${links.length}`);
                    }
                } else {
                    console.log('No text content (or content not accessible)');
                }
                
                // Check for embeds
                if (message.embeds.length > 0) {
                    console.log(`Embeds: ${message.embeds.length}`);
                    message.embeds.forEach((embed, embedIndex) => {
                        console.log(`  Embed ${embedIndex + 1} title: ${embed.title || 'No title'}`);
                        
                        // Check for YouTube links in embed URLs
                        if (embed.url && embed.url.match(youtubeRegex)) {
                            youtubeLinks.push(embed.url);
                            console.log(`YouTube link found in embed: ${embed.url}`);
                        }
                    });
                }
                
                // Check for attachments
                if (message.attachments.size > 0) {
                    console.log(`Attachments: ${message.attachments.size}`);
                    message.attachments.forEach((attachment, attachmentIndex) => {
                        console.log(`  Attachment ${attachmentIndex + 1}: ${attachment.url}`);
                    });
                }
                
                console.log('---'); // Separator between messages
            });

            console.log(`Total YouTube links found: ${youtubeLinks.length}`);
            console.log('YouTube Links:');
            youtubeLinks.forEach((link, index) => {
                console.log(`${index + 1}. ${link}`);
            });

            // Respond to the interaction
            await interaction.editReply(`Processed ${allMessages.length} messages from channel #${channel.name}. Found ${youtubeLinks.length} YouTube links. Check the console for details.`);

        } catch (error) {
            console.error('Error fetching messages:', error);
            await interaction.editReply('An error occurred while fetching messages.');
        }
    },
};