const { google } = require('googleapis');
const { ROLES, TABS, WELCOME_CHANNEL, EXTERNAL_SHEET_ID } = require('./config');

function normalizeName(name) { return name ? name.toString().trim().toLowerCase() : ""; }
function getTodayDate() { const d = new Date(); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }

async function modDiscordRoles(member, addList, removeList) {
    try {
        let currentRoleIds = Array.from(member.roles.cache.keys());
        let newRoleIds = currentRoleIds
            .concat(addList.filter(role => role))
            .filter(id => !removeList.includes(id));
        await member.roles.set([...new Set(newRoleIds)]);
    } catch (e) { console.error("Role Error:", e); }
}

async function findEmptyRow(sheets, spreadsheetId, tab, col = 'B') {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!${col}1:${col}200` });
    const rows = res.data.values || [];
    for (let i = 0; i < 200; i++) {
        if (!rows[i] || !rows[i][0] || rows[i][0] === "N/A") return i + 1;
    }
    return rows.length + 1;
}

// 1. /request promotion test
async function handlePromotionRequest(auth, username, member) {
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Check External Sheet (Score in B, Username in C)
    const res = await sheets.spreadsheets.values.get({ 
        spreadsheetId: EXTERNAL_SHEET_ID, 
        range: `Sheet1!B1:C100` 
    });
    const rows = res.data.values || [];
    
    let passed = false;
    for (let row of rows) {
        if (normalizeName(row[1]) === normalizeName(username)) {
            if (parseInt(row[0]) >= 7) passed = true;
            break;
        }
    }

    const MAIN_SHEET = process.env.SHEET_ID;
    const pRes = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET, range: `${TABS.PLACEMENT}!B1:F100` });
    const pRows = pRes.data.values || [];
    
    for (let i = 0; i < pRows.length; i++) {
        if (normalizeName(pRows[i][0]) === normalizeName(username)) {
            const rowNum = i + 1;
            if (passed) {
                await sheets.spreadsheets.values.update({ 
                    spreadsheetId: MAIN_SHEET, range: `${TABS.PLACEMENT}!C${rowNum}`, 
                    valueInputOption: 'USER_ENTERED', requestBody: { values: [["PHASE2"]] }
                });
                await modDiscordRoles(member, [ROLES.PASSED_PHASE_2], [ROLES.REQ_PROMO_ROLE]);
                return `✅ **${username}** passed with 7+! Roles updated to Phase 2.`;
            } else {
                const currentF = parseInt(pRows[i][4] || 0);
                await sheets.spreadsheets.values.update({ 
                    spreadsheetId: MAIN_SHEET, range: `${TABS.PLACEMENT}!F${rowNum}`, 
                    valueInputOption: 'USER_ENTERED', requestBody: { values: [[currentF + 1]] }
                });
                return `❌ **${username}** failed (<7). Added +1 failure to sheet.`;
            }
        }
    }
    return `⚠️ User ${username} not found on Placement sheet.`;
}

// 2. /rank command
async function transferUser(auth, spreadsheetId, username, member, currentRank, newRank, guild) {
    const sheets = google.sheets({ version: 'v4', auth });

    // PLACEMENT -> RECRUITS
    if (currentRank === "Placement Phase Two" && newRank.includes("Recruit")) {
        const pRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TABS.PLACEMENT}!B1:D100` });
        const pRows = pRes.data.values || [];
        let dateJoined = "01/01/2026";
        let pRowNum = -1;

        for (let i=0; i < pRows.length; i++) {
            if (normalizeName(pRows[i][0]) === normalizeName(username)) {
                dateJoined = pRows[i][2];
                pRowNum = i + 1; break;
            }
        }

        const rRow = await findEmptyRow(sheets, spreadsheetId, TABS.RECRUITS);
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${TABS.RECRUITS}!B${rRow}:D${rRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [[username, newRank, dateJoined]] }
        });

        // Reset Placement Row
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${TABS.PLACEMENT}!B${pRowNum}:G${pRowNum}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [["N/A", "PHASE1", "01/01/2026", "FALSE", "0", "FALSE"]] }
        });

        // Roles
        const isJet = newRank === "Jet Recruit";
        const add = isJet ? [ROLES.JET_RECRUIT, ROLES.FN_CORPS] : [ROLES.FLAME_RECRUIT, ROLES.FN_CORPS];
        const rem = [ROLES.PASSED_PHASE_2, ROLES.UNASSIGNED_1];
        await modDiscordRoles(member, add, rem);

        // Welcome Message
        const welcomeMsg = `<@${member.user.id}>\n> \n> <:FNTC:1443781891349155890>  | **WELCOME TO THE FN TROOPER CORPS!**\n>\n> https://discord.com/channels/1369082109184053469/1468755814134059089 - Trial Information...\n> -# FN Trooper Corps, Officer Team`;
        const channel = guild.channels.cache.get(WELCOME_CHANNEL);
        if (channel) channel.send(welcomeMsg);

        return `✅ Transferred ${username} to ${newRank}.`;
    }

    // RECRUIT -> TROOPER
    if (currentRank.includes("Recruit") && newRank.includes("Trooper")) {
        const isJet = newRank.includes("Jet");
        const recruitTab = TABS.RECRUITS;
        const targetTab = isJet ? TABS.JETPACK : TABS.FLAMETROOPER;
        
        const rRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${recruitTab}!B1:D100` });
        const rRows = rRes.data.values || [];
        let dateJoined = "01/01/2026";
        let rRowNum = -1;

        for (let i=0; i < rRows.length; i++) {
            if (normalizeName(rRows[i][0]) === normalizeName(username)) {
                dateJoined = rRows[i][2];
                rRowNum = i + 1; break;
            }
        }

        const tRow = await findEmptyRow(sheets, spreadsheetId, targetTab);
        // Set Data & Note in I
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${targetTab}!B${tRow}:I${tRow}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [[username, newRank, "N/A", dateJoined, "N/A", "N/A", "N/A", "N/A", "TRUE"]] }
        });
        // Note: You may need a separate request for a physical "Cell Note", but setting column I to TRUE as requested.

        // Clear Recruit Row
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: `${recruitTab}!B${rRowNum}:H${rRowNum}`,
            valueInputOption: 'USER_ENTERED', requestBody: { values: [["N/A", "N/A", "01/01/2026", "0", "FALSE", "0", "FALSE"]] }
        });

        const add = isJet ? [ROLES.JET_COMPANY_ROLE_1, ROLES.JET_COMPANY_ROLE_2, ROLES.JET_TROOPER] : [ROLES.FLAME_COMPANY_ROLE_1, ROLES.FLAME_TROOPER, ROLES.FLAME_COMPANY_ROLE_2];
        const rem = isJet ? [ROLES.UNASSIGNED_2, ROLES.JET_RECRUIT] : [ROLES.UNASSIGNED_2, ROLES.FLAME_RECRUIT];
        await modDiscordRoles(member, add, rem);

        return `✅ ${username} is now a ${newRank}.`;
    }

    // STANDARD PROGRESSION
    const progression = {
        // Jet
        "Jet Trooper-Senior Jet Trooper": { add: [ROLES.SENIOR_JET_TROOPER], rem: [ROLES.JET_TROOPER] },
        "Senior Jet Trooper-Veteran Trooper": { add: [ROLES.JET_VETERAN], rem: [ROLES.SENIOR_JET_TROOPER] },
        "Veteran Trooper-Jet Specialist": { add: [ROLES.JET_SPECIALIST], rem: [ROLES.JET_VETERAN] },
        "Jet Specialist-Jet Corporal": { add: [ROLES.JET_CORPORAL], rem: [ROLES.JET_SPECIALIST] },
        // Flame
        "Flame Trooper-Senior Flame Trooper": { add: [ROLES.SENIOR_FLAME_TROOPER], rem: [ROLES.FLAME_TROOPER] },
        "Senior Flame Trooper-Veteran Trooper": { add: [ROLES.FLAME_VETERAN], rem: [ROLES.SENIOR_FLAME_TROOPER] },
        "Veteran Trooper-Flame Specialist": { add: [ROLES.FLAME_SPECIALIST], rem: [ROLES.FLAME_VETERAN] },
        "Flame Specialist-Flame Corporal": { add: [ROLES.FLAME_CORPORAL], rem: [ROLES.FLAME_SPECIALIST] }
    };

    const path = `${currentRank}-${newRank}`;
    if (progression[path]) {
        await modDiscordRoles(member, progression[path].add, progression[path].rem);
        return `✅ ${username} promoted to ${newRank}.`;
    }

    return "⚠️ Rank path not recognized.";
}

module.exports = { transferUser, handlePromotionRequest };