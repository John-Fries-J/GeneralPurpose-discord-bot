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

function validateBoolean(errors, config, path) {
    const value = path.split('.').reduce((current, part) => current?.[part], config);
    if (value !== undefined && typeof value !== 'boolean') {
        errors.push(`${path} must be a boolean.`);
    }
}

function validateInteger(errors, config, path, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    const value = path.split('.').reduce((current, part) => current?.[part], config);
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
        errors.push(`${path} must be an integer from ${min} to ${max}.`);
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

    if (config.logging !== undefined) {
        if (!isPlainObject(config.logging)) {
            errors.push('logging must be an object.');
        } else {
            validateBoolean(errors, config, 'logging.showUserAvatars');
        }
    }

    if (config.history !== undefined) {
        if (!isPlainObject(config.history)) {
            errors.push('history must be an object.');
        } else {
            validateBoolean(errors, config, 'history.enabled');
            validateBoolean(errors, config, 'history.recordMessages');
            validateBoolean(errors, config, 'history.recordCommands');
            validateInteger(errors, config, 'history.maxEntries', { min: 1, max: 1000000 });
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
            validateString(errors, config, 'honeypot.mentionId');
            validateString(errors, config, 'honeypot.mentionType');
            if (config.honeypot.mentionType !== undefined && config.honeypot.mentionType !== '' && !['user', 'role'].includes(config.honeypot.mentionType)) {
                errors.push('honeypot.mentionType must be "user", "role", or an empty string.');
            }
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
        } else {
            validateString(errors, config, 'twitch.clientId');
            validateString(errors, config, 'twitch.clientSecret');
            validateString(errors, config, 'twitch.accessToken');
            if (config.twitch.accessTokenExpiresAt !== undefined && (!Number.isInteger(config.twitch.accessTokenExpiresAt) || config.twitch.accessTokenExpiresAt < 0)) {
                errors.push('twitch.accessTokenExpiresAt must be a non-negative integer.');
            }
            if (config.twitch.channels !== undefined && !Array.isArray(config.twitch.channels)) {
                errors.push('twitch.channels must be an array.');
            }
        }
    }

    if (config.joinToCreate !== undefined) {
        if (!isPlainObject(config.joinToCreate)) {
            errors.push('joinToCreate must be an object.');
        } else {
            if (config.joinToCreate.enabled !== undefined && typeof config.joinToCreate.enabled !== 'boolean') {
                errors.push('joinToCreate.enabled must be a boolean.');
            }
            if (config.joinToCreate.userLimitMax !== undefined && (!Number.isInteger(config.joinToCreate.userLimitMax) || config.joinToCreate.userLimitMax < 1 || config.joinToCreate.userLimitMax > 99)) {
                errors.push('joinToCreate.userLimitMax must be an integer from 1 to 99.');
            }
        }
    }

    if (config.leveling !== undefined) {
        if (!isPlainObject(config.leveling)) {
            errors.push('leveling must be an object.');
        } else {
            if (config.leveling.enabled !== undefined && typeof config.leveling.enabled !== 'boolean') {
                errors.push('leveling.enabled must be a boolean.');
            }
            if (config.leveling.mode !== undefined && !['text', 'voice', 'both'].includes(config.leveling.mode)) {
                errors.push('leveling.mode must be "text", "voice", or "both".');
            }
            if (config.leveling.roleRewards !== undefined && !Array.isArray(config.leveling.roleRewards)) {
                errors.push('leveling.roleRewards must be an array.');
            }
        }
    }

    if (config.database !== undefined) {
        if (!isPlainObject(config.database)) {
            errors.push('database must be an object.');
        } else {
            if (config.database.provider !== undefined && !['sqlite', 'json', 'mysql'].includes(config.database.provider)) {
                errors.push('database.provider must be "sqlite", "json", or "mysql".');
            }
            validateString(errors, config, 'database.jsonPath');
            validateString(errors, config, 'database.sqlitePath');
            validateString(errors, config, 'database.mysql.url', { required: config.database.provider === 'mysql' });
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
            if (config.commandSettings.access !== undefined) {
                if (!isPlainObject(config.commandSettings.access)) {
                    errors.push('commandSettings.access must be an object.');
                } else {
                    for (const [commandName, access] of Object.entries(config.commandSettings.access)) {
                        if (!isPlainObject(access)) {
                            errors.push(`commandSettings.access.${commandName} must be an object.`);
                            continue;
                        }

                        for (const key of ['allowRoleIds', 'allowUserIds', 'denyRoleIds', 'denyUserIds']) {
                            if (access[key] !== undefined && (!Array.isArray(access[key]) || !access[key].every(item => typeof item === 'string'))) {
                                errors.push(`commandSettings.access.${commandName}.${key} must be an array of strings.`);
                            }
                        }
                    }
                }
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

    if (config.namelessmc !== undefined) {
        if (!isPlainObject(config.namelessmc)) {
            errors.push('namelessmc must be an object.');
        } else {
            if (config.namelessmc.enabled !== undefined && typeof config.namelessmc.enabled !== 'boolean') {
                errors.push('namelessmc.enabled must be a boolean.');
            }
            validateString(errors, config, 'namelessmc.apiUrl');
            validateString(errors, config, 'namelessmc.apiKey');
            if (config.namelessmc.syncOnReady !== undefined && typeof config.namelessmc.syncOnReady !== 'boolean') {
                errors.push('namelessmc.syncOnReady must be a boolean.');
            }
            if (config.namelessmc.syncIntervalMinutes !== undefined && (!Number.isInteger(config.namelessmc.syncIntervalMinutes) || config.namelessmc.syncIntervalMinutes < 0)) {
                errors.push('namelessmc.syncIntervalMinutes must be a non-negative integer.');
            }
            if (config.namelessmc.roleSync !== undefined) {
                if (!isPlainObject(config.namelessmc.roleSync)) {
                    errors.push('namelessmc.roleSync must be an object.');
                } else {
                    if (config.namelessmc.roleSync.enabled !== undefined && typeof config.namelessmc.roleSync.enabled !== 'boolean') {
                        errors.push('namelessmc.roleSync.enabled must be a boolean.');
                    }
                    if (config.namelessmc.roleSync.direction !== undefined && !['nameless-to-discord', 'discord-to-nameless', 'both'].includes(config.namelessmc.roleSync.direction)) {
                        errors.push('namelessmc.roleSync.direction must be "nameless-to-discord", "discord-to-nameless", or "both".');
                    }
                    if (config.namelessmc.roleSync.groupRoleMap !== undefined && !Array.isArray(config.namelessmc.roleSync.groupRoleMap)) {
                        errors.push('namelessmc.roleSync.groupRoleMap must be an array.');
                    }
                }
            }
        }
    }

    if (config.music !== undefined) {
        if (!isPlainObject(config.music)) {
            errors.push('music must be an object.');
        } else {
            validateBoolean(errors, config, 'music.enabled');
            validateBoolean(errors, config, 'music.allowFileUploads');
            validateInteger(errors, config, 'music.maxQueueLength', { min: 1, max: 1000 });
            validateInteger(errors, config, 'music.voiceReadyTimeoutMs', { min: 5000, max: 300000 });
            validateInteger(errors, config, 'music.voiceJoinRetries', { min: 0, max: 10 });
            validateInteger(errors, config, 'music.voiceRetryDelayMs', { min: 0, max: 60000 });
            validateString(errors, config, 'music.ytDlpCookiesPath');
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
