const { google } = require('googleapis');
const { ROLES, TABS } = require('./config');

function getTodayDate() { const d = new Date(); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }

async function runBackgroundCheck(robloxUsername, member, status, auth, spreadsheetId, webhook) {
    if (status !== 'pass') {
        if (webhook) await webhook.send({ content: `❌ BGC Failed for ${robloxUsername}.` });
        return `BGC logged as failed for ${robloxUsername}.`;
    }

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Find empty row in PLACEMENT
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TABS.PLACEMENT}!B1:B150` });
    const rows = res.data.values || [];
    let emptyRow = -1;
    
    for (let i = 0; i < 150; i++) {
        if (!rows[i] || !rows[i][0] || rows[i][0] === "N/A") {
            emptyRow = i + 1;
            break;
        }
    }

    if (emptyRow !== -1) {
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${TABS.PLACEMENT}!B${emptyRow}:D${emptyRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [[robloxUsername, "PHASE1", getTodayDate()]] }
        });

        // Add / Remove Roles
        const rolesToAdd = [ROLES.UNASSIGNED_2, ROLES.REQ_PROMO_ROLE, ROLES.UNASSIGNED_1];
        const rolesToRemove = [ROLES.UNASSIGNED_3];
        
        try {
            if (rolesToAdd.length > 0) await member.roles.add(rolesToAdd);
            if (rolesToRemove.length > 0) await member.roles.remove(rolesToRemove);
        } catch (e) {
            console.error("Failed to update BGC roles.", e);
        }

        if (webhook) await webhook.send({ content: `✅ **BGC Passed** for ${robloxUsername}. Added to Placement sheet.` });
        return `✅ BGC Passed. Added ${robloxUsername} to Placement row ${emptyRow} and updated roles.`;
    } else {
        return `❌ Could not find an empty row in the Placement sheet.`;
    }
}

module.exports = { runBackgroundCheck };