const { google } = require('googleapis');

// --- CONFIG ---
const TEST_SHEET_ID = "1S-MdjLntP9KVZd8vpyR-n_IM6ZxlMsBF7DRONTBx1OM";
const TEST_TAB = "Sheet1"; // ⚠️ CHANGE if needed

const PLACEMENT_TAB = "PLACEMENTS"; // ⚠️ CHANGE if needed

// Roles
const PASS_ROLE = "1443766259995901952";
const REMOVE_ROLE = "1443766165536247808";

// --- HELPERS ---
function normalize(name) {
    return name?.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// --- MAIN FUNCTION ---
async function handlePromotionRequest(auth, username, interaction, webhook) {

    const sheets = google.sheets({ version: 'v4', auth });
    const cleanUser = normalize(username);

    // --- GET TEST SHEET ---
    const testData = await sheets.spreadsheets.values.get({
        spreadsheetId: TEST_SHEET_ID,
        range: `${TEST_TAB}!B:C`
    });

    const rows = testData.data.values || [];

    let foundRow = null;
    let score = 0;

    for (let i = 0; i < rows.length; i++) {
        const rowUser = normalize(rows[i][1]); // Column C
        if (rowUser === cleanUser) {
            foundRow = i + 1;
            score = parseInt(rows[i][0]) || 0; // Column B
            break;
        }
    }

    if (!foundRow) {
        return "❌ Username not found in test sheet.";
    }

    const member = interaction.member;

    // --- PASS CASE ---
    if (score >= 7) {

        // --- UPDATE PLACEMENT SHEET ---
        const placementData = await sheets.spreadsheets.values.get({
            spreadsheetId: TEST_SHEET_ID,
            range: `${PLACEMENT_TAB}!B:G`
        });

        const placementRows = placementData.data.values || [];
        let placementRowIndex = -1;

        for (let i = 0; i < placementRows.length; i++) {
            if (normalize(placementRows[i][0]) === cleanUser) {
                placementRowIndex = i + 1;
                break;
            }
        }

        if (placementRowIndex !== -1) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: TEST_SHEET_ID,
                range: `${PLACEMENT_TAB}!C${placementRowIndex}`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [["PHASE2"]]
                }
            });
        }

        // --- DISCORD ROLES ---
        try {
            await member.roles.add(PASS_ROLE);
            await member.roles.remove(REMOVE_ROLE);
        } catch (err) {
            console.error("Role error:", err);
        }

        // --- WEBHOOK ---
        if (webhook) {
            await webhook.send({
                content: `✅ PASS: ${username} moved to PHASE2`
            });
        }

        return `✅ **${username} PASSED** and moved to PHASE2`;

    } else {

        // --- FAIL CASE ---
        const failCell = `F${foundRow}`;

        const currentFails = await sheets.spreadsheets.values.get({
            spreadsheetId: TEST_SHEET_ID,
            range: `${TEST_TAB}!${failCell}`
        });

        let fails = parseInt(currentFails.data.values?.[0]?.[0]) || 0;
        fails++;

        await sheets.spreadsheets.values.update({
            spreadsheetId: TEST_SHEET_ID,
            range: `${TEST_TAB}!${failCell}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [[fails]]
            }
        });

        if (webhook) {
            await webhook.send({
                content: `❌ FAIL: ${username} now has ${fails} fails`
            });
        }

        return `❌ **${username} FAILED** (Score: ${score}) | Fails: ${fails}`;
    }
}

module.exports = { handlePromotionRequest };