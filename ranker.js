const { ROLES, CHANNELS, RANK_PROGRESSION, RECRUITS_TAB, JETPACK_TAB, FLAMETROOPER_TAB, PLACEMENT_TAB } = require('./config');

function normalizeName(name) {
    if (!name) return "";
    return name.toString().trim().toLowerCase();
}

function getNextSaturday() {
    const today = new Date();
    const resultDate = new Date(today);
    const daysUntilSat = (6 - today.getDay() + 7) % 7 || 7;
    resultDate.setDate(today.getDate() + daysUntilSat);
    return `${resultDate.getMonth() + 1}/${resultDate.getDate()}/${resultDate.getFullYear()}`;
}

function getTodayDate() {
    const today = new Date();
    return `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
}

async function sendWebhookLog(webhook, title, description, executor) {
    if (webhook) {
        await webhook.send({
            embeds: [{
                title: title,
                description: description + `\n**Executor:** ${executor}`,
                color: 0x00FF00,
                timestamp: new Date()
            }]
        });
    }
}

async function handleBGC(doc, rbxId, targetMember, executor, webhook) {
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[PLACEMENT_TAB];
    await sheet.loadCells('A1:D100');

    // MOCK ROBLOX API FETCH: You would fetch the real username using the rbxId here.
    const fetchedUsername = `User_${rbxId}`; 

    let emptyRow = -1;
    for (let r = 0; r < 100; r++) {
        const val = sheet.getCell(r, 1).value; // Col B
        if (!val || val === "N/A") {
            emptyRow = r; break;
        }
    }

    if (emptyRow !== -1) {
        sheet.getCell(emptyRow, 1).value = fetchedUsername; // B
        sheet.getCell(emptyRow, 3).value = getTodayDate(); // D
        await sheet.saveUpdatedCells();

        await targetMember.roles.add(ROLES.BGC_PASSED);
        await targetMember.roles.remove(ROLES.BGC_REMOVE);

        await sendWebhookLog(webhook, "BGC Passed", `**User:** ${fetchedUsername} (<@${targetMember.id}>)`, executor);
        return `✅ Background check logged. Assigned to Placement sheet.`;
    }
    return `❌ No empty rows on Placement sheet.`;
}

async function handlePromotionRequest(promoDoc, mainDoc, rbxUser, member, webhook) {
    await promoDoc.loadInfo();
    await mainDoc.loadInfo();
    
    // Promo sheet logic
    const testSheet = promoDoc.sheetsByIndex[0]; // gid=1287311031
    await testSheet.loadCells('B1:C500');

    let passed = false;
    for (let r = 0; r < 500; r++) {
        if (normalizeName(testSheet.getCell(r, 2).value) === normalizeName(rbxUser)) {
            const score = parseFloat(testSheet.getCell(r, 1).value) || 0; // Col B
            if (score >= 7) passed = true;
            break;
        }
    }

    const placeSheet = mainDoc.sheetsByTitle[PLACEMENT_TAB];
    await placeSheet.loadCells('B1:F100');
    
    let pRow = -1;
    for (let r = 0; r < 100; r++) {
        if (normalizeName(placeSheet.getCell(r, 1).value) === normalizeName(rbxUser)) {
            pRow = r; break;
        }
    }

    if (pRow === -1) return `❌ Could not find ${rbxUser} on the Placement sheet.`;

    if (passed) {
        placeSheet.getCell(pRow, 2).value = "PHASE2"; // Col C
        await placeSheet.saveUpdatedCells();

        await member.roles.add(ROLES.PROMOTION_PASSED);
        await member.roles.remove(ROLES.REQUEST_PROMOTION_PERM);
        
        await sendWebhookLog(webhook, "Promotion Requested & Passed", `**User:** ${rbxUser}`, `<@${member.id}>`);
        return `✅ Passed! ${rbxUser} moved to PHASE2. Roles updated.`;
    } else {
        const fails = parseFloat(placeSheet.getCell(pRow, 5).value) || 0; // Col F
        placeSheet.getCell(pRow, 5).value = fails + 1;
        await placeSheet.saveUpdatedCells();
        
        await sendWebhookLog(webhook, "Promotion Requested & Failed", `**User:** ${rbxUser}`, `<@${member.id}>`);
        return `❌ Score below 7. Added +1 to fail count for ${rbxUser}.`;
    }
}

async function transferUser(doc, username, member, fromRank, toRank, executorPing, webhook, client) {
    await doc.loadInfo(); 
    let resMsg = "";

    if (fromRank === "Placement Phase Two" && (toRank === "Jet Recruit" || toRank === "Flame Recruit")) {
        const pSheet = doc.sheetsByTitle[PLACEMENT_TAB];
        const rSheet = doc.sheetsByTitle[RECRUITS_TAB];
        await pSheet.loadCells('A1:G100');
        await rSheet.loadCells('A1:D100');

        let pRow = -1;
        let dateJoined = "01/01/2026";
        for (let r = 0; r < 100; r++) {
            if (normalizeName(pSheet.getCell(r, 1).value) === normalizeName(username)) {
                pRow = r; 
                dateJoined = pSheet.getCell(r, 3).value; // D
                break;
            }
        }
        if (pRow === -1) throw new Error("User not found on Placement sheet.");

        let emptyRRow = -1;
        for (let r = 0; r < 100; r++) {
            if (!rSheet.getCell(r, 1).value || rSheet.getCell(r, 1).value === "N/A") {
                emptyRRow = r; break;
            }
        }

        rSheet.getCell(emptyRRow, 1).value = username; // B
        rSheet.getCell(emptyRRow, 2).value = toRank; // C
        rSheet.getCell(emptyRRow, 3).value = dateJoined; // D

        pSheet.getCell(pRow, 1).value = "N/A";
        pSheet.getCell(pRow, 2).value = "PHASE1";
        pSheet.getCell(pRow, 3).value = "01/01/2026";
        pSheet.getCell(pRow, 4).value = false;
        pSheet.getCell(pRow, 5).value = 0;
        pSheet.getCell(pRow, 6).value = false;

        await pSheet.saveUpdatedCells();
        await rSheet.saveUpdatedCells();

        if (toRank === "Jet Recruit") {
            await member.roles.add(ROLES.JET_RECRUIT);
        } else {
            await member.roles.add(ROLES.FLAME_RECRUIT);
        }
        await member.roles.remove([ROLES.PROMOTION_PASSED, ROLES.RECRUIT_REMOVE]);

        const welcomeChannel = client.channels.cache.get(CHANNELS.WELCOME_CHANNEL);
        if (welcomeChannel) {
            await welcomeChannel.send(`
<@${member.id}>
> 
> <:FNTC:1443781891349155890>  | **WELCOME TO THE FN TROOPER CORPS!**
> 
> Please ensure to inspect all the channels that follow:
> 
>  https://discord.com/channels/1369082109184053469/1468755814134059089 - Trial Information.
>  https://discord.com/channels/1369082109184053469/1403795268507533393 - Request your promotion here once you finish your trial.
>  https://discord.com/channels/1369082109184053469/1369082110006267988 - Server rules.
>  https://discord.com/channels/1369082109184053469/1443405151149752452 - Frequently asked questions can be found here.
>  https://discord.com/channels/1369082109184053469/1369082110006267989 - Read our documents.
> 
> -# Signed,
> -# FN Trooper Corps, Officer Team
            `);
        }
        resMsg = `Promoted ${username} to ${toRank}. Welcome message sent!`;

    } else if ((fromRank === "Jet Recruit" || fromRank === "Flame Recruit") && (toRank === "Jet Trooper" || toRank === "Flame Trooper")) {
        const rSheet = doc.sheetsByTitle[RECRUITS_TAB];
        const tSheet = doc.sheetsByTitle[toRank === "Jet Trooper" ? JETPACK_TAB : FLAMETROOPER_TAB];
        await rSheet.loadCells('A1:H100');
        await tSheet.loadCells('A1:J100');

        let sRow = -1;
        let dateJoined = "01/01/2026";
        for (let r = 0; r < 100; r++) {
            if (normalizeName(rSheet.getCell(r, 1).value) === normalizeName(username)) {
                sRow = r; 
                dateJoined = rSheet.getCell(r, 3).value; // D
                break;
            }
        }
        if (sRow === -1) throw new Error(`${username} not found on RECRUITS sheet.`);

        let dRow = -1;
        for (let r = 0; r < 100; r++) {
            if (!tSheet.getCell(r, 1).value || tSheet.getCell(r, 1).value === "N/A") {
                dRow = r; break;
            }
        }

        tSheet.getCell(dRow, 1).value = username; // B
        tSheet.getCell(dRow, 2).value = toRank; // C
        tSheet.getCell(dRow, 3).value = dateJoined; // D
        tSheet.getCell(dRow, 8).value = true; // I (TRUE)
        tSheet.getCell(dRow, 8).note = "New Trooper, (next Saturday)";

        rSheet.getCell(sRow, 1).value = "N/A";
        rSheet.getCell(sRow, 2).value = "N/A";
        rSheet.getCell(sRow, 3).value = "01/01/2026";
        rSheet.getCell(sRow, 4).value = 0;
        rSheet.getCell(sRow, 5).value = false;
        rSheet.getCell(sRow, 6).value = 0;
        rSheet.getCell(sRow, 7).value = false;

        await rSheet.saveUpdatedCells();
        await tSheet.saveUpdatedCells();

        if (toRank === "Jet Trooper") {
            await member.roles.add(ROLES.JET_TROOPER);
        } else {
            await member.roles.add(ROLES.FLAME_TROOPER);
        }
        await member.roles.remove(ROLES.TROOPER_REMOVE);
        resMsg = `Moved ${username} to ${toRank} Company.`;

    } else {
        // Linear rank progressions
        const transition = `${fromRank} -> ${toRank}`;
        if (RANK_PROGRESSION[transition]) {
            await member.roles.add(RANK_PROGRESSION[transition].add);
            await member.roles.remove(RANK_PROGRESSION[transition].remove);
            resMsg = `Promoted ${username} from ${fromRank} to ${toRank} (Discord Roles updated).`;
        } else {
            return `❌ Unknown rank transition: ${transition}`;
        }
    }

    await sendWebhookLog(webhook, "Rank Updated", `**User:** ${username} (<@${member.id}>)\n**From:** ${fromRank}\n**To:** ${toRank}`, executorPing);
    return `✅ ${resMsg}`;
}

module.exports = { transferUser, handlePromotionRequest, handleBGC };