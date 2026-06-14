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

// ── Parse CLI flags ─────────────────────────────────────────────────────────
// --global        → register commands globally (slow propagation, up to ~1 hour)
// --guild         → register commands to a single guild (instant), using
//                   DISCORD_GUILD_ID from .env
// --guild=<id>    → register to the given guild ID (overrides .env)
// (no flag)       → same as --global
const args = process.argv.slice(2);
const guildArg = args.find(a => a === '--guild' || a.startsWith('--guild='));
const deployGlobal = args.includes('--global') || !guildArg;
let guildId = null;

if (guildArg && !deployGlobal) {
    if (guildArg.startsWith('--guild=')) {
        guildId = guildArg.slice('--guild='.length).trim();
    } else {
        guildId = process.env.DISCORD_GUILD_ID;
    }
    if (!guildId) {
        console.error('--guild was passed but no guild ID was provided.');
        console.error('  Either set DISCORD_GUILD_ID in .env, or run with --guild=<id>.');
        process.exit(1);
    }
}

// ── Load command definitions ────────────────────────────────────────────────
const commandsPath = path.resolve(__dirname, 'commands');
console.log('commandsPath =', commandsPath);
const commands = [];

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

// ── Deploy ──────────────────────────────────────────────────────────────────
const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        if (deployGlobal) {
            console.log(`Started refreshing ${commands.length} application (/) commands globally.`);
            console.log('  ⚠️  Global commands take up to ~1 hour to propagate to Discord clients.');
            console.log('     For instant updates on a test server, run: npm run deploy:guild');
            const data = await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands }
            );
            console.log(`✅ Successfully reloaded ${data.length} application (/) commands globally.`);
        } else {
            console.log(`Started refreshing ${commands.length} application (/) commands for guild ${guildId}.`);
            const data = await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands }
            );
            console.log(`✅ Successfully reloaded ${data.length} application (/) commands for guild ${guildId}.`);
            console.log('   Guild commands update instantly — refresh Discord (Ctrl+R) and the new schema will be live.');
        }
    } catch (error) {
        console.error('Error deploying commands:', error);
        process.exit(1);
    }
})();
