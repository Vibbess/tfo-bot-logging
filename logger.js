const { GoogleSpreadsheet } = require('google-spreadsheet');

const SHEET_ID = "1ctn-Ay3n4EZ-BY3hyEvKmC9vfgIRNiMO7_1RQu-NC-A";

const TABS_CONFIG = {
    "⭐STAFF TEAM":     { updateCols: ['D', 'G', 'J'], timeCol: 'N' },
    "👑 VULCAN":         { updateCols: ['D', 'F', 'I'], timeCol: 'K' },
    "❄️ BLIZZARD FORCE": { updateCols: ['D', 'F', 'I'], timeCol: 'K' },
    "🔥 WILDFIRE ":      { updateCols: ['D', 'F', 'I'], timeCol: 'K' },
    "🏬TROOPER PLATOON": { updateCols: ['D', 'E', 'G'], timeCol: 'I' },
    "💂RECRUITS":        { updateCols: ['D', 'E', 'F'], timeCol: 'G' }
};

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
    const TZ = ['est', 'edt', 'cst', 'cdt', 'mst', 'mdt', 'pst', 'pdt', 'gmt', 'bst', 'utc', 'aest'];
    return text.split(/[,\s\n\t|]+/).map(n => normalizeName(n)).filter(n => n && !TZ.includes(n));
}

function colToIndex(col) {
    return col.toUpperCase().charCodeAt(0) - 65;
}

function updateCellManual(sheet, rowIdx, colLetter, valToAdd) {
    const cell = sheet.getCell(rowIdx, colToIndex(colLetter));
    const oldVal = parseFloat(cell.value) || 0;
    const newVal = oldVal + valToAdd;
    cell.value = newVal;
    return `[${colLetter}${rowIdx + 1}]: ${oldVal} -> ${newVal}`;
}

async function processLog(doc, command, input) {
    await doc.loadInfo();
    let eventType = "";
    let data = { host: "", co_hosts: [], attendees: [], duration: 20, participants: 0, eventName: "", minutes: 0 };

    if (input.includes("VF/ICSU Host:")) {
        eventType = "SSU";
        data.host = normalizeName((input.match(/VF\/ICSU Host:\s*([^|\n]+)/i) || [])[1]);
        data.co_hosts = extractNames((input.match(/VF\/ICSU Officers:\s*([\s\S]*?)(?=VF\/ICSU Attendees:|Notes:|Proof:|$)/i) || [])[1]);
        data.attendees = extractNames((input.match(/VF\/ICSU Attendees:\s*([\s\S]*?)(?=Notes:|Proof:|$)/i) || [])[1]);
        if (/40\s*(minute|min)/i.test(input)) data.duration = 40;
    } 
    else if (input.includes("Username:") && input.includes("Time:")) {
        eventType = "Time Log";
        data.host = normalizeName((input.match(/Username:\s*([^\n|]+)/i) || [])[1]);
        data.minutes = parseInt((input.match(/Time:\s*(\d+)/i) || [0, 0])[1]) || 0;
    }
    else {
        eventType = input.includes("Number of participants:") ? "Tryout" : "Event";
        data.eventName = (input.match(/Event:\s*([^.|]+)/i) || [])[1] || "";
        data.host = normalizeName((input.match(/Hosted by:\s*([^|\n]+)/i) || [])[1]);
        data.co_hosts = extractNames((input.match(/Co-Host(?:\/Supervised by)?:\s*([\s\S]*?)(?=Attendees:|Passed:|Notes:|Number of participants:|$)/i) || [])[1]);
        data.attendees = extractNames((input.match(/Attendees:\s*([\s\S]*?)(?=Passed:|Notes:|Proof:|Number of participants:|$)/i) || [])[1]);
        data.participants = parseInt((input.match(/Number of participants:\s*(\d+)/i) || [0, 0])[1]) || 0;
    }

    const reportEntries = [];
    const users = [{ name: data.host, role: 'Host' }];
    data.co_hosts.forEach(n => users.push({ name: n, role: 'Co-Host' }));
    data.attendees.forEach(n => users.push({ name: n, role: 'Attendee' }));

    const uniqueUsers = Array.from(new Set(users.map(u => JSON.stringify(u)))).map(u => JSON.parse(u));

    for (const user of uniqueUsers) {
        if (!user.name) continue;
        const res = await updateUserInTabs(doc, user.name, eventType, { ...data, role: user.role });
        reportEntries.push(res);
    }
    return reportEntries.join('\n');
}

async function updateUserInTabs(doc, username, type, context) {
    const searchTarget = normalizeName(username);
    let foundAny = false;
    let changeLogs = [];

    for (const [tabName, cfg] of Object.entries(TABS_CONFIG)) {
        const sheet = doc.sheetsByTitle[tabName];
        if (!sheet) continue;

        const limit = Math.min(sheet.rowCount, 100);
        await sheet.loadCells(`A1:P${limit}`);

        let rowIndex = -1;
        for (let i = 0; i < limit; i++) {
            const val = sheet.getCell(i, 1).value; 
            if (normalizeName(val) === searchTarget) {
                rowIndex = i; 
                break;
            }
        }

        if (rowIndex === -1) continue;
        foundAny = true;
        const rowNum = rowIndex + 1;
        let tabChanges = [];

        const isDivSheet = ["👑 VULCAN", "❄️ BLIZZARD FORCE", "🔥 WILDFIRE ", "🏬TROOPER PLATOON"].includes(tabName);
        if (isDivSheet && rowNum >= 11 && rowNum <= 13) {
            if (context.role === 'Host') {
                tabChanges.push(updateCellManual(sheet, rowIndex, 'D', 1));
                tabChanges.push(updateCellManual(sheet, rowIndex, 'E', 1));
                tabChanges.push(updateCellManual(sheet, rowIndex, 'I', 10));
            } else if (context.role === 'Co-Host') {
                tabChanges.push(updateCellManual(sheet, rowIndex, 'D', 0.5));
                tabChanges.push(updateCellManual(sheet, rowIndex, 'E', 0.5));
                tabChanges.push(updateCellManual(sheet, rowIndex, 'I', 10));
            } else if (context.role === 'Attendee') {
                tabChanges.push(updateCellManual(sheet, rowIndex, 'F', 1));
                tabChanges.push(updateCellManual(sheet, rowIndex, 'G', 1));
                tabChanges.push(updateCellManual(sheet, rowIndex, 'I', 10));
            }
            await sheet.saveUpdatedCells();
            changeLogs.push(`**${username}** (${tabName} Sgt): ${tabChanges.join(', ')}`);
            continue; 
        }

        if (tabName === "⭐STAFF TEAM" && (context.role === 'Host' || context.role === 'Co-Host')) {
            const val = context.role === 'Host' ? 1.0 : 0.5;
            if (type === "Tryout") {
                tabChanges.push(updateCellManual(sheet, rowIndex, 'E', val));
                tabChanges.push(updateCellManual(sheet, rowIndex, 'K', val));
                tabChanges.push(updateCellManual(sheet, rowIndex, 'J', 10));
            } else {
                tabChanges.push(updateCellManual(sheet, rowIndex, 'D', val));
                tabChanges.push(updateCellManual(sheet, rowIndex, 'G', val));
                tabChanges.push(updateCellManual(sheet, rowIndex, 'J', 10));
            }
            await sheet.saveUpdatedCells();
            changeLogs.push(`**${username}** (${tabName} Staff): ${tabChanges.join(', ')}`);
            continue;
        }

        let rewards = [0, 0, 0];
        const eName = (context.eventName || "").toLowerCase();

        if (type === "Time Log") {
            const cell = sheet.getCell(rowIndex, colToIndex(cfg.timeCol));
            const oldT = parseFloat(cell.value) || 0;
            cell.value = oldT + context.minutes;
            tabChanges.push(`[${cfg.timeCol}${rowNum}]: ${oldT} -> ${cell.value}`);
            rewards = [Math.floor(context.minutes / 120), Math.floor(context.minutes / 120), Math.floor(context.minutes / 60) * 10];
        } 
        else if (tabName === "💂RECRUITS") {
            if (eName.includes("physical training")) {
                sheet.getCell(rowIndex, 3).value = "TRUE";
                tabChanges.push(`[D${rowNum}]: Set TRUE`);
            } else if (type === "Tryout") rewards = [1.0, 1.0, 1];
            else if (eName.includes("patrol")) rewards = [0, context.role === 'Attendee' ? 1.0 : 0.5, 0];
            else if (eName.includes("guarding simulation")) rewards = [0, 0, 1.0];
        } 
        else {
            if (type === "SSU") {
                rewards = context.duration === 40 ? [2.0, 2.0, 20] : [1.0, 1.0, 10];
            } else if (type === "Tryout") {
                rewards = [1.0, 1.0, 10];
            } else if (type === "Event") {
                rewards = [1.0, 1.0, 10];
                if (eName.includes("guarding simulation")) { rewards[0] += 1; rewards[1] += 1; }
            }
        }

        cfg.updateCols.forEach((col, idx) => {
            if (rewards[idx] !== 0) {
                tabChanges.push(updateCellManual(sheet, rowIndex, col, rewards[idx]));
            }
        });

        if (tabChanges.length > 0) {
            await sheet.saveUpdatedCells();
            changeLogs.push(`**${username}** (${tabName}): ${tabChanges.join(', ')}`);
        }
    }

    return foundAny ? changeLogs.join('\n') : `❌ **${username}**: Not found in any tab.`;
}

module.exports = { processLog };