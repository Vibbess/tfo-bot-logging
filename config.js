/*
    FN Trooper Corps Configuration
    Clean version matching NEW system
*/

module.exports = {

    /* ================= SHEETS ================= */

    SHEETS: {
        PLACEMENT: "PLACEMENT",
        RECRUITS: "RECRUITS",
        JET: "JETPACK COMPANY",
        FLAME: "FLAMETROOPER COMPANY",
        STAFF: "DIVISIONAL STAFF",
        HIGH: "HIGH COMMAND"
    },

    /* ================= COLUMN MAPS ================= */
    /* All indexes are ZERO-BASED */

    COLUMNS: {

        PLACEMENT: {
            USERNAME: 1, // B
            PHASE: 2,    // C
            DATE: 3,     // D
            ACTIVE: 4,   // E
            SCORE: 5,    // F
            FLAG: 6      // G
        },

        RECRUITS: {
            USERNAME: 1, // B
            RANK: 2,     // C
            DATE: 3,     // D
            PATROLS: 4,  // E
            PT: 5,       // F
            EVENTS: 6,   // G
            FLAG: 7      // H
        },

        JET: {
            USERNAME: 1, // B
            RANK: 2,     // C
            EVENTS: 4,   // E
            WEEKLY: 5,   // F
            TIME: 6,     // G
            NOTE: 8      // I
        },

        FLAME: {
            USERNAME: 1,
            RANK: 2,
            EVENTS: 4,
            WEEKLY: 5,
            TIME: 6,
            NOTE: 8
        },

        STAFF: {
            USERNAME: 1,
            EVENTS: 5, // F
            HOSTS: 6,  // G
            EXTRA: 7,  // H
            TRYOUTS: 10 // K
        },

        HIGH: {
            USERNAME: 1,
            HOSTS: 6, // G
            EVENTS: 7 // H
        }
    },

    /* ================= ROLE IDS ================= */

    ROLES: {

        /* BASE */
        AUTHORIZED: "1369082109184053474",
        REQUESTER: "1443766165536247808",

        /* PHASE */
        PHASE_TWO: "1443766259995901952",
        PHASE_ONE_REMOVE: "1443766165536247808",

        /* RECRUITS */
        JET_RECRUIT: "1468755195419689073",
        FLAME_RECRUIT: "1468755302244679926",
        RECRUIT_BASE: "1369082109184053476",

        /* TROOPERS */
        JET_TROOPER: "1369082109435838508",
        FLAME_TROOPER: "1443791781811454013",

        /* JET PROGRESSION */
        SENIOR_JET: "1443792369882239067",
        VETERAN_JET: "1445500320775016469",
        SPECIALIST_JET: "1445500422147281039",
        CORPORAL_JET: "1445500469622345921",

        /* FLAME PROGRESSION */
        SENIOR_FLAME: "1389915192984604875",
        VETERAN_FLAME: "1457209493644640297",
        SPECIALIST_FLAME: "1457209610875437137",
        CORPORAL_FLAME: "1457209756015136979",

        /* OTHER */
        REMOVE_ON_JOIN: "1386742728485900348"
    },

    /* ================= RANK FLOW ================= */

    RANK_FLOW: {

        /* RECRUIT → TROOPER */
        "Jet Recruit": "Jet Trooper",
        "Flame Recruit": "Flame Trooper",

        /* JET PATH */
        "Jet Trooper": "Senior Jet Trooper",
        "Senior Jet Trooper": "Veteran Trooper",
        "Veteran Trooper": "Specialist",
        "Specialist": "Corporal",

        /* FLAME PATH */
        "Flame Trooper": "Senior Flame Trooper",
        "Senior Flame Trooper": "Veteran Trooper",
        "Veteran Trooper": "Specialist",
        "Specialist": "Corporal"
    },

    /* ================= DEFAULT VALUES ================= */

    DEFAULTS: {
        RESET_DATE: "01/01/2026",
        EMPTY: "N/A",
        FALSE: "FALSE",
        TRUE: "TRUE"
    }

};