const config = require('./config');

/**
 * Helper to clean and normalize usernames for matching
 */
function normalizeName(name) {
    if (!name) return "";
    return name.toString().split('|')[0].trim().normalize('NFKC').replace(/[@\(\)]/g, "").replace(/[^\w\d_]+/g, "").toLowerCase();
}

/**
 * Extracts names from a list string (comma, newline, or space separated)
 */
function extractNames(text) {
    if (!text || /^(N\/?A|None|No attendees|No one)\.?$/i.test(text.trim())) return [];
    return text.split(/[,\n\t|]+/).map(n => normalizeName(n.trim())).filter(n => n !== "");
}

/**
 * Updates a specific cell value by adding a number
 */
function updateCellAdd(sheet, row, colIndex, value) {
    const cell = sheet.getCell(row, colIndex);
    const currentVal = parseFloat(cell.value) || 0;
    cell.value = currentVal + value;
}

async function processLog(doc, interaction) {
    const eventTypeInput = interaction.options.getString('eventtype').toLowerCase();
    const isWeekend = interaction.options.getBoolean('weekend');
    const input = interaction.options.getString('input');
    const multiplier = isWeekend ? 2 : 1;

    await doc.loadInfo();

    // --- 1. DATA PARSING ---
    let data = {
        host: "",
        coHosts: [],
        attendees: [],
        type: eventTypeInput,
        timeInGame: 0
    };

    if (input.includes("Time in-game:")) {
        // Time Log Format
        data.host = normalizeName((input.match(/Username:\s*([^\n]+)/i) || [])[1]);
        data.timeInGame = parseInt((input.match(/Time in-game:\s*(\d+)/i) || [0, 0])[1]);
    } else {
        // Event/Tryout Format
        data.host = normalizeName((input.match(/Host:\s*([^\n]+)/i) || [])[1]);
        const coHostMatch = input.match(/Co-hosts:\s*([^\n]+)/i);
        data.coHosts = coHostMatch ? extractNames(coHostMatch[1]) : [];
        const attendeeMatch = input.match(/Attendees:\s*([\s\S]*?)(?=Passed:|Notes:|Proof:|$)/i);
        data.attendees = attendeeMatch ? extractNames(attendeeMatch[1]) : [];
    }

    const logResults = [];

    // --- 2. POINT DISTRIBUTION LOGIC ---

    // Process Attendees
    for (const username of data.attendees) {
        let found = false;

        // Check RECRUITS sheet
        const recruitSheet = doc.sheetsByTitle[config.RECRUITS_TAB];
        const rRow = await findUserRow(recruitSheet, username, 1); // Col B
        if (rRow !== -1) {
            found = true;
            if (data.type.includes("patrol")) {
                updateCellAdd(recruitSheet, rRow, 4, 1); // +1 to E
                logResults.push(`${username} (Recruit): +1 Patrol Point (E)`);
            } else if (data.type.includes("pt") || data.type.includes("physical training")) {
                recruitSheet.getCell(rRow, 5).value = true; // F = TRUE
                logResults.push(`${username} (Recruit): PT marked TRUE (F)`);
            } else {
                // Default event point for recruits (if applicable)
                updateCellAdd(recruitSheet, rRow, 4, 1); 
            }
            await recruitSheet.saveUpdatedCells();
        }

        // Check COMPANY sheets
        const companies = [doc.sheetsByTitle[config.FLAMETROOPER_TAB], doc.sheetsByTitle[config.JETPACK_TAB]];
        for (const sheet of companies) {
            const cRow = await findUserRow(sheet, username, 1); // Col B
            if (cRow !== -1) {
                found = true;
                updateCellAdd(sheet, cRow, 4, 1); // + Point to E
                updateCellAdd(sheet, cRow, 5, 1); // + Point to F
                // If it's a specific time log or has duration, add to G
                if (data.timeInGame > 0) updateCellAdd(sheet, cRow, 6, data.timeInGame); 
                await sheet.saveUpdatedCells();
                logResults.push(`${username} (Company): Points added to E&F`);
            }
        }
    }

    // Process Host & Co-Host
    const staffSheets = [
        { sheet: doc.sheetsByTitle[config.STAFF_TAB], type: 'STAFF' },
        { sheet: doc.sheetsByTitle[config.HICOM_TAB], type: 'HICOM' }
    ];

    const leads = [{ name: data.host, isHost: true }];
    data.coHosts.forEach(name => leads.push({ name, isHost: false }));

    for (const lead of leads) {
        for (const entry of staffSheets) {
            const row = await findUserRow(entry.sheet, lead.name, 1);
            if (row === -1) continue;

            const basePoints = lead.isHost ? 1 : 0.5;
            const awarded = basePoints * multiplier;

            if (data.type.includes("tryout")) {
                if (entry.type === 'STAFF') {
                    updateCellAdd(entry.sheet, row, 6, awarded); // G
                    updateCellAdd(entry.sheet, row, 10, awarded); // K
                } else if (entry.type === 'HICOM') {
                    updateCellAdd(entry.sheet, row, 6, awarded); // G
                    updateCellAdd(entry.sheet, row, 7, awarded); // H
                }
            } else {
                // Any other event
                updateCellAdd(entry.sheet, row, 5, awarded); // F
                updateCellAdd(entry.sheet, row, 7, awarded); // H
            }
            await entry.sheet.saveUpdatedCells();
            logResults.push(`${lead.name} (${entry.type}): +${awarded} points (Host/Co)`);
        }
    }

    return logResults.length > 0 ? logResults.join('\n') : "Log processed. No sheet updates were required.";
}

/**
 * Finds the row index for a specific username
 */
async function findUserRow(sheet, username, colIndex) {
    if (!sheet) return -1;
    await sheet.loadCells();
    const searchName = normalizeName(username);
    for (let i = 0; i < sheet.rowCount; i++) {
        const cellValue = sheet.getCell(i, colIndex).value;
        if (normalizeName(cellValue) === searchName) return i;
    }
    return -1;
}

module.exports = { processLog };