require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, WebhookClient, EmbedBuilder } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const creds = require('./credentials.json');
const config = require('./config');

// Import our logic modules
const ranker = require('./ranker');
const logger = require('./logger');

// 1. Setup Discord Client
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.MessageContent
    ] 
});

// 2. Setup Google Auth
const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const mainDoc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);
const testDoc = new GoogleSpreadsheet(config.TEST_SHEET_ID, serviceAccountAuth);

// --- Update this section in index.js ---
let webhook = null;
const webhookUrl = process.env.WEBHOOK_URL || process.env.BGC_WEBHOOK_URL;

if (webhookUrl && webhookUrl.startsWith('https://')) {
    webhook = new WebhookClient({ url: webhookUrl });
    console.log("✅ Webhook Client initialized.");
} else {
    console.warn("⚠️ WARNING: WEBHOOK_URL is missing or invalid in .env. Logging will be skipped.");
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // Check Permissions
    const isAuthorized = interaction.member.roles.cache.has(config.ROLES.AUTHORIZED);
    const isEligible = interaction.member.roles.cache.has(config.ROLES.PROMOTION_ELIGIBLE);

    await interaction.deferReply();

    try {
        // --- AUTHORIZE COMMAND ---
        if (interaction.commandName === 'authorize') {
            if (!isAuthorized) return await interaction.editReply("❌ You are not permitted to use this command.");
            
            const target = interaction.options.getMember('user');
            await target.roles.add(config.ROLES.AUTHORIZED);
            
            await interaction.editReply(`✅ Successfully authorized **${target.user.tag}**.`);
        }

        // --- BGC COMMAND ---
        if (interaction.commandName === 'bgc') {
            if (!isAuthorized) return await interaction.editReply("❌ Unauthorized.");
            
            const result = await ranker.handleBGC(mainDoc, interaction, webhook);
            await interaction.editReply(result);
        }

        // --- REQUEST PROMOTION TEST (Get Test Results) ---
        if (interaction.commandName === 'request_promotion_test') {
            if (!isEligible) return await interaction.editReply("❌ You do not have the 'Promotion Eligible' role.");
            
            const result = await ranker.handlePromotionTest(mainDoc, testDoc, interaction, webhook);
            await interaction.editReply(result);
        }

        // --- RANK COMMAND ---
        if (interaction.commandName === 'rank') {
            if (!isAuthorized) return await interaction.editReply("❌ Unauthorized.");
            
            const result = await ranker.handleRank(mainDoc, interaction, webhook);
            await interaction.editReply(result);
        }

        // --- EVENT LOG COMMAND ---
        if (interaction.commandName === 'eventlog') {
            // Usually restricted to staff/authorized
            const result = await logger.processLog(mainDoc, interaction, webhook);
            await interaction.editReply(result);
        }

    } catch (error) {
        console.error("Critical Error:", error);
        if (interaction.deferred) {
            await interaction.editReply(`⚠️ System Error: ${error.message}`);
        }
    }
});

// 4. Register Commands
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const commands = [
        // Authorize
        new SlashCommandBuilder()
            .setName('authorize')
            .setDescription('Authorize a user to use bot commands')
            .addUserOption(o => o.setName('user').setRequired(true).setDescription('User to authorize')),

        // BGC
        new SlashCommandBuilder()
            .setName('bgc')
            .setDescription('Run a background check')
            .addStringOption(o => o.setName('roblox_username').setRequired(true))
            .addUserOption(o => o.setName('discord_user').setRequired(true)),

        // Request Promotion Test
        new SlashCommandBuilder()
            .setName('request_promotion_test')
            .setDescription('Check your test scores and promote to Phase 2')
            .addStringOption(o => o.setName('roblox_username').setRequired(true)),

        // Rank
        new SlashCommandBuilder()
            .setName('rank')
            .setDescription('Promote/Rank a user')
            .addStringOption(o => o.setName('roblox_username').setRequired(true))
            .addUserOption(o => o.setName('discord_user').setRequired(true))
            .addStringOption(o => o.setName('current_rank').setRequired(true))
            .addStringOption(o => o.setName('new_rank').setRequired(true)),

        // Event Log
        new SlashCommandBuilder()
            .setName('eventlog')
            .setDescription('Log a training or patrol')
            .addStringOption(o => o.setName('eventtype').setRequired(true).addChoices(
                { name: 'Patrol', value: 'patrol' },
                { name: 'PT', value: 'pt' },
                { name: 'Tryout', value: 'tryout' },
                { name: 'Other', value: 'other' }
            ))
            .addStringOption(o => o.setName('input').setRequired(true).setDescription('Paste the log text'))
            .addBooleanOption(o => o.setName('weekend').setRequired(true).setDescription('Is it a weekend?'))

    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log('Successfully registered application commands.');
    } catch (error) {
        console.error(error);
    }
});

client.login(process.env.DISCORD_TOKEN);