// create a new file named commandHandling.js in the events folder and paste the following code:
 const fs = require('node:fs');
 const path = require('node:path');
 const { Client } = require('discord.js');

 module.exports = {
 	name: 'ready',
 	once: true,
 	execute(client) {
 		client.commands = new Map();
 		const commandFolders = fs.readdirSync('./commands');
 		for (const folder of commandFolders) {
 			const commandFiles = fs.readdirSync(`./commands/${folder}`).filter(file => file.endsWith('.js'));
 			for (const file of commandFiles) {
 				const command = require(`../commands/${folder}/${file}`);
 				client.commands.set(command.data.name, command);
 			}
 		}
 	},
 };
