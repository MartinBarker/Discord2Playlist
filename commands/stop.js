const { SlashCommandBuilder } = require('discord.js');
const makePlaylists = require('./makePlaylists.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop all scheduled /makeplaylists auto-runs in this server'),
    async execute(interaction) {
        const { repeatJobs, getRepeatJobKey } = makePlaylists;
        const guildId = interaction.guildId;

        if (!guildId) {
            await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
            return;
        }

        const prefix = `${guildId}:`;
        const stopped = [];
        for (const [key, job] of repeatJobs) {
            if (key.startsWith(prefix)) {
                try {
                    job.task.stop();
                    if (typeof job.task.destroy === 'function') {
                        job.task.destroy();
                    }
                    repeatJobs.delete(key);
                    const [, inputId, outputId] = key.split(':');
                    stopped.push({ inputId, outputId, repeat: job.repeat });
                } catch (err) {
                    console.error(`[Stop] Error stopping job ${key}:`, err);
                }
            }
        }

        if (stopped.length === 0) {
            await interaction.reply({ content: 'No scheduled auto-runs found in this server.', ephemeral: true });
            return;
        }

        const list = stopped.map(s => `• \`${s.repeat}\` (input: <#${s.inputId}> → output: <#${s.outputId}>)`).join('\n');
        await interaction.reply({
            content: `**Stopped ${stopped.length} scheduled auto-run(s):**\n${list}`,
            ephemeral: true
        });
        console.log(`[Stop] Stopped ${stopped.length} scheduled job(s) in guild ${guildId}`);
    },
};
