const config = require('./config');
const { EmbedBuilder } = require('discord.js');
const axios = require('axios'); // Ensure you run 'npm install axios'

// Helpers
function normalizeName(name) {
    if (!name) return "";
    return name.toString().split('|')[0].trim().normalize('NFKC').replace(/[@\(\)]/g, "").replace(/[^\w\d_]+/g, "").toLowerCase();
}

function getNextSaturday() {
    const today = new Date();
    const resultDate = new Date(today);
    const daysUntilSat = (6 - today.getDay() + 7) % 7 || 7;
    resultDate.setDate(today.getDate() + daysUntilSat);
    return `${resultDate.getMonth() + 1}/${resultDate.getDate()}/${resultDate.getFullYear()}`;
}

async function findRow(sheet, val, colIndex) {
    await sheet.loadCells();
    for (let i = 0; i < sheet.rowCount; i++) {
        const cellVal = sheet.getCell(i, colIndex).value;
        if (normalizeName(cellVal) === normalizeName(val)) return i;
    }
    return -1;
}

async function findEmptyRow(sheet, colIndex) {
    await sheet.loadCells();
    for (let i = 0; i < sheet.rowCount; i++) {
        const val = sheet.getCell(i, colIndex).value;
        if (!val || val === "N/A" || val === "") return i;
    }
    return -1;
}

/**
 * BGC COMMAND LOGIC
 */
async function handleBGC(doc, interaction, webhook) {
    const robloxId = interaction.options.getString('roblox_userid');
    const targetMember = interaction.options.getMember('discord_user');
    
    // --- START DATA FETCH SIMULATION ---
    // In a real scenario, you'd use axios to call Roblox APIs here. 
    // I am setting these as placeholders based on your provided format.
    const username = "RobloxUser"; // Should fetch via API
    const profile_url = `https://www.roblox.com/users/${robloxId}/profile`;
    const join_date = "01/01/2020"; 
    const badge_count = 250;
    
    const acc_age_ok = true; // Logic: check if > 7 months
    const badge_count_ok = badge_count >= 200;
    const inventory_ok = true; 
    const progression_ok = true;

    const requirements_met = [acc_age_ok, badge_count_ok, inventory_ok, progression_ok].filter(v => v).length;
    const passed = requirements_met >= 3;
    const MARK = "✅", XMARK = "❌";
    // --- END DATA FETCH ---

    if (passed) {
        const sheet = doc.sheetsByTitle[config.PLACEMENT_TAB];
        const row = await findEmptyRow(sheet, 1); // Column B
        
        sheet.getCell(row, 1).value = username;
        sheet.getCell(row, 3).value = new Date().toLocaleDateString('en-US'); // Today's Date
        await sheet.saveUpdatedCells();

        await targetMember.roles.add(["1399091736856236053", "1443766165536247808", "1378869378178879578"]);
        await targetMember.roles.remove("1386742728485900348");
    }

    // WEBHOOK LOGGING (Format provided)
    let result_lines = [];
    result_lines.append(`**ROBLOX Username:** ${username}`);
    result_lines.append(`**ROBLOX Profile Link:** ${profile_url}`);
    result_lines.append(`**Discord User ID:** ${targetMember.id}`);
    result_lines.append(`**ROBLOX Join Date:** ${join_date}`);
    result_lines.append(`**ROBLOX Badges Amount:** ${badge_count}`);

    result_lines.append("\n**REQUIREMENTS:**");
    result_lines.append(`7+ months ROBLOX account creation: ${acc_age_ok ? MARK : XMARK}`);
    result_lines.append(`200+ badges: ${badge_count_ok ? MARK : XMARK}`);
    result_lines.append(`1 page of accessories/ all combined clothing: ${inventory_ok ? MARK : XMARK}`);
    result_lines.append(`Consistent badge progression?: ${progression_ok ? MARK : XMARK}`);

    result_lines.append(`\n**Passed?:** ${passed ? MARK : XMARK}`);

    const embed = new EmbedBuilder()
        .setTitle("Background Check Results")
        .setDescription(result_lines.join('\n'))
        .setColor(passed ? 0x00FF00 : 0xFF0000)
        .setTimestamp();

    if (webhook) await webhook.send({ embeds: [embed] });
    return passed ? `Successfully passed **${username}**.` : `**${username}** failed the BGC.`;
}

/**
 * PROMOTION TEST REQUEST
 */
async function handlePromotionTest(doc, interaction) {
    const username = interaction.options.getString('roblox_username');
    
    // Connect to external test sheet
    const testDoc = new GoogleSpreadsheet('1S-MdjLntP9KVZd8vpyR-n_IM6ZxlMsBF7DRONTBx1OM', doc.auth);
    await testDoc.loadInfo();
    const testSheet = testDoc.sheetsById['1287311031'];
    
    const testRowIdx = await findRow(testSheet, username, 2); // Check Column C
    if (testRowIdx === -1) return "Username not found on the test sheet.";

    const score = parseInt(testSheet.getCell(testRowIdx, 1).value); // Check Column B

    const mainSheet = doc.sheetsByTitle[config.PLACEMENT_TAB];
    const mainRowIdx = await findRow(mainSheet, username, 1);
    if (mainRowIdx === -1) return "User not found on the Placement sheet.";

    if (score >= 7) {
        mainSheet.getCell(mainRowIdx, 2).value = "PHASE2"; // Column C
        await interaction.member.roles.add("1443766259995901952");
        await interaction.member.roles.remove("1443766165536247808");
        await mainSheet.saveUpdatedCells();
        return "You passed! Rank updated to Phase 2.";
    } else {
        const currentStrikes = parseInt(mainSheet.getCell(mainRowIdx, 5).value || 0); // Column F
        mainSheet.getCell(mainRowIdx, 5).value = currentStrikes + 1;
        await mainSheet.saveUpdatedCells();
        return "You failed the test. A strike has been added to your record.";
    }
}

/**
 * MAIN RANKING LOGIC
 */
async function transferUser(doc, username, targetMember, currentRank, newRank, interaction, webhook) {
    await doc.loadInfo();

    // SCENARIO 1: PHASE TWO -> JET/FLAME RECRUIT
    if (currentRank === "Placement Phase Two") {
        const placementSheet = doc.sheetsByTitle[config.PLACEMENT_TAB];
        const recruitSheet = doc.sheetsByTitle[config.RECRUITS_TAB];

        const pRow = await findRow(placementSheet, username, 1);
        if (pRow === -1) throw new Error("User not found in Placement.");

        const dateJoined = placementSheet.getCell(pRow, 3).value; // Column D

        // 1. Move to Recruits
        const rRow = await findEmptyRow(recruitSheet, 1);
        recruitSheet.getCell(rRow, 1).value = username; // B
        recruitSheet.getCell(rRow, 3).value = dateJoined; // D
        recruitSheet.getCell(rRow, 2).value = newRank; // C

        // 2. Reset Placement Row
        const pCells = [
            { col: 1, val: "N/A" },      // B
            { col: 2, val: "PHASE1" },   // C
            { col: 3, val: "01/01/2026" }, // D
            { col: 4, val: false },      // E
            { col: 5, val: 0 },          // F
            { col: 6, val: false }       // G
        ];
        pCells.forEach(c => placementSheet.getCell(pRow, c.col).value = c.val);

        await placementSheet.saveUpdatedCells();
        await recruitSheet.saveUpdatedCells();

        // 3. Roles and Welcome
        if (newRank === "Jet Recruit") {
            await targetMember.roles.add(["1468755195419689073", "1369082109184053476"]);
        } else {
            await targetMember.roles.add(["1468755302244679926", "1369082109184053476"]);
        }
        await targetMember.roles.remove(["1443766259995901952", "1378869378178879578"]);

        const welcomeChannel = interaction.guild.channels.cache.get("1468756387562782732");
        await welcomeChannel.send({
            content: `<@${targetMember.id}>\n> \n> <:FNTC:1443781891349155890>  | **WELCOME TO THE FN TROOPER CORPS!**\n> \n> Please ensure to inspect all the channels that follow:\n> \n>  https://discord.com/channels/1369082109184053469/1468755814134059089 - Trial Information.\n>  https://discord.com/channels/1369082109184053469/1403795268507533393 - Request your promotion here once you finish your trial.\n>  https://discord.com/channels/1369082109184053469/1369082110006267988 - Server rules.\n>  https://discord.com/channels/1369082109184053469/1443405151149752452 - Frequently asked questions can be found here.\n>  https://discord.com/channels/1369082109184053469/1369082110006267989 - Read our documents.\n> \n> -# Signed,\n> -# FN Trooper Corps, Officer Team`
        });
    }

    // SCENARIO 2: RECRUIT -> TROOPER (COMPANY)
    else if (currentRank.includes("Recruit") && newRank.includes("Trooper")) {
        const recruitSheet = doc.sheetsByTitle[config.RECRUITS_TAB];
        const companySheet = newRank.includes("Jet") ? doc.sheetsByTitle[config.JETPACK_TAB] : doc.sheetsByTitle[config.FLAMETROOPER_TAB];

        const rRow = await findRow(recruitSheet, username, 1);
        const dateJoined = recruitSheet.getCell(rRow, 3).value;

        const cRow = await findEmptyRow(companySheet, 1);
        companySheet.getCell(cRow, 1).value = username; // B
        companySheet.getCell(cRow, 3).value = dateJoined; // D
        companySheet.getCell(cRow, 8).value = true; // I = TRUE
        companySheet.getCell(cRow, 8).note = `New Trooper, (${getNextSaturday()})`;

        // Reset Recruit Row
        const resetVals = ["N/A", "N/A", "01/01/2026", 0, false, 0, false];
        resetVals.forEach((v, i) => recruitSheet.getCell(rRow, i + 1).value = v);

        await recruitSheet.saveUpdatedCells();
        await companySheet.saveUpdatedCells();

        // Roles
        if (newRank.includes("Jet")) {
            await targetMember.roles.add(["1443389199645409393", "1387471508816793610", "1369082109435838508"]);
            await targetMember.roles.remove(["1399091736856236053", "1468755195419689073"]);
        } else {
            await targetMember.roles.add(["1369082109435838504", "1443791781811454013", "1443389267652120667"]);
            await targetMember.roles.remove(["1468755302244679926", "1399091736856236053"]);
        }
    }

    // SCENARIO 3: INTERNAL COMPANY RANK UPS
    else {
        const jetRanks = {
            "Jet Trooper": "1369082109435838508",
            "Senior Jet Trooper": "1443792369882239067",
            "Veteran Trooper": "1445500320775016469",
            "Specialist": "1445500422147281039",
            "Corporal": "1445500469622345921"
        };
        const flameRanks = {
            "Flame Trooper": "1443791781811454013",
            "Senior Flame Trooper": "1389915192984604875",
            "Veteran Trooper": "1457209493644640297",
            "Specialist": "1457209610875437137",
            "Corporal": "1457209756015136979"
        };

        if (jetRanks[currentRank] && jetRanks[newRank]) {
            await targetMember.roles.add(jetRanks[newRank]);
            await targetMember.roles.remove(jetRanks[currentRank]);
        } else if (flameRanks[currentRank] && flameRanks[newRank]) {
            await targetMember.roles.add(flameRanks[newRank]);
            await targetMember.roles.remove(flameRanks[currentRank]);
        }
    }

    return `Successfully promoted **${username}** to **${newRank}**.`;
}

module.exports = { transferUser, handlePromotionTest, handleBGC };