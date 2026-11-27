'use strict';

const CHANGELOG = require('./changelog');

function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// Notes for versions after `since` up to and including `current`.
// With no `since`, just the current version's notes.
function notesBetween(since, current, changelog = CHANGELOG) {
  return changelog.filter((entry) =>
    compareVersions(entry.version, current) <= 0 &&
    (since ? compareVersions(entry.version, since) > 0 : compareVersions(entry.version, current) === 0));
}

// Decide whether to show "What's new" on this launch.
function shouldShowWhatsNew({ lastSeen, current, isFirstRun }) {
  if (isFirstRun) return false;
  if (!lastSeen) return true; // updated from a version that didn't record it
  return compareVersions(current, lastSeen) > 0;
}

module.exports = { compareVersions, notesBetween, shouldShowWhatsNew };
