const { SlashCommandBuilder } = require('discord.js');
const { parseDuration } = require('../../utils/duration');
const { createEmbed } = require('../../utils/embeds');

const maxReminderMs = 24 * 24 * 60 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remindme')
        .setDescription('Set a DM reminder.')
        .addStringOption(option => option.setName('duration').setDescription('When to remind you, such as 10m, 2h, or 3d.').setRequired(true))
        .addStringOption(option => option.setName('message').setDescription('What to remind you about.').setMaxLength(1500).setRequired(true)),

    async execute(interaction) {
        const duration = interaction.options.getString('duration', true);
        const message = interaction.options.getString('message', true);
        const durationMs = parseDuration(duration);

        if (!durationMs) {
            return interaction.reply({ content: 'Invalid duration. Use something like 10m, 2h, or 3d.', flags: 64 });
        }

        if (durationMs > maxReminderMs) {
            return interaction.reply({ content: 'Reminders can be up to 24 days while this bot has no database.', flags: 64 });
        }

        setTimeout(async () => {
            const embed = createEmbed({
                title: 'Reminder',
                description: message,
                color: 'blue',
            });
            await interaction.user.send({ embeds: [embed] }).catch(() => null);
        }, durationMs);

        return interaction.reply({ content: `I will remind you in ${duration}.`, flags: 64 });
    },
};
