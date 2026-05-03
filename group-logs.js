const { Client, GatewayIntentBits, EmbedBuilder, Events } = require('discord.js');
const axios = require('axios');

// --- CONFIGURATION ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHECK_INTERVAL = 60000; 

const groupConfigs = [
    { id: "1061251193", channel: "1498050754559082692", threshold: 1 },
];

const cache = new Map(); 

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- UTILS ---
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function getGroupMembers(groupId, threshold) {
    try {
        // 1. Get Group Info (For the name)
        const groupInfo = await axios.get(`https://groups.roblox.com/v1/groups/${groupId}`);
        const groupName = groupInfo.data.name;

        // 2. Get Roles (Separate endpoint)
        const rolesRes = await axios.get(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
        const roles = rolesRes.data.roles.filter(r => r.rank >= threshold);
        
        const membersMap = new Map();

        for (const role of roles) {
            let cursor = "";
            do {
                const res = await axios.get(`https://groups.roblox.com/v1/groups/${groupId}/roles/${role.id}/users?limit=100&cursor=${cursor}`);
                res.data.data.forEach(user => {
                    membersMap.set(user.userId, {
                        username: user.username,
                        rank: role.rank,
                        rankName: role.name,
                        groupName: groupName
                    });
                });
                cursor = res.data.nextPageCursor;
                if (cursor) await sleep(250);
            } while (cursor);
        }
        return { name: groupName, members: membersMap };
    } catch (e) {
        console.error(`Failed fetching group ${groupId}:`, e.message);
        return null;
    }
}

function createEmbed(type, user, oldRank, newRank, groupId) {
    const colors = { Join: 0x2ecc71, Promotion: 0xf1c40f, Demotion: 0x9b59b6, Leave: 0xe74c3c };
    const descriptions = {
        Join: "A member has joined/been accepted!",
        Promotion: "There has been a promotion",
        Demotion: "There has been a demotion",
        Leave: "A member has left or been demoted below the tracked threshold."
    };

    return new EmbedBuilder()
        .setTitle(type === "Leave" ? "Rank Change / Leave" : type)
        .setDescription(descriptions[type])
        .setColor(colors[type])
        .addFields(
            { name: "Username", value: `[${user.username}](https://www.roblox.com/users/${user.userId}/profile)`, inline: true },
            { name: "Group", value: `[${user.groupName}](https://www.roblox.com/groups/${groupId})`, inline: true },
            { name: "Old Rank", value: oldRank || "Guest/Below Threshold", inline: false },
            { name: "New Rank", value: newRank || "Left/Below Threshold", inline: false }
        )
        .setFooter({ text: "Group Logs - by Vibbes_1" })
        .setTimestamp();
}

// --- LOGIC ---
async function checkGroups() {
    for (const config of groupConfigs) {
        const data = await getGroupMembers(config.id, config.threshold);
        if (!data) continue;

        const oldMembers = cache.get(config.id);
        const channel = client.channels.cache.get(config.channel);

        // Only log if we have an existing cache (prevents massive spam on bot start)
        if (oldMembers && channel) {
            for (const [userId, user] of data.members) {
                const oldUser = oldMembers.get(userId);
                user.userId = userId;

                if (!oldUser) {
                    await channel.send({ embeds: [createEmbed("Join", user, null, `${user.rankName} (${user.rank})`, config.id)] }).catch(() => {});
                } else if (user.rank > oldUser.rank) {
                    await channel.send({ embeds: [createEmbed("Promotion", user, `${oldUser.rankName} (${oldUser.rank})`, `${user.rankName} (${user.rank})`, config.id)] }).catch(() => {});
                } else if (user.rank < oldUser.rank) {
                    await channel.send({ embeds: [createEmbed("Demotion", user, `${oldUser.rankName} (${oldUser.rank})`, `${user.rankName} (${user.rank})`, config.id)] }).catch(() => {});
                }
            }

            for (const [userId, user] of oldMembers) {
                if (!data.members.has(userId)) {
                    user.userId = userId;
                    await channel.send({ embeds: [createEmbed("Leave", user, `${user.rankName} (${user.rank})`, null, config.id)] }).catch(() => {});
                }
            }
        }

        cache.set(config.id, data.members);
        await sleep(1000); 
    }
}

// Fixed the deprecation warning by using clientReady
client.once(Events.ClientReady, () => {
    console.log(`Log Bot Active: ${client.user.tag}`);
    // Run once immediately, then interval
    checkGroups();
    setInterval(checkGroups, CHECK_INTERVAL);
});

client.login(DISCORD_TOKEN);