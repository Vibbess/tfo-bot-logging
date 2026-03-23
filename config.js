module.exports = {
    // --- DISCORD CONNECTION ---
    TOKEN: process.env.DISCORD_TOKEN,
    GUILD_ID: "1369082109184053469",
    OWNER_ID: "1097605097502015539",
    WEBHOOK_URL: process.env.WEBHOOK_URL,

    // --- GOOGLE SHEETS ---
    SHEET_ID: "1S-MdjLntP9KVZd8vpyR-n_IM6ZxlMsBF7DRONTBx1OM",
    
    // --- CHANNELS ---
    WELCOME_CHANNEL_ID: "1468756387562782732",
    LOG_IMAGE_URL: "https://cdn.discordapp.com/attachments/1369082110291349585/1468765416036896808/image.png",

    // --- CORE ROLES ---
    AUTH_ROLE_ID: "1369082109184053474",      // Authorized to use bot
    PROMO_REQ_ROLE_ID: "1443766165536247808",  // Allowed to request test
    PHASE2_ROLE_ID: "1443766259995901952",     // Set after passing score check

    // --- RANK MAPPINGS ---
    RANKS: {
        // Jet Company
        JET_RECRUIT: {
            add: ["1468755195419689073", "1369082109184053476"],
            remove: ["1443766259995901952", "1378869378178879578"]
        },
        JET_TROOPER: {
            add: ["1443389199645409393", "1387471508816793610", "1369082109435838508"],
            remove: ["1399091736856236053", "1468755195419689073"]
        },
        SENIOR_JET: {
            add: ["1443792369882239067"],
            remove: ["1369082109435838508"]
        },
        VETERAN_JET: {
            add: ["1445500320775016469"],
            remove: ["1443792369882239067"]
        },
        MASTER_JET: {
            add: ["1451525281410973706"],
            remove: ["1445500320775016469"]
        },

        // Flame Company
        FLAME_RECRUIT: {
            add: ["1468755302244679926", "1369082109184053476"],
            remove: ["1443766259995901952", "1378869378178879578"]
        },
        FLAME_TROOPER: {
            add: ["1369082109435838504", "1443791781811454013", "1443389267652120667"],
            remove: ["1468755302244679926", "1399091736856236053"]
        },
        SENIOR_FLAME: {
            add: ["1389915192984604875"],
            remove: ["1443791781811454013"]
        },
        VETERAN_FLAME: {
            add: ["1457209493644640297"],
            remove: ["1389915192984604875"]
        },
        MASTER_FLAME: {
            add: ["1457209569733513307"],
            remove: ["1457209493644640297"]
        },

        // BGC Specific
        BGC_PASS: {
            add: ["1399091736856236053", "1443766165536247808", "1378869378178879578"],
            remove: ["1386742728485900348"]
        }
    }
};