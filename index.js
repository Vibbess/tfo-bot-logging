require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    MessageFlags,
    EmbedBuilder
} = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');

// Imports
const cfg = require('./config');
const { transferUser } = require('./ranker');
const { processLog } = require('./logger');

// --- SETUP ---
const TOKEN = process.env.DISCORD_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const TOKEN_PATH = './tokens.json';
const PERMS_PATH = './permissions.json';

// Google OAuth2
const credentials = JSON.parse(fs.readFileSync('client_secret.json'));
const { client_id, client_secret, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ] 
});

// --- HELPERS ---
function getPermissions() {
    if (!fs.existsSync(PERMS_PATH)) return {};
    try { return JSON.parse(fs.readFileSync(PERMS_PATH)); } catch { return {}; }
}

function savePermissions(perms) {
    fs.writeFileSync(PERMS_PATH, JSON.stringify(perms, null, 2));
}

async function getUserSheets(userId) {
    if (!fs.existsSync(TOKEN_PATH)) return null;
    const db = JSON.parse(fs.readFileSync(TOKEN_PATH));
    const userTokens = db[userId];
    if (!userTokens) return null;
    const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    auth.setCredentials(userTokens);
    return auth;
}

// --- COMMAND DEFINITIONS ---
const commands = [
    new SlashCommandBuilder().setName('authorize').setDescription('Authorize a user for a specific command')
        .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
        .addStringOption(o => o.setName('command').setDescription('Command name').setRequired(true)),

    new SlashCommandBuilder().setName('verify').setDescription('Connect your Google account'),
    new SlashCommandBuilder().setName('confirm').setDescription('Finalize verification with code')
        .addStringOption(o => o.setName('code').setDescription('Code from Google URL').setRequired(true)),

    new SlashCommandBuilder().setName('bgc').setDescription('Background check results')
        .addStringOption(o => o.setName('robloxuserid').setDescription('Roblox User ID').setRequired(true))
        .addUserOption(o => o.setName('discorduser').setDescription('Discord User').setRequired(true))
        .addStringOption(o => o.setName('result').setDescription('Pass or Fail').setRequired(true)
            .addChoices({name: 'Pass', value: 'pass'}, {name: 'Fail', value: 'fail'})),

    new SlashCommandBuilder().setName('rank').setDescription('Change a user\'s rank and update sheets')
        .addStringOption(o => o.setName('robloxusername').setDescription('Roblox Username').setRequired(true))
        .addUserOption(o => o.setName('discorduser').setDescription('Discord User (@)').setRequired(true))
        .addStringOption(o => o.setName('current_rank').setDescription('Current Rank').setRequired(true))
        .addStringOption(o => o.setName('new_rank').setDescription('Target Rank').setRequired(true)),

    new SlashCommandBuilder().setName('eventlog').setDescription('Log a divisional event')
        .addStringOption(o => o.setName('event_type').setDescription('Type of event').setRequired(true)
            .addChoices(
                { name: 'Patrol', value: 'Patrol' },
                { name: 'General Tryout', value: 'General Tryout' },
                { name: 'General Training (GT)', value: 'General Training (GT)' },
                { name: 'OTS CT', value: 'OTS CT' },
                { name: 'TPS CT', value: 'TPS CT' },
                { name: 'Inspections', value: 'Inspections' }
            ))
        .addStringOption(o => o.setName('input').setDescription('Attendees / Raw Log').setRequired(true))
        .addBooleanOption(o => o.setName('weekend').setDescription('Is it the weekend?').setRequired(true)),

    new SlashCommandBuilder().setName('timelog').setDescription('Log in-game time')
        .addStringOption(o => o.setName('input').setDescription('Log text').setRequired(true)),

    new SlashCommandBuilder().setName('inactivitynotice').setDescription('Issue an inactivity notice')
        .addUserOption(o => o.setName('discorduser').setDescription('Discord User').setRequired(true))
        .addStringOption(o => o.setName('robloxusername').setDescription('Roblox Username').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('Notice length').setRequired(true)
            .addChoices({name: 'One Reset (Next Sat)', value: 'one'}, {name: 'Two Resets (Following Sat)', value: 'two'}))
].map(cmd => cmd.toJSON());

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, user, options, member, guild } = interaction;
    const logChannel = guild.channels.cache.get(cfg.LOG_CHANNEL);

    // Permissions Logic
    const isAuthorizedAdmin = member.roles.cache.has(cfg.PERMS.AUTHORIZE_ROLE);
    const isHighCommand = member.roles.cache.has(cfg.PERMS.HIGH_COMMAND_ROLE);
    const isLoggingRole = member.roles.cache.has(cfg.PERMS.LOGGING_ROLE);

    // 1. Authorize Command check
    if (commandName === 'authorize') {
        if (!isAuthorizedAdmin) return interaction.reply({ content: "Access Denied.", flags: [MessageFlags.Ephemeral] });
        const target = options.getUser('user');
        const cmd = options.getString('command');
        const perms = getPermissions();
        if (!perms[target.id]) perms[target.id] = [];
        perms[target.id].push(cmd);
        savePermissions(perms);
        return interaction.reply({ content: `Authorized <@${target.id}> for /${cmd}.`, flags: [MessageFlags.Ephemeral] });
    }

    // 2. Command Access Checks
    const highCmds = ['rank', 'inactivitynotice', 'bgc'];
    const logCmds = ['eventlog', 'timelog'];

    if (highCmds.includes(commandName) && !isHighCommand) {
        return interaction.reply({ content: "High Command role required.", flags: [MessageFlags.Ephemeral] });
    }
    if (logCmds.includes(commandName) && !isLoggingRole && !isHighCommand) {
        return interaction.reply({ content: "Logging permission required.", flags: [MessageFlags.Ephemeral] });
    }

    // 3. Google Auth Commands
    if (commandName === 'verify') {
        const url = oAuth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/spreadsheets'] });
        return interaction.reply({ content: `[Verify Google Account](${url})`, flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'confirm') {
        const code = options.getString('code');
        try {
            const { tokens } = await oAuth2Client.getToken(code);
            const db = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH)) : {};
            db[user.id] = tokens;
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(db, null, 2));
            return interaction.reply({ content: "Successfully verified!", flags: [MessageFlags.Ephemeral] });
        } catch { return interaction.reply({ content: "Invalid code.", flags: [MessageFlags.Ephemeral] }); }
    }

    // 4. Data-heavy Commands
    await interaction.deferReply();
    const auth = await getUserSheets(user.id);
    if (!auth) return interaction.editReply("Run `/verify` first.");

    try {
        if (commandName === 'bgc') {
            const res = options.getString('result');
            const target = options.getUser('discorduser');
            const targetMember = await guild.members.fetch(target.id);

            if (res === 'pass') {
                await targetMember.roles.add(cfg.GENERAL_ROLES.BGC_PASS);
                await targetMember.roles.remove(cfg.GENERAL_ROLES.BGC_REMOVE);
                
                const welcomeMsg = `<@${target.id}>\n>\n> <:FNTC:1443781891349155890>  | **WELCOME TO THE FN TROOPER CORPS!**\n>\n> Please ensure to inspect all the channels that follow:\n>\n> https://discord.com/channels/1369082109184053469/1403809864483995648 - Placement Information.\n> https://discord.com/channels/1369082109184053469/1443777053987049562 - Test scores.\n> https://discord.com/channels/1369082109184053469/1369082110006267988 - Rules.\n> https://discord.com/channels/1369082109184053469/1443405151149752452 - FAQ.\n>\n> -# Signed, FN Trooper Corps Officer Team`;
                
                await guild.channels.cache.get(cfg.WELCOME_CHANNEL).send(welcomeMsg);
                if (logChannel) logChannel.send(`**BGC Passed:** <@${target.id}> by <@${user.id}>`);
                await interaction.editReply(`Background check passed for <@${target.id}>.`);
            } else {
                if (logChannel) logChannel.send(`**BGC Failed:** <@${target.id}> by <@${user.id}>`);
                await interaction.editReply("Background check marked as Fail.");
            }

        } else if (commandName === 'inactivitynotice') {
            const target = options.getUser('discorduser');
            const targetMember = await guild.members.fetch(target.id);
            await targetMember.roles.add(cfg.GENERAL_ROLES.INACTIVITY_NOTICE);
            
            // Note: Sheets logic for notice (PLACEMENT/RECRUITS/JET/FLAME check) 
            // should be handled in a helper function within ranker.js or a dedicated notice handler.
            
            if (logChannel) logChannel.send(`**Inactivity Notice:** <@${target.id}> issued by <@${user.id}>`);
            await interaction.editReply(`Inactivity notice issued to <@${target.id}>.`);

        } else if (commandName === 'rank') {
            const result = await transferUser(auth, SHEET_ID, interaction, logChannel);
            await interaction.editReply(result);

        } else if (commandName === 'eventlog' || commandName === 'timelog') {
            const input = options.getString('input');
            const type = options.getString('event_type') || "Time Log";
            const weekend = options.getBoolean('weekend') || false;

            const formattedInput = `Event: ${type}\nWeekend: ${weekend}\n${input}`;
            const result = await processLog(auth, SHEET_ID, commandName, formattedInput);
            
            if (logChannel) logChannel.send(`**Activity Logged:**\nUser: <@${user.id}>\nType: ${type}\nResult: \n${result}`);
            await interaction.editReply("Log processed and saved to sheets.");
        }

    } catch (err) {
        console.error(err);
        await interaction.editReply(`Error: ${err.message}`);
    }
});

try {
    require('./group-logs.js');
} catch(e) {}


client.once('ready', async (c) => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(c.user.id, cfg.GUILD_ID), { body: commands });
        console.log(`System Online: ${c.user.tag}`);
    } catch (e) { console.error(e); }
});

client.login(TOKEN);