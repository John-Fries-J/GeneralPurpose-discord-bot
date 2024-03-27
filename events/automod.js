const { Events } = require('discord.js');
module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot) return;
        if (message.content.match(/(discord\.(gg|io|me|li)\/.+|discordapp\.com\/invite\/.+)/i) || message.content.match(/(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)\/.+|discordapp\.com\/invite\/.+)/i)) {
            await message.delete();
            await message.channel.send(`Hey!\n${message.author} You are not allowed to send discord invite links!`);
        }
    },

};