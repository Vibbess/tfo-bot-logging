const { google } = require('googleapis');
const { ROLES, TABS, WELCOME_CHANNEL, EXTERNAL_SHEET_ID } = require('./config');

// ------------------ HELPERS ------------------

function normalizeName(name) {
    return name ? name.toString().split('|')[0].trim().toLowerCase() : "";
}

function getTodayDate() {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function isAuthorized(member) {
    return member.roles.cache.has(ROLES.AUTH_ROLE);
}

// FIXED ROLE FUNCTION
async function modDiscordRoles(member, addList, removeList) {
    try {
        const safeRemove = removeList.filter(r => !addList.includes(r));

        if (safeRemove.length > 0) {
            await member.roles.remove(safeRemove);
        }

        if (addList.length > 0) {
            await member.roles.add(addList);
        }

    } catch (e) {
        console.error("Role modification failed:", e);
    }
}

async function findEmptyRow(sheets, spreadsheetId, tab, col = 'B', max = 200) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tab}!${col}1:${col}${max}`
    });

    const rows = res.data.values || [];

    for (let i = 0; i < max; i++) {
        if (!rows[i] || !rows[i][0] || rows[i][0] === "N/A") return i + 1;
    }

    return max + 1;
}

// ------------------ PROMOTION REQUEST ------------------

async function handlePromotionRequest(auth, username, member) {
    const sheets = google.sheets({ version: 'v4', auth });

    // CHECK EXTERNAL SHEET
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: EXTERNAL_SHEET_ID,
        range: `Sheet1!B:C`
    });

    const rows = res.data.values || [];
    let passed = false;

    for (let row of rows) {
        if (normalizeName(row[1]) === normalizeName(username)) {
            const score = parseInt(row[0] || 0);
            if (score >= 7) passed = true;
            break;
        }
    }

    const MAIN = process.env.SHEET_ID;

    const placement = await sheets.spreadsheets.values.get({
        spreadsheetId: MAIN,
        range: `${TABS.PLACEMENT}!B:F`
    });

    const rowsP = placement.data.values || [];

    for (let i = 0; i < rowsP.length; i++) {
        if (normalizeName(rowsP[i][0]) === normalizeName(username)) {

            const row = i + 1;

            if (passed) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: MAIN,
                    range: `${TABS.PLACEMENT}!C${row}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [["PHASE2"]] }
                });

                await modDiscordRoles(
                    member,
                    [ROLES.PASSED_PHASE_2],
                    [ROLES.REQ_PROMO_ROLE]
                );

                return `✅ Passed → PHASE2`;
            } else {
                const fails = parseInt(rowsP[i][4] || 0);

                await sheets.spreadsheets.values.update({
                    spreadsheetId: MAIN,
                    range: `${TABS.PLACEMENT}!F${row}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[fails + 1]] }
                });

                return `❌ Failed → +1 Fail`;
            }
        }
    }

    return "User not found.";
}

// ------------------ MAIN RANK FUNCTION ------------------

async function transferUser(auth, spreadsheetId, username, member, currentRank, newRank, guild) {
    const sheets = google.sheets({ version: 'v4', auth });

    // ---------------- PLACEMENT → RECRUIT ----------------
    if (currentRank === "Placement Phase Two" && newRank.includes("Recruit")) {

        const pData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${TABS.PLACEMENT}!B:G`
        });

        const rows = pData.data.values || [];

        let dateJoined = getTodayDate();
        let rowNum = -1;

        for (let i = 0; i < rows.length; i++) {
            if (normalizeName(rows[i][0]) === normalizeName(username)) {
                dateJoined = rows[i][2];
                rowNum = i + 1;
                break;
            }
        }

        if (rowNum === -1) throw new Error("User not found in Placement");

        const newRow = await findEmptyRow(sheets, spreadsheetId, TABS.RECRUITS);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${TABS.RECRUITS}!B${newRow}:D${newRow}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [[username, newRank, dateJoined]]
            }
        });

        // CLEAR PLACEMENT
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${TABS.PLACEMENT}!B${rowNum}:G${rowNum}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [["N/A","PHASE1","01/01/2026","FALSE","0","FALSE"]]
            }
        });

        // ROLES
        if (newRank === "Jet Recruit") {
            await modDiscordRoles(member,
                [ROLES.JET_RECRUIT, ROLES.FN_CORPS],
                [ROLES.PASSED_PHASE_2, ROLES.UNASSIGNED_1]
            );
        } else {
            await modDiscordRoles(member,
                [ROLES.FLAME_RECRUIT, ROLES.FN_CORPS],
                [ROLES.PASSED_PHASE_2, ROLES.UNASSIGNED_1]
            );
        }

        // WELCOME MESSAGE
        const channel = guild.channels.cache.get("1404225235007570040");
        if (channel) {
            channel.send(`<@${member.id}>

> <:FNTC:1443781891349155890>  | **WELCOME TO THE FN TROOPER CORPS!**
> 
> Please ensure to inspect all the channels that follow:
> 
> https://discord.com/channels/1369082109184053469/1468755814134059089
> https://discord.com/channels/1369082109184053469/1403795268507533393
> https://discord.com/channels/1369082109184053469/1369082110006267988
> https://discord.com/channels/1369082109184053469/1443405151149752452
> https://discord.com/channels/1369082109184053469/1369082110006267989`);
        }

        return "✅ Placement → Recruit complete";
    }

    // ---------------- RECRUIT → TROOPER ----------------
    if (currentRank.includes("Recruit") && newRank.includes("Trooper")) {

        const rData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${TABS.RECRUITS}!B:H`
        });

        const rows = rData.data.values || [];

        let rowNum = -1;
        let dateJoined = "";

        for (let i = 0; i < rows.length; i++) {
            if (normalizeName(rows[i][0]) === normalizeName(username)) {
                rowNum = i + 1;
                dateJoined = rows[i][2];
                break;
            }
        }

        if (rowNum === -1) throw new Error("User not found in Recruits");

        const isJet = newRank.includes("Jet");
        const targetTab = isJet ? TABS.JETPACK : TABS.FLAMETROOPER;

        const newRow = await findEmptyRow(sheets, spreadsheetId, targetTab);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${targetTab}!B${newRow}:I${newRow}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [[
                    "N/A",
                    username,
                    newRank,
                    dateJoined,
                    "", "", "", "",
                    "TRUE"
                ]]
            }
        });

        // CLEAR RECRUITS
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${TABS.RECRUITS}!B${rowNum}:H${rowNum}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [["N/A","N/A","01/01/2026","0","FALSE","0","FALSE"]]
            }
        });

        if (isJet) {
            await modDiscordRoles(member,
                [ROLES.JET_COMPANY_ROLE_1, ROLES.JET_COMPANY_ROLE_2, ROLES.JET_TROOPER],
                [ROLES.UNASSIGNED_2, ROLES.JET_RECRUIT]
            );
        } else {
            await modDiscordRoles(member,
                [ROLES.FLAME_COMPANY_ROLE_1, ROLES.FLAME_COMPANY_ROLE_2, ROLES.FLAME_TROOPER],
                [ROLES.UNASSIGNED_2, ROLES.FLAME_RECRUIT]
            );
        }

        return "✅ Recruit → Trooper complete";
    }

    // ---------------- PROMOTION CHAINS ----------------

    const promos = {
        "Jet Trooper-Senior Jet Trooper": [ROLES.SENIOR_JET_TROOPER, ROLES.JET_TROOPER],
        "Senior Jet Trooper-Veteran Trooper": [ROLES.VETERAN_TROOPER, ROLES.SENIOR_JET_TROOPER],
        "Veteran Trooper-Jet Specialist": [ROLES.SPECIALIST, ROLES.VETERAN_TROOPER],
        "Jet Specialist-Jet Corporal": [ROLES.CORPORAL, ROLES.SPECIALIST],

        "Flame Trooper-Senior Flame Trooper": [ROLES.SENIOR_FLAME_TROOPER, ROLES.FLAME_TROOPER],
        "Senior Flame Trooper-Veteran Trooper": [ROLES.VETERAN_TROOPER, ROLES.SENIOR_FLAME_TROOPER],
        "Veteran Trooper-Flame Specialist": [ROLES.SPECIALIST, ROLES.VETERAN_TROOPER],
        "Flame Specialist-Flame Corporal": [ROLES.CORPORAL, ROLES.SPECIALIST],
    };

    const key = `${currentRank}-${newRank}`;

    if (promos[key]) {
        const [addRole, removeRole] = promos[key];

        await modDiscordRoles(member, [addRole], [removeRole]);

        return `✅ Promoted ${username} to ${newRank}`;
    }

    return "⚠️ Promotion not recognized.";
}

// ---------------- EXPORTS ----------------

module.exports = {
    transferUser,
    handlePromotionRequest,
    isAuthorized
};