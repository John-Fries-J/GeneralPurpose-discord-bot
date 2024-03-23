import config from './config.json' assert { type: 'json' };

// start the discord bot with the token from the config file 
const client = new Discord.Client();
client.login(config.token);
console.log('Bot started!')


client.once('ready', () => {
    console.log('Ready!');
    client.user.setActivity('!help', { type: 'LISTENING' });
});

