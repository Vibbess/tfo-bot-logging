const { google } = require('googleapis');
const cfg = require('./config');

/**
 * Main function to handle rank changes and sheet transfers
 */
async function transferUser(auth, spreadsheetId, interaction, logChannel) {
    const sheets = google.sheets({ version: 'v4', auth });
    
    const robloxName = interaction.options.getString('robloxusername');
    const targetMember = interaction.options.getMember('discorduser');
    const oldRank = interaction.options.getString('current_rank').toUpperCase();
    const newRank = interaction.options.getString('new_rank').toUpperCase();

    const sourceTab = getTabFromRank(oldRank);
    const targetTab = getTabFromRank(newRank);

    if (!sourceTab || !targetTab) {
        return `❌ Invalid Rank: ${oldRank} -> ${newRank}`;
    }

    try {
        const sourceRange = `${sourceTab}!A1:Z300`;
        const getRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: sourceRange });
        const rows = getRes.data.values || [];
        
        const colMap = cfg.SHEETS_MAP[sourceTab];
        const userColIdx = colMap.userCol.charCodeAt(0) - 65;
        
        const rowIndex = rows.findIndex(row => 
            row[userColIdx] && row[userColIdx].toLowerCase() === robloxName.toLowerCase()
        );

        if (rowIndex === -1) {
            return `❌ User **${robloxName}** not found on **${sourceTab}**.`;
        }

        const userData = rows[rowIndex];
        const rowNum = rowIndex + 1;

        // 1. Update Discord Roles
        await updateDiscordRoles(targetMember, oldRank, newRank);

        // 2. Handle Logic based on Transfer Type
        
        // CASE A: Phase 1 -> Phase 2 (Stay on RECRUITS)
        if (oldRank === "PLACEMENT PHASE ONE" && newRank === "PLACEMENT PHASE TWO") {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sourceTab}!C${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[newRank]] }
            });
        } 
        
        // CASE B: Moving from RECRUITS to a Company
        else if (sourceTab === cfg.TABS.RECRUITS && sourceTab !== targetTab) {
            // Append to New Sheet
            await appendToTarget(sheets, spreadsheetId, targetTab, robloxName, newRank, userData);
            // Wipe the Recruit Row (B=N/A, C=N/A, D=01/01/2026, E=0, F="", G=FALSE, H=0, I=FALSE)
            const wipeRow = ["N/A", "N/A", "01/01/2026", "0", "", "FALSE", "0", "FALSE"];
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sourceTab}!B${rowNum}:I${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [wipeRow] }
            });
        }

        return `✅ Successfully ranked **${robloxName}** to **${newRank}**.`;

    } catch (err) {
        console.error(err);
        return `❌ Error: ${err.message}`;
    }
}

async function appendToTarget(sheets, spreadsheetId, targetTab, name, rank, oldData) {
    const originalDate = oldData[3] || "N/A"; // Column D (Index 3)
    // Row Format for Companies: [ID(A), Name(B), Rank(C), Date(D), ...rest]
    const newRow = ["", name, rank, originalDate];

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${targetTab}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] }
    });
}

async function updateDiscordRoles(member, oldRank, newRank) {
    const r = newRank.toUpperCase();

    // 1. Phase 1 -> Phase 2
    if (r === "PLACEMENT PHASE TWO") {
        await member.roles.add("1498050747240284287"); // Phase 2
        await member.roles.remove("1498050747240284286"); // Phase 1
    }

    // 2. Company Transfers
    const removals = ["1498050747240284290", "1498050747240284287", "1498050747240284285"];

    if (r === "SNOWTROOPER") {
        await member.roles.remove(removals);
        await member.roles.add(["1498050747340951794", "1498050747340951788", "1498050747340951789"]);
    } 
    else if (r === "ICEGUARD TROOPER") {
        await member.roles.remove(removals);
        await member.roles.add(["1498050747307393025", "1498050747286163679", "1498050747286163678"]);
    } 
    else if (r === "HAILSTORM TROOPER") {
        await member.roles.remove(removals);
        await member.roles.add(["1498050747340951787", "1498050747307393027", "1498050747307393026"]);
    }
}

function getTabFromRank(rank) {
    const r = rank.toUpperCase();
    if (r.includes("PLACEMENT")) return cfg.TABS.RECRUITS;
    if (r === "SNOWTROOPER") return cfg.TABS.SNOWTROOPER;
    if (r === "ICEGUARD TROOPER") return cfg.TABS.ICEGUARD;
    if (r === "HAILSTORM TROOPER") return cfg.TABS.HAILSTORM;
    return null; 
}

module.exports = { transferUser };