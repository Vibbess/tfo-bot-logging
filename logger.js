const { google } = require('googleapis');

// --- SHEET NAMES (CHANGE IF NEEDED) ---
const SHEETS = {
    RECRUITS: "RECRUITS",
    JET: "JETPACK COMPANY",
    FLAME: "FLAMETROOPER COMPANY",
    DIVISIONAL: "DIVISIONAL STAFF",
    HIGH: "HIGH COMMAND"
};

// --- HELPERS ---
function normalize(name) {
    return name?.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractSection(text, key) {
    const regex = new RegExp(`${key}:([\\s\\S]*?)(?=\\n[A-Z]|$)`, "i");
    return regex.exec(text)?.[1]?.trim() || "";
}

function extractNames(text) {
    if (!text) return [];
    return text.split(/[\n,]+/)
        .map(x => normalize(x))
        .filter(x => x.length > 2);
}

async function getAllRows(sheets, spreadsheetId, tab) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tab}!A:G`
    });
    return res.data.values || [];
}

async function updateCell(sheets, spreadsheetId, tab, cell, value) {
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!${cell}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[value]] }
    });
}

async function addValue(sheets, spreadsheetId, tab, cell, amount) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tab}!${cell}`
    });

    let current = parseFloat(res.data.values?.[0]?.[0]) || 0;
    current += amount;

    await updateCell(sheets, spreadsheetId, tab, cell, current);
}

// --- MAIN ---
async function processLog(auth, spreadsheetId, input, interaction, webhook) {

    const sheets = google.sheets({ version: 'v4', auth });

    const lower = input.toLowerCase();

    const isWeekend = lower.includes("weekend: true");
    const isTryout = lower.includes("general tryout");

    const host = normalize(extractSection(input, "Host"));
    const cohosts = extractNames(extractSection(input, "Co-hosts"));
    const attendees = extractNames(extractSection(input, "Attendees"));

    const users = [
        { name: host, role: "host" },
        ...cohosts.map(n => ({ name: n, role: "cohost" })),
        ...attendees.map(n => ({ name: n, role: "attendee" }))
    ];

    let results = [];

    for (const user of users) {

        const username = user.name;
        if (!username) continue;

        let found = false;

        // --- RECRUITS ---
        const recruitRows = await getAllRows(sheets, spreadsheetId, SHEETS.RECRUITS);

        for (let i = 0; i < recruitRows.length; i++) {
            if (normalize(recruitRows[i][1]) === username) {
                const row = i + 1;
                found = true;

                if (lower.includes("patrol")) {
                    await addValue(sheets, spreadsheetId, SHEETS.RECRUITS, `E${row}`, 1);
                }

                if (lower.includes("physical training")) {
                    await updateCell(sheets, spreadsheetId, SHEETS.RECRUITS, `F${row}`, "TRUE");
                }

                results.push(`👤 ${username} (Recruit updated)`);
                break;
            }
        }

        // --- JET ---
        const jetRows = await getAllRows(sheets, spreadsheetId, SHEETS.JET);

        for (let i = 0; i < jetRows.length; i++) {
            if (normalize(jetRows[i][1]) === username) {
                const row = i + 1;
                found = true;

                if (user.role === "attendee") {
                    await addValue(sheets, spreadsheetId, SHEETS.JET, `E${row}`, 1);
                    await addValue(sheets, spreadsheetId, SHEETS.JET, `F${row}`, 1);
                }

                results.push(`🚀 ${username} (Jet updated)`);
                break;
            }
        }

        // --- FLAME ---
        const flameRows = await getAllRows(sheets, spreadsheetId, SHEETS.FLAME);

        for (let i = 0; i < flameRows.length; i++) {
            if (normalize(flameRows[i][1]) === username) {
                const row = i + 1;
                found = true;

                if (user.role === "attendee") {
                    await addValue(sheets, spreadsheetId, SHEETS.FLAME, `E${row}`, 1);
                    await addValue(sheets, spreadsheetId, SHEETS.FLAME, `F${row}`, 1);
                }

                results.push(`🔥 ${username} (Flame updated)`);
                break;
            }
        }

        // --- TRYOUT LOGIC ---
        if (isTryout) {

            // DIVISIONAL STAFF
            const divRows = await getAllRows(sheets, spreadsheetId, SHEETS.DIVISIONAL);

            for (let i = 0; i < divRows.length; i++) {
                if (normalize(divRows[i][1]) === username) {
                    const row = i + 1;

                    if (user.role === "host") {
                        const val = isWeekend ? 2 : 1;
                        await addValue(sheets, spreadsheetId, SHEETS.DIVISIONAL, `G${row}`, val);
                        await addValue(sheets, spreadsheetId, SHEETS.DIVISIONAL, `K${row}`, val);
                    }

                    if (user.role === "cohost") {
                        const val = isWeekend ? 1 : 0.5;
                        await addValue(sheets, spreadsheetId, SHEETS.DIVISIONAL, `G${row}`, val);
                    }
                }
            }

            // HIGH COMMAND
            const highRows = await getAllRows(sheets, spreadsheetId, SHEETS.HIGH);

            for (let i = 0; i < highRows.length; i++) {
                if (normalize(highRows[i][1]) === username) {
                    const row = i + 1;

                    if (user.role === "host") {
                        const val = isWeekend ? 2 : 1;
                        await addValue(sheets, spreadsheetId, SHEETS.HIGH, `G${row}`, val);
                        await addValue(sheets, spreadsheetId, SHEETS.HIGH, `H${row}`, val);
                    }

                    if (user.role === "cohost") {
                        const val = isWeekend ? 1 : 0.5;
                        await addValue(sheets, spreadsheetId, SHEETS.HIGH, `G${row}`, val);
                    }
                }
            }

        } else {

            // --- NORMAL EVENTS ---
            if (user.role === "host") {
                const val = isWeekend ? 2 : 1;

                await updateGeneralSheets(sheets, spreadsheetId, username, val, "host");
            }

            if (user.role === "cohost") {
                const val = isWeekend ? 1 : 0.5;

                await updateGeneralSheets(sheets, spreadsheetId, username, val, "cohost");
            }
        }

        if (!found) {
            results.push(`❌ ${username} not found`);
        }
    }

    if (webhook) {
        await webhook.send({
            content: `📋 Event Logged by <@${interaction.user.id}>`
        });
    }

    return results.join("\n");
}

// --- GENERAL EVENT UPDATE ---
async function updateGeneralSheets(sheets, spreadsheetId, username, value, role) {

    for (const tab of [SHEETS.DIVISIONAL, SHEETS.HIGH]) {

        const rows = await getAllRows(sheets, spreadsheetId, tab);

        for (let i = 0; i < rows.length; i++) {
            if (normalize(rows[i][1]) === username) {
                const row = i + 1;

                if (role === "host") {
                    await addValue(sheets, spreadsheetId, tab, `F${row}`, value);
                    await addValue(sheets, spreadsheetId, tab, `H${row}`, value);
                }

                if (role === "cohost") {
                    await addValue(sheets, spreadsheetId, tab, `F${row}`, value);
                }
            }
        }
    }
}

module.exports = { processLog };