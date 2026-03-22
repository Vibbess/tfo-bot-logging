require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, WebhookClient } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const creds = require('./credentials.json');
const config = require('./config');

// Import logic modules
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

// 3. Setup Logging Webhook (Safe Initialization)
let webhook = null;
if (process.env.WEBHOOK_URL && process.env.WEBHOOK_URL.startsWith('https://')) {
    webhook = new WebhookClient({ url: process.env.WEBHOOK_URL });
    console.log("✅ Webhook Client initialized.");
} else {
    console.warn("⚠️ WARNING: WEBHOOK_URL is missing or invalid. Logging to Discord channels will be skipped.");
}

// 4. Interaction Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const isAuthorized = interaction.member.roles.cache.has(config.ROLES.AUTHORIZED);
    const isEligible = interaction.member.roles.cache.has(config.ROLES.PROMOTION_ELIGIBLE);

    await interaction.deferReply();

    try {
        // --- AUTHORIZE ---
        if (interaction.commandName === 'authorize') {
            if (!isAuthorized) return await interaction.editReply("❌ You do not have permission to authorize users.");
            const target = interaction.options.getMember('user');
            await target.roles.add(config.ROLES.AUTHORIZED);
            await interaction.editReply(`✅ Successfully authorized **${target.user.tag}**.`);
        }

        // --- BGC ---
        if (interaction.commandName === 'bgc') {
            if (!isAuthorized) return await interaction.editReply("❌ Unauthorized.");
            const result = await ranker.handleBGC(mainDoc, interaction, webhook);
            await interaction.editReply(result);
        }

        // --- TEST RESULTS / PROMOTION ---
        if (interaction.commandName === 'request_promotion_test') {
            if (!isEligible) return await interaction.editReply("❌ You need the 'Promotion Eligible' role to check results.");
            const result = await ranker.handlePromotionTest(mainDoc, testDoc, interaction, webhook);
            await interaction.editReply(result);
        }

        // --- RANKING ---
        if (interaction.commandName === 'rank') {
            if (!isAuthorized) return await interaction.editReply("❌ Unauthorized.");
            const result = await ranker.handleRank(mainDoc, interaction, webhook);
            await interaction.editReply(result);
        }

        // --- EVENT LOGGING (Patrols/PTs/Tryouts) ---
        if (interaction.commandName === 'eventlog') {
            if (!isAuthorized) return await interaction.editReply("❌ Unauthorized.");
            const result = await logger.processLog(mainDoc, interaction, webhook);
            await interaction.editReply(result);
        }

    } catch (error) {
        console.error("Interaction Error:", error);
        if (interaction.deferred) {
            await interaction.editReply(`⚠️ System Error: ${error.message}`);
        }
    }
});

// 5. Register Commands
client.once('ready', async () => {
    console.log(`🚀 Logged in as ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('authorize')
            .setDescription('Grant a user permission to use bot commands')
            .addUserOption(o => o.setName('user').setDescription('The user to authorize').setRequired(true)),

        new SlashCommandBuilder()
            .setName('bgc')
            .setDescription('Process a background check for a new recruit')
            .addStringOption(o => o.setName('roblox_username').setDescription('Roblox Username').setRequired(true))
            .addUserOption(o => o.setName('discord_user').setDescription('Discord User').setRequired(true)),

        new SlashCommandBuilder()
            .setName('request_promotion_test')
            .setDescription('Check your test scores and claim Phase 2')
            .addStringOption(o => o.setName('roblox_username').setDescription('Your exact Roblox Username').setRequired(true)),

        new SlashCommandBuilder()
            .setName('rank')
            .setDescription('Promote or transfer a user between sheets')
            .addStringOption(o => o.setName('roblox_username').setDescription('Roblox Username').setRequired(true))
            .addUserOption(o => o.setName('discord_user').setDescription('Discord User').setRequired(true))
            .addStringOption(o => o.setName('current_rank').setDescription('Their current rank').setRequired(true))
            .addStringOption(o => o.setName('new_rank').setDescription('The rank to give them').setRequired(true)),

        new SlashCommandBuilder()
            .setName('eventlog')
            .setDescription('Log points for a Patrol, PT, or Tryout')
            .addStringOption(o => o.setName('eventtype').setDescription('Type of event').setRequired(true).addChoices(
                { name: 'Patrol', value: 'patrol' },
                { name: 'PT', value: 'pt' },
                { name: 'Tryout', value: 'tryout' }
            ))
            .addStringOption(o => o.setName('input').setDescription('Paste the list of usernames').setRequired(true))
            .addBooleanOption(o => o.setName('weekend').setDescription('Is it currently a weekend? (Double Points)').setRequired(true))

    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log('✅ Successfully registered all slash commands.');
    } catch (error) {
        console.error("Command Registration Error:", error);
    }
});

client.login(process.env.DISCORD_TOKEN);