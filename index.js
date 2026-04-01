require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, WebhookClient, MessageFlags, Events } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');

const { transferUser, handlePromotionRequest } = require('./ranker');
const { processLog } = require('./logger');
const { runBackgroundCheck } = require('./bgc');
const { ROLES } = require('./config');

const TOKEN = process.env.DISCORD_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const ALLOWED_GUILD_ID = "1369082109184053469"; 
const OWNER_ID = "1097605097502015539"; 
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const TOKEN_PATH = './tokens.json';
const PERMS_PATH = './permissions.json';

function getPermissions() {
    if (!fs.existsSync(PERMS_PATH)) return {};
    try { return JSON.parse(fs.readFileSync(PERMS_PATH)); } catch { return {}; }
}

function savePermissions(perms) {
    fs.writeFileSync(PERMS_PATH, JSON.stringify(perms, null, 2));
}

function isAuthorized(member, commandName) {
    if (member.user.id === OWNER_ID) return true;
    const perms = getPermissions();
    return perms[member.user.id] && perms[member.user.id].includes(commandName);
}

const credentials = JSON.parse(fs.readFileSync('client_secret.json'));
const { client_id, client_secret, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

let webhook = null;
if (WEBHOOK_URL && WEBHOOK_URL.startsWith('http')) {
    webhook = new WebhookClient({ url: WEBHOOK_URL });
}

const client = new Client({ 
    intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent ] 
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

// Rank dropdown choices for Auto-fill
const rankChoices = [
    { name: 'Placement Phase Two', value: 'Placement Phase Two' },
    { name: 'Jet Recruit', value: 'Jet Recruit' },
    { name: 'Flame Recruit', value: 'Flame Recruit' },
    { name: 'Jet Trooper', value: 'Jet Trooper' },
    { name: 'Flame Trooper', value: 'Flame Trooper' },
    { name: 'Senior Jet Trooper', value: 'Senior Jet Trooper' },
    { name: 'Senior Flame Trooper', value: 'Senior Flame Trooper' },
    { name: 'Veteran Trooper', value: 'Veteran Trooper' },
    { name: 'Specialist', value: 'Specialist' },
    { name: 'Corporal', value: 'Corporal' }
];

const commands = [
    new SlashCommandBuilder().setName('authorize').setDescription('Authorize a user for a command')
        .addUserOption(o => o.setName('user').setDescription('The user to authorize').setRequired(true))
        .addStringOption(o => o.setName('command').setDescription('The command name').setRequired(true)
            .addChoices({name: 'rank', value: 'rank'}, {name: 'eventlog', value: 'eventlog'}, {name: 'bgc', value: 'bgc'})),

    new SlashCommandBuilder().setName('verify').setDescription('Link your Google account'),
    new SlashCommandBuilder().setName('confirm').setDescription('Enter the code from Google')
        .addStringOption(opt => opt.setName('code').setDescription('The code from the URL').setRequired(true)),

    new SlashCommandBuilder().setName('request_promotion').setDescription('Request a promotion test')
        .addStringOption(o => o.setName('robloxusername').setDescription('Roblox Username').setRequired(true)),

    new SlashCommandBuilder().setName('bgc').setDescription('Run a background check')
        .addStringOption(o => o.setName('robloxusername').setDescription('Roblox Username').setRequired(true))
        .addUserOption(o => o.setName('discorduser').setDescription('Discord User').setRequired(true))
        .addStringOption(o => o.setName('status').setDescription('Pass or Fail').setRequired(true).addChoices({name:'Pass', value:'pass'}, {name:'Fail', value:'fail'})),

    new SlashCommandBuilder().setName('rank').setDescription('Promote or transfer a user')
        .addStringOption(o => o.setName('robloxusername').setRequired(true).setDescription('Roblox Username'))
        .addUserOption(o => o.setName('discorduser').setRequired(true).setDescription('Discord User'))
        .addStringOption(o => o.setName('current_rank').setRequired(true).setDescription('From Rank').addChoices(...rankChoices))
        .addStringOption(o => o.setName('new_rank').setRequired(true).setDescription('To Rank').addChoices(...rankChoices)),

    new SlashCommandBuilder().setName('eventlog').setDescription('Log an event')
        .addStringOption(o => o.setName('event_type').setRequired(true).setDescription('Type of event'))
        .addStringOption(o => o.setName('input').setRequired(true).setDescription('The raw log text'))
        .addStringOption(o => o.setName('weekend').setRequired(true).setDescription('Is it the weekend?').addChoices({ name: 'True', value: 'true' }, { name: 'False', value: 'false' })),
].map(cmd => cmd.toJSON());

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.guildId !== ALLOWED_GUILD_ID) return;
    const { commandName, user, options, member } = interaction;

    if (commandName === 'authorize') {
        if (user.id !== OWNER_ID && !member.roles.cache.has(ROLES.AUTH_ROLE)) {
            return interaction.reply({ content: "❌ Unauthorized. You need the proper role.", flags: [MessageFlags.Ephemeral] });
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

    if (['rank', 'eventlog', 'bgc'].includes(commandName) && !isAuthorized(member, commandName)) {
        return interaction.reply({ content: "❌ Unauthorized.", flags: [MessageFlags.Ephemeral] });
    }

    // Handle OAuth
    if (commandName === 'verify') {
        const url = oAuth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/spreadsheets'] });
        return interaction.reply({ content: `🔗 [Click to Login](${url})`, flags: [MessageFlags.Ephemeral] });
    }
    if (commandName === 'confirm') {
        try {
            const { tokens } = await oAuth2Client.getToken(options.getString('code'));
            const db = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH)) : {};
            db[user.id] = tokens;
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(db, null, 2));
            return interaction.reply({ content: "✅ Verified!", flags: [MessageFlags.Ephemeral] });
        } catch (e) { return interaction.reply({ content: "❌ Invalid code.", flags: [MessageFlags.Ephemeral] }); }
    }

    await interaction.deferReply();
    const userAuth = await getUserSheets(user.id);
    if (!userAuth) return interaction.editReply("❌ Use `/verify` first to link your Google account.");

    try {
        if (commandName === 'request_promotion') {
            if (!member.roles.cache.has(ROLES.REQ_PROMO_ROLE)) return interaction.editReply("❌ Missing required role.");
            const result = await handlePromotionRequest(userAuth, options.getString('robloxusername'), member);
            await interaction.editReply(result);
        } 
        else if (commandName === 'rank') {
            const targetMember = await interaction.guild.members.fetch(options.getUser('discorduser').id);
            const result = await transferUser(userAuth, SHEET_ID, options.getString('robloxusername'), targetMember, options.getString('current_rank'), options.getString('new_rank'), interaction.guild, webhook);
            await interaction.editReply(result);
        } 
        else if (commandName === 'bgc') {
            const status = options.getString('status');
            const targetMember = await interaction.guild.members.fetch(options.getUser('discorduser').id);
            const result = await runBackgroundCheck(options.getString('robloxusername'), targetMember, status, userAuth, SHEET_ID, webhook);
            await interaction.editReply(result);
        } 
        else if (commandName === 'eventlog') {
            const formattedInput = `Event: ${options.getString('event_type')}\nWeekend: ${options.getString('weekend')}\n${options.getString('input')}`;
            const result = await processLog(userAuth, SHEET_ID, formattedInput, `<@${user.id}>`, webhook);
            await interaction.editReply(result);
        }
    } catch (error) {
        console.error(error);
        await interaction.editReply(`Error: ${error.message}`);
    }
});

client.once(Events.ClientReady, async (c) => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(c.user.id, ALLOWED_GUILD_ID), { body: commands });
    console.log(`✅ Logged in as ${c.user.tag}`);
});

client.login(TOKEN);