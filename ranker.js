const { google } = require('googleapis');
const cfg = require('./config');
const { EmbedBuilder } = require('discord.js');

/**
 * Main function to handle rank changes and sheet transfers
 */
async function transferUser(auth, spreadsheetId, interaction, logChannel) {
    const sheets = google.sheets({ version: 'v4', auth });
    
    const robloxName = interaction.options.getString('robloxusername');
    const targetMember = interaction.options.getMember('discorduser');
    const oldRank = interaction.options.getString('current_rank').toUpperCase();
    const newRank = interaction.options.getString('new_rank').toUpperCase();

    const sourceTab = getTabFromRank(oldRank);
    const targetTab = getTabFromRank(newRank);

    if (!sourceTab || !targetTab) {
        return `Invalid Rank: ${oldRank} -> ${newRank}`;
    }

    try {
        // 1. Get Source Data (Recruits)
        const sourceRes = await sheets.spreadsheets.values.get({ 
            spreadsheetId, 
            range: `${sourceTab}!A1:Z300` 
        });
        const sourceRows = sourceRes.data.values || [];
        const userColIdx = cfg.SHEETS_MAP[sourceTab].userCol.charCodeAt(0) - 65;
        
        const sourceRowIndex = sourceRows.findIndex(row => 
            row[userColIdx] && row[userColIdx].toLowerCase() === robloxName.toLowerCase()
        );

        if (sourceRowIndex === -1) {
            return `User **${robloxName}** not found on **${sourceTab}**.`;
        }

        const userData = sourceRows[sourceRowIndex];
        const sourceRowNum = sourceRowIndex + 1;
        const joinDate = userData[3] || "01/01/2026"; // Column D

        // 2. Update Discord Roles
        await updateDiscordRoles(targetMember, oldRank, newRank);

        let statusMessage = "";

        // CASE A: Phase 1 -> Phase 2 (Stay on RECRUITS)
        if (oldRank === "PLACEMENT PHASE ONE" && newRank === "PLACEMENT PHASE TWO") {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sourceTab}!C${sourceRowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[newRank]] }
            });
            statusMessage = `Updated rank to Phase 2 on RECRUITS.`;
        } 
        
        // CASE B: Moving from RECRUITS to a Company (Find N/A slot)
        else if (sourceTab === cfg.TABS.RECRUITS && sourceTab !== targetTab) {
            
            // 3. Find N/A slot in Target Company Sheet
            const targetRes = await sheets.spreadsheets.values.get({ 
                spreadsheetId, 
                range: `${targetTab}!B1:B300` 
            });
            const targetRows = targetRes.data.values || [];
            
            // Find first row where Column B is "N/A"
            const targetRowIndex = targetRows.findIndex(row => row[0] === "N/A");

            if (targetRowIndex === -1) {
                return `No empty "N/A" slots found on the **${targetTab}** sheet!`;
            }

            const targetRowNum = targetRowIndex + 1;

            // 4. Fill the "N/A" slot in Company Sheet
            // Format: [Name(B), Rank(C), Date(D)]
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${targetTab}!B${targetRowNum}:D${targetRowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[robloxName, newRank, joinDate]] }
            });

            // 5. Wipe the Recruit Row
            const wipeRow = ["N/A", "N/A", "01/01/2026", "0", "", "FALSE", "0", "FALSE"];
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sourceTab}!B${sourceRowNum}:I${sourceRowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [wipeRow] }
            });

            statusMessage = `Transferred to **${targetTab}** (Slot ${targetRowNum}) and wiped Recruit data.`;
        }

        // 6. LOG TO DISCORD CHANNEL
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle("Rank Change Log")
                .setColor(0x2f3136)
                .addFields(
                    { name: "User", value: `${targetMember} (${robloxName})`, inline: true },
                    { name: "Transfer", value: `${oldRank} -> ${newRank}`, inline: true },
                    { name: "Status", value: statusMessage }
                )
                .setTimestamp();
            
            await logChannel.send({ embeds: [embed] });
        }

        return `Successfully ranked **${robloxName}** to **${newRank}**.`;

    } catch (err) {
        console.error(err);
        return `Error: ${err.message}`;
    }
}

async function updateDiscordRoles(member, oldRank, newRank) {
    const r = newRank.toUpperCase();

    if (r === "PLACEMENT PHASE TWO") {
        await member.roles.add("1498050747240284287"); 
        await member.roles.remove("1498050747240284286");
    }

    const removals = ["1498050747240284290", "1498050747240284287", "1498050747240284285"];

    if (r === "SNOWTROOPER") {
        await member.roles.remove(removals);
        await member.roles.add(["1498050747340951794", "1498050747340951788", "1498050747340951789"]);
    } 
    else if (r === "ICEGUARD TROOPER") {
        await member.roles.remove(removals);
        await member.roles.add(["1498050747307393025", "1498050747286163679", "1498050747286163678"]);
    } 
    else if (r === "HAILSTORM TROOPER") {
        await member.roles.remove(removals);
        await member.roles.add(["1498050747340951787", "1498050747307393027", "1498050747307393026"]);
    }
}

function getTabFromRank(rank) {
    const r = rank.toUpperCase();
    if (r.includes("PLACEMENT")) return cfg.TABS.RECRUITS;
    if (r === "SNOWTROOPER") return cfg.TABS.SNOWTROOPER;
    if (r === "ICEGUARD TROOPER") return cfg.TABS.ICEGUARD;
    if (r === "HAILSTORM TROOPER") return cfg.TABS.HAILSTORM;
    return null; 
}

module.exports = { transferUser };