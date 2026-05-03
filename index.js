require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    MessageFlags,
    EmbedBuilder
} = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');

// Imports
const cfg = require('./config');
const { transferUser } = require('./ranker');
const { processLog } = require('./logger');

// --- SETUP ---
const TOKEN = process.env.DISCORD_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const TOKEN_PATH = './tokens.json';
const PERMS_PATH = './permissions.json';

// Google OAuth2
const credentials = JSON.parse(fs.readFileSync('client_secret.json'));
const { client_id, client_secret, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ] 
});

// --- HELPERS ---
function getPermissions() {
    if (!fs.existsSync(PERMS_PATH)) return {};
    try { return JSON.parse(fs.readFileSync(PERMS_PATH)); } catch { return {}; }
}

function savePermissions(perms) {
    fs.writeFileSync(PERMS_PATH, JSON.stringify(perms, null, 2));
}

async function getUserSheets(userId) {
    if (!fs.existsSync(TOKEN_PATH)) return null;
    const db = JSON.parse(fs.readFileSync(TOKEN_PATH));
    const userTokens = db[userId];
    if (!userTokens) return null;
    const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    auth.setCredentials(userTokens);
    return auth;
}

async function performDischarge(auth, spreadsheetId, robloxName) {
    const sheetsApi = google.sheets({ version: 'v4', auth });
    const sheetsToSearch = Object.values(cfg.TABS);
    
    // 1. Find the user
    let foundSheet = null;
    let foundRowIndex = -1;

    for (const sheetName of sheetsToSearch) {
        const res = await sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:D`
        });
        const rows = res.data.values || [];
        const idx = rows.findIndex(row => row.some(cell => cell?.toLowerCase() === robloxName.toLowerCase()));
        
        if (idx !== -1) {
            foundSheet = sheetName;
            foundRowIndex = idx + 1; // 1-based for A1 notation
            break;
        }
    }

    if (!foundSheet) return { success: false, msg: "User not found on any sheets." };

    // 2. Prepare Wipe Data based on Sheet Type
    let range = "";
    let values = [];

    if (foundSheet === cfg.TABS.HIGH_COM) {
        // B=N/A, D=01/01/2026, E-H=0
        range = `${foundSheet}!B${foundRowIndex}:H${foundRowIndex}`;
        values = [["N/A", "", "01/01/2026", 0, 0, 0, 0]];
    } 
    else if (foundSheet === cfg.TABS.STAFF) {
        // B=N/A, E=01/01/2026, F-H=0, I=FALSE, J&K=0
        range = `${foundSheet}!B${foundRowIndex}:K${foundRowIndex}`;
        values = [["N/A", "", "", "01/01/2026", 0, 0, 0, "FALSE", 0, 0]];
    } 
    else if ([cfg.TABS.SNOWTROOPER, cfg.TABS.ICEGUARD, cfg.TABS.HAILSTORM].includes(foundSheet)) {
        // B=N/A, D=01/01/2026, E-H=0, I=FALSE
        range = `${foundSheet}!B${foundRowIndex}:I${foundRowIndex}`;
        values = [["N/A", "", "01/01/2026", 0, 0, 0, 0, "FALSE"]];
    } 
    else if (foundSheet === cfg.TABS.RECRUITS) {
        // B=N/A, C=N/A, D=01/01/2026, E=0, F&G=FALSE, H=0
        range = `${foundSheet}!B${foundRowIndex}:H${foundRowIndex}`;
        values = [["N/A", "N/A", "01/01/2026", 0, "FALSE", "FALSE", 0]];
    }

    // 3. Execute Wipe
    await sheetsApi.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [values] }
    });

    return { success: true, msg: `Wiped data from **${foundSheet}**.` };
}

// --- NEW HELPERS FOR INACTIVITY NOTICE ---
function getNextSaturday(weeksAhead = 1) {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const daysUntilNextSat = (6 - dayOfWeek + 7) % 7 || 7; // If today is Sat, get next Sat (7 days)
    now.setDate(now.getDate() + daysUntilNextSat + (weeksAhead - 1) * 7);
    
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

async function issueInactivityNotice(auth, spreadsheetId, robloxName, duration) {
    const sheetsApi = google.sheets({ version: 'v4', auth });
    
    // The specific sheets to search through
    const sheetsToSearch = [
        'RECRUITS', 
        'SNOWTROOPER COMPANY', 
        'ICEGUARD COMPANY', 
        'HAILSTORM COMPANY', 
        'DIVISIONAL STAFF', 
        'HIGH COMMAND'
    ];

    // 1. Get spreadsheet metadata to map sheet names to their internal sheetIds
    const meta = await sheetsApi.spreadsheets.get({ spreadsheetId });
    const sheetMap = {};
    meta.data.sheets.forEach(s => {
        sheetMap[s.properties.title] = s.properties.sheetId;
    });

    let found = false;
    let targetSheetName = '';
    let targetRowIndex = -1;
    let targetSheetId = null;

    // 2. Search for the Roblox username across the sheets
    for (const sheetName of sheetsToSearch) {
        if (!sheetMap[sheetName]) continue; // Skip if sheet doesn't exist

        const response = await sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:D` // Assuming the username is somewhere in Columns A to D
        });

        const rows = response.data.values;
        if (!rows) continue;

        // Find the row containing the roblox username (case-insensitive)
        const rowIndex = rows.findIndex(row => 
            row.some(cell => typeof cell === 'string' && cell.toLowerCase() === robloxName.toLowerCase())
        );

        if (rowIndex !== -1) {
            found = true;
            targetSheetName = sheetName;
            targetRowIndex = rowIndex; // 0-based index for batchUpdate
            targetSheetId = sheetMap[sheetName];
            break;
        }
    }

    if (!found) {
        return `Could not find **${robloxName}** in any of the expected division sheets.`;
    }

    // 3. Calculate Due Date based on duration ('one' or 'two' resets)
    const weeksAhead = duration === 'one' ? 1 : 2;
    const dueDate = getNextSaturday(weeksAhead);

    // 4. Update Column I (Index 8) to be TRUE and add the note
    const requests = [{
        updateCells: {
            range: {
                sheetId: targetSheetId,
                startRowIndex: targetRowIndex,
                endRowIndex: targetRowIndex + 1,
                startColumnIndex: 8, // Column I
                endColumnIndex: 9
            },
            rows: [{
                values: [{
                    userEnteredValue: { boolValue: true }, // Checks the box
                    note: `Due Date: ${dueDate}` // Adds the note
                }]
            }],
            fields: 'userEnteredValue,note'
        }
    }];

    await sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests }
    });

    return `Found in **${targetSheetName}**. Inactivity notice logged for **${dueDate}**.`;
}

// --- COMMAND DEFINITIONS ---
const commands = [
    new SlashCommandBuilder().setName('authorize').setDescription('Authorize a user for a specific command')
        .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
        .addStringOption(o => o.setName('command').setDescription('Command name').setRequired(true)),

    new SlashCommandBuilder().setName('verify').setDescription('Connect your Google account'),
    new SlashCommandBuilder().setName('confirm').setDescription('Finalize verification with code')
        .addStringOption(o => o.setName('code').setDescription('Code from Google URL').setRequired(true)),

    new SlashCommandBuilder().setName('bgc').setDescription('Background check results')
        .addStringOption(o => o.setName('robloxuserid').setDescription('Roblox User ID').setRequired(true))
        .addUserOption(o => o.setName('discorduser').setDescription('Discord User').setRequired(true))
        .addStringOption(o => o.setName('result').setDescription('Pass or Fail').setRequired(true)
            .addChoices({name: 'Pass', value: 'pass'}, {name: 'Fail', value: 'fail'})),

   // Inside your commands array in index.js:
new SlashCommandBuilder().setName('rank').setDescription('Change a user\'s rank and update sheets')
    .addStringOption(o => o.setName('robloxusername').setDescription('Roblox Username').setRequired(true))
    .addUserOption(o => o.setName('discorduser').setDescription('Discord User (@)').setRequired(true))
    .addStringOption(o => o.setName('current_rank')
        .setDescription('Current Rank')
        .setRequired(true)
        .setAutocomplete(true)) // <--- ADD THIS
    .addStringOption(o => o.setName('new_rank')
        .setDescription('Target Rank')
        .setRequired(true)
        .setAutocomplete(true)), // <--- ADD THIS

    new SlashCommandBuilder().setName('eventlog').setDescription('Log a divisional event')
        .addStringOption(o => o.setName('event_type').setDescription('Type of event').setRequired(true)
            .addChoices(
                { name: 'Patrol', value: 'Patrol' },
                { name: 'General Tryout', value: 'General Tryout' },
                { name: 'General Training (GT)', value: 'General Training (GT)' },
                { name: 'OTS CT', value: 'OTS CT' },
                { name: 'TPS CT', value: 'TPS CT' },
                { name: 'Inspections', value: 'Inspections' }
            ))
        .addStringOption(o => o.setName('input').setDescription('Attendees / Raw Log').setRequired(true))
        .addBooleanOption(o => o.setName('weekend').setDescription('Is it the weekend?').setRequired(true)),

    new SlashCommandBuilder().setName('timelog').setDescription('Log in-game time')
        .addStringOption(o => o.setName('input').setDescription('Log text').setRequired(true)),

    new SlashCommandBuilder().setName('inactivitynotice').setDescription('Issue an inactivity notice')
        .addUserOption(o => o.setName('discorduser').setDescription('Discord User').setRequired(true))
        .addStringOption(o => o.setName('robloxusername').setDescription('Roblox Username').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('Notice length').setRequired(true)
            .addChoices({name: 'One Reset (Next Sat)', value: 'one'}, {name: 'Two Resets (Following Sat)', value: 'two'})),
            new SlashCommandBuilder().setName('discharge').setDescription('Discharge a user and wipe their sheet data')
        .addStringOption(o => o.setName('robloxusername').setDescription('Roblox Username').setRequired(true))
        .addUserOption(o => o.setName('discorduser').setDescription('Discord User to kick').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for discharge').setRequired(true)
            .addChoices(
                { name: 'Quota Fail', value: 'Quota Fail' },
                { name: 'Removal', value: 'Removal' },
                { name: 'Discharge', value: 'Discharge' }
            )),
].map(cmd => cmd.toJSON());


// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
if (interaction.isAutocomplete()) {
        const focusedOption = interaction.options.getFocused(true);
        let choices = [];

// Inside interactionCreate for isAutocomplete()
if (focusedOption.name === 'current_rank' || focusedOption.name === 'new_rank') {
    choices = [
        'PLACEMENT PHASE ONE', 
        'PLACEMENT PHASE TWO', 
        'SNOWTROOPER', 
        'ICEGUARD TROOPER', 
        'HAILSTORM TROOPER'
    ];
}

        const filtered = choices
            .filter(choice => choice.startsWith(focusedOption.value.toUpperCase()))
            .slice(0, 25);

        await interaction.respond(
            filtered.map(choice => ({ name: choice, value: choice }))
        );
        return; 
    }

    // --- 2. CHAT COMMAND HANDLER ---
    if (!interaction.isChatInputCommand()) return;
    const { commandName, user, options, member, guild } = interaction;
    const logChannel = guild.channels.cache.get(cfg.LOG_CHANNEL);

    // Permissions Logic
    const isAuthorizedAdmin = member.roles.cache.has(cfg.PERMS.AUTHORIZE_ROLE);
    const isHighCommand = member.roles.cache.has(cfg.PERMS.HIGH_COMMAND_ROLE);
    const isLoggingRole = member.roles.cache.has(cfg.PERMS.LOGGING_ROLE);

    // 1. Authorize Command check
    if (commandName === 'authorize') {
        if (!isAuthorizedAdmin) return interaction.reply({ content: "Access Denied.", flags: [MessageFlags.Ephemeral] });
        const target = options.getUser('user');
        const cmd = options.getString('command');
        const perms = getPermissions();
        if (!perms[target.id]) perms[target.id] = [];
        perms[target.id].push(cmd);
        savePermissions(perms);
        return interaction.reply({ content: `Authorized <@${target.id}> for /${cmd}.`, flags: [MessageFlags.Ephemeral] });
    }

    
    // 2. Command Access Checks
    const highCmds = ['rank', 'inactivitynotice', 'bgc'];
    const logCmds = ['eventlog', 'timelog'];

    if (highCmds.includes(commandName) && !isHighCommand) {
        return interaction.reply({ content: "High Command role required.", flags: [MessageFlags.Ephemeral] });
    }
    if (logCmds.includes(commandName) && !isLoggingRole && !isHighCommand) {
        return interaction.reply({ content: "Logging permission required.", flags: [MessageFlags.Ephemeral] });
    }

    // 3. Google Auth Commands
    if (commandName === 'verify') {
        const url = oAuth2Client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/spreadsheets'] });
        return interaction.reply({ content: `[Verify Google Account](${url})`, flags: [MessageFlags.Ephemeral] });
    }

    if (commandName === 'confirm') {
        const code = options.getString('code');
        try {
            const { tokens } = await oAuth2Client.getToken(code);
            const db = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH)) : {};
            db[user.id] = tokens;
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(db, null, 2));
            return interaction.reply({ content: "Successfully verified!", flags: [MessageFlags.Ephemeral] });
        } catch { return interaction.reply({ content: "Invalid code.", flags: [MessageFlags.Ephemeral] }); }
    }

    // 4. Data-heavy Commands
    await interaction.deferReply();
    const auth = await getUserSheets(user.id);
    if (!auth) return interaction.editReply("Run `/verify` first.");

    try {
        if (commandName === 'bgc') {
            const result = options.getString('result');
            const robloxId = options.getString('robloxuserid');
            const target = options.getUser('discorduser');
            const targetMember = await guild.members.fetch(target.id);

            if (result === 'pass') {
                // 1. Update Discord Roles
                await targetMember.roles.add(cfg.GENERAL_ROLES.BGC_PASS);
                await targetMember.roles.remove(cfg.GENERAL_ROLES.BGC_REMOVE);
                
                // 2. Send Welcome Message
                const welcomeMsg = `<@${target.id}>\n>\n> :SnowTrooper:  | **WELCOME TO THE FIRST ORDER SNOWTROOPER!**\n>\n> Please ensure to inspect all the channels that follow:\n>\n> https://discord.com/channels/1498050747101610165/1498050749215674550 - Recruit Information.\n> https://discord.com/channels/1498050747101610165/1498050750050336775 - Documents.\n> https://discord.com/channels/1498050747101610165/1498050750050336768 - Rules.\n> https://discord.com/channels/1498050747101610165/1498050750050336773 - FAQ.\n>\n> -# Signed, Snowtrooper Officer team`;
                await guild.channels.cache.get(cfg.WELCOME_CHANNEL).send(welcomeMsg);

                // 3. LOG TO DISCORD (Embed)
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle("Background Check: Passed")
                        .setColor(0x2f3136)
                        .addFields(
                            { name: "User", value: `${targetMember} (${robloxId})`, inline: true },
                            { name: "Officer", value: `<@${user.id}>`, inline: true },
                            { name: "Outcome", value: "Added to Recruits", inline: false }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [embed] });
                }
                await interaction.editReply(`Background check **passed** for <@${target.id}>.`);

            } else {
                // BGC FAIL LOGIC
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle("Background Check: Failed")
                        .setColor(0xFF0000) // Red for failure
                        .addFields(
                            { name: "User", value: `${targetMember} (${robloxId})`, inline: true },
                            { name: "Officer", value: `<@${user.id}>`, inline: true },
                            { name: "Outcome", value: "BGC Failed", inline: false }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [embed] });
                }
                await interaction.editReply("Background check marked as **Fail**.");
            }

} else if (commandName === 'inactivitynotice') {
                const target = options.getUser('discorduser');
                const robloxName = options.getString('robloxusername');
                const duration = options.getString('duration');
                const targetMember = await guild.members.fetch(target.id);

                // 1. Add the Discord Role
                try {
                    await targetMember.roles.add(cfg.GENERAL_ROLES.INACTIVITY_NOTICE);
                } catch (err) {
                    console.error("Failed to add role:", err);
                }
                
                // 2. Update the Spreadsheet
                const sheetResult = await issueInactivityNotice(auth, SHEET_ID, robloxName, duration);
                
                // 3. LOG TO DISCORD CHANNEL (Formatted Embed)
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle("Inactivity Notice Log")
                        .setColor(0x2f3136)
                        .addFields(
                            { name: "User", value: `${targetMember} (${robloxName})`, inline: true },
                            { name: "Duration", value: `${duration === 'one' ? '1 Reset' : '2 Resets'}`, inline: true },
                            { name: "Status", value: sheetResult }
                        )
                        .setTimestamp();

                    await logChannel.send({ embeds: [embed] });
                }
                await interaction.editReply(`Notice issued to **${robloxName}**.\n> ${sheetResult}`);

                } else if (commandName === 'discharge') {
    const robloxName = options.getString('robloxusername');
    const targetUser = options.getUser('discorduser');
    const reason = options.getString('reason');
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    // 1. Update Sheets
    const sheetResult = await performDischarge(auth, SHEET_ID, robloxName);
    
    // 2. Kick from Discord
    let kickStatus = "User not in server.";
    if (targetMember) {
        try {
            await targetMember.kick(`Discharged by ${user.tag}: ${reason}`);
            kickStatus = "Successfully kicked.";
        } catch (err) {
            kickStatus = "Failed to kick (Check bot permissions).";
        }
    }

    // 3. Log to Discord Embed
    if (logChannel) {
        const embed = new EmbedBuilder()
            .setTitle(" Discharge Log")
            .setColor(0x000000) // Black for discharge
            .addFields(
                { name: "User", value: `${targetUser.tag} (${robloxName})`, inline: true },
                { name: "Reason", value: reason, inline: true },
                { name: "Sheet Action", value: sheetResult.msg, inline: false },
                { name: "Discord Action", value: kickStatus, inline: false }
            )
            .setTimestamp();
        
        await logChannel.send({ embeds: [embed] });
    }

    await interaction.editReply(`**Discharge Processed:**\n> **Sheets:** ${sheetResult.msg}\n> **Discord:** ${kickStatus}`);


        } else if (commandName === 'rank') {
            const result = await transferUser(auth, SHEET_ID, interaction, logChannel);
            await interaction.editReply(result);

        } else if (commandName === 'eventlog' || commandName === 'timelog') {
            const input = options.getString('input');
            const type = options.getString('event_type') || "Time Log";
            const weekend = options.getBoolean('weekend') || false;

            const formattedInput = `Event: ${type}\nWeekend: ${weekend}\n${input}`;
            const result = await processLog(auth, SHEET_ID, commandName, formattedInput);
            
            if (logChannel) logChannel.send(`**Activity Logged:**\nUser: <@${user.id}>\nType: ${type}\nResult: \n${result}`);
            await interaction.editReply("Log processed and saved to sheets.");
        }

    } catch (err) {
        console.error(err);
        await interaction.editReply(`Error: ${err.message}`);
    }
});

try {
    require('./group-logs.js');
} catch(e) {}


client.once('ready', async (c) => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    
    try {
        console.log('--- 🧹 STARTING COMMAND CLEANUP ---');

        // Step 1: Wipe Global Commands (The ones that follow the bot everywhere)
        await rest.put(Routes.applicationCommands(c.user.id), { body: [] });
        console.log('✅ Global commands cleared.');

        // Step 2: Wipe Guild Commands (The ones stuck in your specific server)
        await rest.put(Routes.applicationGuildCommands(c.user.id, cfg.GUILD_ID), { body: [] });
        console.log('✅ Guild commands cleared.');

        // Step 3: Register Fresh Commands (With Autocomplete enabled)
        await rest.put(
            Routes.applicationGuildCommands(c.user.id, cfg.GUILD_ID),
            { body: commands }
        );
        
        console.log(`✅ ${c.user.tag} is online.`);
        console.log('🚀 Commands synced! RESTART YOUR DISCORD APP (Ctrl+R) to see changes.');

    } catch (error) {
        console.error('❌ Error during command sync:', error);
    }
});

client.login(TOKEN);