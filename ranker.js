const { RECRUITS_TAB, TROOPER_TAB, RANK_RANGES } = require('./config');

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

async function transferUser(doc, username, fromRank, toRank, executorPing, webhook) {
    await doc.loadInfo(); 

    const fromCfg = RANK_RANGES[fromRank];
    const toCfg = RANK_RANGES[toRank];
    
    if (!fromCfg || !toCfg) throw new Error("Invalid rank configuration.");

    const wsFrom = doc.sheetsByTitle[fromCfg.tab];
    const wsTo = doc.sheetsByTitle[toCfg.tab];

    if (!wsFrom || !wsTo) throw new Error("Could not find worksheet tabs.");

    await wsFrom.loadCells();
    await wsTo.loadCells();

    let sRow = -1;
    for (let r = fromCfg.start; r <= fromCfg.end; r++) {
        const val = wsFrom.getCell(r, 1).value;
        if (normalizeName(val) === normalizeName(username)) {
            sRow = r; break;
        }
    }
    if (sRow === -1) throw new Error(`${username} not found in ${fromRank} section.`);

    let dRow = -1;
    for (let r = toCfg.start; r <= toCfg.end; r++) {
        const val = wsTo.getCell(r, 1).value;
        if (!val || val.toString().trim() === "" || val.toString().trim() === "N/A") {
            dRow = r; break;
        }
    }
    if (dRow === -1) throw new Error(`No empty slots available in ${toRank} section.`);

    if (fromRank === "Recruit" && toRank === "Trooper") {
        wsFrom.getCell(sRow, 1).value = "N/A";
        wsFrom.getCell(sRow, 2).value = "01/01/2026"; 
        wsFrom.getCell(sRow, 3).value = false;        
        for (let c = 4; c <= 6; c++) wsFrom.getCell(sRow, c).value = 0;

        wsTo.getCell(dRow, 1).value = username;
        for (let c = 3; c <= 6; c++) wsTo.getCell(dRow, c).value = 0; 
        wsTo.getCell(dRow, 8).value = 0;     
        wsTo.getCell(dRow, 9).value = true;  
        wsTo.getCell(dRow, 10).value = 0;    
        wsTo.getCell(dRow, 9).note = `Due date: ${getNextSaturday()} (New Trooper)`;
    } 
    else {
        const statD = wsFrom.getCell(sRow, 3).value;
        const statE = wsFrom.getCell(sRow, 4).value;
        const statF = wsFrom.getCell(sRow, 5).value;
        const statG = wsFrom.getCell(sRow, 6).value;
        const boxJ = wsFrom.getCell(sRow, 9).value;
        const noteJ = wsFrom.getCell(sRow, 9).note;

        wsFrom.getCell(sRow, 1).value = "N/A";
        const resetVals = [0, 0, 0, 0, "120 MINUTES", 0, false, 0, false];
        for (let i = 0; i < resetVals.length; i++) {
            wsFrom.getCell(sRow, 3 + i).value = resetVals[i];
        }
        wsFrom.getCell(sRow, 9).note = "";

        wsTo.getCell(dRow, 1).value = username;
        wsTo.getCell(dRow, 3).value = statD;
        wsTo.getCell(dRow, 4).value = statE;
        wsTo.getCell(dRow, 5).value = statF;
        wsTo.getCell(dRow, 6).value = statG;
        wsTo.getCell(dRow, 9).value = boxJ;
        wsTo.getCell(dRow, 9).note = noteJ;
    }

    await wsFrom.saveUpdatedCells();
    await wsTo.saveUpdatedCells();

    if (webhook) {
        await webhook.send({
            embeds: [{
                title: "Rank upated",
                description: `**User:** ${username}\n**From:** ${fromRank}\n**To:** ${toRank}\n**Executor:** ${executorPing}`,
                color: 0x00FF00,
                timestamp: new Date()
            }]
        });
    }

    return `Successfully moved **${username}** to **${toRank}** (Row ${dRow + 1}).`;
}

module.exports = { transferUser };