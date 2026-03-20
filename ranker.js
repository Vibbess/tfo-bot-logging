const { google } = require('googleapis');
const { RANK_RANGES } = require('./config');

/* -------------------------------------------------- */
/* Utilities */
/* -------------------------------------------------- */

function normalizeName(name) {
    if (!name) return "";
    return name.toString().split('|')[0].trim().normalize('NFKC')
        .replace(/[@\(\)]/g, "").replace(/[^\w\d_]+/g, "").toLowerCase();
}

function getNextSaturday() {
    const today = new Date();
    const resultDate = new Date(today);
    const daysUntilSat = (6 - today.getDay() + 7) % 7 || 7;
    resultDate.setDate(today.getDate() + daysUntilSat);
    return `${resultDate.getMonth() + 1}/${resultDate.getDate()}/${resultDate.getFullYear()}`;
}

async function getSheetId(sheets, spreadsheetId, title) {
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = res.data.sheets.find(s => s.properties.title === title);
    return sheet.properties.sheetId;
}

/* -------------------------------------------------- */
/* Main Transfer Logic */
/* -------------------------------------------------- */

async function transferUser(auth, spreadsheetId, username, fromRank, toRank, executorPing, webhook) {
    const sheets = google.sheets({ version: 'v4', auth });

    const fromCfg = RANK_RANGES[fromRank];
    const toCfg = RANK_RANGES[toRank];
    if (!fromCfg || !toCfg) throw new Error("Invalid rank configuration.");

    /* ---------- Find user and fetch metadata ---------- */
    // Fetch only what exists. If Recruit, fetch B:H. If Trooper+, fetch B:K.
    const fetchLimit = fromRank === "Recruit" ? "H" : "K";
    const fromRangeLookup = `${fromCfg.tab}!B${fromCfg.start}:${fetchLimit}${fromCfg.end}`;
    
    const fromDataResponse = await sheets.spreadsheets.get({
        spreadsheetId,
        ranges: [fromRangeLookup],
        includeGridData: true
    });

    const sheetData = fromDataResponse.data.sheets[0].data[0].rowData || [];
    let sRowIndex = -1;
    let existingNoteOnJ = null;
    let oldStats = {};

    for (let i = 0; i < sheetData.length; i++) {
        const row = sheetData[i];
        const cellValue = row.values?.[0]?.formattedValue;
        if (normalizeName(cellValue) === normalizeName(username)) {
            sRowIndex = (fromCfg.start - 1) + i;
            
            // Map values safely
            oldStats = {
                D: row.values?.[2]?.formattedValue || 0,
                E: row.values?.[3]?.formattedValue || 0,
                F: row.values?.[4]?.formattedValue || 0,
                G: row.values?.[5]?.formattedValue || 0,
                I: row.values?.[7]?.formattedValue || 0,
                J: row.values?.[8]?.formattedValue || "FALSE",
                K: row.values?.[9]?.formattedValue || 0
            };
            // Only Trooper+ has Column J (index 8 in the row data)
            existingNoteOnJ = (fromRank !== "Recruit") ? (row.values?.[8]?.note || null) : null;
            break;
        }
    }

    if (sRowIndex === -1) throw new Error(`${username} not found in ${fromRank}.`);

    /* ---------- Find empty slot in TO tab ---------- */
    const toRangeLookup = `${toCfg.tab}!B${toCfg.start}:B${toCfg.end}`;
    const toData = await sheets.spreadsheets.values.get({ spreadsheetId, range: toRangeLookup });
    const toRows = toData.data.values || [];

    let dRowIndex = -1;
    for (let i = 0; i < (toCfg.end - toCfg.start + 1); i++) {
        const val = toRows[i]?.[0];
        if (!val || val.trim() === "" || val === "N/A") {
            dRowIndex = (toCfg.start - 1) + i;
            break;
        }
    }

    if (dRowIndex === -1) throw new Error(`No empty slots available in ${toRank}.`);

    /* ---------- Prepare Value Updates ---------- */
    const updates = [];
    let noteToApply = null;

    if (fromRank === "Recruit" && toRank === "Trooper") {
        // RESET RECRUIT: Set C to date, clear B, D-G. (NEVER TOUCH J/INDEX 9)
        updates.push({ range: `${fromCfg.tab}!B${sRowIndex + 1}`, values: [["N/A"]] });
        updates.push({ range: `${fromCfg.tab}!C${sRowIndex + 1}`, values: [["01/01/2026"]] });
        updates.push({ range: `${fromCfg.tab}!D${sRowIndex + 1}:G${sRowIndex + 1}`, values: [["FALSE", 0, 0, 0]] });

        // SETUP TROOPER: Set B, D-G, I=0, J=TRUE
        updates.push({ range: `${toCfg.tab}!B${dRowIndex + 1}`, values: [[username]] });
        updates.push({ range: `${toCfg.tab}!D${dRowIndex + 1}:G${dRowIndex + 1}`, values: [[0, 0, 0, 0]] });
        updates.push({ range: `${toCfg.tab}!I${dRowIndex + 1}:J${dRowIndex + 1}`, values: [[0, "TRUE"]] });

        noteToApply = `Due date: ${getNextSaturday()} (New Trooper)`;
    } else {
        // RESET OLD TROOPER: Clear B, D-G, and set J to FALSE
        updates.push({ range: `${fromCfg.tab}!B${sRowIndex + 1}`, values: [["N/A"]] });
        updates.push({ range: `${fromCfg.tab}!D${sRowIndex + 1}:G${sRowIndex + 1}`, values: [[0, 0, 0, 0]] });
        updates.push({ range: `${fromCfg.tab}!J${sRowIndex + 1}`, values: [["FALSE"]] });

        // TRANSFER TO SPECIALIST+: Move B, D-G, I, J, K
        updates.push({ range: `${toCfg.tab}!B${dRowIndex + 1}`, values: [[username]] });
        updates.push({ range: `${toCfg.tab}!D${dRowIndex + 1}:G${dRowIndex + 1}`, values: [[oldStats.D, oldStats.E, oldStats.F, oldStats.G]] });
        updates.push({ range: `${toCfg.tab}!I${dRowIndex + 1}:K${dRowIndex + 1}`, values: [[oldStats.I, oldStats.J, oldStats.K]] });

        noteToApply = existingNoteOnJ;
    }

    // Apply Updates
    for (const update of updates) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: update.range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: update.values }
        });
    }

    /* ---------- Note Management (Index 9 = Col J) ---------- */
    const fromSheetId = await getSheetId(sheets, spreadsheetId, fromCfg.tab);
    const toSheetId = await getSheetId(sheets, spreadsheetId, toCfg.tab);
    const batchRequests = [];

    // ONLY clear note from old position if it wasn't a Recruit (since Recruit has no J)
    if (fromRank !== "Recruit") {
        batchRequests.push({
            updateCells: {
                range: { sheetId: fromSheetId, startRowIndex: sRowIndex, endRowIndex: sRowIndex + 1, startColumnIndex: 9, endColumnIndex: 10 },
                rows: [{ values: [{ note: null }] }],
                fields: 'note'
            }
        });
    }

    // ONLY add note to new position if it's a Trooper or higher
    if (noteToApply && toRank !== "Recruit") {
        batchRequests.push({
            updateCells: {
                range: { sheetId: toSheetId, startRowIndex: dRowIndex, endRowIndex: dRowIndex + 1, startColumnIndex: 9, endColumnIndex: 10 },
                rows: [{ values: [{ note: noteToApply }] }],
                fields: 'note'
            }
        });
    }

    if (batchRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: batchRequests }
        });
    }

    if (webhook) {
        await webhook.send({
            embeds: [{
                title: "Rank Updated",
                description: `**User:** ${username}\n**From:** ${fromRank}\n**To:** ${toRank}\n**Executor:** ${executorPing}`,
                color: 0x00FF00,
                timestamp: new Date()
            }]
        });
    }

    return `Successfully moved **${username}** to **${toRank}**.`;
}

module.exports = { transferUser };