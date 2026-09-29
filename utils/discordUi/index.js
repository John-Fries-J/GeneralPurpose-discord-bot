const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    CheckboxBuilder,
    CheckboxGroupBuilder,
    CheckboxGroupOptionBuilder,
    ContainerBuilder,
    FileBuilder,
    FileUploadBuilder,
    LabelBuilder,
    MediaGalleryBuilder,
    MessageFlags,
    RadioGroupBuilder,
    RadioGroupOptionBuilder,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    ComponentType,
} = require('discord.js');

const brandColor = 0x5865f2;

function textDisplay(content) {
    return new TextDisplayBuilder().setContent(String(content || ''));
}

function separator({ divider = true, spacing = SeparatorSpacingSize.Small } = {}) {
    return new SeparatorBuilder()
        .setDivider(divider)
        .setSpacing(spacing);
}

function button(customId, label, style = ButtonStyle.Secondary, options = {}) {
    const builder = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style);
    if (options.disabled) builder.setDisabled(true);
    return builder;
}

function actionRow(...components) {
    return new ActionRowBuilder().addComponents(components.flat());
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

function thumbnail(url, description = '') {
    const builder = new ThumbnailBuilder().setURL(url);
    if (description) builder.setDescription(description);
    return builder;
}

function section(content, accessory) {
    const builder = new SectionBuilder();
    const displays = Array.isArray(content) ? content : [content];
    builder.addTextDisplayComponents(displays.map(item => (typeof item === 'string' ? textDisplay(item) : item)));
    if (accessory instanceof ButtonBuilder) builder.setButtonAccessory(accessory);
    else if (accessory instanceof ThumbnailBuilder) builder.setThumbnailAccessory(accessory);
    else throw new Error('Sections require a button or thumbnail accessory.');
    return builder;
}

function mediaGallery(items = []) {
    return new MediaGalleryBuilder().addItems(items);
}

function file(url, { spoiler = false } = {}) {
    const builder = new FileBuilder().setURL(url);
    if (spoiler) builder.setSpoiler(true);
    return builder;
}

function label(labelText, component, description = '') {
    const builder = new LabelBuilder().setLabel(labelText);
    if (description) builder.setDescription(description);

    const type = component.toJSON().type;
    if (type === ComponentType.TextInput) return builder.setTextInputComponent(component);
    if (type === ComponentType.FileUpload) return builder.setFileUploadComponent(component);
    if (type === ComponentType.Checkbox) return builder.setCheckboxComponent(component);
    if (type === ComponentType.CheckboxGroup) return builder.setCheckboxGroupComponent(component);
    if (type === ComponentType.RadioGroup) return builder.setRadioGroupComponent(component);
    if (type === ComponentType.StringSelect) return builder.setStringSelectMenuComponent(component);
    if (type === ComponentType.UserSelect) return builder.setUserSelectMenuComponent(component);
    if (type === ComponentType.RoleSelect) return builder.setRoleSelectMenuComponent(component);
    if (type === ComponentType.MentionableSelect) return builder.setMentionableSelectMenuComponent(component);
    if (type === ComponentType.ChannelSelect) return builder.setChannelSelectMenuComponent(component);
    throw new Error('Unsupported labeled component type.');
}

function radioOption(labelText, value, options = {}) {
    const builder = new RadioGroupOptionBuilder()
        .setLabel(labelText)
        .setValue(value);
    if (options.description) builder.setDescription(options.description);
    if (options.default) builder.setDefault(true);
    return builder;
}

function radioGroup(customId, options, { required = true } = {}) {
    return new RadioGroupBuilder()
        .setCustomId(customId)
        .setRequired(required)
        .setOptions(options);
}

function checkbox(customId, { defaultValue = false } = {}) {
    return new CheckboxBuilder()
        .setCustomId(customId)
        .setDefault(defaultValue);
}

function checkboxOption(labelText, value, options = {}) {
    const builder = new CheckboxGroupOptionBuilder()
        .setLabel(labelText)
        .setValue(value);
    if (options.description) builder.setDescription(options.description);
    if (options.default) builder.setDefault(true);
    return builder;
}

function checkboxGroup(customId, options, {
    minValues = 0,
    maxValues = options.length,
    required = false,
} = {}) {
    return new CheckboxGroupBuilder()
        .setCustomId(customId)
        .setMinValues(minValues)
        .setMaxValues(maxValues)
        .setRequired(required)
        .setOptions(options);
}

function fileUpload(customId, { minValues = 0, maxValues = 1, required = false } = {}) {
    return new FileUploadBuilder()
        .setCustomId(customId)
        .setMinValues(minValues)
        .setMaxValues(maxValues)
        .setRequired(required);
}

function addContainerComponent(container, component) {
    const type = component.toJSON().type;
    if (type === ComponentType.TextDisplay) return container.addTextDisplayComponents(component);
    if (type === ComponentType.Separator) return container.addSeparatorComponents(component);
    if (type === ComponentType.Section) return container.addSectionComponents(component);
    if (type === ComponentType.ActionRow) return container.addActionRowComponents(component);
    if (type === ComponentType.MediaGallery) return container.addMediaGalleryComponents(component);
    if (type === ComponentType.File) return container.addFileComponents(component);
    throw new Error(`Unsupported container component type: ${type}`);
}

function container(components = [], { accentColor = brandColor, spoiler = false } = {}) {
    const builder = new ContainerBuilder().setAccentColor(accentColor);
    if (spoiler) builder.setSpoiler(true);
    for (const component of components) addContainerComponent(builder, component);
    return builder;
}

function v2Flags({ ephemeral = true } = {}) {
    return MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0);
}

function v2Payload(components, options = {}) {
    return {
        components: Array.isArray(components) ? components : [components],
        flags: v2Flags(options),
    };
}

function v2UpdatePayload(components) {
    return {
        components: Array.isArray(components) ? components : [components],
        flags: MessageFlags.IsComponentsV2,
    };
}

module.exports = {
    actionRow,
    brandColor,
    button,
    checkbox,
    checkboxGroup,
    checkboxOption,
    container,
    file,
    fileUpload,
    label,
    mediaGallery,
    radioGroup,
    radioOption,
    section,
    separator,
    stringSelect,
    textDisplay,
    thumbnail,
    v2Flags,
    v2Payload,
    v2UpdatePayload,
};
