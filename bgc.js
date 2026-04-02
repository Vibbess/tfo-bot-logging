async function runBGC(doc, robloxUsername, discordUser, guild, webhook) {
    await doc.loadInfo();

    const sheet = doc.sheetsByTitle["PLACEMENTS"];
    await sheet.loadCells();

    let rowIndex = -1;

    for (let i = 0; i < 100; i++) {
        let val = sheet.getCell(i, 1).value;
        if (!val || val === "N/A") {
            rowIndex = i;
            break;
        }
    }

    if (rowIndex === -1) throw new Error("No empty slots.");

    const today = new Date().toLocaleDateString();

    sheet.getCell(rowIndex, 1).value = robloxUsername;
    sheet.getCell(rowIndex, 3).value = today;

    await sheet.saveUpdatedCells();

    const member = await guild.members.fetch(discordUser.id);

    await member.roles.add([
        "1399091736856236053",
        "1443766165536247808",
        "1378869378178879578"
    ]);

    await member.roles.remove("1386742728485900348");

    await webhook.send({
        content: `BGC PASSED\nUser: ${robloxUsername}\nDiscord: <@${discordUser.id}>`
    });

    return "BGC complete.";
}

module.exports = { runBGC };