const { google } = require('googleapis');
const { ROLES, TABS } = require('./config');

function getTodayDate() { const d = new Date(); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }

// Helper function to sleep (prevents Discord API rate limiting bugs)
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function runBackgroundCheck(robloxUsername, member, status, auth, spreadsheetId, webhook) {
    if (status !== 'pass') {
        if (webhook) await webhook.send({ content: `❌ BGC Failed for ${robloxUsername}.` });
        return `BGC logged as failed for ${robloxUsername}.`;
    }

    const sheets = google.sheets({ version: 'v4', auth });
    let emptyRow = -1;
    
    try {
        // Find empty row in PLACEMENT
        const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TABS.PLACEMENT}!B1:B150` });
        const rows = res.data.values || [];
        
        for (let i = 0; i < 150; i++) {
            const cellValue = rows[i]?.[0];
            if (!cellValue || cellValue.trim() === "" || cellValue === "N/A") {
                emptyRow = i + 1;
                break;
            }
        }

        if (emptyRow === -1) {
            return `❌ Could not find an empty row or an "N/A" slot in the Placement sheet.`;
        }

        // Add to Google Sheets
        await sheets.spreadsheets.values.update({
            spreadsheetId, 
            range: `${TABS.PLACEMENT}!B${emptyRow}:D${emptyRow}`,
            valueInputOption: 'USER_ENTERED', 
            requestBody: { values: [[robloxUsername, "PHASE1", getTodayDate()]] }
        });

    } catch (sheetError) {
        console.error("Sheet update failed:", sheetError);
        return `❌ Failed to update the Placement Sheet: ${sheetError.message}`;
    }

    // Role Logic - Remove first, wait briefly, then Add (Prevents Discord API overrides)
    const rolesToAdd = [ROLES.UNASSIGNED_2, ROLES.REQ_PROMO_ROLE, ROLES.UNASSIGNED_1];
    const rolesToRemove = [ROLES.UNASSIGNED_3];
    
    try {
        if (rolesToRemove.length > 0) {
            await member.roles.remove(rolesToRemove);
        }
        
        await sleep(500); // Wait half a second before adding to ensure Discord registers it
        
        if (rolesToAdd.length > 0) {
            await member.roles.add(rolesToAdd);
        }
    } catch (roleError) {
        console.error("Failed to update BGC roles.", roleError);
        return `⚠️ Added **${robloxUsername}** to Placement row ${emptyRow}, but failed to fully update Discord roles. Double check bot permissions.`;
    }

    if (webhook) await webhook.send({ content: `✅ **BGC Passed** for ${robloxUsername}. Added to Placement sheet.` });
    return `✅ BGC Passed. Added ${robloxUsername} to Placement row ${emptyRow} and updated roles.`;
}

module.exports = { runBackgroundCheck };