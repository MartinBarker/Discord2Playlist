const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); 

// Read .env vars 
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID; 
if (!token) {
    console.error('DISCORD_TOKEN is missing. Please check your .env file.');
    process.exit(1); 
}
if (!clientId) {
    console.error('Client ID is missing. Please check your .env file.');
    process.exit(1); 
}

const commandsPath = path.resolve(__dirname, 'commands'); 
console.log("commandsPath = ", commandsPath);
const commands = [];

// Read all commands from the commands folder
fs.readdirSync(commandsPath).forEach(file => {
    if (file.endsWith('.js')) {
        const command = require(path.resolve(commandsPath, file));
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