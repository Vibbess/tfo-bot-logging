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

    // 1. Determine Source and Target Tabs
    const sourceTab = getTabFromRank(oldRank);
    const targetTab = getTabFromRank(newRank);

    if (!sourceTab || !targetTab) {
        return `❌ Could not determine sheet tabs for ranks: ${oldRank} -> ${newRank}`;
    }

    try {
        // 2. Find the user in the source sheet
        const sourceRange = `${sourceTab}!A1:Z200`;
        const getRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: sourceRange });
        const rows = getRes.data.values || [];
        
        const colMap = cfg.SHEETS_MAP[sourceTab];
        const userColIdx = colMap.userCol.charCodeAt(0) - 65; // Convert 'B' to 1, etc.
        
        const rowIndex = rows.findIndex(row => 
            row[userColIdx] && row[userColIdx].toLowerCase() === robloxName.toLowerCase()
        );

        if (rowIndex === -1) {
            return `❌ User **${robloxName}** not found on the **${sourceTab}** sheet. Check spelling or current rank.`;
        }

        const userData = rows[rowIndex];
        const rowNum = rowIndex + 1;

        // 3. Update Discord Roles first (Safety check)
        await updateDiscordRoles(targetMember, newRank);

        // 4. If moving to a DIFFERENT tab, handle the transfer
        if (sourceTab !== targetTab) {
            await appendToTarget(sheets, spreadsheetId, targetTab, robloxName, newRank, userData, sourceTab);
            await deleteFromSource(sheets, spreadsheetId, sourceTab, rowNum);
        } else {
            // Just updating rank on the same sheet
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

        // 5. Final Logging
        const logEmbed = `**Rank Update**\n**User:** ${robloxName} (${targetMember})\n**Old Rank:** ${oldRank}\n**New Rank:** ${newRank}\n**Sheet:** ${sourceTab} ➡️ ${targetTab}`;
        if (logChannel) logChannel.send(logEmbed);

        return `✅ Successfully ranked **${robloxName}** to **${newRank}**.`;

    } catch (err) {
        console.error(err);
        return `❌ Critical Error during ranking: ${err.message}`;
    }
}

/**
 * Helper to identify which Sheet Tab a rank belongs to
 */
function getTabFromRank(rank) {
    const r = rank.toUpperCase();
    if (r === "PLACEMENT") return cfg.TABS.PLACEMENT;
    if (r.includes("RECRUIT") || r === "PVT") return cfg.TABS.RECRUITS;
    
    // Check if it's a Jet or Flame specific rank
    // This logic assumes you know which company they are in via the command or a lookup
    // For now, we'll check common keywords
    if (r.includes("JET")) return cfg.TABS.JETPACK;
    if (r.includes("FLAME")) return cfg.TABS.FLAME;
    
    // Default fallback: If it's a standard rank, we assume they stay in their current company
    // You might need to adjust this if ranks aren't prefixed
    return null; 
}

/**
 * Handles the actual row deletion from the old sheet
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

/**
 * Prepares data and appends it to the bottom of the new sheet
 */
async function appendToTarget(sheets, spreadsheetId, targetTab, name, rank, oldData, sourceTab) {
    let newRow = [];
    const now = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY

    if (targetTab === cfg.TABS.RECRUITS) {
        // [Empty, Name, Rank, Date, Points, PT, Notes, Inact]
        newRow = ["", name, rank, now, 0, "FALSE", "", "FALSE"];
    } 
    else if (targetTab === cfg.TABS.JETPACK || targetTab === cfg.TABS.FLAME) {
        // Carry over name, set rank/date, reset points
        newRow = ["", name, rank, now, 0, 0, 0, "", "FALSE"];
    }

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${targetTab}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] }
    });
}

/**
 * Manages Discord Role swapping
 */
/**
 * Manages Discord Role swapping by clearing old ranks and adding new ones
 */
async function updateDiscordRoles(member, newRank) {
    const r = newRank.toUpperCase();

    // 1. Gather ALL rank-related roles from config into one flat array
    // This allows us to "clean" the user of any existing divisional ranks.
    const allRankRoles = [
        ...Object.values(cfg.JET_ROLES).flat(),
        ...Object.values(cfg.FLAME_ROLES).flat(),
        cfg.GENERAL_ROLES.PHASE_TWO,
        ...cfg.GENERAL_ROLES.BGC_PASS,
        cfg.GENERAL_ROLES.PHASE_ONE_REMOVE
    ];

    // 2. Identify which of those roles the user currently has
    const rolesToRemove = member.roles.cache
        .filter(role => allRankRoles.includes(role.id))
        .map(role => role.id);

    try {
        // 3. Strip existing ranks (prevents role stacking)
        if (rolesToRemove.length > 0) {
            await member.roles.remove(rolesToRemove);
        }

        // 4. Handle Phase Transfers
        if (r === "PHASE 2") {
            await member.roles.add(cfg.GENERAL_ROLES.PHASE_TWO);
            // We don't need to manually remove Phase 1 because it's in our "clean" list above
        }

        // 5. Handle Jetpack Company Ranks
        if (r.includes("JET")) {
            if (r.includes("RECRUIT")) await member.roles.add(cfg.JET_ROLES.RECRUIT);
            else if (r.includes("TROOPER")) await member.roles.add(cfg.JET_ROLES.TROOPER);
            else if (r.includes("SENIOR")) await member.roles.add(cfg.JET_ROLES.SENIOR);
            else if (r.includes("VETERAN")) await member.roles.add(cfg.JET_ROLES.VETERAN);
            else if (r.includes("SPECIALIST")) await member.roles.add(cfg.JET_ROLES.SPECIALIST);
            else if (r.includes("CORPORAL")) await member.roles.add(cfg.JET_ROLES.CORPORAL);
        }

        // 6. Handle Flame Company Ranks
        if (r.includes("FLAME")) {
            if (r.includes("RECRUIT")) await member.roles.add(cfg.FLAME_ROLES.RECRUIT);
            else if (r.includes("TROOPER")) await member.roles.add(cfg.FLAME_ROLES.TROOPER);
            else if (r.includes("SENIOR")) await member.roles.add(cfg.FLAME_ROLES.SENIOR);
            else if (r.includes("VETERAN")) await member.roles.add(cfg.FLAME_ROLES.VETERAN);
            else if (r.includes("SPECIALIST")) await member.roles.add(cfg.FLAME_ROLES.SPECIALIST);
            else if (r.includes("CORPORAL")) await member.roles.add(cfg.FLAME_ROLES.CORPORAL);
        }

    } catch (err) {
        console.error(`Failed to update roles for ${member.user.tag}:`, err);
    }
}

module.exports = { transferUser };