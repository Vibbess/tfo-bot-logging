const { google } = require('googleapis');
const { TABS } = require('./config');

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function normalizeName(name) {
    if (!name) return "";
    return name.toString().split('|')[0].trim().replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
}

function extractNames(text) {
    if (!text) return [];
    return text.split(/[,\s\n\t|]+/).map(n => normalizeName(n)).filter(n => n.length > 2);
}

async function modCell(sheets, spreadsheetId, tab, row, col, valToAdd, isBoolean = false) {
    const range = `${tab}!${col}${row}`;
    await sleep(500); 
    try {
        if (isBoolean) {
            await sheets.spreadsheets.values.update({
                spreadsheetId, range, valueInputOption: 'USER_ENTERED',
                requestBody: { values: [["TRUE"]] }
            });
            return `[${col}${row}]: -> TRUE`;
        } else {
            const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
            const oldVal = parseFloat(res.data.values ? res.data.values[0][0] : 0) || 0;
            const newVal = oldVal + valToAdd;
            await sheets.spreadsheets.values.update({
                spreadsheetId, range, valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[newVal]] }
            });
            return `[${col}${row}]: ${oldVal} -> ${newVal}`;
        }
    } catch (e) { return `Err ${col}${row}`; }
}

async function processLog(auth, spreadsheetId, input, executorPing, webhook) {
    const sheets = google.sheets({ version: 'v4', auth });
    const fullText = input.toLowerCase();
    const isWeekend = fullText.includes("weekend: true");
    const isTryout = fullText.includes("general tryout");

    const eventName = (input.match(/Event:\s*([^.\n|]+)/i) || [])[1]?.trim() || "";
    const host = normalizeName((input.match(/Host(?:ed by)?:\s*([^|\n]+)/i) || [])[1]);
    const co_hosts = extractNames((input.match(/Co-host(?:s)?:\s*([\s\S]*?)(?=Attendees:|Passed:|Notes:|$)/i) || [])[1]);
    const attendees = extractNames((input.match(/Attendees:\s*([\s\S]*?)(?=Passed:|Notes:|Proof:|$)/i) || [])[1]);
    
    // Time log parse logic
    const timeMatch = input.match(/time\s*in-game:\s*(\d+)/i);
    const timeInGame = timeMatch ? parseInt(timeMatch[1]) : 0;

    const users = [];
    if (host) users.push({ name: host, role: 'Host' });
    co_hosts.forEach(n => users.push({ name: n, role: 'Co-Host' }));
    attendees.forEach(n => users.push({ name: n, role: 'Attendee' }));

    const reportEntries = [];

    // Cache to prevent quota hits
    const cache = {};
    for (const tab of Object.values(TABS)) {
        try {
            const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:C200` });
            cache[tab] = (res.data.values || []).map(row => normalizeName(row[1])); // Assuming B is username
            await sleep(400);
        } catch (e) { cache[tab] = []; }
    }

    for (const user of users) {
        let foundAny = false;
        let changeLogs = [];
        
        for (const [tabName, names] of Object.entries(cache)) {
            const rowIndex = names.indexOf(user.name);
            if (rowIndex === -1) continue;
            foundAny = true;
            const rowNum = rowIndex + 1;
            let changes = [];

            // RECRUITS logic
            if (tabName === TABS.RECRUITS && user.role === 'Attendee') {
                if (eventName.toLowerCase().includes("patrol")) changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'E', 1));
                if (eventName.toLowerCase().includes("physical training") || eventName.toLowerCase().includes("pt")) {
                    changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'F', 0, true)); // Set F to true
                }
            }

            // FLAMETROOPER / JETPACK logic
            if ((tabName === TABS.FLAMETROOPER || tabName === TABS.JETPACK) && user.role === 'Attendee') {
                changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'E', 1));
                changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'F', 1));
                if (timeInGame > 0) changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'G', timeInGame));
            }

            // TRYOUT LOGIC (DIVISIONAL STAFF / HIGH COMMAND)
            if (isTryout) {
                if (tabName === TABS.DIVISIONAL_STAFF) {
                    if (user.role === 'Host') {
                        const pts = isWeekend ? 2 : 1;
                        changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'G', pts));
                        changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'K', pts));
                    } else if (user.role === 'Co-Host') {
                        const pts = isWeekend ? 1 : 0.5;
                        changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'G', pts)); // Assume they get same category points 
                    }
                }
                if (tabName === TABS.HIGH_COMMAND) {
                    if (user.role === 'Host') {
                        const pts = isWeekend ? 2 : 1;
                        changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'G', pts));
                        changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'H', pts));
                    } else if (user.role === 'Co-Host') {
                        const pts = isWeekend ? 1 : 0.5;
                        changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'G', pts));
                    }
                }
            } else {
                // OTHER EVENTS (General Host / Attendee Points)
                if (user.role === 'Host') {
                    const pts = isWeekend ? 2 : 1;
                    changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'F', pts));
                    changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'H', pts));
                } else if (user.role === 'Co-Host') {
                    const pts = isWeekend ? 1 : 0.5;
                    changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'F', pts));
                } else if (user.role === 'Attendee') {
                    // +1 Event point universally if not covered by specific divisional logic above
                    if (tabName !== TABS.RECRUITS && tabName !== TABS.FLAMETROOPER && tabName !== TABS.JETPACK) {
                        changes.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'E', 1)); // Generic event column
                    }
                }
            }

            if (changes.length > 0) changeLogs.push(`**${user.name}** (${tabName}): ${changes.join(', ')}`);
        }
        if (foundAny && changeLogs.length > 0) reportEntries.push(changeLogs.join('\n'));
    }

    const finalResult = reportEntries.length > 0 ? reportEntries.join('\n') : "✅ Logged successfully, but no matching rows modified.";
    if (webhook) await webhook.send({ content: `**Log by ${executorPing}**\n${finalResult}` });
    return finalResult;
}

module.exports = { processLog };