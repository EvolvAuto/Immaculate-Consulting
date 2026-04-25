// Schedule string parsing.
//
// Each cm_sftp_endpoints row has pull_schedule and/or push_schedule strings.
// A daily cron tick walks all active endpoints and asks: "does today match
// this endpoint's schedule?" - only the matching ones run.
//
// Supported schedule strings:
//   monthly_<N>th    - run if today's day-of-month is N. Examples:
//                      'monthly_7th' (NC DHHS outbound)
//                      'monthly_26th' (AMH inbound)
//   weekly_<dow>     - run if today's day-of-week matches.
//                      sunday|monday|tuesday|wednesday|thursday|friday|saturday
//                      Example: 'weekly_sunday' (TCM inbound)
//   daily            - run every day (for testing or unusual setups)
//   manual_only      - never run via cron; only manual triggers
//
// Day-of-month / day-of-week is evaluated in the timezone the cron tick
// fires in. With CRON_TIMEZONE=America/New_York, this aligns with NC Medicaid
// spec timing.

function todayMatches(scheduleStr, now) {
  if (!scheduleStr || typeof scheduleStr !== 'string') return false;
  const s = scheduleStr.trim().toLowerCase();
  if (s === '' || s === 'manual_only') return false;
  if (s === 'daily') return true;

  const d = now || new Date();
  const dayOfMonth = d.getDate();
  const dayOfWeek = d.getDay(); // 0=Sun..6=Sat

  // monthly_<N>th
  const monthlyMatch = s.match(/^monthly_(\d{1,2})(st|nd|rd|th)?$/);
  if (monthlyMatch) {
    const targetDay = parseInt(monthlyMatch[1], 10);
    if (!Number.isFinite(targetDay) || targetDay < 1 || targetDay > 31) return false;
    return dayOfMonth === targetDay;
  }

  // weekly_<dow>
  const weeklyMatch = s.match(/^weekly_(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (weeklyMatch) {
    const dayMap = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    return dayOfWeek === dayMap[weeklyMatch[1]];
  }

  // Unknown format - return false rather than throw, so a bad schedule string
  // on one endpoint can't crash the whole tick. Operator should review.
  return false;
}

// Returns a human-readable explanation for logs / status endpoint.
function describe(scheduleStr) {
  if (!scheduleStr) return '(none)';
  const s = scheduleStr.trim().toLowerCase();
  if (s === 'manual_only') return 'manual only (no cron)';
  if (s === 'daily') return 'every day';
  const m = s.match(/^monthly_(\d{1,2})(st|nd|rd|th)?$/);
  if (m) return 'on day ' + m[1] + ' of each month';
  const w = s.match(/^weekly_(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (w) return 'every ' + w[1];
  return '(unrecognized: ' + scheduleStr + ')';
}

module.exports = { todayMatches, describe };
