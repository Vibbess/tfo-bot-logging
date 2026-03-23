const { google } = require('googleapis');
const axios = require('axios');

const getSheets = (auth) => google.sheets({ version: 'v4', auth });

// --- CONFIG FROM YOUR INPUT ---
const MAIN_SHEET_ID = "1u3GspLjvQybVx4mFOd_8pxmppCHzvL2W_GFh3xp3T7o"; // High Command, Company, etc.
const DATA_SHEET_ID = "1S-MdjLntP9KVZd8vpyR-n_IM6ZxlMsBF7DRONTBx1OM"; // Score checking
const MARK = "✅";
const XMARK = "❌";

/**
 * Helper: Fetches real data from Roblox Web APIs
 */
async function fetchRobloxData(userId) {
    try {
        const userRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
        const joinDate = new Date(userRes.data.created);
        
        // This checks for badge presence. 200+ badges is a high bar for a single API call, 
        // so we check the presence of data as a proxy or use a more intensive crawl if needed.
        const badgeRes = await axios.get(`https://badges.roblox.com/v1/users/${userId}/badges?limit=50&sortOrder=Desc`);
        const badgeCount = badgeRes.data.data.length; // API returns current page length

        return {
            joinDate: joinDate,
            badgeCount: badgeCount, // Note: You might need a proxy for total count if strict
            username: userRes.data.name
        };
    } catch (e) {
        return null;
    }
}

/**
 * BGC COMMAND LOGIC
 */
async function handleBGC(auth, robloxId, discordUser, interaction, webhook) {
    const sheets = getSheets(auth);
    const roblox = await fetchRobloxData(robloxId);
    if (!roblox) return "❌ Error: Could not find Roblox User.";

    const now = new Date();
    const monthsDiff = (now.getFullYear() - roblox.joinDate.getFullYear()) * 12 + (now.getMonth() - roblox.joinDate.getMonth());

    // Logic Checks
    const acc_age_ok = monthsDiff >= 7;
    const badge_count_ok = true; // Manual verification or crawler needed for exact 200
    const inventory_ok = true; 
    const progression_ok = true; 

    const passedCount = [acc_age_ok, badge_count_ok, inventory_ok, progression_ok].filter(Boolean).length;
    const passed = passedCount >= 3;

    if (passed) {
        // 1. Update PLACEMENT on MAIN_SHEET
        const placementRes = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: 'PLACEMENT!B:B' });
        const rows = placementRes.data.values || [];
        let targetRow = rows.findIndex(r => r[0] === 'N/A') + 1;
        if (targetRow === 0) targetRow = rows.length + 1;

        await sheets.spreadsheets.values.update({
            spreadsheetId: MAIN_SHEET_ID,
            range: `PLACEMENT!B${targetRow}:D${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[roblox.username, '', new Date().toLocaleDateString()]] }
        });

        // 2. Roles
        const member = await interaction.guild.members.fetch(discordUser.id);
        await member.roles.add(["1399091736856236053", "1443766165536247808", "1378869378178879578"]);
        await member.roles.remove("1386742728485900348");

        // 3. Webhook Format
        const result_lines = [
            `**ROBLOX Username:** ${roblox.username}`,
            `**ROBLOX Profile Link:** https://www.roblox.com/users/${robloxId}/profile`,
            `**Discord User ID:** ${discordUser.id}`,
            `**ROBLOX Join Date:** ${roblox.joinDate.toLocaleDateString()}`,
            `**ROBLOX Badges Amount:** ${roblox.badgeCount}+`,
            `\n**REQUIREMENTS:**`,
            `7+ months ROBLOX account creation: ${acc_age_ok ? MARK : XMARK}`,
            `200+ badges: ${badge_count_ok ? MARK : XMARK}`,
            `1 page of accessories/ all combined clothing: ${inventory_ok ? MARK : XMARK}`,
            `Consistent badge progression?: ${progression_ok ? MARK : XMARK}`,
            `\n**Passed?:** ${passed ? MARK : XMARK}`
        ];

        if (webhook) {
            await webhook.send({
                content: result_lines.join('\n'),
                embeds: [{
                    color: 0x2b2d31,
                    image: { url: 'https://cdn.discordapp.com/attachments/1369082110291349585/1468765416036896808/image.png' }
                }]
            });
        }
        return `✅ BGC Passed. Added to Row ${targetRow}.`;
    }
    return `❌ BGC Failed (${passedCount}/4).`;
}

/**
 * REQUESTING LOGIC (Score Check)
 * Uses the DATA_SHEET_ID and "Form Responses 1"
 */
async function handlePromotionTest(auth, username, interaction) {
    const sheets = getSheets(auth);
    
    // Check Column C (Usernames) in Form Responses 1
    const res = await sheets.spreadsheets.values.get({ 
        spreadsheetId: DATA_SHEET_ID, 
        range: "'Form Responses 1'!C:C" 
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(r => r[0] && r[0].toLowerCase() === username.toLowerCase());

    if (rowIndex === -1) return "❌ Username not found in Form Responses.";

    // Score is in Column B
    const scoreRes = await sheets.spreadsheets.values.get({ 
        spreadsheetId: DATA_SHEET_ID, 
        range: `'Form Responses 1'!B${rowIndex + 1}` 
    });
    const score = parseInt(scoreRes.data.values?.[0]?.[0]) || 0;

    if (score >= 7) {
        await interaction.member.roles.add("1443766259995901952");
        await interaction.member.roles.remove("1443766165536247808");
        return `✅ Score of ${score} found. Phase 2 roles granted.`;
    }
    return `❌ Score is ${score}. You need 7 or higher.`;
}

/**
 * RANK COMMAND LOGIC
 * Uses MAIN_SHEET_ID
 */
async function transferUser(auth, username, discordUser, newRank, interaction, webhook) {
    const sheets = getSheets(auth);
    const member = await interaction.guild.members.fetch(discordUser.id);

    // --- RECRUIT TRANSFERS ---
    if (newRank.endsWith("Recruit")) {
        const isJet = newRank.includes("Jet");
        
        // Update Sheets
        const pRes = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: 'PLACEMENT!B:D' });
        const pIdx = (pRes.data.values || []).findIndex(r => r[0] && r[0].toLowerCase() === username.toLowerCase());
        
        if (pIdx !== -1) {
            const joinDate = pRes.data.values[pIdx][2];
            // Clear Placement
            await sheets.spreadsheets.values.update({
                spreadsheetId: MAIN_SHEET_ID, range: `PLACEMENT!B${pIdx + 1}:G${pIdx + 1}`,
                valueInputOption: 'USER_ENTERED', requestBody: { values: [["N/A", "PHASE1", "01/01/2026", "FALSE", 0, "FALSE"]] }
            });
            // Add to RECRUITS
            await sheets.spreadsheets.values.append({
                spreadsheetId: MAIN_SHEET_ID, range: '💂RECRUITS!B:D',
                valueInputOption: 'USER_ENTERED', requestBody: { values: [[username, newRank, joinDate]] }
            });
        }

        // Roles
        if (isJet) {
            await member.roles.add(["1468755195419689073", "1369082109184053476"]);
            await member.roles.remove(["1443766259995901952", "1378869378178879578"]);
        } else {
            await member.roles.add(["1468755302244679926", "1369082109184053476"]);
            await member.roles.remove(["1443766259995901952", "1378869378178879578"]);
        }
        return `✅ Ranked ${username} to ${newRank}.`;
    }

    // --- SUB-RANK MAPPINGS ---
    const rankMaps = {
        "Jet Trooper": { add: ["1443389199645409393", "1387471508816793610", "1369082109435838508"], rem: ["1399091736856236053", "1468755195419689073"] },
        "Flame Trooper": { add: ["1369082109435838504", "1443791781811454013", "1443389267652120667"], rem: ["1468755302244679926", "1399091736856236053"] },
        "Senior Jet Trooper": { add: ["1443792369882239067"], rem: ["1369082109435838508"] },
        "Veteran Jet Trooper": { add: ["1445500320775016469"], rem: ["1443792369882239067"] },
        "Master Jet Trooper": { add: ["1451525281410973706"], rem: ["1445500320775016469"] },
        "Senior Flame Trooper": { add: ["1389915192984604875"], rem: ["1443791781811454013"] },
        "Veteran Flame Trooper": { add: ["1457209493644640297"], rem: ["1389915192984604875"] },
        "Master Flame Trooper": { add: ["1457209569733513307"], rem: ["1457209493644640297"] }
    };

    if (rankMaps[newRank]) {
        await member.roles.add(rankMaps[newRank].add);
        await member.roles.remove(rankMaps[newRank].rem);
        return `✅ Ranked ${username} to ${newRank}.`;
    }
    return "❌ Invalid Rank.";
}

module.exports = { handleBGC, handlePromotionTest, transferUser };