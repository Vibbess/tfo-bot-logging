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

   // Inside your commands array in index.js:
new SlashCommandBuilder().setName('rank').setDescription('Change a user\'s rank and update sheets')
    .addStringOption(o => o.setName('robloxusername').setDescription('Roblox Username').setRequired(true))
    .addUserOption(o => o.setName('discorduser').setDescription('Discord User (@)').setRequired(true))
    .addStringOption(o => o.setName('current_rank')
        .setDescription('Current Rank')
        .setRequired(true)
        .setAutocomplete(true)) // <--- ADD THIS
    .addStringOption(o => o.setName('new_rank')
        .setDescription('Target Rank')
        .setRequired(true)
        .setAutocomplete(true)), // <--- ADD THIS

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
if (interaction.isAutocomplete()) {
        const focusedOption = interaction.options.getFocused(true);
        let choices = [];

        if (focusedOption.name === 'current_rank' || focusedOption.name === 'new_rank') {
            choices = [
                'PLACEMENT', 'PVT', 'RECRUIT', 
                'JET RECRUIT', 'JET TROOPER', 'JET SENIOR', 'JET VETERAN', 'JET SPECIALIST', 'JET CORPORAL',
                'FLAME RECRUIT', 'FLAME TROOPER', 'FLAME SENIOR', 'FLAME VETERAN', 'FLAME SPECIALIST', 'FLAME CORPORAL',
                'PHASE 2'
            ];
        }

        const filtered = choices
            .filter(choice => choice.startsWith(focusedOption.value.toUpperCase()))
            .slice(0, 25);

        await interaction.respond(
            filtered.map(choice => ({ name: choice, value: choice }))
        );
        return; 
    }

    // --- 2. CHAT COMMAND HANDLER ---
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
                
                const welcomeMsg = `<@${target.id}>\n>\n> :SnowTrooper:  | **WELCOME TO THE FIRST ORDER SNOWTROOPER!**\n>\n> Please ensure to inspect all the channels that follow:\n>\n> https://discord.com/channels/1498050747101610165/1498050749215674550 - Recruit Information.\n> https://discord.com/channels/1498050747101610165/1498050750050336775 - Documents.\n> https://discord.com/channels/1498050747101610165/1498050750050336768 - Rules.\n> https://discord.com/channels/1498050747101610165/1498050750050336773 - FAQ.\n>\n> -# Signed, Snowtrooper Officer team`;
                
                await guild.channels.cache.get(cfg.WELCOME_CHANNEL).send(welcomeMsg);
                if (logChannel) logChannel.send(`**BGC Passed:** <@${target.id}> by <@${user.id}>`);
                await interaction.editReply(`Background check passed for <@${target.id}>.`);
            } else {
                if (logChannel) logChannel.send(`**BGC Failed:** <@${target.id}> by <@${user.id}>`);
                await interaction.editReply("Background check marked as Fail.");
            }

// Inside index.js interaction handler:
} else if (commandName === 'inactivitynotice') {
    const target = options.getUser('discorduser');
    const robloxName = options.getString('robloxusername');
    const duration = options.getString('duration');
    const targetMember = await guild.members.fetch(target.id);

    // 1. Add the Discord Role
    await targetMember.roles.add(cfg.GENERAL_ROLES.INACTIVITY_NOTICE);
    
    // 2. Update the Spreadsheet
    const sheetResult = await issueInactivityNotice(auth, SHEET_ID, robloxName, duration);
    
    if (logChannel) {
        logChannel.send(`🕒 **Inactivity Notice:** <@${target.id}> (${robloxName})\n**Duration:** ${duration} reset(s)\n**Sheet Status:** ${sheetResult}`);
    }
    await interaction.editReply(`✅ Notice issued to **${robloxName}**. ${sheetResult}`);


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
        console.log('--- 🧹 STARTING COMMAND CLEANUP ---');

        // Step 1: Wipe Global Commands (The ones that follow the bot everywhere)
        await rest.put(Routes.applicationCommands(c.user.id), { body: [] });
        console.log('✅ Global commands cleared.');

        // Step 2: Wipe Guild Commands (The ones stuck in your specific server)
        await rest.put(Routes.applicationGuildCommands(c.user.id, cfg.GUILD_ID), { body: [] });
        console.log('✅ Guild commands cleared.');

        // Step 3: Register Fresh Commands (With Autocomplete enabled)
        await rest.put(
            Routes.applicationGuildCommands(c.user.id, cfg.GUILD_ID),
            { body: commands }
        );
        
        console.log(`✅ ${c.user.tag} is online.`);
        console.log('🚀 Commands synced! RESTART YOUR DISCORD APP (Ctrl+R) to see changes.');

    } catch (error) {
        console.error('❌ Error during command sync:', error);
    }
});

client.login(TOKEN);