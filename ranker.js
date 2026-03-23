const { google } = require('googleapis');

const MAIN_SHEET_ID = "1u3GspLjvQybVx4mFOd_8pxmppCHzvL2W_GFh3xp3T7o";

function getSheets(auth) {
    return google.sheets({ version: 'v4', auth });
}

// --------------------
// ROLE CONFIGS
// --------------------
const ROLE_CONFIG = {
    jetRecruit: ["1468755195419689073", "1369082109184053476"],
    flameRecruit: ["1468755302244679926", "1369082109184053476"],

    removePhase2: ["1443766259995901952", "1378869378178879578"],

    jetTrooper: ["1443389199645409393", "1387471508816793610", "1369082109435838508"],
    flameTrooper: ["1369082109435838504", "1443791781811454013", "1443389267652120667"],

    jetRemove: ["1399091736856236053", "1468755195419689073"],
    flameRemove: ["1468755302244679926", "1399091736856236053"]
};

// --------------------
// SUB-RANK CHAINS
// --------------------
const jetRankChain = {
    "Jet Trooper": ["1369082109435838508", "1443792369882239067"],
    "Senior Jet Trooper": ["1443792369882239067", "1445500320775016469"],
    "Veteran Trooper": ["1445500320775016469", "1445500422147281039"],
    "Specialist": ["1445500422147281039", "1445500469622345921"]
};

const flameRankChain = {
    "Flame Trooper": ["1443791781811454013", "1389915192984604875"],
    "Senior Flame Trooper": ["1389915192984604875", "1457209493644640297"],
    "Veteran Trooper": ["1457209493644640297", "1457209610875437137"],
    "Specialist": ["1457209610875437137", "1457209756015136979"]
};

// --------------------
// MAIN TRANSFER FUNCTION
// --------------------
async function transferUser(auth, username, discordUser, fromRank, toRank, interaction, webhook) {
    const sheets = getSheets(auth);
    const member = await interaction.guild.members.fetch(discordUser.id);

    // --------------------
    // RECRUIT ENTRY (PLACEMENT → RECRUITS)
    // --------------------
    if (toRank === "Jet Recruit" || toRank === "Flame Recruit") {
        const isJet = toRank.includes("Jet");

        const placement = await sheets.spreadsheets.values.get({
            spreadsheetId: MAIN_SHEET_ID,
            range: "PLACEMENT!B:D"
        });

        const rows = placement.data.values || [];
        const index = rows.findIndex(r => r[0]?.toLowerCase() === username.toLowerCase());

        if (index === -1) return "❌ User not found in PLACEMENT.";

        const joinDate = rows[index][2];

        // CLEAR PLACEMENT
        await sheets.spreadsheets.values.update({
            spreadsheetId: MAIN_SHEET_ID,
            range: `PLACEMENT!B${index + 1}:G${index + 1}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [["N/A", "PHASE1", "01/01/2026", "FALSE", 0, "FALSE"]]
            }
        });

        // ADD TO RECRUITS (FIXED NO EMOJI)
        await sheets.spreadsheets.values.append({
            spreadsheetId: MAIN_SHEET_ID,
            range: "RECRUITS!B:D",
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [[username, toRank, joinDate]]
            }
        });

        // ROLES
        if (isJet) {
            await member.roles.add(ROLE_CONFIG.jetRecruit);
        } else {
            await member.roles.add(ROLE_CONFIG.flameRecruit);
        }

        await member.roles.remove(ROLE_CONFIG.removePhase2);

        // WELCOME MESSAGE
        const channel = interaction.guild.channels.cache.get("1468756387562782732");
        if (channel) {
            await channel.send({
                content: `<@${discordUser.id}>
> 
> <:FNTC:1443781891349155890> | **WELCOME TO THE FN TROOPER CORPS!**
> 
> Please ensure to inspect all the channels that follow:
> 
> https://discord.com/channels/1369082109184053469/1468755814134059089
> https://discord.com/channels/1369082109184053469/1403795268507533393
> https://discord.com/channels/1369082109184053469/1369082110006267988
> https://discord.com/channels/1369082109184053469/1443405151149752452
> https://discord.com/channels/1369082109184053469/1369082110006267989
> 
> -# FN Trooper Corps Officer Team`
            });
        }

        return `✅ ${username} ranked to ${toRank}`;
    }

    // --------------------
    // RECRUIT → TROOPER
    // --------------------
    if (fromRank.includes("Recruit") && toRank.includes("Trooper")) {
        const recruits = await sheets.spreadsheets.values.get({
            spreadsheetId: MAIN_SHEET_ID,
            range: "RECRUITS!B:D"
        });

        const rows = recruits.data.values || [];
        const index = rows.findIndex(r => r[0]?.toLowerCase() === username.toLowerCase());

        if (index === -1) return "❌ User not found in RECRUITS.";

        const joinDate = rows[index][2];
        const isJet = fromRank.includes("Jet");

        const targetSheet = isJet ? "JETPACK COMPANY" : "FLAMETROOPER COMPANY";

        // ADD TO COMPANY
        await sheets.spreadsheets.values.append({
            spreadsheetId: MAIN_SHEET_ID,
            range: `${targetSheet}!B:I`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [["N/A", "", "", joinDate, "", "", "", "TRUE"]]
            }
        });

        // RESET RECRUIT ROW
        await sheets.spreadsheets.values.update({
            spreadsheetId: MAIN_SHEET_ID,
            range: `RECRUITS!B${index + 1}:H${index + 1}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [["N/A", "N/A", "01/01/2026", 0, "FALSE", 0, "FALSE"]]
            }
        });

        // ROLES
        if (isJet) {
            await member.roles.add(ROLE_CONFIG.jetTrooper);
            await member.roles.remove(ROLE_CONFIG.jetRemove);
        } else {
            await member.roles.add(ROLE_CONFIG.flameTrooper);
            await member.roles.remove(ROLE_CONFIG.flameRemove);
        }

        return `✅ ${username} promoted to ${toRank}`;
    }

    // --------------------
    // SUB-RANK PROGRESSION
    // --------------------
    if (jetRankChain[fromRank]) {
        const [removeRole, addRole] = jetRankChain[fromRank];
        await member.roles.remove(removeRole);
        await member.roles.add(addRole);
        return `✅ ${username} promoted (Jet chain)`;
    }

    if (flameRankChain[fromRank]) {
        const [removeRole, addRole] = flameRankChain[fromRank];
        await member.roles.remove(removeRole);
        await member.roles.add(addRole);
        return `✅ ${username} promoted (Flame chain)`;
    }

    return "❌ Invalid ranking path.";
}

module.exports = { transferUser };