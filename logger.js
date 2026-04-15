const { google } = require('googleapis');
const cfg = require('./config');

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

/**
 * Normalizes usernames for consistent sheet searching
 */
function normalizeName(name) {
    if (!name) return "";
    let n = name.toString().split('|')[0].trim().normalize('NFKC');
    return n.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase().trim();
}

/**
 * Extracts usernames from a block of text
 */
function extractNames(text) {
    if (!text || /^(N\/?A|None|No attendees|No one)\.?$/i.test(text.trim())) return [];
    return text.split(/[,\s\n\t|]+/).map(n => normalizeName(n)).filter(n => n.length > 2);
}

/**
 * Updates a cell value by adding a number or setting a boolean string
 */
async function modCell(sheets, spreadsheetId, tab, row, col, val) {
    if (!col || !row) return "Skip";
    const range = `${tab}!${col}${row}`;
    await sleep(400); // Prevents hitting Google API rate limits

    try {
        // Handle Boolean assignments (e.g., Physical Training = TRUE)
        if (typeof val === 'string' && (val === "TRUE" || val === "FALSE")) {
            await sheets.spreadsheets.values.update({
                spreadsheetId, range, valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[val]] }
            });
            return `[${col}${row}]: -> ${val}`;
        }

        // Handle additive numeric values
        const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        const oldVal = parseFloat(res.data.values ? res.data.values[0][0] : 0) || 0;
        const newVal = oldVal + parseFloat(val);
        await sheets.spreadsheets.values.update({
            spreadsheetId, range, valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[newVal]] }
        });
        return `[${col}${row}]: ${oldVal} -> ${newVal}`;
    } catch (e) {
        if (e.message.includes("quota")) { await sleep(5000); return "⚠️ Quota Hit"; }
        return `Err ${col}${row}`;
    }
}

/**
 * Main function to parse logs and distribute points/time
 */
async function processLog(auth, spreadsheetId, command, input) {
    const sheets = google.sheets({ version: 'v4', auth });
    const fullText = input.toLowerCase();
    
    // Extract Metadata injected by index.js
    const isWeekend = fullText.includes("weekend: true");
    const typeMatch = input.match(/Event:\s*([^.\n|]+)/i);
    const eventType = typeMatch ? typeMatch[1].trim() : "Event";

    let data = { host: "", co_hosts: [], attendees: [], minutes: 0, isWeekend };

    if (command === "timelog") {
        const nameMatch = input.match(/Username:\s*([a-zA-Z0-9_]+)/i);
        const timeMatch = input.match(/Time in-game:\s*(\d+)/i);
        data.host = nameMatch ? normalizeName(nameMatch[1]) : "";
        data.minutes = timeMatch ? parseInt(timeMatch[1]) : 0;
    } else {
        // Parse Standard Event/Tryout Formats
        data.host = normalizeName((input.match(/Host:\s*([^|\n]+)/i) || [])[1]);
        data.co_hosts = extractNames((input.match(/Co-hosts?:\s*([\s\S]*?)(?=Attendees:|Notes:|Proof:|$)/i) || [])[1]);
        data.attendees = extractNames((input.match(/Attendees:\s*([\s\S]*?)(?=Passed:|Notes:|Proof:|$)/i) || [])[1]);
        
        // Check if time is included in the event log (optional)
        const timeMatch = input.match(/(?:Time in-game|Minutes):\s*(\d+)/i);
        data.minutes = timeMatch ? parseInt(timeMatch[1]) : 0;
    }

    const users = [];
    if (data.host) users.push({ name: data.host, role: 'Host' });
    data.co_hosts.forEach(n => users.push({ name: n, role: 'Co-Host' }));
    data.attendees.forEach(n => users.push({ name: n, role: 'Attendee' }));
    
    const uniqueUsers = Array.from(new Set(users.map(u => JSON.stringify(u)))).map(u => JSON.parse(u));

    // Batch Cache: Get usernames from Col B/C of all relevant sheets
    const sheetCache = {};
    const tabsToSearch = Object.values(cfg.TABS);
    for (const tabName of tabsToSearch) {
        try {
            const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A1:C200` });
            sheetCache[tabName] = (res.data.values || []).map(row => ({
                colB: row[1] ? normalizeName(row[1]) : "",
                colC: row[2] ? normalizeName(row[2]) : ""
            }));
            await sleep(200);
        } catch (e) { sheetCache[tabName] = []; }
    }

    const reportEntries = [];
    for (const user of uniqueUsers) {
        const res = await updateUserWithCache(sheets, spreadsheetId, user.name, eventType, { ...data, role: user.role }, sheetCache);
        reportEntries.push(res);
    }
    return reportEntries.join('\n');
}

async function updateUserWithCache(sheets, spreadsheetId, username, eventType, context, cache) {
    const searchTarget = normalizeName(username);
    let changeLogs = [];
    let foundAny = false;

    const isWeekend = context.isWeekend;
    const isTryout = eventType.toLowerCase().includes("tryout");

    for (const [tabKey, tabName] of Object.entries(cfg.TABS)) {
        const rows = cache[tabName];
        if (!rows) continue;

        // Search Col B or C for the username
        let rowIndex = rows.findIndex(r => r.colB === searchTarget || r.colC === searchTarget);
        if (rowIndex === -1) continue;

        foundAny = true;
        const rowNum = rowIndex + 1;
        let tabChanges = [];

        // 1. Host & Co-Host Logic (Tryouts vs General)
        if (context.role === 'Host' || context.role === 'Co-Host') {
            const multiplier = (context.role === 'Host') ? 1 : 0.5;
            const basePts = (isWeekend ? 2 : 1) * multiplier;

            if (isTryout) {
                if (tabName === cfg.TABS.STAFF) {
                    tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'G', basePts));
                    tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'K', basePts));
                } else if (tabName === cfg.TABS.HIGH_COM) {
                    tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'G', basePts));
                    tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'H', basePts));
                }
            } else {
                // General Event Hosting
                if ([cfg.TABS.STAFF, cfg.TABS.HIGH_COM].includes(tabName)) {
                    tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'F', basePts));
                    tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'H', basePts));
                }
            }
        } 
        
        // 2. Attendee & Time Logic
        if (context.role === 'Attendee' || context.minutes > 0) {
            // Recruits Tab specific rules
            if (tabName === cfg.TABS.RECRUITS) {
                if (eventType.toLowerCase().includes("patrol")) {
                    tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'E', 1));
                }
                if (eventType.toLowerCase().includes("physical training") || eventType.toLowerCase().includes("pt")) {
                    tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'F', "TRUE"));
                }
            } 
            // Jetpack & Flametrooper Company rules
            else if (tabName === cfg.TABS.JETPACK || tabName === cfg.TABS.FLAME) {
                if (context.role === 'Attendee') {
                    tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'E', 1)); // Event Points E
                    tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'F', 1)); // Event Points F
                }
                if (context.minutes > 0) {
                    tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'G', context.minutes)); // Time G
                }
            }
        }

        if (tabChanges.length > 0) {
            changeLogs.push(`**${username}** (${tabName}): ${tabChanges.join(', ')}`);
        }
    }

    return foundAny ? changeLogs.join('\n') : `❌ **${username}**: User not found.`;
}

module.exports = { processLog };