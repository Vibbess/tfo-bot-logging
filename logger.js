const { GoogleSpreadsheet } = require('google-spreadsheet');
const { RECRUITS_TAB, JETPACK_TAB, FLAMETROOPER_TAB, DIVISIONAL_STAFF_TAB, HIGH_COMMAND_TAB } = require('./config');

function normalizeName(name) {
    if (!name) return "";
    return name.toString().split('|')[0].trim().replace(/[@\(\)]/g, "").toLowerCase();
}

function extractNames(text) {
    if (!text || /^(N\/?A|None|No attendees|No one)\.?$/i.test(text.trim())) return [];
    return text.split(/[,\s\n\t|]+/).map(n => normalizeName(n)).filter(n => n.length > 2);
}

function updateCell(sheet, rowIdx, colIndex, valToAdd, isBool = false) {
    const cell = sheet.getCell(rowIdx, colIndex);
    if (isBool) {
        cell.value = true;
        return `Set TRUE`;
    } else {
        const oldVal = parseFloat(cell.value) || 0;
        cell.value = oldVal + valToAdd;
        return `${oldVal} -> ${cell.value}`;
    }
}

async function processLog(doc, eventType, input, weekend, executorPing, webhook) {
    await doc.loadInfo();
    
    let host = normalizeName((input.match(/Host(?:ed by)?:\s*([^|\n]+)/i) || [])[1]);
    let coHosts = extractNames((input.match(/Co-Hosts?:\s*([\s\S]*?)(?=Attendees:|Passed:|Notes:|Proof:|$)/i) || [])[1]);
    let attendees = extractNames((input.match(/Attendees?:\s*([\s\S]*?)(?=Passed:|Notes:|Proof:|$)/i) || [])[1]);

    const users = [{ name: host, role: 'Host' }];
    coHosts.forEach(n => users.push({ name: n, role: 'Co-Host' }));
    attendees.forEach(n => users.push({ name: n, role: 'Attendee' }));

    let logs = [];
    
    for (const user of users) {
        if (!user.name) continue;
        const targetName = user.name;
        
        let found = false;

        // 1. Check Recruits Tab
        const rSheet = doc.sheetsByTitle[RECRUITS_TAB];
        await rSheet.loadCells('A1:G100');
        for (let r = 0; r < 100; r++) {
            if (normalizeName(rSheet.getCell(r, 1).value) === targetName) {
                found = true;
                if (user.role === 'Attendee') {
                    if (eventType === "Patrol") updateCell(rSheet, r, 4, 1); // E
                    if (eventType === "PT") updateCell(rSheet, r, 5, 0, true); // F
                    if (eventType !== "Patrol" && eventType !== "PT") updateCell(rSheet, r, 4, 1); // Generic event pt
                }
                break;
            }
        }
        if (found) { await rSheet.saveUpdatedCells(); logs.push(`Logged Recruits tab for ${targetName}`); continue; }

        // 2. Check Companies
        const jSheet = doc.sheetsByTitle[JETPACK_TAB];
        const fSheet = doc.sheetsByTitle[FLAMETROOPER_TAB];
        for (const sheet of [jSheet, fSheet]) {
            if (!sheet) continue;
            await sheet.loadCells('A1:G100');
            for (let r = 0; r < 100; r++) {
                if (normalizeName(sheet.getCell(r, 1).value) === targetName) {
                    found = true;
                    if (user.role === 'Attendee') {
                        updateCell(sheet, r, 4, 1); // E
                        updateCell(sheet, r, 5, 1); // F
                        updateCell(sheet, r, 6, 10); // G (Assuming 10 mins in-game time per event)
                    }
                    break;
                }
            }
            if (found) { await sheet.saveUpdatedCells(); logs.push(`Logged Company tab for ${targetName}`); break; }
        }
        if (found) continue;

        // 3. Hosts logic / Staff Tabs
        if (user.role === 'Host' || user.role === 'Co-Host') {
            const isHost = user.role === 'Host';
            const mult = weekend ? 2 : 1;
            
            let hostPts = isHost ? (1 * mult) : (0.5 * (weekend ? 2 : 1)); // if weekend +1 for cohost

            if (eventType === "General Tryout") {
                const divSheet = doc.sheetsByTitle[DIVISIONAL_STAFF_TAB];
                const hcSheet = doc.sheetsByTitle[HIGH_COMMAND_TAB];
                
                // Try Divisional
                if (divSheet) {
                    await divSheet.loadCells('A1:K100');
                    for (let r = 0; r < 100; r++) {
                        if (normalizeName(divSheet.getCell(r, 1).value) === targetName) {
                            updateCell(divSheet, r, 6, hostPts); // G
                            updateCell(divSheet, r, 10, hostPts); // K
                            found = true; break;
                        }
                    }
                    if (found) { await divSheet.saveUpdatedCells(); logs.push(`Logged DivStaff for ${targetName}`); continue; }
                }
                // Try HC
                if (hcSheet) {
                    await hcSheet.loadCells('A1:K100');
                    for (let r = 0; r < 100; r++) {
                        if (normalizeName(hcSheet.getCell(r, 1).value) === targetName) {
                            updateCell(hcSheet, r, 6, hostPts); // G
                            updateCell(hcSheet, r, 7, hostPts); // H
                            found = true; break;
                        }
                    }
                    if (found) { await hcSheet.saveUpdatedCells(); logs.push(`Logged HC for ${targetName}`); continue; }
                }
            } else {
                // Other events for hosts (Assumed Staff sheet or similar handling)
                const staffSheet = doc.sheetsByTitle[DIVISIONAL_STAFF_TAB]; // Fallback to div staff for F&H
                if (staffSheet) {
                    await staffSheet.loadCells('A1:K100');
                    for (let r = 0; r < 100; r++) {
                        if (normalizeName(staffSheet.getCell(r, 1).value) === targetName) {
                            updateCell(staffSheet, r, 5, hostPts); // F
                            updateCell(staffSheet, r, 7, hostPts); // H
                            found = true; break;
                        }
                    }
                    if (found) { await staffSheet.saveUpdatedCells(); logs.push(`Logged Host Points for ${targetName}`); }
                }
            }
        }
    }

    if (webhook) {
        await webhook.send({
            embeds: [{
                title: "Event Logged",
                description: `**Type:** ${eventType}\n**Host:** ${host}\n**Attendees:** ${attendees.length}\n**Weekend Multiplier:** ${weekend}\n\n**Executor:** ${executorPing}`,
                color: 0x3498DB,
                timestamp: new Date()
            }]
        });
    }

    return logs.length > 0 ? `✅ Log processed successfully.\n${logs.join('\n')}` : `⚠️ Processed, but no users matched in the sheets.`;
}

module.exports = { processLog };