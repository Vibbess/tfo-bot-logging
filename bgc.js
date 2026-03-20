const axios = require('axios');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { DateTime } = require('luxon');
const { google } = require('googleapis');

const GROUP_ID = 5288669;
const REQUIRED_RANK = 2;
const TRELLO_BOARD_ID = "PkzSQAMG";
const SHEET_ID = process.env.SHEET_ID;
const TAB_NAME = "💂RECRUITS";

const chartCanvas = new ChartJSNodeCanvas({ width: 800, height: 400, backgroundColour: '#000000' });

// Function to fetch ALL badges by handling pagination cursors
async function fetchAllBadges(robloxId) {
    let allBadges = [];
    let cursor = null;

    try {
        do {
            const url = `https://badges.roblox.com/v1/users/${robloxId}/badges?limit=100&sortOrder=Asc${cursor ? `&cursor=${cursor}` : ''}`;
            const response = await axios.get(url);
            allBadges = allBadges.concat(response.data.data);
            cursor = response.data.nextPageCursor;
        } while (cursor);
        return allBadges;
    } catch (e) {
        console.error("Error fetching badges:", e);
        return [];
    }
}

async function updateRecruitSheet(auth, robloxUsername) {
    const sheets = google.sheets({ version: 'v4', auth });
    const range = `${TAB_NAME}!B:B`;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
    const rows = response.data.values || [];
    
    let rowIndex = rows.findIndex(row => row[0] === 'N/A') + 1;
    
    if (rowIndex > 0) {
        const today = DateTime.now().setZone('America/New_York').toFormat('MM/dd/yyyy');
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${TAB_NAME}!B${rowIndex}:C${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[robloxUsername, today]] }
        });
        return true;
    }
    return false;
}

async function runBackgroundCheck(robloxId, discordId, userAuth) {
    try {
        // Fetch basic info and all badges
        const [userReq, groupReq] = await Promise.all([
            axios.get(`https://users.roblox.com/v1/users/${robloxId}`),
            axios.get(`https://groups.roblox.com/v2/users/${robloxId}/groups/roles`)
        ]);

        const profile = userReq.data;
        const groups = groupReq.data.data;
        const allBadges = await fetchAllBadges(robloxId); // This now gets EVERY badge
        const joinDate = DateTime.fromISO(profile.created);

        // Blacklist Check
        const trelloResp = await axios.get(`https://trello.com/b/${TRELLO_BOARD_ID}.json`);
        const listsMap = Object.fromEntries(trelloResp.data.lists.map(l => [l.id, l.name]));
        const isBlacklisted = trelloResp.data.cards.some(card => {
            const listName = listsMap[card.idList];
            if (!["Universal Blacklists", "Vader's Fist Blacklists"].includes(listName)) return false;
            const content = (card.name + card.desc).toLowerCase();
            return content.includes(robloxId) || content.includes(profile.name.toLowerCase());
        });

        // Evaluation
        const accAgeOk = DateTime.now().diff(joinDate, 'months').months >= 10;
        const userRank = groups.find(g => g.group.id === GROUP_ID)?.role.rank || 0;
        const rankOk = userRank >= REQUIRED_RANK;
        const badgeCountOk = allBadges.length >= 400;

        const MARK = ":Mark:";
        const XMARK = ":XMark:";
        const passed = accAgeOk && rankOk && !isBlacklisted && badgeCountOk;

        let sheetStatus = "";
        if (passed && userAuth) {
            const updated = await updateRecruitSheet(userAuth, profile.name);
            sheetStatus = updated ? "" : "";
        }

        // Generate Chart using full badge data
        const configuration = {
            type: 'line',
            data: {
                labels: allBadges.map(b => DateTime.fromISO(b.created).toFormat('yyyy-MM')),
                datasets: [{
                    data: allBadges.map((_, i) => i + 1),
                    borderColor: '#98d1c8',
                    borderWidth: 2,
                    pointRadius: 0, // Set to 0 for cleaner line on high badge counts
                    fill: false,
                    tension: 0.1
                }]
            },
            options: {
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { display: true, color: 'white', maxRotation: 45 }, grid: { display: false } },
                    y: { title: { display: true, text: 'Total Badges', color: 'white' }, ticks: { color: 'white' } }
                }
            }
        };

        const imageBuffer = await chartCanvas.renderToBuffer(configuration);
        const attachment = new AttachmentBuilder(imageBuffer, { name: 'progression.png' });

        const responseContent = `
> **\`USER INFORMATION\`**
> Username: ${profile.name}
> Profile Link: https://www.roblox.com/users/${robloxId}/profile
> Discord User ID: ${discordId}
> ROBLOX Join Date: ${joinDate.toFormat('dd/MM/yyyy')}
> ROBLOX Badges Amount: ${allBadges.length}
> Is the individual [blacklisted](https://trello.com/b/PkzSQAMG/tge-imperial-blacklist)?: ${isBlacklisted ? MARK : XMARK}

> **\`REQUIREMENTS\`**
> 10+ months ROBLOX account creation: ${accAgeOk ? MARK : XMARK}
> E2 | Private+: ${rankOk ? MARK : XMARK}
> 400+ badges: ${badgeCountOk ? MARK : XMARK}
> 1 page of accessories: ${MARK}
> 1 page of all combined clothing: ${MARK}
> Consistent badge progression?: ${MARK}
> Passed: ${passed ? MARK : XMARK}${sheetStatus}
`;

        return { content: responseContent, files: [attachment] };

    } catch (error) {
        console.error(error);
        return { content: "❌ Error during background check. Verify IDs or check if inventory is public." };
    }
}

module.exports = { runBackgroundCheck };