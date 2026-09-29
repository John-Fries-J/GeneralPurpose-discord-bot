const test = require('node:test');
const assert = require('node:assert/strict');
const { ComponentType, MessageFlags } = require('discord.js');
const {
    actionRow,
    button,
    checkbox,
    checkboxGroup,
    checkboxOption,
    container,
    label,
    radioGroup,
    radioOption,
    separator,
    textDisplay,
    v2Payload,
    v2UpdatePayload,
} = require('../utils/discordUi');

test('discord UI helpers build Components V2 payloads with stable flags', () => {
    const payload = v2Payload(container([
        textDisplay('## Title'),
        separator(),
        actionRow(button('demo:next', 'Next')),
    ]));
    const json = payload.components[0].toJSON();

    assert.equal(payload.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    assert.equal(json.type, ComponentType.Container);
    assert.equal(json.components[0].type, ComponentType.TextDisplay);
    assert.equal(json.components[1].type, ComponentType.Separator);
    assert.equal(json.components[2].type, ComponentType.ActionRow);
});

test('discord UI helpers build modal label wrappers for modern controls', () => {
    const radio = radioGroup('setup:mode', [
        radioOption('Text', 'text', { default: true }),
        radioOption('Voice', 'voice'),
    ]);
    const checks = checkboxGroup('setup:logs', [
        checkboxOption('Moderation', 'moderation', { default: true }),
    ]);
    const single = checkbox('setup:enabled', { defaultValue: true });

    assert.equal(label('Mode', radio).toJSON().component.type, ComponentType.RadioGroup);
    assert.equal(label('Logs', checks).toJSON().component.type, ComponentType.CheckboxGroup);
    assert.equal(label('Enabled', single).toJSON().component.type, ComponentType.Checkbox);
});

test('discord UI update payload keeps only the editable V2 flag', () => {
    const payload = v2UpdatePayload(container([textDisplay('Updated')]));

    assert.equal(payload.flags, MessageFlags.IsComponentsV2);
    assert.equal(payload.components[0].toJSON().type, ComponentType.Container);
});
