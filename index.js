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

// --- IMPORT YOUR SYSTEM FILES ---
const { transferUser } = require('./ranker');
const { processLog } = require('./logger');
const { runBackgroundCheck } = require('./bgc');
const { handlePromotionRequest } = require('./promotionRequest');

// --- CONFIG ---
const TOKEN = process.env.DISCORD_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const ALLOWED_GUILD_ID = "1469734105292865768";

// ROLE IDS
const AUTH_ROLE = "1369082109184053474";
const PROMO_ROLE = "1443766165536247808";

// WEBHOOK
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const TOKEN_PATH = './tokens.json';

// --- GOOGLE SETUP ---
const credentials = JSON.parse(fs.readFileSync('client_secret.json'));
const { client_id, client_secret, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
);

// --- CLIENT ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

// --- WEBHOOK ---
let webhook = null;
if (WEBHOOK_URL && WEBHOOK_URL.startsWith('http')) {
    webhook = new WebhookClient({ url: WEBHOOK_URL });
}

// --- HELPERS ---
function hasRole(member, roleId) {
    return member.roles.cache.has(roleId);
}

async function getUserSheets(userId) {
    if (!fs.existsSync(TOKEN_PATH)) return null;
    const db = JSON.parse(fs.readFileSync(TOKEN_PATH));
    const tokens = db[userId];
    if (!tokens) return null;

    const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    auth.setCredentials(tokens);
    return auth;
}

async function logWebhook(message) {
    if (!webhook) return;
    try {
        await webhook.send({ content: message });
    } catch (e) {
        console.error("Webhook error:", e.message);
    }
}

// --- COMMANDS ---
const commands = [

    new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Link Google account'),

    new SlashCommandBuilder()
        .setName('confirm')
        .setDescription('Confirm Google auth')
        .addStringOption(o =>
            o.setName('code')
                .setRequired(true)
                .setDescription('OAuth code')
        ),

    new SlashCommandBuilder()
        .setName('requestpromotion')
        .setDescription('Request promotion test')
        .addStringOption(o =>
            o.setName('robloxusername')
                .setRequired(true)
                .setDescription('Roblox Username')
        ),

    new SlashCommandBuilder()
        .setName('bgc')
        .setDescription('Background check')
        .addStringOption(o =>
            o.setName('robloxid')
                .setRequired(true)
                .setDescription('Roblox ID')
        )
        .addStringOption(o =>
            o.setName('discordid')
                .setRequired(true)
                .setDescription('Discord User ID')
        )
        .addStringOption(o =>
            o.setName('result')
                .setRequired(true)
                .setDescription('Pass or Fail')
                .addChoices(
                    { name: 'Pass', value: 'pass' },
                    { name: 'Fail', value: 'fail' }
                )
        ),

    new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Rank user')
        .addStringOption(o =>
            o.setName('robloxusername')
                .setRequired(true)
                .setDescription('Roblox Username')
        )
        .addUserOption(o =>
            o.setName('discorduser')
                .setRequired(true)
                .setDescription('Discord User')
        )
        .addStringOption(o =>
            o.setName('rank')
                .setRequired(true)
                .setDescription('New Rank')
        ),

    new SlashCommandBuilder()
        .setName('eventlog')
        .setDescription('Log event')
        .addStringOption(o =>
            o.setName('eventtype')
                .setRequired(true)
                .setDescription('Event Type')
        )
        .addStringOption(o =>
            o.setName('input')
                .setRequired(true)
                .setDescription('Event log text')
        )
        .addStringOption(o =>
            o.setName('weekend')
                .setRequired(true)
                .addChoices(
                    { name: 'True', value: 'true' },
                    { name: 'False', value: 'false' }
                )
        )

].map(c => c.toJSON());

// --- INTERACTIONS ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.guildId !== ALLOWED_GUILD_ID) return;

    const { commandName, user, member, options } = interaction;

    // --- ROLE PERMISSIONS ---
    if (['rank', 'eventlog', 'bgc'].includes(commandName)) {
        if (!hasRole(member, AUTH_ROLE)) {
            return interaction.reply({
                content: "❌ Unauthorized.",
                flags: [MessageFlags.Ephemeral]
            });
        }
    }

    if (commandName === 'requestpromotion') {
        if (!hasRole(member, PROMO_ROLE)) {
            return interaction.reply({
                content: "❌ Unauthorized.",
                flags: [MessageFlags.Ephemeral]
            });
        }
    }

    // --- VERIFY ---
    if (commandName === 'verify') {
        const url = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: ['https://www.googleapis.com/auth/spreadsheets']
        });

        return interaction.reply({
            content: `🔗 Login: ${url}`,
            flags: [MessageFlags.Ephemeral]
        });
    }

    // --- CONFIRM ---
    if (commandName === 'confirm') {
        const code = options.getString('code');

        try {
            const { tokens } = await oAuth2Client.getToken(code);
            const db = fs.existsSync(TOKEN_PATH)
                ? JSON.parse(fs.readFileSync(TOKEN_PATH))
                : {};

            db[user.id] = tokens;
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(db, null, 2));

            return interaction.reply({
                content: "✅ Verified!",
                flags: [MessageFlags.Ephemeral]
            });

        } catch {
            return interaction.reply({
                content: "❌ Invalid code.",
                flags: [MessageFlags.Ephemeral]
            });
        }
    }

    // --- REQUIRE GOOGLE AUTH ---
    await interaction.deferReply();

    const auth = await getUserSheets(user.id);
    if (!auth) {
        return interaction.editReply("❌ Use /verify first.");
    }

    try {

        // --- PROMOTION REQUEST ---
        if (commandName === 'requestpromotion') {
            const result = await handlePromotionRequest(
                auth,
                options.getString('robloxusername'),
                interaction,
                webhook
            );

            await logWebhook(`📈 Promotion Request by <@${user.id}>`);
            return interaction.editReply(result);
        }

        // --- BGC ---
        if (commandName === 'bgc') {
            const result = await runBackgroundCheck(
                options.getString('robloxid'),
                options.getString('discordid'),
                options.getString('result'),
                interaction
            );

            await logWebhook(`🛡️ BGC by <@${user.id}>`);
            return interaction.editReply(result);
        }

        // --- RANK ---
        if (commandName === 'rank') {
            const result = await transferUser(
                auth,
                SHEET_ID,
                options.getString('robloxusername'),
                options.getUser('discorduser'),
                options.getString('rank'),
                interaction,
                webhook
            );

            await logWebhook(`📊 Rank used by <@${user.id}>`);
            return interaction.editReply(result);
        }

        // --- EVENT LOG ---
        if (commandName === 'eventlog') {
            const formatted = `
Event: ${options.getString('eventtype')}
Weekend: ${options.getString('weekend')}
${options.getString('input')}
`;

            const result = await processLog(
                auth,
                SHEET_ID,
                formatted,
                interaction,
                webhook
            );

            await logWebhook(`📋 Event logged by <@${user.id}>`);
            return interaction.editReply(result);
        }

    } catch (err) {
        console.error(err);
        return interaction.editReply(`❌ Error: ${err.message}`);
    }
});

// --- READY ---
client.once('ready', async (c) => {
    console.log(`Logged in as ${c.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(c.user.id, ALLOWED_GUILD_ID),
        { body: commands }
    );

    console.log("✅ Commands registered");
});

client.login(TOKEN);