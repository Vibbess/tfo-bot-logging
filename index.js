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
const { transferUser, handleBGC, handlePromotionTest } = require('./ranker');
const { processLog, processTimeLog } = require('./logger');

// --- CONFIG ---
const TOKEN = process.env.DISCORD_TOKEN;
const MAIN_SHEET_ID = "1u3GspLjvQybVx4mFOd_8pxmppCHzvL2W_GFh3xp3T7o"; 
const DATA_SHEET_ID = "1S-MdjLntP9KVZd8vpyR-n_IM6ZxlMsBF7DRONTBx1OM"; 
const ALLOWED_GUILD_ID = "1369082109184053469"; 
const OWNER_ID = "1097605097502015539"; 
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const TOKEN_PATH = './tokens.json';
const PERMS_PATH = './permissions.json';

// Role Constants
const AUTH_ROLE_ID = "1369082109184053474"; 
const PROMO_REQ_ROLE_ID = "1443766165536247808";

// --- DATABASE HELPERS ---
const getPermissions = () => fs.existsSync(PERMS_PATH) ? JSON.parse(fs.readFileSync(PERMS_PATH)) : {};
const savePermissions = (perms) => fs.writeFileSync(PERMS_PATH, JSON.stringify(perms, null, 2));

function isAuthorized(member, commandName) {
    if (member.id === OWNER_ID) return true;
    if (member.roles.cache.has(AUTH_ROLE_ID)) return true;
    const perms = getPermissions();
    return perms[member.id] && perms[member.id].includes(commandName);
}

// --- GOOGLE OAUTH SETUP (FILELESS VERSION) ---
// This part now looks for the GOOGLE_CREDENTIALS environment variable
if (!process.env.GOOGLE_CREDENTIALS) {
    console.error("FATAL ERROR: GOOGLE_CREDENTIALS environment variable is missing!");
    process.exit(1);
}

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const { client_id, client_secret, redirect_uris } = credentials.web || credentials.installed;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const webhook = WEBHOOK_URL ? new WebhookClient({ url: WEBHOOK_URL }) : null;
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

async function getUserAuth(userId) {
    if (!fs.existsSync(TOKEN_PATH)) return null;
    const db = JSON.parse(fs.readFileSync(TOKEN_PATH));
    if (!db[userId]) return null;
    const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    auth.setCredentials(db[userId]);
    return auth;
}

// --- SLASH COMMANDS ---
const commands = [
    new SlashCommandBuilder().setName('verify').setDescription('Link your Google account'),
    new SlashCommandBuilder().setName('confirm').setDescription('Enter the code from Google')
        .addStringOption(o => o.setName('code').setDescription('The code from the URL').setRequired(true)),
    new SlashCommandBuilder().setName('bgc').setDescription('Run Background Check')
        .addStringOption(o => o.setName('robloxuserid').setRequired(true))
        .addUserOption(o => o.setName('discorduser').setRequired(true)),
    new SlashCommandBuilder().setName('request').setDescription('Request promotion test')
        .addStringOption(o => o.setName('robloxusername').setRequired(true)),
    new SlashCommandBuilder().setName('rank').setDescription('Promote/Transfer User')
        .addStringOption(o => o.setName('robloxusername').setRequired(true))
        .addUserOption(o => o.setName('discorduser').setRequired(true))
        .addStringOption(o => o.setName('new_rank').setRequired(true).addChoices(
            {name:'Jet Recruit', value:'Jet Recruit'}, {name:'Flame Recruit', value:'Flame Recruit'},
            {name:'Jet Trooper', value:'Jet Trooper'}, {name:'Flame Trooper', value:'Flame Trooper'},
            {name:'Senior Jet Trooper', value:'Senior Jet Trooper'}, {name:'Senior Flame Trooper', value:'Senior Flame Trooper'},
            {name:'Veteran Jet Trooper', value:'Veteran Jet Trooper'}, {name:'Veteran Flame Trooper', value:'Veteran Flame Trooper'},
            {name:'Master Jet Trooper', value:'Master Jet Trooper'}, {name:'Master Flame Trooper', value:'Master Flame Trooper'}
        )),
    new SlashCommandBuilder().setName('eventlog').setDescription('Log an event')
        .addStringOption(o => o.setName('input').setRequired(true))
        .addBooleanOption(o => o.setName('weekend').setRequired(true)),
    new SlashCommandBuilder().setName('timelog').setDescription('Log in-game activity hours')
        .addStringOption(o => o.setName('input').setRequired(true))
].map(cmd => cmd.toJSON());

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.guildId !== ALLOWED_GUILD_ID) return;
    const { commandName, user, options, member } = interaction;

    if (commandName === 'verify') {
        const url = oAuth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/spreadsheets'] });
        return interaction.reply({ content: `🔗 [Click here to verify](${url})`, flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'confirm') {
        const code = options.getString('code');
        try {
            const { tokens } = await oAuth2Client.getToken(code);
            const db = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH)) : {};
            db[user.id] = tokens;
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(db, null, 2));
            return interaction.reply({ content: "✅ Verified! Access granted.", flags: [MessageFlags.Ephemeral] });
        } catch (e) { return interaction.reply({ content: "❌ Invalid code.", flags: [MessageFlags.Ephemeral] }); }
    }

    const protectedCmds = ['rank', 'eventlog', 'bgc', 'timelog'];
    if (protectedCmds.includes(commandName) && !isAuthorized(member, commandName)) {
        return interaction.reply({ content: "❌ Unauthorized.", flags: [MessageFlags.Ephemeral] });
    }

    await interaction.deferReply();
    const auth = await getUserAuth(user.id);
    if (!auth) return interaction.editReply("❌ Please run `/verify` first.");

    try {
        switch (commandName) {
            case 'bgc':
                const bgcRes = await handleBGC(auth, options.getString('robloxuserid'), options.getUser('discorduser'), interaction, webhook);
                await interaction.editReply(bgcRes);
                break;
            case 'request':
                const reqRes = await handlePromotionTest(auth, options.getString('robloxusername'), interaction);
                await interaction.editReply(reqRes);
                break;
            case 'rank':
                const rankRes = await transferUser(auth, options.getString('robloxusername'), options.getUser('discorduser'), options.getString('new_rank'), interaction, webhook);
                await interaction.editReply(rankRes);
                break;
            case 'eventlog':
                const logRes = await processLog(auth, MAIN_SHEET_ID, options.getString('input'), options.getBoolean('weekend'), `<@${user.id}>`, webhook);
                await interaction.editReply(logRes);
                break;
            case 'timelog':
                const timeRes = await processTimeLog(auth, options.getString('input'), `<@${user.id}>`, webhook);
                await interaction.editReply(timeRes);
                break;
        }
    } catch (error) {
        console.error(error);
        await interaction.editReply(`System Error: ${error.message}`);
    }
});

client.once('ready', async (c) => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(c.user.id, ALLOWED_GUILD_ID), { body: commands });
        console.log(`✅ ${c.user.tag} Online & Commands registered.`);
    } catch (err) { console.error(err); }
});

client.login(TOKEN);