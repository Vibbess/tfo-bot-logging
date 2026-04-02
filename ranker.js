const { google } = require('googleapis');

// --- SHEETS ---
const SHEETS = {
    PLACEMENTS: "PLACEMENTS",
    RECRUITS: "RECRUITS",
    JET: "JETPACK COMPANY",
    FLAME: "FLAMETROOPER COMPANY"
};

// --- CHANNEL ---
const WELCOME_CHANNEL = "1468756387562782732";

// --- ROLE MAPS ---
const ROLES = {
    // Recruit
    JET_RECRUIT_ADD: ["1468755195419689073", "1369082109184053476"],
    FLAME_RECRUIT_ADD: ["1468755302244679926", "1369082109184053476"],
    RECRUIT_REMOVE: ["1443766259995901952", "1378869378178879578"],

    // Trooper
    JET_TROOPER_ADD: ["1443389199645409393", "1387471508816793610", "1369082109435838508"],
    JET_TROOPER_REMOVE: ["1399091736856236053", "1468755195419689073"],

    FLAME_TROOPER_ADD: ["1369082109435838504", "1443791781811454013", "1443389267652120667"],
    FLAME_TROOPER_REMOVE: ["1468755302244679926", "1399091736856236053"]
};

// --- HELPERS ---
function normalize(name) {
    return name?.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function getRows(sheets, spreadsheetId, tab) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tab}!A:G`
    });
    return res.data.values || [];
}

async function updateRow(sheets, spreadsheetId, range, values) {
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [values] }
    });
}

async function addRoles(member, roles) {
    for (const r of roles) {
        try { await member.roles.add(r); } catch {}
    }
}

async function removeRoles(member, roles) {
    for (const r of roles) {
        try { await member.roles.remove(r); } catch {}
    }
}

// --- MAIN FUNCTION ---
async function transferUser(auth, spreadsheetId, username, discordUser, newRank, interaction, webhook) {

    const sheets = google.sheets({ version: 'v4', auth });
    const member = await interaction.guild.members.fetch(discordUser.id);
    const clean = normalize(username);

    // --- FIND IN PLACEMENTS ---
    const placementRows = await getRows(sheets, spreadsheetId, SHEETS.PLACEMENTS);
    let pIndex = placementRows.findIndex(r => normalize(r[1]) === clean);

    // ============================
    // PHASE 2 → RECRUIT
    // ============================
    if (newRank === "Jet Recruit" || newRank === "Flame Recruit") {

        if (pIndex === -1) return "❌ User not in placements.";

        const row = placementRows[pIndex];
        const dateJoined = row[3];

        // --- FIND EMPTY RECRUIT SLOT ---
        const recruitRows = await getRows(sheets, spreadsheetId, SHEETS.RECRUITS);
        let empty = recruitRows.findIndex(r => !r[1] || r[1] === "N/A");

        if (empty === -1) return "❌ No empty recruit slot.";

        const rRow = empty + 1;

        // --- INSERT INTO RECRUITS ---
        await updateRow(
            sheets,
            spreadsheetId,
            `${SHEETS.RECRUITS}!B${rRow}:D${rRow}`,
            [username, newRank, dateJoined]
        );

        // --- RESET PLACEMENT ---
        await updateRow(
            sheets,
            spreadsheetId,
            `${SHEETS.PLACEMENTS}!B${pIndex + 1}:G${pIndex + 1}`,
            ["N/A", "PHASE1", "01/01/2026", "FALSE", 0, "FALSE"]
        );

        // --- ROLES ---
        if (newRank === "Jet Recruit") {
            await addRoles(member, ROLES.JET_RECRUIT_ADD);
        } else {
            await addRoles(member, ROLES.FLAME_RECRUIT_ADD);
        }

        await removeRoles(member, ROLES.RECRUIT_REMOVE);

        // --- WELCOME MESSAGE ---
        const channel = interaction.guild.channels.cache.get(WELCOME_CHANNEL);

        if (channel) {
            await channel.send(`
<@${member.id}>

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
> -# FN Trooper Corps
`);
        }

        if (webhook) {
            await webhook.send(`📥 ${username} → ${newRank}`);
        }

        return `✅ ${username} promoted to ${newRank}`;
    }

    // ============================
    // RECRUIT → TROOPER
    // ============================
    const recruitRows = await getRows(sheets, spreadsheetId, SHEETS.RECRUITS);
    let rIndex = recruitRows.findIndex(r => normalize(r[1]) === clean);

    if (rIndex === -1) return "❌ User not in recruits.";

    const recruitRow = recruitRows[rIndex];
    const dateJoined = recruitRow[3];

    if (newRank === "Jet Trooper" || newRank === "Flame Trooper") {

        const targetSheet = newRank === "Jet Trooper" ? SHEETS.JET : SHEETS.FLAME;

        const targetRows = await getRows(sheets, spreadsheetId, targetSheet);
        let empty = targetRows.findIndex(r => !r[1] || r[1] === "N/A");

        if (empty === -1) return "❌ No empty slot.";

        const tRow = empty + 1;

        // --- MOVE TO COMPANY ---
        await updateRow(
            sheets,
            spreadsheetId,
            `${targetSheet}!B${tRow}:I${tRow}`,
            ["N/A", "", "", dateJoined, "", "", "", "TRUE"]
        );

        // --- RESET RECRUIT ---
        await updateRow(
            sheets,
            spreadsheetId,
            `${SHEETS.RECRUITS}!B${rIndex + 1}:H${rIndex + 1}`,
            ["N/A", "N/A", "01/01/2026", 0, "FALSE", 0, "FALSE"]
        );

        // --- ROLES ---
        if (newRank === "Jet Trooper") {
            await addRoles(member, ROLES.JET_TROOPER_ADD);
            await removeRoles(member, ROLES.JET_TROOPER_REMOVE);
        } else {
            await addRoles(member, ROLES.FLAME_TROOPER_ADD);
            await removeRoles(member, ROLES.FLAME_TROOPER_REMOVE);
        }

        if (webhook) {
            await webhook.send(`🚀 ${username} → ${newRank}`);
        }

        return `✅ ${username} promoted to ${newRank}`;
    }

    return "❌ Invalid rank.";
}

module.exports = { transferUser };