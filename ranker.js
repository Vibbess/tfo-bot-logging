const { google } = require('googleapis');
const axios = require('axios');

const getSheets = (auth) => google.sheets({ version: 'v4', auth });

// --- CONFIG ---
const MAIN_SHEET_ID = "1u3GspLjvQybVx4mFOd_8pxmppCHzvL2W_GFh3xp3T7o";
const DATA_SHEET_ID = "1S-MdjLntP9KVZd8vpyR-n_IM6ZxlMsBF7DRONTBx1OM";

const MARK = "✅";
const XMARK = "❌";

// --- ROBLOX FETCH ---
async function fetchRobloxData(userId) {
    try {
        const userRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
        const joinDate = new Date(userRes.data.created);

        const badgeRes = await axios.get(`https://badges.roblox.com/v1/users/${userId}/badges?limit=50&sortOrder=Desc`);

        return {
            joinDate,
            badgeCount: badgeRes.data.data.length,
            username: userRes.data.name
        };
    } catch {
        return null;
    }
}

// --- BGC ---
async function handleBGC(auth, robloxId, discordUser, interaction, webhook) {
    const sheets = getSheets(auth);
    const roblox = await fetchRobloxData(robloxId);
    if (!roblox) return "❌ Error: Could not find Roblox User.";

    const now = new Date();
    const monthsDiff = (now.getFullYear() - roblox.joinDate.getFullYear()) * 12 +
        (now.getMonth() - roblox.joinDate.getMonth());

    const acc_age_ok = monthsDiff >= 7;
    const badge_count_ok = true;
    const inventory_ok = true;
    const progression_ok = true;

    const passedCount = [acc_age_ok, badge_count_ok, inventory_ok, progression_ok].filter(Boolean).length;
    const passed = passedCount >= 3;

    if (passed) {
        const placementRes = await sheets.spreadsheets.values.get({
            spreadsheetId: MAIN_SHEET_ID,
            range: 'PLACEMENT!B:B'
        });

        const rows = placementRes.data.values || [];
        let targetRow = rows.findIndex(r => r[0] === 'N/A') + 1;
        if (targetRow === 0) targetRow = rows.length + 1;

        await sheets.spreadsheets.values.update({
            spreadsheetId: MAIN_SHEET_ID,
            range: `PLACEMENT!B${targetRow}:D${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[roblox.username, '', new Date().toLocaleDateString()]] }
        });

        const member = await interaction.guild.members.fetch(discordUser.id);

        await member.roles.add(["1399091736856236053", "1443766165536247808", "1378869378178879578"]);
        await member.roles.remove("1386742728485900348");

        return `✅ BGC Passed. Added to Row ${targetRow}.`;
    }

    return `❌ BGC Failed (${passedCount}/4).`;
}

// --- PROMO TEST ---
async function handlePromotionTest(auth, username, interaction) {
    const sheets = getSheets(auth);

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: DATA_SHEET_ID,
        range: "'Form Responses 1'!C:C"
    });

    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] && r[0].toLowerCase() === username.toLowerCase());

    if (rowIndex === -1) return "❌ Username not found.";

    const scoreRes = await sheets.spreadsheets.values.get({
        spreadsheetId: DATA_SHEET_ID,
        range: `'Form Responses 1'!B${rowIndex + 1}`
    });

    const score = parseInt(scoreRes.data.values?.[0]?.[0]) || 0;

    if (score >= 7) {
        await interaction.member.roles.add("1443766259995901952");
        await interaction.member.roles.remove("1443766165536247808");
        return `✅ Passed with ${score}.`;
    }

    return `❌ Score ${score}/7 required.`;
}

// --- ROLE AUTO SYSTEM ---
async function handleAutoRoles(member, newRank) {

    const roleMap = {

    // --- JET ---
    "Jet Trooper": { add: ["1369082109435838508"], remove: [] },
    "Senior Jet Trooper": { add: ["1443792369882239067"], remove: ["1369082109435838508"] },
    "Veteran Jet Trooper": { add: ["1445500320775016469"], remove: ["1443792369882239067"] },

    "Jet Specialist": { add: ["1445500422147281039"], remove: ["1445500320775016469"] },
    "Jet Corporal": { add: ["1445500469622345921"], remove: ["1445500422147281039"] },

    // --- FLAME ---
    "Flame Trooper": { add: ["1443791781811454013"], remove: [] },
    "Senior Flame Trooper": { add: ["1389915192984604875"], remove: ["1443791781811454013"] },
    "Veteran Flame Trooper": { add: ["1457209493644640297"], remove: ["1389915192984604875"] },

    "Flame Specialist": { add: ["1457209610875437137"], remove: ["1457209493644640297"] },
    "Flame Corporal": { add: ["1457209756015136979"], remove: ["1457209610875437137"] }
};

    const config = roleMap[newRank];
    if (!config) return;

    try {
        if (config.remove.length) await member.roles.remove(config.remove);
        if (config.add.length) await member.roles.add(config.add);
    } catch (err) {
        console.error("Role error:", err);
    }
}

// --- RANK ---
async function transferUser(auth, username, discordUser, newRank, interaction, webhook) {
    const sheets = getSheets(auth);

    if (!discordUser) return "❌ Invalid Discord user.";

    const member = await interaction.guild.members.fetch(discordUser.id);

    // --- RECRUITS ---
    if (newRank.includes("Recruit")) {

        const isJet = newRank.includes("Jet");

        const pRes = await sheets.spreadsheets.values.get({
            spreadsheetId: MAIN_SHEET_ID,
            range: 'PLACEMENT!B:D'
        });

        const pIdx = (pRes.data.values || []).findIndex(r =>
            r[0] && r[0].toLowerCase() === username.toLowerCase()
        );

        if (pIdx !== -1) {
            const joinDate = pRes.data.values[pIdx][2];

            await sheets.spreadsheets.values.update({
                spreadsheetId: MAIN_SHEET_ID,
                range: `PLACEMENT!B${pIdx + 1}:G${pIdx + 1}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [["N/A", "PHASE1", "01/01/2026", "FALSE", 0, "FALSE"]] }
            });

            await sheets.spreadsheets.values.append({
                spreadsheetId: MAIN_SHEET_ID,
                range: 'RECRUITS!B:D', // ✅ FIXED (NO EMOJI)
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[username, newRank, joinDate]] }
            });
        }

        if (isJet) {
            await member.roles.add(["1468755195419689073"]);
        } else {
            await member.roles.add(["1468755302244679926"]);
        }

        return `✅ Ranked ${username} to ${newRank}.`;
    }

    // --- AUTO ROLES ---
    await handleAutoRoles(member, newRank);

    return `✅ Ranked ${username} to ${newRank}.`;
}

module.exports = { handleBGC, handlePromotionTest, transferUser };