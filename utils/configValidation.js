function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateString(errors, config, path, { required = false } = {}) {
    const value = path.split('.').reduce((current, part) => current?.[part], config);
    if (value === undefined || value === null || value === '') {
        if (required) errors.push(`${path} is required.`);
        return;
    }

    if (typeof value !== 'string') {
        errors.push(`${path} must be a string.`);
    }
}

function validateConfig(config, options = {}) {
    const errors = [];

    if (!isPlainObject(config)) {
        return ['config must be a JSON object.'];
    }

    validateString(errors, config, 'token', { required: options.requireToken });
    validateString(errors, config, 'clientId');
    validateString(errors, config, 'guildId');
    validateString(errors, config, 'statusName');
    validateString(errors, config, 'welcomeID');
    validateString(errors, config, 'suggestionID');

    if (config.devs !== undefined && (!Array.isArray(config.devs) || !config.devs.every(item => typeof item === 'string'))) {
        errors.push('devs must be an array of strings.');
    }

    if (config.logChannels !== undefined) {
        if (!isPlainObject(config.logChannels)) {
            errors.push('logChannels must be an object.');
        } else {
            for (const [key, value] of Object.entries(config.logChannels)) {
                if (typeof value !== 'string') errors.push(`logChannels.${key} must be a string.`);
            }
        }
    }

    if (config.roles !== undefined) {
        if (!isPlainObject(config.roles)) {
            errors.push('roles must be an object.');
        } else {
            validateString(errors, config, 'roles.autoRoleId');
            if (config.roles.autoRoleIds !== undefined && (!Array.isArray(config.roles.autoRoleIds) || !config.roles.autoRoleIds.every(item => typeof item === 'string'))) {
                errors.push('roles.autoRoleIds must be an array of strings.');
            }
        }
    }

    if (config.dashboard !== undefined) {
        if (!isPlainObject(config.dashboard)) {
            errors.push('dashboard must be an object.');
        } else {
            if (config.dashboard.enabled !== undefined && typeof config.dashboard.enabled !== 'boolean') {
                errors.push('dashboard.enabled must be a boolean.');
            }
            if (config.dashboard.port !== undefined && (!Number.isInteger(config.dashboard.port) || config.dashboard.port < 1 || config.dashboard.port > 65535)) {
                errors.push('dashboard.port must be an integer from 1 to 65535.');
            }
            validateString(errors, config, 'dashboard.host');
            validateString(errors, config, 'dashboard.publicUrl');
            validateString(errors, config, 'dashboard.guildId');
            validateString(errors, config, 'dashboard.oauth.clientId');
            validateString(errors, config, 'dashboard.oauth.clientSecret');
            validateString(errors, config, 'dashboard.oauth.redirectUri');
        }
    }

    if (config.honeypot !== undefined) {
        if (!isPlainObject(config.honeypot)) {
            errors.push('honeypot must be an object.');
        } else {
            if (config.honeypot.enabled !== undefined && typeof config.honeypot.enabled !== 'boolean') {
                errors.push('honeypot.enabled must be a boolean.');
            }
            validateString(errors, config, 'honeypot.channelId');
            validateString(errors, config, 'honeypot.alertChannelId');
        }
    }

    if (config.memberCounters !== undefined && !Array.isArray(config.memberCounters)) {
        errors.push('memberCounters must be an array.');
    }

    if (config.youtube !== undefined) {
        if (!isPlainObject(config.youtube)) {
            errors.push('youtube must be an object.');
        } else if (config.youtube.channels !== undefined && !Array.isArray(config.youtube.channels)) {
            errors.push('youtube.channels must be an array.');
        }
    }

    if (config.twitch !== undefined) {
        if (!isPlainObject(config.twitch)) {
            errors.push('twitch must be an object.');
        } else if (config.twitch.channels !== undefined && !Array.isArray(config.twitch.channels)) {
            errors.push('twitch.channels must be an array.');
        }
    }

    if (config.database !== undefined) {
        if (!isPlainObject(config.database)) {
            errors.push('database must be an object.');
        } else {
            if (config.database.provider !== undefined && !['sqlite', 'json'].includes(config.database.provider)) {
                errors.push('database.provider must be either "sqlite" or "json".');
            }
            validateString(errors, config, 'database.jsonPath');
            validateString(errors, config, 'database.sqlitePath');
        }
    }

    if (config.commandSettings !== undefined) {
        if (!isPlainObject(config.commandSettings)) {
            errors.push('commandSettings must be an object.');
        } else {
            if (config.commandSettings.modules !== undefined && !isPlainObject(config.commandSettings.modules)) {
                errors.push('commandSettings.modules must be an object.');
            }
            if (config.commandSettings.commands !== undefined && !isPlainObject(config.commandSettings.commands)) {
                errors.push('commandSettings.commands must be an object.');
            }
        }
    }

    if (config.moderation !== undefined) {
        if (!isPlainObject(config.moderation)) {
            errors.push('moderation must be an object.');
        } else {
            validateString(errors, config, 'moderation.muteRoleId');
            validateString(errors, config, 'moderation.muteRoleName');
        }
    }

    return errors;
}

function assertValidConfig(config, options) {
    const errors = validateConfig(config, options);
    if (errors.length) {
        throw new Error(`Invalid config.json:\n- ${errors.join('\n- ')}`);
    }
}

module.exports = {
    assertValidConfig,
    validateConfig,
};
