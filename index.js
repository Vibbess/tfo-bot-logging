const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, WebhookClient } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const config = require('./config');
const ranker = require('./ranker');
const logger = require('./logger');

// Load your credentials file directly
const creds = require('./credentials.json.json'); // Match the double .json in your screenshot

// 1. Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 2. Google Sheets Authentication using the JSON file
const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(config.SPREADSHEET_ID, serviceAccountAuth);

// 3. Webhook for BGC Logging
const bgcWebhook = new WebhookClient({ url: config.BGC_WEBHOOK_URL });

// 4. Slash Command Definitions
const commands = [
    // /bgc command
    new SlashCommandBuilder()
        .setName('bgc')
        .setDescription('Run a background check on a user')
        .addStringOption(opt => opt.setName('roblox_userid').setDescription('The Roblox User ID').setRequired(true))
        .addUserOption(opt => opt.setName('discord_user').setDescription('The Discord User').setRequired(true)),

    // /rank command
    new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Promote or transfer a user between sheets/roles')
        .addStringOption(opt => opt.setName('username').setDescription('Roblox Username').setRequired(true))
        .addUserOption(opt => opt.setName('member').setDescription('Discord Member').setRequired(true))
        .addStringOption(opt => opt.setName('current_rank').setDescription('Current Rank/Sheet location').setRequired(true))
        .addStringOption(opt => opt.setName('new_rank').setDescription('New Rank to give').setRequired(true)),

    // /log command
    new SlashCommandBuilder()
        .setName('log')
        .setDescription('Log an event, patrol, or tryout')
        .addStringOption(opt => opt.setName('eventtype').setDescription('Type of event (Patrol, PT, Tryout, etc)').setRequired(true))
        .addStringOption(opt => opt.setName('input').setDescription('Paste the full log format here').setRequired(true))
        .addBooleanOption(opt => opt.setName('weekend').setDescription('Is this a weekend event? (2x points)').setRequired(true)),

    // /test_check command
    new SlashCommandBuilder()
        .setName('test_check')
        .setDescription('Check promotion test results for a user')
        .addStringOption(opt => opt.setName('roblox_username').setDescription('Roblox Username').setRequired(true))
].map(command => command.toJSON());

// 5. Register Commands
const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationCommands(config.CLIENT_ID), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

// 6. Interaction Handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply({ ephemeral: true });

    try {
        // Handle BGC
        if (interaction.commandName === 'bgc') {
            const response = await ranker.handleBGC(doc, interaction, bgcWebhook);
            await interaction.editReply(response);
        }

        // Handle Ranking
        if (interaction.commandName === 'rank') {
            const username = interaction.options.getString('username');
            const member = interaction.options.getMember('member');
            const currentRank = interaction.options.getString('current_rank');
            const newRank = interaction.options.getString('new_rank');

            const response = await ranker.transferUser(doc, username, member, currentRank, newRank, interaction);
            await interaction.editReply(response);
        }

        // Handle Logging
        if (interaction.commandName === 'log') {
            const response = await logger.processLog(doc, interaction);
            await interaction.editReply(response);
        }

        // Handle Test Check
        if (interaction.commandName === 'test_check') {
            const response = await ranker.handlePromotionTest(doc, interaction);
            await interaction.editReply(response);
        }

    } catch (err) {
        console.error(err);
        await interaction.editReply(`An error occurred: ${err.message}`);
    }
});

// 7. Login
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.login(config.DISCORD_TOKEN);