const { google } = require('googleapis');
const cfg = require('./config');

/**
 * Utility to get the next Saturday's date for inactivity notes
 */
function getNextSaturday(weeksOut = 1) {
    const today = new Date();
    const resultDate = new Date(today);
    const daysUntilSat = (6 - today.getDay() + 7) % 7 || 7;
    resultDate.setDate(today.getDate() + daysUntilSat + ((weeksOut - 1) * 7));
    return `${resultDate.getMonth() + 1}/${resultDate.getDate()}/${resultDate.getFullYear()}`;
}

/**
 * Main Transfer and Ranking Logic
 */
async function transferUser(auth, spreadsheetId, robloxUser, discordMember, currentRank, newRank) {
    const sheets = google.sheets({ version: 'v4', auth });

    // --- 1. PLACEMENT: PHASE 1 TO PHASE 2 ---
    if (currentRank === "Placement Phase One" && newRank === "Placement Phase Two") {
        const res = await sheets.spreadsheets.values.get({ 
            spreadsheetId, 
            range: `${cfg.TABS.PLACEMENT}!A1:F500` 
        });
        const rows = res.data.values || [];
        // Per your request: check username in Column C (Index 2)
        const rowIndex = rows.findIndex(r => r[2] && r[2].toLowerCase() === robloxUser.toLowerCase());

        if (rowIndex === -1) return `❌ User **${robloxUser}** not found in Column C of Placement sheet.`;

        // Check score in Column B (Index 1)
        const score = parseInt(rows[rowIndex][1] || 0);
        const rowNum = rowIndex + 1;

        if (score >= 7) {
            // Update Column C to PHASE2
            await sheets.spreadsheets.values.update({
                spreadsheetId, range: `${cfg.TABS.PLACEMENT}!C${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [["PHASE2"]] }
            });
            // Update Discord Roles
            await discordMember.roles.add(cfg.PHASE_TWO_ROLE);
            await discordMember.roles.remove(cfg.PHASE_ONE_ROLE);
            return `✅ **${robloxUser}** passed! Moved to Phase 2 on sheet and Discord.`;
        } else {
            // Fail logic: Add +1 to Column F (Index 5)
            const currentF = parseInt(rows[rowIndex][5] || 0);
            await sheets.spreadsheets.values.update({
                spreadsheetId, range: `${cfg.TABS.PLACEMENT}!F${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[currentF + 1]] }
            });
            return `⚠️ **${robloxUser}** score was ${score} (Needs 7). Added +1 fail to Column F.`;
        }
    }

    // --- 2. PLACEMENT PHASE 2 -> RECRUITS (JET/FLAME) ---
    if (currentRank === "Placement Phase Two" && (newRank === "Jet Recruit" || newRank === "Flame Recruit")) {
        const res = await sheets.spreadsheets.values.get({ 
            spreadsheetId, 
            range: `${cfg.TABS.PLACEMENT}!B1:D500` 
        });
        const rows = res.data.values || [];
        // Check username in Column B (Index 0 of the range B:D)
        const rowIndex = rows.findIndex(r => r[0] && r[0].toLowerCase() === robloxUser.toLowerCase());
        if (rowIndex === -1) return `❌ **${robloxUser}** not found in Column B of Placement.`;

        const dateJoined = rows[rowIndex][2] || "Unknown"; 
        const rowNum = rowIndex + 1;

        // Find empty slot in RECRUITS where B = "B"
        const recRes = await sheets.spreadsheets.values.get({ 
            spreadsheetId, 
            range: `${cfg.TABS.RECRUITS}!B1:B500` 
        });
        const recRows = recRes.data.values || [];
        const targetRow = recRows.findIndex(r => r[0] === "B") + 1;

        if (targetRow === 0) return "❌ No available 'B' slot found on RECRUITS sheet.";

        // Write to RECRUITS (B=Username, C=Rank, D=DateJoined)
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${cfg.TABS.RECRUITS}!B${targetRow}:D${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[robloxUser, newRank, dateJoined]] }
        });

        // Reset the row in PLACEMENT
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${cfg.TABS.PLACEMENT}!B${rowNum}:G${rowNum}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [["N/A", "PHASE1", "01/01/2026", "FALSE", "0", "FALSE"]] }
        });

        // Discord Roles & Welcome Message handled in index.js for embed formatting
        return { status: "SUCCESS_TO_RECRUIT", user: robloxUser, rank: newRank, date: dateJoined };
    }

    // --- 3. RECRUIT -> TROOPER (JET/FLAME) ---
    if (currentRank.includes("Recruit") && newRank.includes("Trooper")) {
        const isJet = currentRank.includes("Jet");
        const targetTab = isJet ? cfg.TABS.JETPACK : cfg.TABS.FLAME;
        
        const recRes = await sheets.spreadsheets.values.get({ 
            spreadsheetId, 
            range: `${cfg.TABS.RECRUITS}!B1:D500` 
        });
        const recRows = recRes.data.values || [];
        const rowIndex = recRows.findIndex(r => r[0] && r[0].toLowerCase() === robloxUser.toLowerCase());

        if (rowIndex === -1) return `❌ **${robloxUser}** not found on RECRUITS sheet.`;
        const dateJoined = recRows[rowIndex][2];
        const rowNum = rowIndex + 1;

        // Move to Company Sheet (Look for B = "N/A")
        const compRes = await sheets.spreadsheets.values.get({ 
            spreadsheetId, 
            range: `${targetTab}!B1:B500` 
        });
        const compRows = compRes.data.values || [];
        const targetRow = compRows.findIndex(r => r[0] === "N/A") + 1;

        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${targetTab}!B${targetRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [[robloxUser]] }
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${targetTab}!D${targetRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [[dateJoined]] }
        });
        // Set I = TRUE with "New Trooper" note
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${targetTab}!I${targetRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [["TRUE"]] }
        });

        // Reset Recruit Row
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${cfg.TABS.RECRUITS}!B${rowNum}:H${rowNum}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [["N/A", "N/A", "01/01/2026", "0", "FALSE", "0", "FALSE"]] }
        });

        return { status: "SUCCESS_TO_TROOPER", user: robloxUser, type: isJet ? "JET" : "FLAME" };
    }

    return "❌ This rank combination is not currently supported by the automation.";
}

module.exports = { transferUser, getNextSaturday };