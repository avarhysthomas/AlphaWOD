"use strict";
/* eslint-disable require-jsdoc */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEADERBOARD_CANDIDATE_MAX_ROWS = exports.LEADERBOARD_FUTURE_MONTHS = exports.LEADERBOARD_HISTORY_MONTHS = void 0;
exports.resolveBoundedLeaderboardMonthKey = resolveBoundedLeaderboardMonthKey;
exports.filterAttendanceLeaderboardRows = filterAttendanceLeaderboardRows;
exports.filterDipLeaderboardRows = filterDipLeaderboardRows;
const authz_1 = require("./authz");
exports.LEADERBOARD_HISTORY_MONTHS = 24;
exports.LEADERBOARD_FUTURE_MONTHS = 1;
exports.LEADERBOARD_CANDIDATE_MAX_ROWS = 500;
function monthOrdinal(monthKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || year < 2000 || year > 9999 ||
        month < 1 || month > 12) {
        return null;
    }
    return year * 12 + month - 1;
}
function resolveBoundedLeaderboardMonthKey(value, currentMonthKey) {
    const candidate = typeof value === "string" && value.trim() ?
        value.trim() : currentMonthKey;
    const candidateOrdinal = monthOrdinal(candidate);
    const currentOrdinal = monthOrdinal(currentMonthKey);
    if (candidateOrdinal === null || currentOrdinal === null)
        return null;
    const difference = candidateOrdinal - currentOrdinal;
    if (difference < -exports.LEADERBOARD_HISTORY_MONTHS ||
        difference > exports.LEADERBOARD_FUTURE_MONTHS)
        return null;
    return candidate;
}
function currentDisplayProfile(userId, profiles) {
    const profile = profiles.get(userId);
    if (!profile || !(0, authz_1.resolveUserAuthorisation)(profile).alphaWodAccess) {
        return null;
    }
    return {
        name: typeof profile.name === "string" && profile.name.trim() ?
            profile.name.trim() : "Member",
        photoURL: typeof profile.photoURL === "string" ? profile.photoURL : "",
    };
}
function normaliseDipCount(value) {
    let count;
    try {
        count = Number(value !== null && value !== void 0 ? value : 0);
    }
    catch (_a) {
        return 0;
    }
    if (!Number.isFinite(count) || count <= 0)
        return 0;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(count));
}
function filterAttendanceLeaderboardRows(values, profiles, limit) {
    const rows = new Map();
    values.forEach((value) => {
        const row = (value || {});
        const userId = typeof row.userId === "string" ? row.userId : "";
        if (!userId || rows.has(userId))
            return;
        const profile = currentDisplayProfile(userId, profiles);
        if (!profile)
            return;
        rows.set(userId, Object.assign(Object.assign({ userId }, profile), { attendedCount: Math.max(0, Number(row.attendedCount || 0)) }));
    });
    return [...rows.values()]
        .sort((left, right) => right.attendedCount - left.attendedCount ||
        left.name.localeCompare(right.name))
        .slice(0, limit);
}
function filterDipLeaderboardRows(values, profiles, limit) {
    const rows = new Map();
    values.forEach((value) => {
        const row = (value || {});
        const userId = typeof row.userId === "string" ? row.userId : "";
        if (!userId || rows.has(userId))
            return;
        const profile = currentDisplayProfile(userId, profiles);
        const dipCount = normaliseDipCount(row.dipCount);
        if (!profile || dipCount <= 0)
            return;
        rows.set(userId, Object.assign(Object.assign({ userId }, profile), { dipCount }));
    });
    return [...rows.values()]
        .sort((left, right) => right.dipCount - left.dipCount || left.name.localeCompare(right.name))
        .slice(0, limit);
}
//# sourceMappingURL=leaderboard.js.map