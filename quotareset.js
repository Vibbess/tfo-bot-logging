const { google } = require('googleapis');
const { EmbedBuilder } = require('discord.js');
const cfg = require('./config');

// Helper to chunk long arrays of strings into Discord-safe 1024-character strings
function formatList(arr) {
    if (!arr || arr.length === 0) return "None";
    const text = arr.join(', ');
    return text.length > 1024 ? text.substring(0, 1020) + "..." : text;
}

// Parses "Due Date: DD/MM/YYYY" to check if it has expired (<= today)
function isINExpired(note) {
    if (!note) return false;
    const match = note.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return false;
    const [_, d, m, y] = match;
    const dueDate = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate <= today;
}

// Google Sheets payload helpers
const updateCell = (sheetId, r, c, value, isBool = false, note = undefined) => {
    const valObj = isBool ? { boolValue: value } : (typeof value === 'string' ? { stringValue: value } : { numberValue: value });
    const cellData = { userEnteredValue: valObj };
    let fields = 'userEnteredValue';
    
    if (note !== undefined) {
        cellData.note = note;
        fields += ',note';
    }

    return {
        updateCells: {
            range: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: c, endColumnIndex: c + 1 },
            rows: [{ values: [cellData] }],
            fields
        }
    };
};

async function runQuotaReset(auth, spreadsheetId, client, interaction) {
    const sheetsApi = google.sheets({ version: 'v4', auth });

    // Lists for the final report
    const lists = {
        passed: [], failedOnce: [], failedTwice: [], inRemoved: [], recruitsReady: []
    };

    const stats = {
        snow: 0, ice: 0, hail: 0,
        topPersonnel: { name: "N/A", score: -1 },
        topOfficer: { name: "N/A", score: -1 }
    };

    const updateRequests = [];

    // 1. Fetch all sheets with gridData to access Checkboxes (boolValue) and Notes
    const response = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        includeGridData: true,
        ranges: [
            `${cfg.TABS.RECRUITS}!A:L`, 
            `${cfg.TABS.SNOWTROOPER}!A:L`, 
            `${cfg.TABS.ICEGUARD}!A:L`, 
            `${cfg.TABS.HAILSTORM}!A:L`, 
            `${cfg.TABS.STAFF}!A:L`
        ]
    });

    const sheetsData = response.data.sheets;

    for (const sheet of sheetsData) {
        const title = sheet.properties.title;
        const sheetId = sheet.properties.sheetId;
        const rows = sheet.data[0].rowData || [];

        // Skip header rows (assuming row 0 is headers)
        for (let r = 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || !row.values) continue;

            const getStr = (col) => row.values[col]?.formattedValue || row.values[col]?.userEnteredValue?.stringValue || "";
            const getNum = (col) => row.values[col]?.userEnteredValue?.numberValue || 0;
            const getBool = (col) => row.values[col]?.userEnteredValue?.boolValue || false;
            const getNote = (col) => row.values[col]?.note || "";

            const name = getStr(1); // Col B
            if (!name || name === "N/A" || name.toLowerCase() === "username") continue;

            // --- RECRUITS ---
            if (title === cfg.TABS.RECRUITS) {
                const passed = getBool(9); // Col J
                if (passed) lists.recruitsReady.push(name);
            }

            // --- COMPANIES ---
            else if ([cfg.TABS.SNOWTROOPER, cfg.TABS.ICEGUARD, cfg.TABS.HAILSTORM].includes(title)) {
                const events = getNum(5); // Col F
                const strikes = getNum(7); // Col H
                const hasIN = getBool(8); // Col I
                const note = getNote(8);  // Col I Note
                const passed = getBool(9); // Col J

                // Top Performers Logic
                if (title === cfg.TABS.SNOWTROOPER) stats.snow += events;
                if (title === cfg.TABS.ICEGUARD) stats.ice += events;
                if (title === cfg.TABS.HAILSTORM) stats.hail += events;

                if (events > stats.topPersonnel.score) {
                    stats.topPersonnel = { name, score: events };
                }

                // Reset Logic
                if (passed) {
                    lists.passed.push(`${name} (${title.split(' ')[0]})`);
                    updateRequests.push(updateCell(sheetId, r, 5, 0)); // F = 0
                    updateRequests.push(updateCell(sheetId, r, 6, 0)); // G = 0
                } else if (!passed && hasIN) {
                    if (isINExpired(note)) {
                        lists.inRemoved.push(name);
                        updateRequests.push(updateCell(sheetId, r, 8, false, true, "")); // Clear I and Note
                        updateRequests.push(updateCell(sheetId, r, 5, 0)); // F = 0
                        updateRequests.push(updateCell(sheetId, r, 6, 0)); // G = 0
                    }
                } else if (!passed && !hasIN) {
                    const newStrikes = strikes + 1;
                    updateRequests.push(updateCell(sheetId, r, 7, newStrikes)); // +1 to H
                    updateRequests.push(updateCell(sheetId, r, 5, 0)); // F = 0
                    updateRequests.push(updateCell(sheetId, r, 6, 0)); // G = 0

                    if (newStrikes >= 2) lists.failedTwice.push(name);
                    else lists.failedOnce.push(name);
                }
            }

            // --- DIVISIONAL STAFF ---
            else if (title === cfg.TABS.STAFF) {
                const events = getNum(7); // Col H
                const tryouts = getNum(10); // Col K
                const strikes = getNum(9); // Col J
                const hasIN = getBool(8); // Col I
                const note = getNote(8); // Col I Note
                const passed = getBool(11); // Col L

                const officerTotal = events + tryouts;
                if (officerTotal > stats.topOfficer.score) {
                    stats.topOfficer = { name, score: officerTotal };
                }

                // Reset Logic
                if (passed) {
                    lists.passed.push(`${name} (Staff)`);
                    updateRequests.push(updateCell(sheetId, r, 7, 0)); // H = 0
                    updateRequests.push(updateCell(sheetId, r, 10, 0)); // K = 0
                } else if (!passed && hasIN) {
                    if (isINExpired(note)) {
                        lists.inRemoved.push(name);
                        updateRequests.push(updateCell(sheetId, r, 8, false, true, "")); // Clear I and Note
                        updateRequests.push(updateCell(sheetId, r, 7, 0)); // H = 0
                        updateRequests.push(updateCell(sheetId, r, 10, 0)); // K = 0
                    }
                } else if (!passed && !hasIN) {
                    const newStrikes = strikes + 1;
                    updateRequests.push(updateCell(sheetId, r, 9, newStrikes)); // +1 to J
                    updateRequests.push(updateCell(sheetId, r, 7, 0)); // H = 0
                    updateRequests.push(updateCell(sheetId, r, 10, 0)); // K = 0

                    if (newStrikes >= 2) lists.failedTwice.push(`${name} (Staff)`);
                    else lists.failedOnce.push(`${name} (Staff)`);
                }
            }
        }
    }

    // 2. Execute Batch Update to modify sheets
    if (updateRequests.length > 0) {
        await sheetsApi.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: updateRequests }
        });
    }

    // 3. Determine Company of the Week
    let topComp = "Tie / None";
    if (stats.snow > stats.ice && stats.snow > stats.hail) topComp = "Snowtrooper";
    else if (stats.ice > stats.snow && stats.ice > stats.hail) topComp = "Iceguard";
    else if (stats.hail > stats.snow && stats.hail > stats.ice) topComp = "Hailstorm";

    // 4. Construct the Embed Report
    const embed = new EmbedBuilder()
        .setTitle("Weekly Quota Reset Report")
        .setColor(0x3498db)
        .setDescription(`**Snowtrooper Maestro (Top Company):** ${topComp}\n**Personnel of the Week:** ${stats.topPersonnel.name} (${stats.topPersonnel.score} events)\n**Officer of the Week:** ${stats.topOfficer.name} (${stats.topOfficer.score} events/tryouts)`)
        .addFields(
            { name: "Passed Quota", value: formatList(lists.passed) },
            { name: "Failed Once (+1 Strike)", value: formatList(lists.failedOnce) },
            { name: "Failed Twice (Needs Removal)", value: formatList(lists.failedTwice) },
            { name: "Expired INs Removed", value: formatList(lists.inRemoved) },
            { name: "Recruits Need removed", value: formatList(lists.recruitsReady) }
        )
        .setTimestamp();

    // 5. Send to Master Log Channel
    const logChannel = client.channels.cache.get('1498050754559082690');
    if (logChannel) {
        await logChannel.send({ embeds: [embed] });
    } else {
        console.warn("Quota Log Channel 1498050754559082690 not found!");
    }

    // 6. Broadcast to Announcement Channels
    const broadcastMsg = "# ——————————QUOTA RESET———————————";
    const broadcastChannels = [
        '1498050751161962608', 
        '1498050751161962609', 
        '1498050751161962610', 
        '1498050751161962611'
    ];

    for (const chId of broadcastChannels) {
        const ch = client.channels.cache.get(chId);
        if (ch) ch.send(broadcastMsg).catch(() => {});
    }

    return "**Quota Reset Complete.**";
}

module.exports = { runQuotaReset };