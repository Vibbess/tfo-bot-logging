const { google } = require('googleapis');
const { ROLES, TABS, WELCOME_CHANNEL, EXTERNAL_SHEET_ID } = require('./config');

function normalizeName(name) { return name ? name.toString().split('|')[0].trim().toLowerCase() : ""; }
function getTodayDate() { const d = new Date(); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }

/**
 * FIXED: Uses member.roles.set or a single transaction to prevent race conditions.
 * We calculate the new role set and apply it once.
 */
async function modDiscordRoles(member, addList, removeList) {
    try {
        // Filter out any undefined/null roles from the lists
        const toAdd = (addList || []).filter(role => role);
        const toRemove = (removeList || []).filter(role => role);

        // Get current roles as an array of IDs, add new ones, and filter out removed ones
        let currentRoleIds = Array.from(member.roles.cache.keys());
        
        let newRoleIds = currentRoleIds
            .concat(toAdd)
            .filter(id => !toRemove.includes(id));

        // Use Set to ensure unique IDs
        await member.roles.set([...new Set(newRoleIds)]);
    } catch (e) { 
        console.error("Role modification failed:", e); 
    }
}

async function findEmptyRow(sheets, spreadsheetId, tab, col = 'B', max = 150) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!${col}1:${col}${max}` });
    const rows = res.data.values || [];
    for (let i = 0; i < max; i++) {
        if (!rows[i] || !rows[i][0] || rows[i][0] === "N/A") return i + 1;
    }
    return max + 1;
}

async function clearRow(sheets, spreadsheetId, tab, rowNum, defaultValues) {
    await sheets.spreadsheets.values.update({
        spreadsheetId, range: `${tab}!B${rowNum}:${String.fromCharCode(64 + defaultValues.length + 1)}${rowNum}`,
        valueInputOption: 'USER_ENTERED', requestBody: { values: [defaultValues] }
    });
}

// 1. handlePromotionRequest
async function handlePromotionRequest(auth, username, member) {
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: EXTERNAL_SHEET_ID, range: `Sheet1!B1:C100` });
    const rows = res.data.values || [];
    
    let passed = false;
    for (let row of rows) {
        if (normalizeName(row[1]) === normalizeName(username)) {
            const score = parseInt(row[0]); 
            if (score >= 7) passed = true;
            break;
        }
    }

    const MAIN_SHEET = process.env.SHEET_ID;
    const placementData = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET, range: `${TABS.PLACEMENT}!B1:F100` });
    const pRows = placementData.data.values || [];
    
    for (let i = 0; i < pRows.length; i++) {
        if (normalizeName(pRows[i][0]) === normalizeName(username)) {
            const rowNum = i + 1;
            if (passed) {
                await sheets.spreadsheets.values.update({ spreadsheetId: MAIN_SHEET, range: `${TABS.PLACEMENT}!C${rowNum}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [["PHASE2"]] }});
                await modDiscordRoles(member, [ROLES.PASSED_PHASE_2], [ROLES.REQ_PROMO_ROLE]);
                return `✅ **${username}** scored 7+! Updated to PHASE2.`;
            } else {
                const currentF = parseInt(pRows[i][4] || 0);
                await sheets.spreadsheets.values.update({ spreadsheetId: MAIN_SHEET, range: `${TABS.PLACEMENT}!F${rowNum}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[currentF + 1]] }});
                return `❌ **${username}** did not pass (<7). Added +1 to F.`;
            }
        }
    }
    return `⚠️ ${username} not found on the placement sheet.`;
}

// 2. transferUser
async function transferUser(auth, spreadsheetId, username, member, currentRank, newRank, guild, webhook) {
    const sheets = google.sheets({ version: 'v4', auth });

    if (currentRank === "Placement Phase Two" && newRank.includes("Recruit")) {
        const pRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TABS.PLACEMENT}!B1:D100` });
        const pRows = pRes.data.values || [];
        let dateJoined = getTodayDate();
        let pRowNum = -1;

        for (let i=0; i < pRows.length; i++) {
            if (normalizeName(pRows[i][0]) === normalizeName(username)) {
                dateJoined = pRows[i][2];
                pRowNum = i + 1;
                break;
            }
        }
        if (pRowNum === -1) throw new Error("User not found in Placement.");

        const rRow = await findEmptyRow(sheets, spreadsheetId, TABS.RECRUITS);
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${TABS.RECRUITS}!B${rRow}:D${rRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [[username, newRank, dateJoined]] }
        });

        await clearRow(sheets, spreadsheetId, TABS.PLACEMENT, pRowNum, ["N/A", "PHASE1", "01/01/2026", "FALSE", "0", "FALSE"]);

        // Updated Roles logic
        const rolesToAdd = [ROLES.FN_CORPS, (newRank === "Jet Recruit" ? ROLES.JET_RECRUIT : ROLES.FLAME_RECRUIT)];
        const rolesToRemove = [ROLES.PASSED_PHASE_2, ROLES.UNASSIGNED_1];
        await modDiscordRoles(member, rolesToAdd, rolesToRemove);

        const welcomeMsg = `<@${member.user.id}>\n> \n> <:FNTC:1443781891349155890>  | **WELCOME TO THE FN TROOPER CORPS!**\n> ... (rest of msg)`;
        const channel = guild.channels.cache.get(WELCOME_CHANNEL);
        if (channel) channel.send(welcomeMsg);

        if (webhook) await webhook.send({ content: `✅ Promoted **${username}** to ${newRank}.` });
        return `✅ Transferred ${username} from Placement to ${newRank}.`;
    }

    if (currentRank.includes("Recruit") && newRank.includes("Trooper")) {
        const rRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TABS.RECRUITS}!B1:D100` });
        const rRows = rRes.data.values || [];
        let dateJoined = getTodayDate();
        let rRowNum = -1;

        for (let i=0; i < rRows.length; i++) {
            if (normalizeName(rRows[i][0]) === normalizeName(username)) {
                dateJoined = rRows[i][2];
                rRowNum = i + 1; break;
            }
        }
        if (rRowNum === -1) throw new Error("User not found in Recruits.");

        const isJet = newRank.includes("Jet");
        const targetTab = isJet ? TABS.JETPACK : TABS.FLAMETROOPER;
        const targetTitle = isJet ? "Jet Trooper" : "Flametrooper";
        
        const tRow = await findEmptyRow(sheets, spreadsheetId, targetTab);
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${targetTab}!B${tRow}:D${tRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [[username, targetTitle, dateJoined]] }
        });
        
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${targetTab}!I${tRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [["TRUE"]] }
        });

        await clearRow(sheets, spreadsheetId, TABS.RECRUITS, rRowNum, ["N/A", "N/A", "01/01/2026", "0", "FALSE", "0", "FALSE"]);

        const add = isJet ? [ROLES.JET_COMPANY_ROLE_1, ROLES.JET_COMPANY_ROLE_2, ROLES.JET_TROOPER] : [ROLES.FLAME_COMPANY_ROLE_1, ROLES.FLAME_TROOPER, ROLES.FLAME_COMPANY_ROLE_2];
        const rem = isJet ? [ROLES.UNASSIGNED_2, ROLES.JET_RECRUIT] : [ROLES.FLAME_RECRUIT, ROLES.UNASSIGNED_2];
        
        await modDiscordRoles(member, add, rem);
        if (webhook) await webhook.send({ content: `✅ Promoted **${username}** to ${newRank}.` });
        return `✅ Promoted ${username} to ${newRank} in ${targetTab}.`;
    }

    // STANDARD PROGRESSION
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

    return "⚠️ Promotion path not recognized.";
}

module.exports = { transferUser, handlePromotionRequest };