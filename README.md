<br/>
<p align="center">
  <a href="https://github.com/John-Fries-J/GeneralPurpose-discord-bot">
    <img src="https://i.johnfries.net/images/logos/logo1.png" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">A basic Discordjs V14 bot with common commands</h3>

  <p align="center">
    Free easy discord bot with lots of configurable options
    <br>
    This is a passion project so don't expect updates immediately and it might not be perfect so feel free to create issues and prs if you want to help but if I can't fix dont be a beg.
  </p>

# IF YOU ARE HAVING ISSUES OR ANY SUPPORT QUESTIONS. JOIN MY DISCORD. https://discord.gg/dCCksYzPWU I have notis on for discord so I'll respond ASAP.

# About The Project

This bot is made with the intention of setting things up without configing beforehand. You can setup most of the channels. Roles ect via commands rather than hard code. There is no need for a database and its 2 commands to get started. Super simple for people that just want to run a bot with some cool features and forget about it. If you're wanting to create something more permenant i.e setting the ticket channel once then never touching it again. Let me know on discord and I'll create a custom repo for you that has your desired needs. Same with custom commands, If you want help setting them up let me know and I'll help on discord!

Index: <br>
<a href="#Commands"> Command List</a> <br>
<a href="#GettingStarted"> Getting Started With the bot</a> <br>
<a href="#Config"> Config Setup and Explanation</a><br>


# GettingStarted

Download all the dependacies using ``npm i`` I'm using node v18.12.1 <br>
Now fill out the exampleconfig.json config. For more details check <a href="#config">here!</a> <br>
Make sure to change your config filename to config.json or YOUR FILE WILL NOT WORK.<br>
Once all your dependancies are downloaded type either ``npm run run`` or ``node index.js`` <br>


# Commands:

Moderation
* `/ban [user] [reason] [duration]` - "Bans a user from the server can also have a duration on the ban"
* `/unban [user]` - "Unbans a user from the server using their discord ID"
* `/mute [user] [duration] [reason]` - "Mutes a user in the server with the timeout feature."
* `/unmute [user]` - "Unmutes the user"
* `/purge [amount]` - "Purges the specified amount of messages"

Utility
* `/ping` - "Gets the ping of the bot"
* `/user` - "Provides information about the user"
* `/server` - "Provides information about the server"
* `/avatar` - "Provides the users avatar or selected user"
* `/help [Optionally can specify the command you want more detail on]` - "Provides a list of the commands the bot has." 

Ticket
* `/ticket [embedMessageChannel] [supportRole] [ticketCategory]` - "Initiates the ticket system and sends the embed through."
* `/close` - "Closes the ticket. Allows the support role to still see the channel but disables the ticket owner from seeing the channel"
* `/delete` - "Deletes the ticket channel. Looks for any channel with the name "closed-" so be careful."
<br> <br>

# Config <br>

<br>
    "token":"", This is your discord bot token. Find it <a href="https://discord.com/developers/applications/"> here</a>  under Bot <br>
    "devs":["630070645874622494"], This is your discord ID by default its mine but you can change it out and put yours in there. If you want to put multiple you should seperate it out like an array like follows: ["630070645874622494", "464107754198663168"] <br>
    "suggestChannel":"" this is the channel you want the suggestions to be sent to. <br>
    "statusName": "Bot Status", This is what the bot is "playing" I recomend something like. "/help" but its entirely up to you <br>
    "clientId": "", This is the bots client ID found <a href="https://discord.com/developers/applications/">here</a> under OAuth2 <br>
	  "guildId": "" This is the parent servers ID. This is currently not used for anything but if this bot is used in one guild specifically or you have a main server just put the ID there. 
    "logChannels":{
        "logChannel": "",
        "messageDelete": "",
        "editMessage": "",
        "threadCreate": "",
        "threadDelete": "",
        "threadUpdate": ""
    }
    I set up different channels sending different log messages to allow for cleaner channels. If you dont want this then just put the same channel ID in all of the values and it will work.
        "WelcomeEmbed": {
        "title": "Welcome to the server!",
        "description": "Welcome ${user}!\nGo to <#ChannelID> to get your roles!\nGo to <#ChannelID> to read up on the rules!",
        "thumbnail": "https://cdn.discordapp.com/attachments/932110932245622865/932110932245622865/unknown.png",
        "footer": "Welcome to the server!",
        "footerIcon": "https://cdn.discordapp.com/attachments/932110932245622865/932110932245622865/unknown.png"
    },
    ,
    "Twitch": {
        "ClientId": "",
        "AccessToken": "",
        "streamerId": "",
        "discordChannelId": "",
        "streamerName": ""
    }
    This is slightly harder to setup so feel free to join my discord (https://discord.gg/dCCksYzPWU) and I can assist you with your setup. 
    To get your twitch client ID you need to head over to https://dev.twitch.tv/login and log in with your twitch. Once there you can create an application. Your client ID is the one you need to enter in the config. To get your access token you need to run this command in your CLI (visual studio works well!):<br> 
    
    curl -X POST "https://id.twitch.tv/oauth2/token" \
    -d "client_id=YOUR_CLIENT_ID" \
    -d "client_secret=YOUR_CLIENT_SECRET" \
    -d "grant_type=client_credentials"
<br>
You can then get your access token. Then to get the streamers ID you need to run this command in your CLI:<br>

    curl -X GET "https://api.twitch.tv/helix/users?login=[THE STREAMERS NAME YOU WANT NOTIFS FOR]" -H "Client-ID: [clientid]" -H "Authorization: Bearer [your access token]"
<br>
THIS IS CRUCIAL. THE ID IS WHAT TWICH USES TO GET THE STREAM.<br>
once you have done that you should be all sorted and everything should be fine and dandy.
  <br>
<br>
 
<br>
<br>

## Authors

* **John Fries** - *Developer* - [John Fries](https://github.com/John-Fries-J/) - *Made everything*