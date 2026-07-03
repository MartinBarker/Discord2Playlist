require('dotenv').config();
var token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error('DISCORD_TOKEN is missing. Please check your .env file.');
    process.exit(1);
}
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const db = require('./db');
const { createApiServer } = require('./api/server');
const scheduler = require('./lib/scheduler');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

// Optionally, if you still want to support subdirectories:
const commandFolders = fs.readdirSync(commandsPath).filter(folder => fs.lstatSync(path.join(commandsPath, folder)).isDirectory());

for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    const commandFilesInFolder = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
    for (const file of commandFilesInFolder) {
        const filePath = path.join(folderPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

// ---- HTTP API ----
// Start the Express API immediately so the health check and the website's
// OAuth/SSE calls have an endpoint even before the gateway connects.
const PORT = parseInt(process.env.PORT || '3000', 10);
const api = createApiServer();
api.listen(PORT, () => console.log(`Express API listening on :${PORT}`));

// ---- Discord events ----
client.once('clientReady', async () => {
    console.log(`✅ Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`📊 Loaded ${client.commands.size} command(s)`);
    // Give the scheduler a client and restore any persisted schedules.
    scheduler.setClient(client);
    try {
        await scheduler.rehydrateAll();
    } catch (err) {
        console.error('Failed to rehydrate scheduled scans:', err);
    }
});

// Track new servers the bot is added to.
client.on('guildCreate', async (guild) => {
    try {
        await db.query(
            `INSERT INTO guilds (guild_id, guild_name)
             VALUES ($1, $2)
             ON CONFLICT (guild_id) DO UPDATE SET guild_name = $2`,
            [guild.id, guild.name]
        );
        console.log(`➕ Joined guild ${guild.name} (${guild.id})`);
    } catch (err) {
        console.error(`Failed to record guildCreate for ${guild.id}:`, err);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
        const reply = { content: 'There was an error while executing this command!', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
        } else {
            await interaction.reply(reply);
        }
    }
});

client.on('error', (error) => {
    console.error('Discord client error:', error);
});

client.on('warn', (warning) => {
    console.warn('Discord client warning:', warning);
});

// Login to Discord
client.login(token).catch((error) => {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
});
