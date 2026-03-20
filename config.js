module.exports = {
    RECRUITS_TAB: "💂RECRUITS",
    TROOPER_TAB: "🏬TROOPER PLATOON",
    STAFF_TEAM_TAB: "⭐STAFF TEAM",
    VULCAN_TAB: "👑 VULCAN",
    BLIZZARD_TAB: "❄️ BLIZZARD FORCE",
    WILDFIRE_TAB: "🔥 WILDFIRE ",

RANK_RANGES: {
    "Recruit":   { tab: "💂RECRUITS", start: 6, end: 41 }, 
    "Trooper":   { tab: "🏬TROOPER PLATOON", start: 45, end: 87 },
    "Specialist": { tab: "🏬TROOPER PLATOON", start: 25, end: 43 },
    "Corporal":  { tab: "🏬TROOPER PLATOON", start: 20, end: 23 },
    "Wildfire":  { tab: "🔥 WILDFIRE ", start: 8, end: 40 }, 
    "Blizzard Force":  { tab: "❄️ BLIZZARD FORCE", start: 8, end: 40 },
    "Vulcan":    { tab: "👑 VULCAN", start: 8, end: 40 }
},

    TAB_MAP: {
        "⭐STAFF TEAM":     { userCol: 1, eapCol: 3, weeklyCol: 6, creditCol: 9, timeCol: 13, noteCol: 11 },
        "👑 VULCAN":         { userCol: 1, eapCol: 3, weeklyCol: 5, creditCol: 8, timeCol: 10, noteCol: 9 },
        "❄️ BLIZZARD FORCE": { userCol: 1, eapCol: 3, weeklyCol: 5, creditCol: 8, timeCol: 10, noteCol: 9 },
        "🔥 WILDFIRE ":      { userCol: 1, eapCol: 3, weeklyCol: 5, creditCol: 8, timeCol: 10, noteCol: 9 },
        "🏬TROOPER PLATOON": { userCol: 1, eapCol: 3, weeklyCol: 4, creditCol: 5, timeCol: 6, noteCol: 9 },
        "💂RECRUITS":        { userCol: 1, dateCol: 2, boxCol: 3, eapCol: 4, weeklyCol: 5, creditCol: 6, noteCol: 7 }
    }
};