const { google } = require('googleapis');

// --- CONFIG ---
const MAIN_SHEET_ID = "1u3GspLjvQybVx4mFOd_8pxmppCHzvL2W_GFh3xp3T7o";

/**
 * Normalizes usernames for consistent sheet matching.
 */
function normalizeName(name) {
    if (!name) return "";
    return name.toString()
        .split('|')[0]
        .trim()
        .replace(/[@\(\)]/g, "")
        .replace(/[^\w\d_]+/g, "")
        .toLowerCase();
}

/**
 * Extracts multiple usernames from a block of text.
 */
function extractNames(text) {
    if (!text || /^(N\/?A|None|No attendees|No one)\.?$/i.test(text.trim())) return [];
    return text.split(/[,\s\n\t|]+/)
        .map(n => normalizeName(n))
        .filter(n => n && n.length > 2);
}

/**
 * Helper to increment a numeric cell value
 */
async function updateCell(sheets, spreadsheetId, tab, range, valToAdd) {
    try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!${range}` });
        const oldVal = parseFloat(res.data.values?.[0]?.[0]) || 0;
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${tab}!${range}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[oldVal + valToAdd]] }
        });
    } catch (e) {
        console.error(`Error updating ${tab}!${range}:`, e.message);
    }
}

/**
 * TIMELOG COMMAND
 * Updates Column G (In-game Time) on Company Sheets
 */
async function processTimeLog(auth, input, executorPing, webhook) {
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Parse Input: Expects "Username: Hours" or similar
    // Example: "JohnDoe: 5"
    const lines = input.split('\n');
    let results = [];

    const tabs = ["FLAMETROOPER COMPANY", "JETPACK COMPANY"];

    for (const line of lines) {
        const parts = line.split(':');
        if (parts.length < 2) continue;

        const username = normalizeName(parts[0]);
        const hours = parseFloat(parts[1]) || 0;

        for (const tab of tabs) {
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${tab}!B:B` });
            const rows = res.data.values || [];
            const idx = rows.findIndex(r => normalizeName(r[0]) === username);

            if (idx !== -1) {
                await updateCell(sheets, MAIN_SHEET_ID, tab, `G${idx + 1}`, hours);
                results.push(`**${username}** (${tab}): +${hours} hours`);
            }
        }
    }

    if (webhook && results.length > 0) {
        await webhook.send({
            embeds: [{
                title: "Time Log Processed",
                description: results.join('\n'),
                color: 0x2ecc71,
                footer: { text: `Logged by ${executorPing}` }
            }]
        });
    }

    return results.length > 0 ? `✅ Logged time for ${results.length} users.` : "❌ No matching users found.";
}

/**
 * EVENT / SSU LOGGING
 */
async function processLog(auth, spreadsheetId, input, isWeekend, executorPing, webhook) {
    const sheets = google.sheets({ version: 'v4', auth });
    
    const eventType = (input.match(/Event:\s*([^|\n]+)/i) || [])[1] || "General";
    const rawHost = (input.match(/Host:\s*([^|\n]+)/i) || [])[1];
    const rawCoHosts = (input.match(/Co-hosts:\s*([^|\n]+)/i) || [])[1];
    const rawAttendees = (input.match(/Attendees:\s*([\s\S]*?)(?=Notes:|Proof:|$)/i) || [])[1];
    
    const data = {
        host: normalizeName(rawHost),
        coHosts: extractNames(rawCoHosts),
        attendees: extractNames(rawAttendees),
        isWeekend: isWeekend === true || isWeekend === "true",
        eventType: eventType.trim()
    };

    const tabsToLoad = ["💂RECRUITS", "FLAMETROOPER COMPANY", "JETPACK COMPANY", "DIVISIONAL STAFF", "HIGH COMMAND"];
    const sheetData = {};

    for (const tab of tabsToLoad) {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${tab}!A:K` });
        sheetData[tab] = res.data.values || [];
    }

    let logResults = [];

    // --- ATTENDEE LOGIC ---
    for (const username of data.attendees) {
        // Recruits Tab
        let recruitIdx = sheetData["💂RECRUITS"].findIndex(r => normalizeName(r[1]) === username);
        if (recruitIdx !== -1) {
            const row = recruitIdx + 1;
            if (data.eventType.toLowerCase().includes("patrol")) {
                await updateCell(sheets, MAIN_SHEET_ID, "💂RECRUITS", `E${row}`, 1);
                logResults.push(`${username}: +1 Patrol Point`);
            }
            if (data.eventType.toLowerCase().includes("pt") || data.eventType.toLowerCase().includes("physical")) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: MAIN_SHEET_ID, range: `💂RECRUITS!F${row}`,
                    valueInputOption: 'USER_ENTERED', requestBody: { values: [["TRUE"]] }
                });
                logResults.push(`${username}: PT marked TRUE`);
            }
        }

        // Company Tabs
        for (const tab of ["FLAMETROOPER COMPANY", "JETPACK COMPANY"]) {
            let divIdx = sheetData[tab].findIndex(r => normalizeName(r[1]) === username);
            if (divIdx !== -1) {
                const row = divIdx + 1;
                await updateCell(sheets, MAIN_SHEET_ID, tab, `E${row}`, 1); // Event Pts
                await updateCell(sheets, MAIN_SHEET_ID, tab, `F${row}`, 1); // Weekly Pts
                logResults.push(`${username} (${tab}): +1 Point`);
            }
        }
    }

    // --- HOST LOGIC ---
    const hostPts = data.isWeekend ? 2 : 1;
    const coHostPts = data.isWeekend ? 1 : 0.5;

    const staff = [
        { names: [data.host], pts: hostPts, type: 'host' },
        { names: data.coHosts, pts: coHostPts, type: 'cohost' }
    ];

    for (const group of staff) {
        for (const name of group.names) {
            if (!name) continue;
            // Divisional Staff (G & K)
            let sIdx = sheetData["DIVISIONAL STAFF"].findIndex(r => normalizeName(r[1]) === name);
            if (sIdx !== -1) {
                await updateCell(sheets, MAIN_SHEET_ID, "DIVISIONAL STAFF", `G${sIdx + 1}`, group.pts);
                await updateCell(sheets, MAIN_SHEET_ID, "DIVISIONAL STAFF", `K${sIdx + 1}`, group.pts);
            }
            // High Command (G & H)
            let hIdx = sheetData["HIGH COMMAND"].findIndex(r => normalizeName(r[1]) === name);
            if (hIdx !== -1 && group.type === 'host') {
                await updateCell(sheets, MAIN_SHEET_ID, "HIGH COMMAND", `G${hIdx + 1}`, group.pts);
                await updateCell(sheets, MAIN_SHEET_ID, "HIGH COMMAND", `H${hIdx + 1}`, group.pts);
            }
        }
    }

    if (webhook) {
        await webhook.send({
            embeds: [{
                title: `Log: ${data.eventType}`,
                description: `**Host:** ${data.host}\n**Weekend:** ${data.isWeekend}\n\n**Updates:**\n${logResults.join('\n') || "No members found."}`,
                color: 0x3498db
            }]
        });
    }

    return `✅ Logged ${data.eventType}.`;
}

module.exports = { processLog, processTimeLog };