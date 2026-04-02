require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, WebhookClient } = require('discord.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const creds = require('./credentials.json');

const { transferUser, handlePromotionRequest, handleBGC } = require('./ranker');
const { processLog } = require('./logger');
const { ROLES } = require('./config');

const TOKEN = process.env.DISCORD_TOKEN;
const SHEET_ID = process.env.SHEET_ID; 
const PROMO_SHEET_ID = "1S-MdjLntP9KVZd8vpyR-n_IM6ZxlMsBF7DRONTBx1OM"; // Specified in prompt
const ALLOWED_GUILD_ID = "1369082109184053469";
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
const promoDoc = new GoogleSpreadsheet(PROMO_SHEET_ID, serviceAccountAuth);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.guildId !== ALLOWED_GUILD_ID) return;

    await interaction.deferReply();
    const executor = `<@${interaction.user.id}>`;
    const member = interaction.member;

    try {
        if (interaction.commandName === 'authorize') {
            if (!member.roles.cache.has(ROLES.AUTHORIZE_PERM)) {
                return interaction.editReply("You don't have permission to use this.");
            }
            const target = interaction.options.getUser('discorduser');
            // Add authorization logic here if needed
            await interaction.editReply(`Successfully authorized ${target}.`);
        }

        if (interaction.commandName === 'request_promotion') {
            if (!member.roles.cache.has(ROLES.REQUEST_PROMOTION_PERM)) {
                return interaction.editReply("You do not have the required role to request a promotion test.");
            }
            const rbxUser = interaction.options.getString('robloxusername');
            const result = await handlePromotionRequest(promoDoc, doc, rbxUser, interaction.member, webhook);
            await interaction.editReply(result);
        }

        if (interaction.commandName === 'rank') {
            const rbxUser = interaction.options.getString('robloxusername');
            const targetUser = interaction.options.getUser('discorduser');
            const currentRank = interaction.options.getString('current_rank');
            const newRank = interaction.options.getString('new_rank');
            
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            const result = await transferUser(doc, rbxUser, targetMember, currentRank, newRank, executor, webhook, interaction.client);
            await interaction.editReply(result);
        }

        if (interaction.commandName === 'eventlog') {
            const eventType = interaction.options.getString('eventtype');
            const input = interaction.options.getString('input');
            const weekend = interaction.options.getBoolean('weekend');
            const result = await processLog(doc, eventType, input, weekend, executor, webhook);
            await interaction.editReply(result);
        }

        if (interaction.commandName === 'bgc') {
            const rbxId = interaction.options.getString('robloxuserid');
            const targetUser = interaction.options.getUser('discorduser');
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            
            const result = await handleBGC(doc, rbxId, targetMember, executor, webhook);
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
        new SlashCommandBuilder().setName('authorize').setDescription('Authorize a discord user').addUserOption(o => o.setName('discorduser').setRequired(true).setDescription('User to authorize')),
        new SlashCommandBuilder().setName('request_promotion').setDescription('Request promotion test').addStringOption(o => o.setName('robloxusername').setRequired(true).setDescription('Roblox Username')),
        new SlashCommandBuilder().setName('bgc').setDescription('Log a Background Check').addStringOption(o => o.setName('robloxuserid').setRequired(true).setDescription('Roblox User ID')).addUserOption(o => o.setName('discorduser').setRequired(true).setDescription('Discord User')),
        
        new SlashCommandBuilder().setName('rank').setDescription('Promote/Transfer a user')
            .addStringOption(o => o.setName('robloxusername').setRequired(true).setDescription('Roblox Username'))
            .addUserOption(o => o.setName('discorduser').setRequired(true).setDescription('Discord Member'))
            .addStringOption(o => o.setName('current_rank').setRequired(true).setDescription('From Rank'))
            .addStringOption(o => o.setName('new_rank').setRequired(true).setDescription('To Rank')),
            
        new SlashCommandBuilder().setName('eventlog').setDescription('Log an event')
            .addStringOption(o => o.setName('eventtype').setRequired(true).setDescription('Type of event')
                .addChoices({name:'Patrol',value:'Patrol'},{name:'PT/Physical Training',value:'PT'},{name:'General Tryout',value:'General Tryout'},{name:'Divisional Tryout',value:'Divisional Tryout'},{name:'Other',value:'Other'}))
            .addStringOption(o => o.setName('input').setRequired(true).setDescription('Paste log format'))
            .addBooleanOption(o => o.setName('weekend').setRequired(true).setDescription('Is it the weekend?'))
    ];

    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("Bot online.");
    } catch (err) {
        console.error("Registration Error:", err);
    }
});

client.login(TOKEN);