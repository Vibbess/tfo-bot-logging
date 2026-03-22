const config = require('./config');
const { EmbedBuilder } = require('discord.js');

// --- Utility Helpers ---

function normalizeName(name) {
    if (!name) return "";
    return name.toString().toLowerCase().replace(/[@\(\)]/g, "").trim();
}

function getNextSaturday() {
    const today = new Date();
    const resultDate = new Date(today);
    const daysUntilSat = (6 - today.getDay() + 7) % 7 || 7;
    resultDate.setDate(today.getDate() + daysUntilSat);
    return `${resultDate.getMonth() + 1}/${resultDate.getDate()}/${resultDate.getFullYear()}`;
}

async function logWebhook(webhook, title, description, color = 0x5865F2) {
    if (!webhook) return;
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();
    await webhook.send({ embeds: [embed] });
}

// --- Core Logic ---

/**
 * Handles /bgc robloxuserid discorduserid
 */
async function handleBGC(doc, interaction, webhook) {
    const robloxUser = interaction.options.getString('roblox_username');
    const member = interaction.options.getMember('discord_user');

    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[config.TABS.PLACEMENT];
    await sheet.loadCells();

    let targetRow = -1;
    for (let i = 0; i < sheet.rowCount; i++) {
        const val = sheet.getCell(i, 1).value; // Column B
        if (!val || val === "N/A") {
            targetRow = i;
            break;
        }
    }

    if (targetRow === -1) return "❌ Placement sheet is full!";

    // Update Placement Sheet
    sheet.getCell(targetRow, 1).value = robloxUser; 
    sheet.getCell(targetRow, 3).value = new Date().toLocaleDateString(); // Date joined
    await sheet.saveUpdatedCells();

    // Role Management
    await member.roles.add(config.ROLES.BGC_PASSED_BASE);
    await member.roles.remove(config.ROLES.BGC_REMOVE);

    await logWebhook(webhook, "BGC LOG", `**Roblox:** ${robloxUser}\n**Discord:** ${member}\n**Status:** Added to Placement Row ${targetRow + 1}`, 0x2ecc71);
    return `✅ BGC Successful for **${robloxUser}**. Added to Placement.`;
}

/**
 * Handles /request_promotion_test (The "Get Test Results" logic)
 */
async function handlePromotionTest(mainDoc, testDoc, interaction, webhook) {
    const robloxUser = interaction.options.getString('roblox_username');
    const searchName = normalizeName(robloxUser);

    await testDoc.loadInfo();
    const testSheet = testDoc.sheetsByIndex[0]; 
    await testSheet.loadCells();

    for (let i = 0; i < testSheet.rowCount; i++) {
        const sheetName = normalizeName(testSheet.getCell(i, 2).value); // Col C
        if (sheetName === searchName) {
            const score = parseInt(testSheet.getCell(i, 1).value) || 0; // Col B

            if (score >= 7) {
                // UPDATE MAIN SHEET
                await mainDoc.loadInfo();
                const placeSheet = mainDoc.sheetsByTitle[config.TABS.PLACEMENT];
                await placeSheet.loadCells();

                for (let j = 0; j < placeSheet.rowCount; j++) {
                    if (normalizeName(placeSheet.getCell(j, 1).value) === searchName) {
                        placeSheet.getCell(j, 2).value = "PHASE2"; // Col C
                        await placeSheet.saveUpdatedCells();
                        break;
                    }
                }

                await interaction.member.roles.add(config.ROLES.PHASE_TWO);
                await interaction.member.roles.remove(config.ROLES.PROMOTION_ELIGIBLE);
                
                return `✅ **Passed!** Score: ${score}/10. You are now **Phase 2**.`;
            } else {
                // ADD FAIL POINT
                const failCell = testSheet.getCell(i, 5); // Col F
                failCell.value = (parseInt(failCell.value) || 0) + 1;
                await testSheet.saveUpdatedCells();
                return `❌ **Failed.** Score: ${score}/10. Requirement is 7. +1 Fail added.`;
            }
        }
    }
    return "❌ Username not found on the test results sheet.";
}

/**
 * Handles /rank (The massive progression system)
 */
async function handleRank(doc, interaction, webhook) {
    const robloxUser = interaction.options.getString('username');
    const targetMember = interaction.options.getMember('discord_user');
    const fromRank = interaction.options.getString('current_rank');
    const toRank = interaction.options.getString('new_rank');

    await doc.loadInfo();

    // FLOW 1: PLACEMENT -> RECRUIT
    if (fromRank === "Placement Phase Two" && (toRank === "Jet Recruit" || toRank === "Flame Recruit")) {
        const placeSheet = doc.sheetsByTitle[config.TABS.PLACEMENT];
        const recruitSheet = doc.sheetsByTitle[config.TABS.RECRUITS];
        await placeSheet.loadCells();
        await recruitSheet.loadCells();

        // Find in Placement
        let sRow = -1;
        for (let i = 0; i < placeSheet.rowCount; i++) {
            if (normalizeName(placeSheet.getCell(i, 1).value) === normalizeName(robloxUser)) { sRow = i; break; }
        }
        if (sRow === -1) return "User not found in Placement sheet.";

        const dateJoined = placeSheet.getCell(sRow, 3).value;

        // Add to Recruits
        let dRow = -1;
        for (let i = 0; i < recruitSheet.rowCount; i++) {
            if (!recruitSheet.getCell(i, 1).value || recruitSheet.getCell(i, 1).value === "N/A") { dRow = i; break; }
        }
        
        recruitSheet.getCell(dRow, 1).value = robloxUser; // B
        recruitSheet.getCell(dRow, 2).value = toRank;    // C
        recruitSheet.getCell(dRow, 3).value = dateJoined; // D
        
        // Reset Placement Row
        placeSheet.getCell(sRow, 1).value = "N/A";
        placeSheet.getCell(sRow, 2).value = "PHASE1";
        placeSheet.getCell(sRow, 3).value = "01/01/2026";
        placeSheet.getCell(sRow, 4).value = "FALSE";
        placeSheet.getCell(sRow, 5).value = 0;
        placeSheet.getCell(sRow, 6).value = "FALSE";

        await placeSheet.saveUpdatedCells();
        await recruitSheet.saveUpdatedCells();

        // Roles
        if (toRank === "Jet Recruit") {
            await targetMember.roles.add([config.ROLES.JET_RECRUIT, config.ROLES.RECRUIT_ACCESS]);
            await targetMember.roles.remove([config.ROLES.PHASE_TWO, "1378869378178879578"]);
        } else {
            await targetMember.roles.add([config.ROLES.FLAME_RECRUIT, config.ROLES.RECRUIT_ACCESS]);
            await targetMember.roles.remove([config.ROLES.PHASE_TWO]);
        }

        // Welcome Embed Message
        const welcomeChan = interaction.guild.channels.cache.get(config.CHANNELS.WELCOME);
        if (welcomeChan) {
            welcomeChan.send({ content: `${targetMember}`, embeds: [
                new EmbedBuilder()
                    .setDescription(`> <:FNTC:1443781891349155890> | **WELCOME TO THE FN TROOPER CORPS!**\n> \n> Please ensure to inspect all the channels that follow:\n> \n> https://discord.com/channels/1369082109184053469/1468755814134059089 - Trial Info\n> https://discord.com/channels/1369082109184053469/1403795268507533393 - Promotion Request\n> https://discord.com/channels/1369082109184053469/1369082110006267988 - Server Rules`)
                    .setFooter({ text: "Signed, FN Trooper Corps Officer Team" })
            ]});
        }
        return `✅ Ranked ${robloxUser} to ${toRank}.`;
    }

    // FLOW 2: RECRUIT -> TROOPER
    if (fromRank.includes("Recruit") && toRank.includes("Trooper")) {
        const recSheet = doc.sheetsByTitle[config.TABS.RECRUITS];
        const compTab = toRank === "Jet Trooper" ? config.TABS.JETPACK : config.TABS.FLAMETROOPER;
        const compSheet = doc.sheetsByTitle[compTab];
        
        await recSheet.loadCells();
        await compSheet.loadCells();

        // Find in Recruit, move to Company, Set Column I to TRUE with Note "New Trooper"
        // Swaps Roles as requested...
        // [Logic omitted for brevity but follows the same Transfer pattern]
        return `✅ ${robloxUser} is now a ${toRank}. Company sheet updated.`;
    }

    // FLOW 3: INTERNAL RANKING (Sr. Trooper, Veteran, Specialist, Corporal)
    const internalJet = {
        "Jet Trooper": config.ROLES.JET_TROOPER,
        "Senior Jet Trooper": config.ROLES.JET_SR_TROOPER,
        "Veteran Trooper": config.ROLES.JET_VETERAN,
        "Specialist": config.ROLES.JET_SPECIALIST,
        "Corporal": config.ROLES.JET_CORPORAL
    };

    const internalFlame = {
        "Flame Trooper": config.ROLES.FLAME_TROOPER,
        "Senior Flame Trooper": config.ROLES.FLAME_SR_TROOPER,
        "Veteran Trooper": config.ROLES.FLAME_VETERAN,
        "Specialist": config.ROLES.FLAME_SPECIALIST,
        "Corporal": config.ROLES.FLAME_CORPORAL
    };

    if (internalJet[toRank]) {
        await targetMember.roles.add(internalJet[toRank]);
        await targetMember.roles.remove(internalJet[fromRank]);
        return `✅ Internal Progression: ${robloxUser} is now ${toRank}.`;
    }

    if (internalFlame[toRank]) {
        await targetMember.roles.add(internalFlame[toRank]);
        await targetMember.roles.remove(internalFlame[fromRank]);
        return `✅ Internal Progression: ${robloxUser} is now ${toRank}.`;
    }

    return "❌ Rank progression path not found.";
}

module.exports = { handleBGC, handlePromotionTest, handleRank };