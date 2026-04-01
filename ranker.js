const { google } = require('googleapis');
const { ROLES, TABS, WELCOME_CHANNEL, EXTERNAL_SHEET_ID } = require('./config');

function normalizeName(name) { return name ? name.toString().split('|')[0].trim().toLowerCase() : ""; }
function getTodayDate() { const d = new Date(); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }

async function modDiscordRoles(member, addList, removeList) {
    try {
        if (addList.length > 0) await member.roles.add(addList);
        if (removeList.length > 0) await member.roles.remove(removeList);
    } catch (e) { console.error("Role modification failed:", e); }
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
        spreadsheetId, range: `${tab}!B${rowNum}:${String.fromCharCode(65 + defaultValues.length + 1)}${rowNum}`,
        valueInputOption: 'USER_ENTERED', requestBody: { values: [defaultValues] }
    });
}

// 1. handlePromotionRequest (The External Sheet Check)
async function handlePromotionRequest(auth, username, member) {
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Check external sheet B and C
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: EXTERNAL_SHEET_ID, range: `Sheet1!B1:C100` });
    const rows = res.data.values || [];
    
    let passed = false;
    for (let row of rows) {
        if (normalizeName(row[1]) === normalizeName(username)) {
            const score = parseInt(row[0]); // assuming B is col 0 in B:C fetch, C is col 1
            if (score >= 7) passed = true;
            break;
        }
    }

    // Now update main placement sheet based on pass/fail
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

// 2. transferUser (The main /rank command)
async function transferUser(auth, spreadsheetId, username, member, currentRank, newRank, guild, webhook) {
    const sheets = google.sheets({ version: 'v4', auth });

    // PLACEMENT -> RECRUITS (Jet Recruit or Flame Recruit)
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

        // Add to Recruits
        const rRow = await findEmptyRow(sheets, spreadsheetId, TABS.RECRUITS);
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${TABS.RECRUITS}!B${rRow}:D${rRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [[username, newRank, dateJoined]] }
        });

        // Clear Placement
        await clearRow(sheets, spreadsheetId, TABS.PLACEMENT, pRowNum, ["N/A", "PHASE1", "01/01/2026", "FALSE", "0", "FALSE"]);

        // Roles & Webhook
        if (newRank === "Jet Recruit") {
            await modDiscordRoles(member, [ROLES.JET_RECRUIT, ROLES.FN_CORPS], [ROLES.PASSED_PHASE_2, ROLES.UNASSIGNED_1]);
        } else {
            await modDiscordRoles(member, [ROLES.FLAME_RECRUIT, ROLES.FN_CORPS], [ROLES.PASSED_PHASE_2, ROLES.UNASSIGNED_1]);
        }

        const welcomeMsg = `<@${member.user.id}>\n> \n> <:FNTC:1443781891349155890>  | **WELCOME TO THE FN TROOPER CORPS!**\n>\n> Please ensure to inspect all the channels that follow:\n>\n>  https://discord.com/channels/1369082109184053469/1468755814134059089 - Trial Information.\n>  https://discord.com/channels/1369082109184053469/1403795268507533393 - Request your promotion here once you finish your trial.\n>  https://discord.com/channels/1369082109184053469/1369082110006267988 - Server rules.\n>  https://discord.com/channels/1369082109184053469/1443405151149752452 - Frequently asked questions can be found here.\n>  https://discord.com/channels/1369082109184053469/1369082110006267989 - Read our documents.\n>\n> -# Signed,\n> -# FN Trooper Corps, Officer Team`;
        
        const channel = guild.channels.cache.get(WELCOME_CHANNEL);
        if (channel) channel.send(welcomeMsg);

        if (webhook) await webhook.send({ content: `✅ Promoted **${username}** to ${newRank}.` });
        return `✅ Transferred ${username} from Placement to ${newRank}.`;
    }

    // RECRUIT -> TROOPER
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

        const targetTab = newRank.includes("Jet") ? TABS.JETPACK : TABS.FLAMETROOPER;
        const targetTitle = newRank.includes("Jet") ? "Jet Trooper" : "Flametrooper";
        
        const tRow = await findEmptyRow(sheets, spreadsheetId, targetTab);
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${targetTab}!B${tRow}:D${tRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [[username, targetTitle, dateJoined]] }
        });
        
        // Add note to I
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${targetTab}!I${tRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [["TRUE"]] }
        }); // Realistically, notes require specific google sheets batchUpdate requests, placing TRUE here as a placeholder for the logic map

        await clearRow(sheets, spreadsheetId, TABS.RECRUITS, rRowNum, ["N/A", "N/A", "01/01/2026", "0", "FALSE", "0", "FALSE"]);

        if (newRank.includes("Jet")) {
            await modDiscordRoles(member, [ROLES.JET_COMPANY_ROLE_1, ROLES.JET_COMPANY_ROLE_2, ROLES.JET_TROOPER], [ROLES.UNASSIGNED_2, ROLES.JET_RECRUIT]);
        } else {
            await modDiscordRoles(member, [ROLES.FLAME_COMPANY_ROLE_1, ROLES.FLAME_TROOPER, ROLES.FLAME_COMPANY_ROLE_2], [ROLES.FLAME_RECRUIT, ROLES.UNASSIGNED_2]);
        }
        if (webhook) await webhook.send({ content: `✅ Promoted **${username}** to ${newRank}.` });
        return `✅ Promoted ${username} to ${newRank} in ${targetTab}.`;
    }

    // STANDARD PROGRESSION PROMOTIONS
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