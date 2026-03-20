require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, WebhookClient } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const creds = require('./credentials.json');

const { transferUser } = require('./ranker');
const { processLog } = require('./logger');

const TOKEN = process.env.DISCORD_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const ALLOWED_GUILD_ID = "1469734105292865768";
const WEBHOOK_URL = process.env.WEBHOOK_URL;

let webhook = null;
if (WEBHOOK_URL && WEBHOOK_URL.startsWith('http')) {
    webhook = new WebhookClient({ url: WEBHOOK_URL });
}

const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.guildId !== ALLOWED_GUILD_ID) return;

    await interaction.deferReply();
    const executor = `<@${interaction.user.id}>`;

    try {
        if (interaction.commandName === 'rank') {
            const username = interaction.options.getString('username');
            const fromRank = interaction.options.getString('current_rank');
            const toRank = interaction.options.getString('new_rank');

            const result = await transferUser(doc, username, fromRank, toRank, executor, webhook);
            await interaction.editReply(result);
        }

        if (['eventlog', 'ssulog', 'timelog'].includes(interaction.commandName)) {
            const input = interaction.options.getString('input');
            const result = await processLog(doc, interaction.commandName, input, executor, webhook);
            await interaction.editReply(result);
        }

    } catch (error) {
        console.error("Interaction Error:", error);
        await interaction.editReply(`System Error: ${error.message}`);
    }
});

client.once('clientReady', async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const commands = [
        new SlashCommandBuilder().setName('rank').setDescription('Promote/Transfer a user')
            .addStringOption(o => o.setName('username').setRequired(true).setDescription('Username'))
            .addStringOption(o => o.setName('current_rank').setRequired(true).setDescription('From')
                .addChoices({name:'Recruit',value:'Recruit'},{name:'Trooper',value:'Trooper'},{name:'Specialist',value:'Specialist'}))
            .addStringOption(o => o.setName('new_rank').setRequired(true).setDescription('To')
                .addChoices({name:'Trooper',value:'Trooper'},{name:'Specialist',value:'Specialist'},{name:'Corporal',value:'Corporal'})),
        
        new SlashCommandBuilder().setName('eventlog').setDescription('Log an event').addStringOption(o => o.setName('input').setRequired(true).setDescription('Paste log')),
        new SlashCommandBuilder().setName('ssulog').setDescription('Log an SSU').addStringOption(o => o.setName('input').setRequired(true).setDescription('Paste log')),
        new SlashCommandBuilder().setName('timelog').setDescription('Log activity time').addStringOption(o => o.setName('input').setRequired(true).setDescription('Paste log'))
    ];

    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("Bot online.");
    } catch (err) {
        console.error("Registration Error:", err);
    }
});

client.login(TOKEN);