// 由活動快照統計「現況分析」：類型、月份、場館、地區、平台分布。純函式，無 I/O。
export const MUSIC = new Set(['演唱會', '音樂祭']);

const PLATFORM_NAMES = { ticketplus: 'Ticket Plus', tixcraft: '拓元', kktix: 'KKTIX', opentix: 'OPENTIX' };

const tally = (values) => {
  const m = new Map();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
};
const ranked = (m, limit = Infinity) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant')).slice(0, limit);

export function buildStats(events, { scope = 'all', topVenues = 10 } = {}) {
  const list = scope === 'concert' ? events.filter((e) => MUSIC.has(e.category)) : events;
  const venueOf = (e) => [...new Set((e.venues ?? []).map((v) => String(v).trim()).filter(Boolean))];
  const cityOf = (e) => [...new Set((e.cities ?? []).filter(Boolean))];
  const months = tally(list.map((e) => (e.dateStart ?? '').slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)));
  return {
    total: list.length,
    byCategory: ranked(tally(list.map((e) => e.category || '其他'))),
    byMonth: [...months].sort((a, b) => a[0].localeCompare(b[0])),
    byVenue: ranked(tally(list.flatMap(venueOf)), topVenues),
    byCity: ranked(tally(list.flatMap(cityOf))),
    byPlatform: ranked(tally(list.map((e) => PLATFORM_NAMES[e.platform ?? 'ticketplus'] ?? e.platform))),
  };
}

// 最近即將開賣的音樂類活動
export function upcomingSales(events, now, limit = 8) {
  return events
    .filter((e) => MUSIC.has(e.category))
    .map((e) => ({ e, t: (e.saleStarts ?? []).filter((x) => x > now).sort((a, b) => a - b)[0] }))
    .filter((x) => x.t != null)
    .sort((a, b) => a.t - b.t)
    .slice(0, limit)
    .map(({ e, t }) => ({
      title: e.title,
      platform: PLATFORM_NAMES[e.platform ?? 'ticketplus'] ?? e.platform,
      venue: (e.venues ?? [])[0] ?? '',
      saleStart: t,
      url: /^https?:\/\//i.test(e.url ?? '') ? e.url : '',
    }));
}
