require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, WebhookClient } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const creds = require('./credentials.json');
const config = require('./config');

// Logic Modules
const ranker = require('./ranker');
const logger = require('./logger'); 

// 1. Initialize Discord Client
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.MessageContent
    ] 
});

// Clean the private key properly
const gRawKey = process.env.GOOGLE_PRIVATE_KEY || creds.private_key;

const gKey = gRawKey 
    ? gRawKey.replace(/\\n/g, '\n') 
    : undefined;

if (!gKey) {
    console.error("❌ ERROR: Google Private Key is missing!");
}

const mainDoc = new GoogleSpreadsheet(process.env.SHEET_ID, serviceAccountAuth);
const testDoc = new GoogleSpreadsheet(config.TEST_SHEET_ID, serviceAccountAuth);

// 3. Webhook Setup (Safe check for Railway Variables)
let webhook = null;
if (process.env.WEBHOOK_URL && process.env.WEBHOOK_URL.startsWith('https://')) {
    webhook = new WebhookClient({ url: process.env.WEBHOOK_URL });
    console.log("✅ Webhook Client linked via Railway.");
} else {
    console.warn("⚠️ WEBHOOK_URL not found in Railway Variables. Logging will be skipped.");
}

// 4. Interaction Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // Permission check based on config roles
    const isAuthorized = interaction.member.roles.cache.has(config.ROLES.AUTHORIZED);
    const isEligible = interaction.member.roles.cache.has(config.ROLES.PROMOTION_ELIGIBLE);

    await interaction.deferReply();

    try {
        switch (interaction.commandName) {
            case 'authorize':
                if (!isAuthorized) return await interaction.editReply("❌ You don't have permission to use this.");
                const target = interaction.options.getMember('user');
                await target.roles.add(config.ROLES.AUTHORIZED);
                await interaction.editReply(`✅ Authorized **${target.user.tag}** to use bot commands.`);
                break;

            case 'bgc':
                if (!isAuthorized) return await interaction.editReply("❌ Unauthorized.");
                const bgcRes = await ranker.handleBGC(mainDoc, interaction, webhook);
                await interaction.editReply(bgcRes);
                break;

            case 'request_promotion_test':
                if (!isEligible) return await interaction.editReply("❌ You must be 'Promotion Eligible' to check results.");
                const testRes = await ranker.handlePromotionTest(mainDoc, testDoc, interaction, webhook);
                await interaction.editReply(testRes);
                break;

            case 'rank':
                if (!isAuthorized) return await interaction.editReply("❌ Unauthorized.");
                const rankRes = await ranker.handleRank(mainDoc, interaction, webhook);
                await interaction.editReply(rankRes);
                break;

            case 'eventlog':
                if (!isAuthorized) return await interaction.editReply("❌ Unauthorized.");
                const logRes = await logger.processLog(mainDoc, interaction, webhook);
                await interaction.editReply(logRes);
                break;

            default:
                await interaction.editReply("Unknown command.");
        }
    } catch (error) {
        console.error("Command Error:", error);
        await interaction.editReply(`⚠️ An error occurred: ${error.message}`);
    }
});

// 5. Bot Startup & Command Registration
client.once('clientReady', async (c) => {
    console.log(`🚀 ${c.user.tag} is online and connected to Railway!`);

    const commands = [
        new SlashCommandBuilder()
            .setName('authorize')
            .setDescription('Grant bot permissions to a user')
            .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)),

        new SlashCommandBuilder()
            .setName('bgc')
            .setDescription('Run a background check on a new user')
            .addStringOption(o => o.setName('roblox_username').setDescription('Roblox Name').setRequired(true))
            .addUserOption(o => o.setName('discord_user').setDescription('Discord User').setRequired(true)),

        new SlashCommandBuilder()
            .setName('request_promotion_test')
            .setDescription('Verify test scores and promote to Phase 2')
            .addStringOption(o => o.setName('roblox_username').setDescription('Your Roblox Name').setRequired(true)),

        new SlashCommandBuilder()
            .setName('rank')
            .setDescription('Promote or transfer a user')
            .addStringOption(o => o.setName('roblox_username').setDescription('Roblox Name').setRequired(true))
            .addUserOption(o => o.setName('discord_user').setDescription('Discord User').setRequired(true))
            .addStringOption(o => o.setName('current_rank').setDescription('Current Rank').setRequired(true))
            .addStringOption(o => o.setName('new_rank').setDescription('Target Rank').setRequired(true)),

        new SlashCommandBuilder()
            .setName('eventlog')
            .setDescription('Log points for Patrols, PTs, or Tryouts')
            .addStringOption(o => o.setName('eventtype').setDescription('Event Type').setRequired(true).addChoices(
                { name: 'Patrol', value: 'patrol' },
                { name: 'PT', value: 'pt' },
                { name: 'Tryout', value: 'tryout' }
            ))
            .addStringOption(o => o.setName('input').setDescription('Paste user list here').setRequired(true))
            .addBooleanOption(o => o.setName('weekend').setDescription('Is it the weekend? (2x Points)').setRequired(true))
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        // Automatically uses the bot's ID from the client object
        await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
        console.log('✅ All slash commands registered successfully.');
    } catch (err) {
        console.error("Failed to register commands:", err);
    }
});

client.login(process.env.DISCORD_TOKEN);