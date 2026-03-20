const { google } = require('googleapis');

const TABS_CONFIG = {
    "⭐STAFF TEAM":      { updateCols: ['D', 'G', 'J'], timeCol: 'N' },
    "👑 VULCAN":         { updateCols: ['D', 'F', 'I'], timeCol: 'K' },
    "❄️ BLIZZARD FORCE": { updateCols: ['D', 'F', 'I'], timeCol: 'K' },
    "🔥 WILDFIRE ":      { updateCols: ['D', 'F', 'I'], timeCol: 'K' },
    "🏬TROOPER PLATOON": { updateCols: ['D', 'E', 'G'], timeCol: 'I' },
    "💂RECRUITS":        { updateCols: ['D', 'E', 'F'], timeCol: 'G' }
};

// --- UTILITIES ---
function normalizeName(name) {
    if (!name) return "";
    let n = name.toString().split('|')[0].trim().normalize('NFKC');
    const fancyMap = { 
        '𝔸': 'A', 'ℕ': 'N', '𝕖': 'e', '𝕣': 'r', '𝕗': 'f', '𝕓': 'b', '𝕠': 'o', '𝕪': 'y', '𝕊': 'S', '𝟙': '1', '𝟛': '3', '𝟘': '0', 
        '𝐚': 'a', '𝐛': 'b', '𝐀': 'A', '𝐁': 'B', '𝕛': 'j', '𝐆': 'G', '𝐌': 'M', '𝑇': 'T', '𝑤': 'w', '𝒊': 'i', '𝒕': 't', '𝒉': 'h'
    };
    for (let key in fancyMap) n = n.replace(new RegExp(key, 'g'), fancyMap[key]);
    return n.replace(/\s*\(.*\)/g, '').replace(/@/g, '').replace(/[^\w\d_]+/g, "").toLowerCase().trim();
}

function extractNames(text) {
    if (!text || /^(N\/?A|None|No attendees|No one)\.?$/i.test(text.trim())) return [];
    const TZ = ['est', 'edt', 'cst', 'cdt', 'mst', 'mdt', 'pst', 'pdt', 'gmt', 'bst', 'utc', 'aest', 'gmt1', 'gmt2', 'gmt3', 'gmt4'];
    return text.split(/[,\s\n\t|]+/).map(n => normalizeName(n)).filter(n => n && !TZ.includes(n));
}

async function modCell(sheets, spreadsheetId, tab, row, col, valToAdd) {
    const range = `${tab}!${col}${row}`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const oldVal = parseFloat(res.data.values ? res.data.values[0][0] : 0) || 0;
    const newVal = oldVal + valToAdd;
    
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[newVal]] }
    });
    return `[${col}${row}]: ${oldVal} -> ${newVal}`;
}

async function processLog(auth, spreadsheetId, command, input) {
    const sheets = google.sheets({ version: 'v4', auth });
    
    let eventType = "";
    let data = { host: "", co_hosts: [], attendees: [], duration: 20, participants: 0, eventName: "", minutes: 0, rawInput: input };

    // 1. Check for Time Log first (using the more aggressive regex)
    if (input.toLowerCase().includes("time") && !input.includes("Hosted by")) {
        eventType = "Time Log";
        const nameMatch = input.match(/(?:Username:\s*)?([a-zA-Z0-9_]+)(?=\s*time)/i);
        const timeMatch = input.match(/time\s*:?\s*(\d+)/i);
        
        data.host = nameMatch ? normalizeName(nameMatch[1]) : "";
        data.minutes = timeMatch ? parseInt(timeMatch[1]) : 0;
    } 
    // 2. Check for SSU
    else if (input.includes("VF/ICSU Host:")) {
        eventType = "SSU";
        data.host = normalizeName((input.match(/VF\/ICSU Host:\s*([^|\n]+)/i) || [])[1]);
        data.co_hosts = extractNames((input.match(/VF\/ICSU Officers:\s*([\s\S]*?)(?=VF\/ICSU Attendees:|Notes:|Proof:|$)/i) || [])[1]);
        data.attendees = extractNames((input.match(/VF\/ICSU Attendees:\s*([\s\S]*?)(?=Notes:|Proof:|$)/i) || [])[1]);
        if (/40\s*(minute|min)/i.test(input)) data.duration = 40;
    } 
    // 3. Check for Events/Tryouts
    else {
        eventType = input.includes("Number of participants:") ? "Tryout" : "Event";
        data.eventName = (input.match(/Event:\s*([^.|]+)/i) || [])[1] || "";
        data.host = normalizeName((input.match(/Hosted by:\s*([^|\n]+)/i) || [])[1]);
        data.co_hosts = extractNames((input.match(/Co-Host(?:\/Supervised by)?:\s*([\s\S]*?)(?=Attendees:|Passed:|Notes:|Number of participants:|$)/i) || [])[1]);
        data.attendees = extractNames((input.match(/Attendees:\s*([\s\S]*?)(?=Passed:|Notes:|Proof:|Number of participants:|$)/i) || [])[1]);
        
        const partMatch = input.match(/Number of participants:\s*(\d+)/i);
        if (partMatch) data.participants = parseInt(partMatch[1]);
    }

    const reportEntries = [];
    const users = [{ name: data.host, role: 'Host' }];
    data.co_hosts.forEach(n => users.push({ name: n, role: 'Co-Host' }));
    data.attendees.forEach(n => users.push({ name: n, role: 'Attendee' }));

    const uniqueUsers = Array.from(new Set(users.map(u => JSON.stringify(u)))).map(u => JSON.parse(u));

    for (const user of uniqueUsers) {
        if (!user.name) continue;
        const res = await updateUserInTabs(sheets, spreadsheetId, user.name, eventType, { ...data, role: user.role });
        reportEntries.push(res);
    }
    return reportEntries.join('\n');
}

async function updateUserInTabs(sheets, spreadsheetId, username, type, context) {
    const searchTarget = normalizeName(username);
    let changeLogs = [];
    let foundAny = false;

    const staffRange = "⭐STAFF TEAM!B1:B100";
    const staffRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: staffRange });
    const staffRows = staffRes.data.values || [];
    const isStaffMember = staffRows.some(r => r[0] && normalizeName(r[0]) === searchTarget);
    
    // Check raw input for PT/GS keywords to ensure Recruit sheet catches it regardless of how it was parsed
    const fullText = context.rawInput.toLowerCase();
    const isCompanyEvent = fullText.includes("company");
    const isPT = fullText.includes("pt") || fullText.includes("physical training");
    const isGS = fullText.includes("gs") || fullText.includes("guarding sim");
    const isPatrol = fullText.includes("patrol");

    for (const [tabName, cfg] of Object.entries(TABS_CONFIG)) {
        const range = `${tabName}!B1:B100`;
        const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        const rows = res.data.values || [];
        
        let rowIndex = rows.findIndex(r => r[0] && normalizeName(r[0]) === searchTarget);
        if (rowIndex === -1) continue;

        foundAny = true;
        const rowNum = rowIndex + 1;
        let tabChanges = [];

        // 1. COMPANY LOGIC (Staff Specific)
        if (isCompanyEvent && isStaffMember && tabName === "⭐STAFF TEAM") {
            const val = (context.role === 'Host') ? 1.0 : 0.5;
            tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'F', val));
            tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'H', val));
            tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'J', 10));
            changeLogs.push(`**${username}** (${tabName} Co.): ${tabChanges.join(', ')}`);
            continue; 
        }

        // 2. RECRUIT LOGIC (FIXED: Checks keywords properly)
        if (tabName === "💂RECRUITS") {
            if (isPT) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId, range: `${tabName}!D${rowNum}`,
                    valueInputOption: 'USER_ENTERED', requestBody: { values: [["TRUE"]] }
                });
                tabChanges.push(`[D${rowNum}]: Set TRUE`);
            } 
            if (isPatrol) {
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'E', 1));
            } 
            if (isGS) {
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'F', 1));
            }
            
            if (tabChanges.length > 0) {
                changeLogs.push(`**${username}** (${tabName}): ${tabChanges.join(', ')}`);
            }
            continue;
        }

        // 3. TRYOUT PARTICIPANT LOGIC
        if (type === "Tryout") {
            let tryoutPoints = 0;
            if (context.participants === 0) {
                tryoutPoints = 0.5;
            } else {
                tryoutPoints = (context.role === 'Host' || context.role === 'Attendee') ? 1.0 : 0.5;
            }

            if (tabName === "⭐STAFF TEAM") {
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'E', tryoutPoints));
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'K', tryoutPoints));
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'J', 10));
            } else {
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, cfg.updateCols[0], tryoutPoints));
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, cfg.updateCols[1], tryoutPoints));
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, cfg.updateCols[2] || 'I', 10));
            }
            changeLogs.push(`**${username}** (${tabName} Tryout): ${tabChanges.join(', ')}`);
            continue;
        }

        // 4. SERGEANT LOGIC (Rows 11-13)
        const isDivSheet = ["👑 VULCAN", "❄️ BLIZZARD FORCE", "🔥 WILDFIRE ", "🏬TROOPER PLATOON"].includes(tabName);
        if (isDivSheet && rowNum >= 11 && rowNum <= 13) {
            const mult = (context.role === 'Host') ? 1 : 0.5;
            if (context.role === 'Attendee') {
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'F', 1));
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'G', 1));
            } else {
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'D', mult));
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'E', mult));
            }
            tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, 'I', 10));
            changeLogs.push(`**${username}** (${tabName} Sgt): ${tabChanges.join(', ')}`);
            continue;
        }

        // 5. GENERAL REWARDS (FIXED: Co-Host now gets 0.5)
        let rewards = [0, 0, 0];
        if (type === "Time Log") {
            tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, cfg.timeCol, context.minutes));
            rewards = [Math.floor(context.minutes / 120), Math.floor(context.minutes / 120), Math.floor(context.minutes / 60) * 10];
        } else if (type === "SSU") {
            const ssuVal = context.duration === 40 ? 2.0 : 1.0;
            const ssuMult = (context.role === 'Host' || context.role === 'Attendee') ? 1 : 0.5;
            rewards = [ssuVal * ssuMult, ssuVal * ssuMult, (ssuVal * 10)];
        } else {
            // Standard Event: Host/Attendee get 1.0, Co-Host gets 0.5
            const eventVal = (context.role === 'Host' || context.role === 'Attendee') ? 1.0 : 0.5;
            rewards = [eventVal, eventVal, 10];
        }

        for (let i = 0; i < cfg.updateCols.length; i++) {
            if (rewards[i] !== 0) {
                tabChanges.push(await modCell(sheets, spreadsheetId, tabName, rowNum, cfg.updateCols[i], rewards[i]));
            }
        }

        if (tabChanges.length > 0) changeLogs.push(`**${username}** (${tabName}): ${tabChanges.join(', ')}`);
    }

    return foundAny ? changeLogs.join('\n') : `❌ **${username}**: Not found.`;
}

module.exports = { processLog };