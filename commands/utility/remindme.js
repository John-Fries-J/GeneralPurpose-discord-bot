const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { parseDuration } = require('../../utils/duration');
const { createReminder } = require('../../utils/store');

const maxReminderMs = 365 * 24 * 60 * 60 * 1000;

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
            return interaction.reply({ content: 'Invalid duration. Use something like 10m, 2h, or 3d.', flags: MessageFlags.Ephemeral });
        }

        if (durationMs > maxReminderMs) {
            return interaction.reply({ content: 'Reminders can be up to 365 days.', flags: MessageFlags.Ephemeral });
        }

        const remindAt = Date.now() + durationMs;
        await createReminder({
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            message,
            remindAt,
        });

        return interaction.reply({
            content: `I will remind you <t:${Math.floor(remindAt / 1000)}:R>.`,
            flags: MessageFlags.Ephemeral,
        });
    },
};
