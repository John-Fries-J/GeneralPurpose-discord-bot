const fs = require('node:fs');
const { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getGuildSettings, updateLevelingSettings } = require('../../utils/guildConfig');
const {
    RankCardValidationError,
    getServerBackgroundAssetPath,
    getUserBackgroundAssetPath,
    normalizeBackgroundId,
    normalizeHexColor,
    processBackgroundAttachment,
    resolveRankCardPath,
    validateBackgroundAttachment,
} = require('../../utils/rankCard');
const {
    deleteRankCardBackground,
    deleteRankCardPreference,
    getRankCardPreference,
    listRankCardBackgrounds,
    upsertRankCardBackground,
    upsertRankCardPreference,
} = require('../../utils/store');

const ephemeral = 64;
const backgroundChoices = [
    { name: 'Default background', value: 'default' },
    { name: 'Custom upload', value: 'custom' },
    { name: 'Server background', value: 'server' },
];

const serverSubcommands = new Set([
    'server-add-background',
    'server-remove-background',
    'server-set-default',
    'server-set-accent',
]);

function canManageRankCards(interaction) {
    return interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)
        || interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild);
}

function findBackground(backgrounds, input) {
    const value = String(input || '').trim();
    const id = normalizeBackgroundId(value);
    return backgrounds.find(background => {
        return background.backgroundId === id || String(background.name || '').toLowerCase() === value.toLowerCase();
    }) || null;
}

async function savePreference(guildId, userId, changes) {
    const current = await getRankCardPreference(guildId, userId);
    return upsertRankCardPreference({
        guildId,
        userId,
        backgroundType: current?.backgroundType || 'default',
        backgroundKey: current?.backgroundKey || null,
        accentColor: current?.accentColor || null,
        ...changes,
    });
}

function removeAsset(relativeAssetPath) {
    try {
        fs.rmSync(resolveRankCardPath(relativeAssetPath), { force: true });
    } catch {
        return false;
    }
    return true;
}

function preferenceSummary(preference, backgrounds) {
    const background = preference?.backgroundType === 'server'
        ? findBackground(backgrounds, preference.backgroundKey)
        : null;
    const backgroundLabel = preference?.backgroundType === 'custom'
        ? 'Custom upload'
        : (background ? `Server: ${background.name}` : 'Default');
    return [
        `Background: **${backgroundLabel}**`,
        `Accent: **${preference?.accentColor || 'server default'}**`,
    ].join('\n');
}

function backgroundRows(backgrounds) {
    return backgrounds.length
        ? backgrounds.map(background => `- ${background.name} (\`${background.backgroundId}\`)`).join('\n')
        : 'No server backgrounds are configured.';
}

async function updateServerRankCard(interaction, values) {
    const current = (await getGuildSettings(interaction.guild.id)).leveling || {};
    await updateLevelingSettings(interaction.guild.id, {
        rankCard: {
            ...(current.rankCard || {}),
            ...values,
        },
    }, {
        actorId: interaction.user.id,
        source: 'command',
    });
}

async function handleSetBackground(interaction) {
    const source = interaction.options.getString('source', true);
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    if (source === 'default') {
        await savePreference(guildId, userId, { backgroundType: 'default', backgroundKey: null });
        return interaction.reply({ content: 'Your rank-card background now uses the server default.', flags: ephemeral });
    }

    if (source === 'server') {
        const name = interaction.options.getString('server_background');
        if (!name) return interaction.reply({ content: 'Provide the server background name or ID.', flags: ephemeral });
        const backgrounds = await listRankCardBackgrounds(guildId);
        const background = findBackground(backgrounds, name);
        if (!background) return interaction.reply({ content: 'That server background was not found. Use `/rankcard view` to see available backgrounds.', flags: ephemeral });
        await savePreference(guildId, userId, { backgroundType: 'server', backgroundKey: background.backgroundId });
        return interaction.reply({ content: `Your rank-card background now uses **${background.name}**.`, flags: ephemeral });
    }

    const attachment = interaction.options.getAttachment('image');
    if (!attachment) return interaction.reply({ content: 'Attach a PNG, JPEG, or WebP image for your custom background.', flags: ephemeral });
    const validation = validateBackgroundAttachment(attachment);
    if (!validation.ok) return interaction.reply({ content: validation.message, flags: ephemeral });

    await interaction.deferReply({ flags: ephemeral });
    try {
        await processBackgroundAttachment(attachment, getUserBackgroundAssetPath(guildId, userId));
        await savePreference(guildId, userId, { backgroundType: 'custom', backgroundKey: null });
        return interaction.editReply({ content: 'Your custom rank-card background has been saved.' });
    } catch (error) {
        const message = error instanceof RankCardValidationError
            ? error.message
            : 'That image could not be processed. Try a PNG, JPEG, or WebP file under the size limit.';
        return interaction.editReply({ content: message });
    }
}

async function handleSetAccent(interaction) {
    const color = normalizeHexColor(interaction.options.getString('color', true));
    if (!color) return interaction.reply({ content: 'Use a 6-digit hex colour, such as `#60a5fa`.', flags: ephemeral });
    await savePreference(interaction.guild.id, interaction.user.id, { accentColor: color });
    return interaction.reply({ content: `Your rank-card accent colour is now **${color}**.`, flags: ephemeral });
}

async function handleReset(interaction) {
    await deleteRankCardPreference(interaction.guild.id, interaction.user.id);
    removeAsset(getUserBackgroundAssetPath(interaction.guild.id, interaction.user.id));
    return interaction.reply({ content: 'Your rank-card preferences have been reset.', flags: ephemeral });
}

async function handleView(interaction) {
    const [preference, backgrounds, settings] = await Promise.all([
        getRankCardPreference(interaction.guild.id, interaction.user.id),
        listRankCardBackgrounds(interaction.guild.id),
        getGuildSettings(interaction.guild.id),
    ]);
    const defaultBackground = findBackground(backgrounds, settings.leveling?.rankCard?.defaultBackgroundId);
    return interaction.reply({
        content: [
            preferenceSummary(preference, backgrounds),
            `Server default: **${defaultBackground?.name || 'Generated default'}**`,
            '',
            '**Server backgrounds**',
            backgroundRows(backgrounds),
        ].join('\n'),
        flags: ephemeral,
    });
}

async function handleServerAddBackground(interaction) {
    const rawName = interaction.options.getString('name', true).trim();
    const image = interaction.options.getAttachment('image', true);
    if (!rawName) return interaction.reply({ content: 'Provide a background name.', flags: ephemeral });
    const validation = validateBackgroundAttachment(image);
    if (!validation.ok) return interaction.reply({ content: validation.message, flags: ephemeral });

    await interaction.deferReply({ flags: ephemeral });
    const backgroundId = normalizeBackgroundId(rawName);
    const assetPath = getServerBackgroundAssetPath(interaction.guild.id, backgroundId);
    try {
        await processBackgroundAttachment(image, assetPath);
        const background = await upsertRankCardBackground({
            guildId: interaction.guild.id,
            backgroundId,
            name: rawName.slice(0, 48),
            assetPath,
            createdBy: interaction.user.id,
        });
        return interaction.editReply({ content: `Saved server rank-card background **${background.name}**.` });
    } catch (error) {
        const message = error instanceof RankCardValidationError
            ? error.message
            : 'That image could not be processed. Try a PNG, JPEG, or WebP file under the size limit.';
        return interaction.editReply({ content: message });
    }
}

async function handleServerRemoveBackground(interaction) {
    const backgrounds = await listRankCardBackgrounds(interaction.guild.id);
    const background = findBackground(backgrounds, interaction.options.getString('name', true));
    if (!background) return interaction.reply({ content: 'That server background was not found.', flags: ephemeral });

    await deleteRankCardBackground(interaction.guild.id, background.backgroundId);
    removeAsset(background.assetPath);
    const current = (await getGuildSettings(interaction.guild.id)).leveling?.rankCard || {};
    if (current.defaultBackgroundId === background.backgroundId) {
        await updateServerRankCard(interaction, { defaultBackgroundId: '' });
    }
    return interaction.reply({ content: `Removed server rank-card background **${background.name}**.`, flags: ephemeral });
}

async function handleServerSetDefault(interaction) {
    const name = interaction.options.getString('name');
    if (!name) {
        await updateServerRankCard(interaction, { defaultBackgroundId: '' });
        return interaction.reply({ content: 'The server rank-card default now uses the generated background.', flags: ephemeral });
    }

    const backgrounds = await listRankCardBackgrounds(interaction.guild.id);
    const background = findBackground(backgrounds, name);
    if (!background) return interaction.reply({ content: 'That server background was not found.', flags: ephemeral });
    await updateServerRankCard(interaction, { defaultBackgroundId: background.backgroundId });
    return interaction.reply({ content: `The server rank-card default is now **${background.name}**.`, flags: ephemeral });
}

async function handleServerSetAccent(interaction) {
    const color = normalizeHexColor(interaction.options.getString('color', true));
    if (!color) return interaction.reply({ content: 'Use a 6-digit hex colour, such as `#60a5fa`.', flags: ephemeral });
    await updateServerRankCard(interaction, { accentColor: color });
    return interaction.reply({ content: `The server rank-card accent colour is now **${color}**.`, flags: ephemeral });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rankcard')
        .setDescription('Customize rank-card visuals.')
        .setContexts(InteractionContextType.Guild)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .addSubcommand(subcommand => subcommand
            .setName('view')
            .setDescription('View your rank-card preferences and server backgrounds.'))
        .addSubcommand(subcommand => subcommand
            .setName('set-background')
            .setDescription('Choose your rank-card background.')
            .addStringOption(option => option
                .setName('source')
                .setDescription('Background source.')
                .setRequired(true)
                .addChoices(...backgroundChoices))
            .addAttachmentOption(option => option
                .setName('image')
                .setDescription('PNG, JPEG, or WebP image for a custom background.'))
            .addStringOption(option => option
                .setName('server_background')
                .setDescription('Server background name or ID.')))
        .addSubcommand(subcommand => subcommand
            .setName('set-accent')
            .setDescription('Set your rank-card accent colour.')
            .addStringOption(option => option
                .setName('color')
                .setDescription('Hex colour, for example #60a5fa.')
                .setRequired(true)
                .setMaxLength(7)))
        .addSubcommand(subcommand => subcommand
            .setName('reset')
            .setDescription('Reset your rank-card preferences.'))
        .addSubcommand(subcommand => subcommand
            .setName('server-add-background')
            .setDescription('Add or replace a server-provided rank-card background.')
            .addStringOption(option => option
                .setName('name')
                .setDescription('Background name.')
                .setRequired(true)
                .setMaxLength(48))
            .addAttachmentOption(option => option
                .setName('image')
                .setDescription('PNG, JPEG, or WebP image.')
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName('server-remove-background')
            .setDescription('Remove a server-provided rank-card background.')
            .addStringOption(option => option
                .setName('name')
                .setDescription('Background name or ID.')
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName('server-set-default')
            .setDescription('Set the server default rank-card background.')
            .addStringOption(option => option
                .setName('name')
                .setDescription('Background name or ID. Leave empty for generated default.')))
        .addSubcommand(subcommand => subcommand
            .setName('server-set-accent')
            .setDescription('Set the server default rank-card accent colour.')
            .addStringOption(option => option
                .setName('color')
                .setDescription('Hex colour, for example #60a5fa.')
                .setRequired(true)
                .setMaxLength(7))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (serverSubcommands.has(subcommand) && !canManageRankCards(interaction)) {
            return interaction.reply({ content: 'You need Manage Server to change server rank-card settings.', flags: ephemeral });
        }

        if (subcommand === 'view') return handleView(interaction);
        if (subcommand === 'set-background') return handleSetBackground(interaction);
        if (subcommand === 'set-accent') return handleSetAccent(interaction);
        if (subcommand === 'reset') return handleReset(interaction);
        if (subcommand === 'server-add-background') return handleServerAddBackground(interaction);
        if (subcommand === 'server-remove-background') return handleServerRemoveBackground(interaction);
        if (subcommand === 'server-set-default') return handleServerSetDefault(interaction);
        if (subcommand === 'server-set-accent') return handleServerSetAccent(interaction);
        return interaction.reply({ content: 'Unsupported rank-card command.', flags: ephemeral });
    },
};
