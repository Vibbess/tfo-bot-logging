const { normalize } = require('path');

/* ================= NORMALIZE ================= */
function clean(name) {
    if (!name) return "";
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* ================= PARSE INPUT ================= */
function extract(section, text) {
    const match = text.match(new RegExp(`${section}:\\s*([\\s\\S]*?)(?=\\n[A-Z]|$)`, 'i'));
    if (!match) return [];
    return match[1]
        .split(/[,\n]/)
        .map(x => clean(x))
        .filter(Boolean);
}

/* ================= FIND USER ================= */
async function findUser(sheet, username) {
    await sheet.loadCells('A1:K200');

    for (let i = 0; i < 200; i++) {
        const val = sheet.getCell(i, 1).value;
        if (clean(val) === clean(username)) return i;
    }
    return -1;
}

/* ================= ADD VALUE ================= */
function add(sheet, row, col, val) {
    const cell = sheet.getCell(row, col);
    const old = parseFloat(cell.value) || 0;
    cell.value = old + val;
}

/* ================= MAIN ================= */
async function processEvent(doc, type, weekend, interaction, webhook) {
    await doc.loadInfo();

    const recruits = doc.sheetsByTitle['RECRUITS'];
    const jet = doc.sheetsByTitle['JETPACK COMPANY'];
    const flame = doc.sheetsByTitle['FLAMETROOPER COMPANY'];
    const staff = doc.sheetsByTitle['DIVISIONAL STAFF'];
    const high = doc.sheetsByTitle['HIGH COMMAND'];

    const input = interaction.options.getString('eventtype'); // using same field as text input if needed

    /* ================= PARSE ================= */
    const host = extract("Host", input)[0];
    const cohosts = extract("Co-hosts", input);
    const attendees = extract("Attendees", input);

    let logs = [];

    /* ================= HELPER ================= */
    async function handleUser(username, role) {
        if (!username) return;

        let mult = weekend ? 2 : 1;
        let half = weekend ? 1 : 0.5;

        /* ---------- RECRUITS ---------- */
        let rRow = await findUser(recruits, username);
        if (rRow !== -1) {
            if (type === "patrol" && role === "attendee") {
                add(recruits, rRow, 4, 1); // E
                logs.push(`${username} +1 patrol`);
            }

            if (type === "pt" && role === "attendee") {
                recruits.getCell(rRow, 5).value = true; // F
                logs.push(`${username} PT TRUE`);
            }

            await recruits.saveUpdatedCells();
            return;
        }

        /* ---------- JET ---------- */
        let jRow = await findUser(jet, username);
        if (jRow !== -1) {
            if (role === "attendee") {
                add(jet, jRow, 4, 1);
                add(jet, jRow, 5, 1);
                add(jet, jRow, 6, 10);
                logs.push(`${username} Jet +event`);
            }
            await jet.saveUpdatedCells();
            return;
        }

        /* ---------- FLAME ---------- */
        let fRow = await findUser(flame, username);
        if (fRow !== -1) {
            if (role === "attendee") {
                add(flame, fRow, 4, 1);
                add(flame, fRow, 5, 1);
                add(flame, fRow, 6, 10);
                logs.push(`${username} Flame +event`);
            }
            await flame.saveUpdatedCells();
            return;
        }

        /* ---------- TRYOUT LOGIC ---------- */
        if (type === "tryout") {

            /* STAFF */
            let sRow = await findUser(staff, username);
            if (sRow !== -1) {
                if (role === "host") {
                    add(staff, sRow, 6, mult); // G
                    add(staff, sRow, 10, mult); // K
                    logs.push(`${username} staff tryout host`);
                }
                if (role === "cohost") {
                    add(staff, sRow, 6, half);
                    add(staff, sRow, 10, half);
                    logs.push(`${username} staff tryout cohost`);
                }
                await staff.saveUpdatedCells();
                return;
            }

            /* HIGH COMMAND */
            let hRow = await findUser(high, username);
            if (hRow !== -1) {
                if (role === "host") {
                    add(high, hRow, 6, mult);
                    add(high, hRow, 7, mult);
                    logs.push(`${username} HC tryout host`);
                }
                if (role === "cohost") {
                    add(high, hRow, 6, half);
                    add(high, hRow, 7, half);
                    logs.push(`${username} HC tryout cohost`);
                }
                await high.saveUpdatedCells();
                return;
            }
        }

        /* ---------- GENERAL EVENTS ---------- */
        let sRow = await findUser(staff, username);
        if (sRow !== -1) {
            if (role === "host") {
                add(staff, sRow, 5, mult); // F
                add(staff, sRow, 7, mult); // H
                logs.push(`${username} staff host`);
            }
            if (role === "cohost") {
                add(staff, sRow, 5, half);
                add(staff, sRow, 7, half);
                logs.push(`${username} staff cohost`);
            }
            await staff.saveUpdatedCells();
            return;
        }
    }

    /* ================= RUN ================= */
    await handleUser(host, "host");

    for (const c of cohosts) {
        await handleUser(c, "cohost");
    }

    for (const a of attendees) {
        await handleUser(a, "attendee");
    }

    /* ================= WEBHOOK ================= */
    if (webhook) {
        await webhook.send({
            embeds: [{
                title: "Event Log",
                description:
`**Type:** ${type}
**Weekend:** ${weekend}
**Host:** ${host || "N/A"}
**Co-hosts:** ${cohosts.join(", ") || "None"}
**Attendees:** ${attendees.join(", ") || "None"}

**Updates:**
${logs.join("\n") || "No updates"}`,
                color: 0x00ff00
            }]
        });
    }

    return `✅ Event processed:\n${logs.join("\n") || "No updates"}`;
}

module.exports = { processEvent };