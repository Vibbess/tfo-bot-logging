const { google } = require('googleapis');
const { ROLES, TABS, WELCOME_CHANNEL, EXTERNAL_SHEET_ID } = require('./config');

/**
 * HELPER: Formats sheet ranges to handle spaces in tab names 
 * (e.g., 'Sheet Name'!A1)
 */
const formatRange = (tab, range) => `'${tab}'!${range}`;

/**
 * HELPER: Normalizes names for comparison (strips IDs, trims, lowercase)
 */
function normalizeName(name) { 
    return name ? name.toString().split('|')[0].trim().toLowerCase() : ""; 
}

/**
 * HELPER: Gets today's date in MM/DD/YYYY
 */
function getTodayDate() { 
    const d = new Date(); 
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; 
}

/**
 * HELPER: Modifies Discord roles safely
 */
async function modDiscordRoles(member, addList, removeList) {
    try {
        if (addList && addList.length > 0) await member.roles.add(addList);
        if (removeList && removeList.length > 0) await member.roles.remove(removeList);
    } catch (e) { 
        console.error("Role modification failed:", e.message); 
    }
}

/**
 * HELPER: Finds the first empty row (or "N/A" row) in a column
 */
async function findEmptyRow(sheets, spreadsheetId, tab, col = 'B', max = 150) {
    const res = await sheets.spreadsheets.values.get({ 
        spreadsheetId, 
        range: formatRange(tab, `${col}1:${col}${max}`) 
    });
    const rows = res.data.values || [];
    for (let i = 0; i < max; i++) {
        if (!rows[i] || !rows[i][0] || rows[i][0] === "N/A" || rows[i][0] === "") return i + 1;
    }
    return max + 1;
}

/**
 * HELPER: Resets a specific row to default values
 */
async function clearRow(sheets, spreadsheetId, tab, rowNum, defaultValues) {
    const endColChar = String.fromCharCode(66 + defaultValues.length - 1); 
    await sheets.spreadsheets.values.update({
        spreadsheetId, 
        range: formatRange(tab, `B${rowNum}:${endColChar}${rowNum}`),
        valueInputOption: 'USER_ENTERED', 
        requestBody: { values: [defaultValues] }
    });
}

// ---------------------------------------------------------
// 1. handlePromotionRequest (The External Sheet Check)
// ---------------------------------------------------------
async function handlePromotionRequest(auth, username, member) {
    const sheets = google.sheets({ version: 'v4', auth });
    
    // FETCH EXTERNAL DATA (Scores)
    // Note: Ensure the tab in your external sheet is exactly "Sheet1"
    const res = await sheets.spreadsheets.values.get({ 
        spreadsheetId: EXTERNAL_SHEET_ID, 
        range: `'Sheet1'!B1:C100` 
    });
    
    const rows = res.data.values || [];
    let passed = false;

    for (let row of rows) {
        // Logic: B (row[0]) = Username, C (row[1]) = Score
        if (normalizeName(row[0]) === normalizeName(username)) {
            const score = parseInt(row[1] || 0); 
            if (score >= 7) passed = true;
            break;
        }
    }

    const MAIN_SHEET = process.env.SHEET_ID;
    const placementData = await sheets.spreadsheets.values.get({ 
        spreadsheetId: MAIN_SHEET, 
        range: formatRange(TABS.PLACEMENT, `B1:F100`) 
    });
    const pRows = placementData.data.values || [];
    
    for (let i = 0; i < pRows.length; i++) {
        if (normalizeName(pRows[i][0]) === normalizeName(username)) {
            const rowNum = i + 1;
            if (passed) {
                // Update to Phase 2 and swap Discord roles
                await sheets.spreadsheets.values.update({ 
                    spreadsheetId: MAIN_SHEET, 
                    range: formatRange(TABS.PLACEMENT, `C${rowNum}`), 
                    valueInputOption: 'USER_ENTERED', 
                    requestBody: { values: [["PHASE2"]] }
                });
                await modDiscordRoles(member, [ROLES.PASSED_PHASE_2], [ROLES.REQ_PROMO_ROLE]);
                return `✅ **${username}** scored 7+! Updated to PHASE2.`;
            } else {
                // Increment fail counter in Column F
                const currentF = parseInt(pRows[i][4] || 0);
                await sheets.spreadsheets.values.update({ 
                    spreadsheetId: MAIN_SHEET, 
                    range: formatRange(TABS.PLACEMENT, `F${rowNum}`), 
                    valueInputOption: 'USER_ENTERED', 
                    requestBody: { values: [[currentF + 1]] }
                });
                return `❌ **${username}** did not pass (<7). Added +1 to fail count.`;
            }
        }
    }
    return `⚠️ ${username} not found on the placement sheet.`;
}

// ---------------------------------------------------------
// 2. transferUser (The main /rank command logic)
// ---------------------------------------------------------
async function transferUser(auth, spreadsheetId, username, member, currentRank, newRank, guild, webhook) {
    const sheets = google.sheets({ version: 'v4', auth });

    // --- CASE A: PLACEMENT -> RECRUITS ---
    if (currentRank === "Placement Phase Two" && newRank.includes("Recruit")) {
        const pRes = await sheets.spreadsheets.values.get({ 
            spreadsheetId, 
            range: formatRange(TABS.PLACEMENT, `B1:D100`) 
        });
        const pRows = pRes.data.values || [];
        let dateJoined = getTodayDate();
        let pRowNum = -1;

        for (let i=0; i < pRows.length; i++) {
            if (normalizeName(pRows[i][0]) === normalizeName(username)) {
                dateJoined = pRows[i][2] || dateJoined;
                pRowNum = i + 1;
                break;
            }
        }
        if (pRowNum === -1) throw new Error("User not found in Placement sheet.");

        const rRow = await findEmptyRow(sheets, spreadsheetId, TABS.RECRUITS);
        await sheets.spreadsheets.values.update({
            spreadsheetId, 
            range: formatRange(TABS.RECRUITS, `B${rRow}:D${rRow}`),
            valueInputOption: 'USER_ENTERED', 
            requestBody: { values: [[username, newRank, dateJoined]] }
        });

        // Clear Placement Row
        await clearRow(sheets, spreadsheetId, TABS.PLACEMENT, pRowNum, ["N/A", "PHASE1", "01/01/2026", "FALSE", "0", "FALSE"]);

        // Discord Roles
        const roleAdd = newRank === "Jet Recruit" ? [ROLES.JET_RECRUIT, ROLES.FN_CORPS] : [ROLES.FLAME_RECRUIT, ROLES.FN_CORPS];
        await modDiscordRoles(member, roleAdd, [ROLES.PASSED_PHASE_2, ROLES.UNASSIGNED_1]);

        // Welcome Message
        const welcomeMsg = `<@${member.user.id}>\n> \n> <:FNTC:1443781891349155890>  | **WELCOME TO THE FN TROOPER CORPS!**\n>\n> Please ensure to inspect all the channels that follow:\n>\n>  https://discord.com/channels/1369082109184053469/1468755814134059089 - Trial Information.\n>  https://discord.com/channels/1369082109184053469/1403795268507533393 - Request your promotion here.\n>  https://discord.com/channels/1369082109184053469/1369082110006267988 - Server rules.\n>\n> -# Signed, FN Trooper Corps Officer Team`;
        const channel = guild.channels.cache.get(WELCOME_CHANNEL);
        if (channel) channel.send(welcomeMsg);

        if (webhook) await webhook.send({ content: `✅ Promoted **${username}** to ${newRank}.` });
        return `✅ Transferred ${username} from Placement to ${newRank}.`;
    }

    // --- CASE B: RECRUIT -> TROOPER ---
    if (currentRank.includes("Recruit") && newRank.includes("Trooper")) {
        const rRes = await sheets.spreadsheets.values.get({ 
            spreadsheetId, 
            range: formatRange(TABS.RECRUITS, `B1:D100`) 
        });
        const rRows = rRes.data.values || [];
        let dateJoined = getTodayDate();
        let rRowNum = -1;

        for (let i=0; i < rRows.length; i++) {
            if (normalizeName(rRows[i][0]) === normalizeName(username)) {
                dateJoined = rRows[i][2] || dateJoined;
                rRowNum = i + 1; break;
            }
        }
        if (rRowNum === -1) throw new Error("User not found in Recruits sheet.");

        const isJet = newRank.includes("Jet");
        const targetTab = isJet ? TABS.JETPACK : TABS.FLAMETROOPER;
        const targetTitle = isJet ? "Jet Trooper" : "Flametrooper";
        
        const tRow = await findEmptyRow(sheets, spreadsheetId, targetTab);
        await sheets.spreadsheets.values.update({
            spreadsheetId, 
            range: formatRange(targetTab, `B${tRow}:D${tRow}`),
            valueInputOption: 'USER_ENTERED', 
            requestBody: { values: [[username, targetTitle, dateJoined]] }
        });
        
        // Add completion flag to Col I
        await sheets.spreadsheets.values.update({
            spreadsheetId, 
            range: formatRange(targetTab, `I${tRow}`),
            valueInputOption: 'USER_ENTERED', 
            requestBody: { values: [["TRUE"]] }
        });

        // Reset Recruit Row
        await clearRow(sheets, spreadsheetId, TABS.RECRUITS, rRowNum, ["N/A", "N/A", "01/01/2026", "0", "FALSE", "0", "FALSE"]);

        // Role Updates
        if (isJet) {
            await modDiscordRoles(member, [ROLES.JET_COMPANY_ROLE_1, ROLES.JET_COMPANY_ROLE_2, ROLES.JET_TROOPER], [ROLES.UNASSIGNED_2, ROLES.JET_RECRUIT]);
        } else {
            await modDiscordRoles(member, [ROLES.FLAME_COMPANY_ROLE_1, ROLES.FLAME_TROOPER, ROLES.FLAME_COMPANY_ROLE_2], [ROLES.FLAME_RECRUIT, ROLES.UNASSIGNED_2]);
        }

        if (webhook) await webhook.send({ content: `✅ Promoted **${username}** to ${newRank}.` });
        return `✅ Promoted ${username} to ${newRank} in ${targetTab}.`;
    }

    // --- CASE C: STANDARD PROGRESSION ---
    const standardPromos = {
        "Jet Trooper-Senior Jet Trooper": { add: [ROLES.SENIOR_JET_TROOPER], rem: [ROLES.JET_TROOPER] },
        "Senior Jet Trooper-Veteran Trooper": { add: [ROLES.VETERAN_TROOPER], rem: [ROLES.SENIOR_JET_TROOPER] },
        "Flame Trooper-Senior Flame Trooper": { add: [ROLES.SENIOR_FLAME_TROOPER], rem: [ROLES.FLAME_TROOPER] },
        "Senior Flame Trooper-Veteran Trooper": { add: [ROLES.VETERAN_TROOPER], rem: [ROLES.SENIOR_FLAME_TROOPER] },
        "Veteran Trooper-Specialist": { add: [ROLES.SPECIALIST], rem: [ROLES.VETERAN_TROOPER] },
        "Specialist-Corporal": { add: [ROLES.CORPORAL], rem: [ROLES.SPECIALIST] }
    };

    const promoKey = `${currentRank}-${newRank}`;
    if (standardPromos[promoKey]) {
        await modDiscordRoles(member, standardPromos[promoKey].add, standardPromos[promoKey].rem);
        if (webhook) await webhook.send({ content: `✅ Promoted **${username}** from ${currentRank} to ${newRank}.` });
        return `✅ Promoted ${username} from ${currentRank} to ${newRank}. Roles updated.`;
    }

    return "⚠️ Promotion path not recognized or currently implemented.";
}

module.exports = { transferUser, handlePromotionRequest };