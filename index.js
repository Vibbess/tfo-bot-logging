require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, WebhookClient, MessageFlags } = require('discord.js');
const { google } = require('googleapis');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const fs = require('fs');

const config = require('./config');
const ranker = require('./ranker');
const logger = require('./logger');

// --- Load Google Credentials from File ---
const credentials = JSON.parse(fs.readFileSync('client_secret.json'));
const { client_id, client_secret, redirect_uris } = credentials.web;

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// --- File Paths for "Database" ---
const TOKEN_PATH = './tokens.json';
const PERMS_PATH = './permissions.json';

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent] 
});

const webhook = process.env.WEBHOOK_URL ? new WebhookClient({ url: process.env.WEBHOOK_URL }) : null;

// --- Helper: Get User's Personal Sheet Access ---
async function getUserDoc(userId, sheetId) {
    if (!fs.existsSync(TOKEN_PATH)) return null;
    const db = JSON.parse(fs.readFileSync(TOKEN_PATH));
    const tokens = db[userId];
    if (!tokens) return null;

    const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    auth.setCredentials(tokens);
    return new GoogleSpreadsheet(sheetId, auth);
}

// --- Helper: Permissions ---
function getPermissions() {
    if (!fs.existsSync(PERMS_PATH)) return {};
    try { return JSON.parse(fs.readFileSync(PERMS_PATH)); } catch { return {}; }
}

// --- Interaction Handler ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, user, options } = interaction;

    // 1. AUTHORIZE (Admin)
    if (commandName === 'authorize') {
        if (user.id !== config.OWNER_ID) return interaction.reply({ content: "❌ Owner only.", flags: [MessageFlags.Ephemeral] });
        const target = options.getUser('user');
        const cmd = options.getString('command');
        const perms = getPermissions();
        if (!perms[target.id]) perms[target.id] = [];
        if (!perms[target.id].includes(cmd)) perms[target.id].push(cmd);
        fs.writeFileSync(PERMS_PATH, JSON.stringify(perms, null, 2));
        return interaction.reply({ content: `✅ Authorized <@${target.id}> for \`/${cmd}\`.`, flags: [MessageFlags.Ephemeral] });
    }

    // 2. VERIFY & CONFIRM (OAuth2)
    if (commandName === 'verify') {
        const url = oAuth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/spreadsheets'] });
        return interaction.reply({ content: `🔗 [Click to Login with Google](${url})\nThen use \`/confirm\` with the code.`, flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'confirm') {
        try {
            const { tokens } = await oAuth2Client.getToken(options.getString('code'));
            const db = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH)) : {};
            db[user.id] = tokens;
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(db, null, 2));
            return interaction.reply({ content: "✅ Linked! Your Google account is ready.", flags: [MessageFlags.Ephemeral] });
        } catch (e) { return interaction.reply({ content: "❌ Invalid code.", flags: [MessageFlags.Ephemeral] }); }
    }

    // 3. LOGIC COMMANDS
    const protectedCmds = ['rank', 'eventlog', 'bgc', 'request_promotion_test'];
    if (protectedCmds.includes(commandName)) {
        const perms = getPermissions();
        if (user.id !== config.OWNER_ID && (!perms[user.id] || !perms[user.id].includes(commandName))) {
            return interaction.reply({ content: "❌ Not authorized.", flags: [MessageFlags.Ephemeral] });
        }

        await interaction.deferReply();
        const mainDoc = await getUserDoc(user.id, process.env.SHEET_ID);
        if (!mainDoc) return interaction.editReply("❌ Run `/verify` first.");

        try {
            if (commandName === 'rank') {
                await interaction.editReply(await ranker.handleRank(mainDoc, interaction, webhook));
            } else if (commandName === 'bgc') {
                await interaction.editReply(await ranker.handleBGC(mainDoc, interaction));
            } else if (commandName === 'eventlog') {
                await interaction.editReply(await logger.processLog(mainDoc, interaction, webhook));
            } else if (commandName === 'request_promotion_test') {
                const testDoc = await getUserDoc(user.id, config.TEST_SHEET_ID);
                await interaction.editReply(await ranker.handlePromotionTest(mainDoc, testDoc, interaction));
            }
        } catch (err) {
            console.error(err);
            await interaction.editReply(`⚠️ Sheet Error: ${err.message}`);
        }
    }
});

// --- Register Commands ---
client.once('ready', async () => {
    console.log(`🚀 ${client.user.tag} Online (Internal Config Mode)`);
    const cmds = [
        new SlashCommandBuilder().setName('authorize').setDescription('Auth user').addUserOption(o=>o.setName('user').setRequired(true).setDescription('User')).addStringOption(o=>o.setName('command').setRequired(true).setDescription('Cmd').addChoices({name:'rank',value:'rank'},{name:'eventlog',value:'eventlog'},{name:'bgc',value:'bgc'},{name:'request_promotion_test',value:'request_promotion_test'})),
        new SlashCommandBuilder().setName('verify').setDescription('Link Google'),
        new SlashCommandBuilder().setName('confirm').setDescription('Enter code').addStringOption(o=>o.setName('code').setRequired(true).setDescription('Code')),
        new SlashCommandBuilder().setName('bgc').setDescription('Run BGC').addStringOption(o=>o.setName('roblox_username').setRequired(true).setDescription('Name')),
        new SlashCommandBuilder().setName('request_promotion_test').setDescription('Check test').addStringOption(o=>o.setName('roblox_username').setRequired(true).setDescription('Name')),
        new SlashCommandBuilder().setName('rank').setDescription('Update rank').addStringOption(o=>o.setName('roblox_username').setRequired(true).setDescription('Name')).addStringOption(o=>o.setName('new_rank').setRequired(true).setDescription('New Rank')),
        new SlashCommandBuilder().setName('eventlog').setDescription('Log points').addStringOption(o=>o.setName('eventtype').setRequired(true).setDescription('Type')).addStringOption(o=>o.setName('input').setRequired(true).setDescription('Names')).addBooleanOption(o=>o.setName('weekend').setRequired(true).setDescription('Weekend?'))
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
        console.log("✅ Slash Commands Registered!");
    } catch (e) { console.error(e); }
});

client.login(process.env.DISCORD_TOKEN);