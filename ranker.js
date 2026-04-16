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
        return `❌ Could not determine sheet tabs for ranks: ${oldRank} -> ${newRank}`;
    }

    try {
        const sourceRange = `${sourceTab}!A1:Z200`;
        const getRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: sourceRange });
        const rows = getRes.data.values || [];
        
        const colMap = cfg.SHEETS_MAP[sourceTab];
        const userColIdx = colMap.userCol.charCodeAt(0) - 65;
        
        const rowIndex = rows.findIndex(row => 
            row[userColIdx] && row[userColIdx].toLowerCase() === robloxName.toLowerCase()
        );

        if (rowIndex === -1) {
            return `❌ User **${robloxName}** not found on the **${sourceTab}** sheet.`;
        }

        const userData = rows[rowIndex];
        const rowNum = rowIndex + 1;

        // 1. Update Discord Roles (Clears old, adds new)
        await updateDiscordRoles(targetMember, newRank);

        // 2. Handle Sheet Transfer or Update
        if (sourceTab !== targetTab) {
            await appendToTarget(sheets, spreadsheetId, targetTab, robloxName, newRank, userData, sourceTab);
            await deleteFromSource(sheets, spreadsheetId, sourceTab, rowNum);
        } else {
            const rankColIdx = colMap.rankCol ? colMap.rankCol.charCodeAt(0) - 65 : null;
            if (rankColIdx !== null) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `${sourceTab}!${colMap.rankCol}${rowNum}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[newRank]] }
                });
            }
        }

        return `✅ Successfully ranked **${robloxName}** to **${newRank}**.`;

    } catch (err) {
        console.error(err);
        return `❌ Critical Error: ${err.message}`;
    }
}

/**
 * Auto-fills data into the new sheet while preserving history
 */
async function appendToTarget(sheets, spreadsheetId, targetTab, name, rank, oldData, sourceTab) {
    let newRow = [];
    const now = new Date().toLocaleDateString('en-GB');
    const originalDate = oldData[3] || now; // Tries to keep the original join date

    if (targetTab === cfg.TABS.RECRUITS) {
        // [ID, Name, Rank, Date, Points, PT, Notes, Inact]
        newRow = ["", name, rank, originalDate, 0, "FALSE", `Transferred from ${sourceTab}`, "FALSE"];
    } 
    else if (targetTab === cfg.TABS.JETPACK || targetTab === cfg.TABS.FLAME) {
        // [ID, Name, Rank, Date, Pt1, Pt2, Time, Notes, Inact]
        newRow = ["", name, rank, now, 0, 0, 0, `Former ${oldData[2]}`, "FALSE"];
    }

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${targetTab}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] }
    });
}

/**
 * Logic to find and mark inactivity across any sheet
 */
async function issueInactivityNotice(auth, spreadsheetId, robloxName, duration) {
    const sheets = google.sheets({ version: 'v4', auth });
    const tabs = Object.values(cfg.TABS);
    const dateStr = new Date().toLocaleDateString('en-GB');

    for (const tabName of tabs) {
        const colMap = cfg.SHEETS_MAP[tabName];
        if (!colMap) continue;

        const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A1:Z200` });
        const rows = res.data.values || [];
        const userColIdx = colMap.userCol.charCodeAt(0) - 65;
        
        const rowIndex = rows.findIndex(row => 
            row[userColIdx] && row[userColIdx].toLowerCase() === robloxName.toLowerCase()
        );

        if (rowIndex !== -1) {
            const rowNum = rowIndex + 1;
            const inactCol = colMap.inactCol || 'I';
            const notesCol = 'H'; 

            // Update Inactivity Checkbox/Status
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${tabName}!${inactCol}${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [["TRUE"]] }
            });

            // Update Notes
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${tabName}!${notesCol}${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[`[${dateStr}] Inactivity: ${duration}`]] }
            });

            return `Updated on **${tabName}** sheet.`;
        }
    }
    return "⚠️ User not found on any sheet, but Discord role was added.";
}

/**
 * Clears old divisional roles and adds the new rank role
 */
async function updateDiscordRoles(member, newRank) {
    const r = newRank.toUpperCase();
    const allRankRoles = [
        ...Object.values(cfg.JET_ROLES).flat(),
        ...Object.values(cfg.FLAME_ROLES).flat(),
        cfg.GENERAL_ROLES.PHASE_TWO,
        ...cfg.GENERAL_ROLES.BGC_PASS,
        cfg.GENERAL_ROLES.PHASE_ONE_REMOVE
    ];

    const rolesToRemove = member.roles.cache
        .filter(role => allRankRoles.includes(role.id))
        .map(role => role.id);

    if (rolesToRemove.length > 0) await member.roles.remove(rolesToRemove);

    if (r === "PHASE 2") await member.roles.add(cfg.GENERAL_ROLES.PHASE_TWO);

    if (r.includes("JET")) {
        if (r.includes("RECRUIT")) await member.roles.add(cfg.JET_ROLES.RECRUIT);
        else if (r.includes("TROOPER")) await member.roles.add(cfg.JET_ROLES.TROOPER);
        else if (r.includes("SENIOR")) await member.roles.add(cfg.JET_ROLES.SENIOR);
        else if (r.includes("VETERAN")) await member.roles.add(cfg.JET_ROLES.VETERAN);
        else if (r.includes("SPECIALIST")) await member.roles.add(cfg.JET_ROLES.SPECIALIST);
        else if (r.includes("CORPORAL")) await member.roles.add(cfg.JET_ROLES.CORPORAL);
    }

    if (r.includes("FLAME")) {
        if (r.includes("RECRUIT")) await member.roles.add(cfg.FLAME_ROLES.RECRUIT);
        else if (r.includes("TROOPER")) await member.roles.add(cfg.FLAME_ROLES.TROOPER);
        else if (r.includes("SENIOR")) await member.roles.add(cfg.FLAME_ROLES.SENIOR);
        else if (r.includes("VETERAN")) await member.roles.add(cfg.FLAME_ROLES.VETERAN);
        else if (r.includes("SPECIALIST")) await member.roles.add(cfg.FLAME_ROLES.SPECIALIST);
        else if (r.includes("CORPORAL")) await member.roles.add(cfg.FLAME_ROLES.CORPORAL);
    }
}

/**
 * Helper to match Rank Name to Sheet Tab
 */
function getTabFromRank(rank) {
    const r = rank.toUpperCase();
    if (r === "PHASE1" || r === "PHASE2") return cfg.TABS.PLACEMENT;
    if (r.includes("RECRUIT")) return cfg.TABS.RECRUITS;
    if (r.includes("JET")) return cfg.TABS.JETPACK;
    if (r.includes("FLAME")) return cfg.TABS.FLAME;
    return null; 
}

/**
 * Removes the row from the sheet to prevent duplicates
 */
async function deleteFromSource(sheets, spreadsheetId, tabName, rowNum) {
    const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetId = sheetMetadata.data.sheets.find(s => s.properties.title === tabName).properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [{
                deleteDimension: {
                    range: {
                        sheetId: sheetId,
                        dimension: "ROWS",
                        startIndex: rowNum - 1,
                        endIndex: rowNum
                    }
                }
            }]
        }
    });
}

module.exports = { transferUser, issueInactivityNotice, updateDiscordRoles };