const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ModalBuilder,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
} = require('discord.js');

function row(...components) {
    return new ActionRowBuilder().addComponents(components.flat());
}

function button(customId, label, style = ButtonStyle.Secondary, options = {}) {
    const builder = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style);

    if (options.disabled) builder.setDisabled(true);
    return builder;
}

function primaryButton(customId, label, options = {}) {
    return button(customId, label, ButtonStyle.Primary, options);
}

function secondaryButton(customId, label, options = {}) {
    return button(customId, label, ButtonStyle.Secondary, options);
}

function successButton(customId, label, options = {}) {
    return button(customId, label, ButtonStyle.Success, options);
}

function dangerButton(customId, label, options = {}) {
    return button(customId, label, ButtonStyle.Danger, options);
}

function stringSelect(customId, placeholder, options, {
    minValues = 1,
    maxValues = 1,
    disabled = false,
} = {}) {
    const builder = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .setMinValues(minValues)
        .setMaxValues(maxValues)
        .setOptions(options);

    if (disabled) builder.setDisabled(true);
    return builder;
}

function channelSelect(customId, placeholder, channelTypes, {
    minValues = 1,
    maxValues = 1,
    disabled = false,
} = {}) {
    const builder = new ChannelSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .setMinValues(minValues)
        .setMaxValues(maxValues);

    if (channelTypes?.length) builder.setChannelTypes(channelTypes);
    if (disabled) builder.setDisabled(true);
    return builder;
}

function roleSelect(customId, placeholder, {
    minValues = 1,
    maxValues = 1,
    disabled = false,
} = {}) {
    const builder = new RoleSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .setMinValues(minValues)
        .setMaxValues(maxValues);

    if (disabled) builder.setDisabled(true);
    return builder;
}

function userSelect(customId, placeholder, {
    minValues = 1,
    maxValues = 1,
    disabled = false,
} = {}) {
    const builder = new UserSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .setMinValues(minValues)
        .setMaxValues(maxValues);

    if (disabled) builder.setDisabled(true);
    return builder;
}

function textInput(customId, label, {
    style = TextInputStyle.Short,
    required = true,
    value = '',
    placeholder = '',
    minLength,
    maxLength,
} = {}) {
    const builder = new TextInputBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style)
        .setRequired(required);

    if (value) builder.setValue(value);
    if (placeholder) builder.setPlaceholder(placeholder);
    if (minLength !== undefined) builder.setMinLength(minLength);
    if (maxLength !== undefined) builder.setMaxLength(maxLength);
    return builder;
}

function modal(customId, title, inputs) {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addComponents(inputs.map(input => row(input)));
}

module.exports = {
    button,
    channelSelect,
    dangerButton,
    modal,
    primaryButton,
    roleSelect,
    row,
    secondaryButton,
    stringSelect,
    successButton,
    textInput,
    userSelect,
};
