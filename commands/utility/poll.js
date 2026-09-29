const { InteractionContextType, ApplicationIntegrationType, SlashCommandBuilder } = require('discord.js');
const { sendLog, formatUser } = require('../../utils/logging');

function collectAnswers(interaction) {
    const answers = [];

    for (let index = 1; index <= 10; index += 1) {
        const answer = interaction.options.getString(`option${index}`);
        if (answer) answers.push({ text: answer });
    }

    return answers;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Create a native Discord poll.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addStringOption(option => option.setName('question').setDescription('The poll question.').setMaxLength(300).setRequired(true))
        .addStringOption(option => option.setName('option1').setDescription('Poll option 1.').setMaxLength(55).setRequired(true))
        .addStringOption(option => option.setName('option2').setDescription('Poll option 2.').setMaxLength(55).setRequired(true))
        .addStringOption(option => option.setName('option3').setDescription('Poll option 3.').setMaxLength(55))
        .addStringOption(option => option.setName('option4').setDescription('Poll option 4.').setMaxLength(55))
        .addStringOption(option => option.setName('option5').setDescription('Poll option 5.').setMaxLength(55))
        .addStringOption(option => option.setName('option6').setDescription('Poll option 6.').setMaxLength(55))
        .addStringOption(option => option.setName('option7').setDescription('Poll option 7.').setMaxLength(55))
        .addStringOption(option => option.setName('option8').setDescription('Poll option 8.').setMaxLength(55))
        .addStringOption(option => option.setName('option9').setDescription('Poll option 9.').setMaxLength(55))
        .addStringOption(option => option.setName('option10').setDescription('Poll option 10.').setMaxLength(55))
        .addIntegerOption(option => option.setName('duration').setDescription('Poll duration in hours.').setMinValue(1).setMaxValue(168))
        .addBooleanOption(option => option.setName('multiple_answers').setDescription('Allow users to choose more than one option.')),

    async execute(interaction) {
        const question = interaction.options.getString('question', true);
        const answers = collectAnswers(interaction);
        const duration = interaction.options.getInteger('duration') || 24;
        const allowMultiselect = interaction.options.getBoolean('multiple_answers') || false;

        await interaction.reply({
            poll: {
                question: { text: question },
                answers,
                duration,
                allowMultiselect,
            },
        });

        await sendLog(interaction.guild, {
            type: 'general',
            title: 'Poll created',
            color: 'blue',
            user: interaction.user,
            fields: [
                { name: 'Creator', value: formatUser(interaction.user), inline: true },
                { name: 'Duration', value: `${duration} hours`, inline: true },
                { name: 'Question', value: question },
            ],
        }).catch(() => null);
    },
};
