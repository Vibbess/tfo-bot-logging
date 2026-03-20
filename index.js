require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    WebhookClient, 
    MessageFlags 
} = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');

// Project-specific imports
const { transferUser } = require('./ranker');
const { processLog } = require('./logger');
const { runBackgroundCheck } = require('./bgc');

// --- CONFIG ---
const TOKEN = process.env.DISCORD_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const ALLOWED_GUILD_ID = "1469734105292865768"; 
const OWNER_ID = "1097605097502015539"; 
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const TOKEN_PATH = './tokens.json';
const PERMS_PATH = './permissions.json';

// --- DATABASE HELPERS ---
function getPermissions() {
    if (!fs.existsSync(PERMS_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(PERMS_PATH));
    } catch { return {}; }
}

function savePermissions(perms) {
    fs.writeFileSync(PERMS_PATH, JSON.stringify(perms, null, 2));
}

function isAuthorized(userId, commandName) {
    if (userId === OWNER_ID) return true; // Owner bypass
    const perms = getPermissions();
    return perms[userId] && perms[userId].includes(commandName);
}

// --- GOOGLE OAUTH SETUP ---
const credentials = JSON.parse(fs.readFileSync('client_secret.json'));
const { client_id, client_secret, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

let webhook = null;
if (WEBHOOK_URL && WEBHOOK_URL.startsWith('http')) {
    webhook = new WebhookClient({ url: WEBHOOK_URL });
}

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

async function getUserSheets(userId) {
    if (!fs.existsSync(TOKEN_PATH)) return null;
    const db = JSON.parse(fs.readFileSync(TOKEN_PATH));
    const userTokens = db[userId];
    if (!userTokens) return null;
    const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    auth.setCredentials(userTokens);
    return auth;
}

// --- SLASH COMMANDS DEFINITION ---
const commands = [
    // Admin Command
    new SlashCommandBuilder().setName('authorize').setDescription('Authorize a user for a command (Owner Only)')
        .addUserOption(o => o.setName('user').setDescription('The user to authorize').setRequired(true))
        .addStringOption(o => o.setName('command').setDescription('The command name').setRequired(true)
            .addChoices(
                {name: 'rank', value: 'rank'},
                {name: 'eventlog', value: 'eventlog'},
                {name: 'ssulog', value: 'ssulog'},
                {name: 'timelog', value: 'timelog'},
                {name: 'bgc', value: 'bgc'}
            )),

    // Auth Commands
    new SlashCommandBuilder().setName('verify').setDescription('Link your Google account'),
    new SlashCommandBuilder().setName('confirm').setDescription('Enter the code from Google URL bar')
        .addStringOption(opt => opt.setName('code').setDescription('The code after code= in the URL').setRequired(true)),

    // Background Check
    new SlashCommandBuilder().setName('bgc').setDescription('Run a background check on a player')
        .addStringOption(o => o.setName('robloxid').setDescription('The Roblox User ID').setRequired(true))
        .addStringOption(o => o.setName('discordid').setDescription('The Discord User ID').setRequired(true)),

    // Ranking Command
    new SlashCommandBuilder().setName('rank').setDescription('Promote or transfer a user')
        .addStringOption(o => o.setName('username').setRequired(true).setDescription('Username'))
        .addStringOption(o => o.setName('current_rank').setRequired(true).setDescription('From')
            .addChoices({name:'Recruit', value:'Recruit'}, {name:'Trooper', value:'Trooper'}, {name:'Specialist', value:'Specialist'}))
        .addStringOption(o => o.setName('new_rank').setRequired(true).setDescription('To')
            .addChoices({name:'Trooper', value:'Trooper'}, {name:'Specialist', value:'Specialist'}, {name:'Corporal', value:'Corporal'})),

    // Log Commands
    new SlashCommandBuilder().setName('eventlog').setDescription('Log an event').addStringOption(o => o.setName('input').setRequired(true).setDescription('Log text')),
    new SlashCommandBuilder().setName('ssulog').setDescription('Log an SSU').addStringOption(o => o.setName('input').setRequired(true).setDescription('Log text')),
    new SlashCommandBuilder().setName('timelog').setDescription('Log activity time').addStringOption(o => o.setName('input').setRequired(true).setDescription('Log text'))
].map(cmd => cmd.toJSON());

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.guildId !== ALLOWED_GUILD_ID) return;
    const { commandName, user, options } = interaction;

    // 1. Handle /authorize (Owner Only)
    if (commandName === 'authorize') {
        if (user.id !== OWNER_ID) {
            return interaction.reply({ content: "❌ Only the designated owner can use this.", flags: [MessageFlags.Ephemeral] });
        }
        const targetUser = options.getUser('user');
        const cmdToAuth = options.getString('command');

        const perms = getPermissions();
        if (!perms[targetUser.id]) perms[targetUser.id] = [];
        if (!perms[targetUser.id].includes(cmdToAuth)) {
            perms[targetUser.id].push(cmdToAuth);
            savePermissions(perms);
        }
        return interaction.reply({ content: `✅ Authorized <@${targetUser.id}> for \`/${cmdToAuth}\`.`, flags: [MessageFlags.Ephemeral] });
    }

    // 2. Permission Check for Protected Commands
    const protectedCmds = ['rank', 'eventlog', 'ssulog', 'timelog', 'bgc'];
    if (protectedCmds.includes(commandName)) {
        if (!isAuthorized(user.id, commandName)) {
            return interaction.reply({ content: "❌ You are not authorized for this command.", flags: [MessageFlags.Ephemeral] });
        }
    }

    // 3. Command Logic
    if (commandName === 'verify') {
        const url = oAuth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/spreadsheets'] });
        return interaction.reply({ content: `🔗 [Click to Login](${url})`, flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'confirm') {
        const code = options.getString('code');
        try {
            const { tokens } = await oAuth2Client.getToken(code);
            const db = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH)) : {};
            db[user.id] = tokens;
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(db, null, 2));
            return interaction.reply({ content: "✅ Verified!", flags: [MessageFlags.Ephemeral] });
        } catch (e) { return interaction.reply({ content: "❌ Invalid code.", flags: [MessageFlags.Ephemeral] }); }
    }

    if (commandName === 'bgc') {
        if (!isAuthorized(user.id, 'bgc')) {
            return interaction.reply({ content: "❌ Unauthorized.", flags: [MessageFlags.Ephemeral] });
        }
        await interaction.deferReply();
        
        // Get the command runner's auth to update the sheet
        const userAuth = await getUserSheets(user.id);
        if (!userAuth) return interaction.editReply("❌ You must `/verify` yourself before running BGCs to update the sheet.");

        const result = await runBackgroundCheck(options.getString('robloxid'), options.getString('discordid'), userAuth);
        return interaction.editReply(result);
    }

    // Default: Sheets-based commands (Rank & Logs)
    await interaction.deferReply();
    const userAuth = await getUserSheets(user.id);
    if (!userAuth) return interaction.editReply("❌ Use `/verify` first.");

    try {
        if (commandName === 'rank') {
            const result = await transferUser(userAuth, SHEET_ID, options.getString('username'), options.getString('current_rank'), options.getString('new_rank'), `<@${user.id}>`, webhook);
            await interaction.editReply(result);
        } else {
            const result = await processLog(userAuth, SHEET_ID, commandName, options.getString('input'), `<@${user.id}>`, webhook);
            await interaction.editReply(result);
        }
    } catch (error) {
        console.error(error);
        await interaction.editReply(`Error: ${error.message}`);
    }
});

// --- READY EVENT ---
client.once('ready', async (c) => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log(`Logged in as ${c.user.tag}`);
        // Clean global commands, update guild commands
        await rest.put(Routes.applicationCommands(c.user.id), { body: [] });
        await rest.put(Routes.applicationGuildCommands(c.user.id, ALLOWED_GUILD_ID), { body: commands });
        console.log(`✅ Commands registered for: ${ALLOWED_GUILD_ID}`);
    } catch (err) { console.error(err); }
});

client.login(TOKEN);