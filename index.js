require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    WebhookClient
} = require('discord.js');

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const creds = require('./credentials.json');

const { transferUser, runBGC, handleRequest } = require('./ranker');
const { processEvent } = require('./logger');

const TOKEN = process.env.DISCORD_TOKEN;

const MAIN_SHEET_ID = "1u3GspLjvQybVx4mFOd_8pxmppCHzvL2W_GFh3xp3T7o";
const DATA_SHEET_ID = "1S-MdjLntP9KVZd8vpyR-n_IM6ZxlMsBF7DRONTBx1OM";

const GUILD_ID = "1469734105292865768";

/* ================= ROLE IDS ================= */
const AUTH_ROLE = "1369082109184053474";
const REQUEST_ROLE = "1443766165536247808";

/* ================= CHANNELS ================= */
const WELCOME_CHANNEL = "1468756387562782732";

/* ================= WEBHOOK ================= */
const webhook = process.env.WEBHOOK_URL
    ? new WebhookClient({ url: process.env.WEBHOOK_URL })
    : null;

/* ================= GOOGLE AUTH ================= */
const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const mainDoc = new GoogleSpreadsheet(MAIN_SHEET_ID, auth);
const dataDoc = new GoogleSpreadsheet(DATA_SHEET_ID, auth);

/* ================= CLIENT ================= */
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.guildId !== GUILD_ID) return;

    await interaction.deferReply();

    try {

        /* ================= AUTHORIZE ================= */
        if (interaction.commandName === 'authorize') {

            if (!interaction.member.roles.cache.has(AUTH_ROLE)) {
                return interaction.editReply("❌ You are not authorized.");
            }

            const user = interaction.options.getUser('user');
            const member = await interaction.guild.members.fetch(user.id);

            await member.roles.add(AUTH_ROLE);

            return interaction.editReply(`✅ Authorized ${user.tag}`);
        }

        /* ================= REQUEST ================= */
        if (interaction.commandName === 'request') {

            if (!interaction.member.roles.cache.has(REQUEST_ROLE)) {
                return interaction.editReply("❌ You cannot use this.");
            }

            const username = interaction.options.getString('username');

            const result = await handleRequest(mainDoc, dataDoc, username, interaction);
            return interaction.editReply(result);
        }

        /* ================= RANK ================= */
        if (interaction.commandName === 'rank') {

            if (!interaction.member.roles.cache.has(AUTH_ROLE)) {
                return interaction.editReply("❌ Not authorized.");
            }

            const username = interaction.options.getString('username');
            const user = interaction.options.getUser('user');
            const fromRank = interaction.options.getString('current_rank');
            const toRank = interaction.options.getString('new_rank');

            const result = await transferUser(
                mainDoc,
                username,
                user,
                fromRank,
                toRank,
                interaction,
                webhook
            );

            /* ===== WELCOME MESSAGE ===== */
            if (toRank.includes("Recruit")) {
                const channel = interaction.guild.channels.cache.get(WELCOME_CHANNEL);

                if (channel) {
                    await channel.send(
`<@${user.id}>

> <:FNTC:1443781891349155890> | **WELCOME TO THE FN TROOPER CORPS!**
>
> Please ensure to inspect all the channels that follow:
>
> https://discord.com/channels/1369082109184053469/1468755814134059089 - Trial Information.
> https://discord.com/channels/1369082109184053469/1403795268507533393 - Request your promotion here once you finish your trial.
> https://discord.com/channels/1369082109184053469/1369082110006267988 - Server rules.
> https://discord.com/channels/1369082109184053469/1443405151149752452 - Frequently asked questions can be found here.
> https://discord.com/channels/1369082109184053469/1369082110006267989 - Read our documents.
>
> -# Signed,
> -# FN Trooper Corps, Officer Team`
                    );
                }
            }

            return interaction.editReply(result);
        }

        /* ================= BGC ================= */
        if (interaction.commandName === 'bgc') {

            const robloxId = interaction.options.getString('robloxid');
            const user = interaction.options.getUser('user');

            const result = await runBGC(
                mainDoc,
                robloxId,
                user,
                interaction,
                webhook
            );

            return interaction.editReply(result);
        }

        /* ================= EVENT ================= */
        if (interaction.commandName === 'eventlog') {

            const type = interaction.options.getString('eventtype');
            const weekend = interaction.options.getBoolean('weekend');

            const result = await processEvent(
                mainDoc,
                type,
                weekend,
                interaction,
                webhook
            );

            return interaction.editReply(result);
        }

    } catch (err) {
        console.error("ERROR:", err);
        return interaction.editReply(`❌ System Error: ${err.message}`);
    }
});

/* ================= READY ================= */
client.once('clientReady', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    const commands = [

        /* AUTHORIZE */
        new SlashCommandBuilder()
            .setName('authorize')
            .setDescription('Authorize a user')
            .addUserOption(o =>
                o.setName('user')
                    .setDescription('User to authorize')
                    .setRequired(true)
            ),

        /* REQUEST */
        new SlashCommandBuilder()
            .setName('request')
            .setDescription('Request promotion test')
            .addStringOption(o =>
                o.setName('username')
                    .setDescription('Roblox username')
                    .setRequired(true)
            ),

        /* RANK */
        new SlashCommandBuilder()
            .setName('rank')
            .setDescription('Rank a user')
            .addStringOption(o =>
                o.setName('username')
                    .setDescription('Roblox username')
                    .setRequired(true)
            )
            .addUserOption(o =>
                o.setName('user')
                    .setDescription('Discord user')
                    .setRequired(true)
            )
            .addStringOption(o =>
                o.setName('current_rank')
                    .setDescription('Current rank')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Jet Recruit', value: 'Jet Recruit' },
                        { name: 'Flame Recruit', value: 'Flame Recruit' },
                        { name: 'Jet Trooper', value: 'Jet Trooper' },
                        { name: 'Flame Trooper', value: 'Flame Trooper' },
                        { name: 'Specialist', value: 'Specialist' },
                        { name: 'Corporal', value: 'Corporal' }
                    )
            )
            .addStringOption(o =>
                o.setName('new_rank')
                    .setDescription('New rank')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Jet Recruit', value: 'Jet Recruit' },
                        { name: 'Flame Recruit', value: 'Flame Recruit' },
                        { name: 'Jet Trooper', value: 'Jet Trooper' },
                        { name: 'Flame Trooper', value: 'Flame Trooper' },
                        { name: 'Specialist', value: 'Specialist' },
                        { name: 'Corporal', value: 'Corporal' }
                    )
            ),

        /* BGC */
        new SlashCommandBuilder()
            .setName('bgc')
            .setDescription('Run BGC check')
            .addStringOption(o =>
                o.setName('robloxid')
                    .setDescription('Roblox User ID')
                    .setRequired(true)
            )
            .addUserOption(o =>
                o.setName('user')
                    .setDescription('Discord user')
                    .setRequired(true)
            ),

        /* EVENT */
        new SlashCommandBuilder()
            .setName('eventlog')
            .setDescription('Log event')
            .addStringOption(o =>
                o.setName('eventtype')
                    .setDescription('Type')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Patrol', value: 'patrol' },
                        { name: 'PT', value: 'pt' },
                        { name: 'Tryout', value: 'tryout' },
                        { name: 'General', value: 'general' }
                    )
            )
            .addBooleanOption(o =>
                o.setName('weekend')
                    .setDescription('Weekend event?')
                    .setRequired(true)
            )
    ];

    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: commands }
        );

        console.log("✅ Commands registered.");
    } catch (err) {
        console.error("Command Error:", err);
    }
});

/* ================= LOGIN ================= */
client.login(TOKEN);