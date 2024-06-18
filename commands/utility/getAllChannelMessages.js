
const { Client, SlashCommandBuilder, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('getallchannelmessages')
        .setDescription('Fetch all messages sent in a channel.'),
    async execute(interaction) {

        const channel = client.channels.cache.get("1012457757615607979");
        console.log('got channel')
        channel.messages.fetch({ limit: 100 }).then(messages => {
            console.log(`Received ${messages.size} messages`);
            //Iterate through the messages here with the variable "messages".
            messages.forEach(message => console.log(message.content))
        })

        await interaction.reply('Getting all messags.');
    },
};


