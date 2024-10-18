const { REST, Routes } = require('discord.js');
const fs = require('fs');
require('dotenv').config(); // Load environment variables from .env

const token = process.env.DISCORD_TOKEN; // Bot token from .env
const clientId = process.env.DISCORD_CLIENT_ID; // Your bot's client/application ID

if (!token) {
    console.error('Bot token is missing. Please check your .env file.');
    process.exit(1); // Stop the script if token is missing
}

if (!clientId) {
    console.error('Client ID is missing. Please check your .env file.');
    process.exit(1); // Stop the script if clientId is missing
}

// Path to commands folder
const commandsPath = './commands'; // Adjust if necessary

// Array to hold all command data
const commands = [];

// Read all command files from the commands folder
fs.readdirSync(commandsPath).forEach(file => {
    if (file.endsWith('.js')) {
        const command = require(`./commands/${file}`);
        if (command && 'data' in command) {
            commands.push(command.data.toJSON());
        } else {
            console.warn(`Command file ${file} is missing "data" or "execute" property.`);
        }
    }
});

// Initialize REST client
const rest = new REST({ version: '10' }).setToken(token);

// Deploy commands globally (this may take up to 1 hour to propagate)
(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands globally.`);

        const data = await rest.put(
            Routes.applicationCommands(clientId), // Global command deployment
            { body: commands }
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands globally.`);
    } catch (error) {
        console.error('Error deploying commands:', error);
    }
})();
