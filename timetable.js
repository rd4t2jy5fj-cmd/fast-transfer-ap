'use strict';

const Timetable = (() => {
  const holidays = typeof module === 'undefined' ? JapanHolidays : require('./holidays.js');
  const holidayDates = new Set(holidays.dates);
  const DAY = 86400;
  const stations = Object.freeze({
    t: '津田沼', makuhariHongo: '幕張本郷', makuhari: '幕張', shinKemigawa: '新検見川',
    inage: '稲毛', nishiChiba: '西千葉', c: '千葉', honChiba: '本千葉', s: '蘇我',
    kamatori: '鎌取', honda: '誉田', toke: '土気', o: '大網', nagata: '永田',
    honno: '本納', shinMobara: '新茂原', m: '茂原', yatsumi: '八積',
    i: '上総一ノ宮', torami: '東浪見', a: '太東',
  });
  const stationOrder = Object.keys(stations);
  const searchStations = Object.freeze(['t', 'c', 's', 'i', 'a']);
  const dayTypes = ['weekday', 'weekendHoliday'];

  function dateNumber(text) {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return NaN;
    // Use UTC only to number civil dates. Input clocks are always JST.
    const timestamp = Date.parse(text + 'T00:00:00Z');
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) return NaN;
    return timestamp / 86400000;
  }

  function dateText(day) {
    return new Date(day * 86400000).toISOString().slice(0, 10);
  }

  function clockSeconds(text, maxHour) {
    if (typeof text !== 'string' || !/^\d{2}:[0-5]\d(?::[0-5]\d)?$/.test(text)) return NaN;
    const [hour, minute, second = 0] = text.split(':').map(Number);
    return hour <= maxHour ? hour * 3600 + minute * 60 + second : NaN;
  }

  function formatTime(time) {
    const seconds = time % DAY;
    const pad = number => String(number).padStart(2, '0');
    return dateText(Math.floor(time / DAY)) + ' ' + pad(Math.floor(seconds / 3600)) + ':' + pad(Math.floor(seconds / 60) % 60) +
      (seconds % 60 ? ':' + pad(seconds % 60) : '');
  }

  function requireValue(test, message) {
    if (!test) throw new Error(message);
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isText(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function readTimetable(data) {
    requireValue(isObject(data) && data.version === 1, '時刻表の形式（version: 1）を確認してください。');
    const { source, validFrom, validThrough, coverage } = data;
    requireValue(isObject(source) && isText(source.name) && Number.isFinite(dateNumber(source.updatedOn)),
      '提供元の名称とデータ更新日が必要です。');
    let sourceUrl;
    try { sourceUrl = new URL(source.url); } catch {}
    requireValue(sourceUrl?.protocol === 'https:', '提供元のHTTPS URLが必要です。');
    const firstDay = dateNumber(validFrom);
    const lastDay = dateNumber(validThrough);
    requireValue(firstDay <= lastDay, '時刻表の有効期間が正しくありません。');
    requireValue(validFrom >= holidays.validFrom && validThrough <= holidays.validThrough,
      `祝日カレンダーの対応期間内で指定してください（${holidays.validFrom}〜${holidays.validThrough}）。`);
    requireValue(['complete', 'partial'].includes(coverage), '時刻表の収録範囲（complete または partial）が必要です。');

    function serviceDate(value) {
      const day = dateNumber(value);
      requireValue(day >= firstDay && day <= lastDay, `運行日 ${value} は有効期間内の日付で指定してください。`);
      return day;
    }

    const overrides = new Map();
    const dayOverrides = data.dayOverrides ?? {};
    requireValue(isObject(dayOverrides), 'dayOverrides は日付ごとのダイヤ区分を指定してください。');
    for (const [date, type] of Object.entries(dayOverrides)) {
      requireValue(dayTypes.includes(type), `${date} のダイヤ区分が正しくありません。`);
      overrides.set(serviceDate(date), type);
    }

    requireValue(Array.isArray(data.trips) && data.trips.length > 0, '列車が登録されていません。');
    const ids = new Set();
    const trips = data.trips.map((trip, index) => {
      const label = `列車 ${index + 1}`;
      requireValue(isObject(trip) && isText(trip.id) && isText(trip.line) && isText(trip.name),
        `${label} のID、路線、列車名が必要です。`);
      requireValue(!ids.has(trip.id), `列車ID ${trip.id} が重複しています。`);
      ids.add(trip.id);
      requireValue(Array.isArray(trip.dayTypes) && trip.dayTypes.every(type => dayTypes.includes(type)),
        `${label} のダイヤ区分が正しくありません。`);
      function readDates(key) {
        const dates = trip[key] ?? [];
        requireValue(Array.isArray(dates), `${label} の ${key} は日付の配列で指定してください。`);
        return new Set(dates.map(serviceDate));
      }
      const addDates = readDates('addDates');
      const removeDates = readDates('removeDates');
      requireValue(trip.dayTypes.length > 0 || addDates.size > 0, `${label} の運行日が必要です。`);
      requireValue([...addDates].every(day => !removeDates.has(day)), `${label} の運行日と運休日が重複しています。`);
      requireValue(Array.isArray(trip.stops) && trip.stops.length >= 2, `${label} の停車駅が不足しています。`);
      let previousDeparture = -Infinity;
      let previousStation = -1;
      let direction = 0;
      const stops = trip.stops.map((stop, stopIndex) => {
        const location = `${label} の停車駅 ${stopIndex + 1}`;
        requireValue(isObject(stop) && stationOrder.includes(stop.station), `${location} の駅コードが不明です。`);
        const station = stationOrder.indexOf(stop.station);
        if (stopIndex > 0) {
          const step = Math.sign(station - previousStation);
          if (stopIndex === 1) direction = step;
          requireValue(step !== 0 && step === direction, `${location} の停車駅順が正しくありません。`);
        }
        previousStation = station;
        const arrival = stop.arrival == null && stopIndex === 0 ? null : clockSeconds(stop.arrival, 47);
        const departure = stop.departure == null && stopIndex === trip.stops.length - 1
          ? null : clockSeconds(stop.departure, 47);
        requireValue((arrival === null || arrival >= previousDeparture) &&
          (departure === null || departure >= (arrival ?? previousDeparture)),
          `${location} の発着時刻を確認してください。翌日分は24時以降で指定します。`);
        requireValue(['pickup', 'dropOff'].every(key => stop[key] === undefined || typeof stop[key] === 'boolean'),
          `${location} の乗降可否が正しくありません。`);
        previousDeparture = departure;
        return { station: stop.station, arrival, departure, pickup: stop.pickup !== false, dropOff: stop.dropOff !== false };
      });

      requireValue(trip.destination === undefined || isText(trip.destination), `${label} の行先が正しくありません。`);
      return { id: trip.id, name: trip.name, line: trip.line, destination: trip.destination, direction, stops,
        dayTypes: trip.dayTypes, addDates, removeDates };
    });
    return { source: { name: source.name, updatedOn: source.updatedOn, url: sourceUrl.href },
      validFrom, validThrough, firstDay, lastDay, coverage, overrides, trips };
  }

  function dayType(data, day) {
    const weekday = new Date(day * 86400000).getUTCDay();
    return data.overrides.get(day) ??
      (weekday === 0 || weekday === 6 || holidayDates.has(dateText(day)) ? 'weekendHoliday' : 'weekday');
  }

  function prepareSearch(data, { date, clock, direction, mode }) {
    const day = dateNumber(date);
    const seconds = clockSeconds(clock, 23);
    requireValue(Number.isFinite(day) && Number.isFinite(seconds), '日付と時刻を入力してください。');
    requireValue(day >= data.firstDay && day <= data.lastDay,
      `指定日は時刻表の有効期間外です（${data.validFrom}〜${data.validThrough}）。`);
    requireValue(direction === 'out' || direction === 'back', '検索方向が正しくありません。');
    requireValue(mode === 'depart' || mode === 'arrive', '検索条件が正しくありません。');

    const time = day * DAY + seconds;
    const reverse = mode === 'arrive';
    const start = reverse ? time - DAY : time;
    const end = reverse ? time : time + DAY;
    // Extended times (24:00–47:59) may come from the preceding service date.
    const firstServiceDay = Math.floor(start / DAY) - 1;
    const lastServiceDay = Math.floor(end / DAY);
    const sameDirection = direction === 'out' ? 1 : -1;
    const order = sameDirection === 1 ? [...searchStations] : [...searchStations].reverse();
    if (reverse) order.reverse();
    const rides = new Map(order.map(station => [station, []]));

    for (let serviceDay = Math.max(firstServiceDay, data.firstDay);
      serviceDay <= Math.min(lastServiceDay, data.lastDay); serviceDay++) {
      const offset = serviceDay * DAY;
      const type = dayType(data, serviceDay);
      for (const trip of data.trips) {
        if (trip.direction !== sameDirection || trip.removeDates.has(serviceDay) ||
          !(trip.dayTypes.includes(type) || trip.addDates.has(serviceDay))) continue;

        // Each ride represents staying on one train through every intervening stop.
        for (const [index, from] of trip.stops.entries()) {
          if (!rides.has(from.station) || !from.pickup || from.departure === null || offset + from.departure < start) continue;
          for (let endIndex = index + 1; endIndex < trip.stops.length; endIndex++) {
            const to = trip.stops[endIndex];
            if (!rides.has(to.station) || !to.dropOff || to.arrival === null || offset + to.arrival > end) continue;
            const ride = {
              from: from.station, to: to.station, depart: offset + from.departure, arrive: offset + to.arrival,
              tripId: trip.id, name: trip.name, line: trip.line, destination: trip.destination,
              via: trip.stops.slice(index + 1, endIndex).map(stop => stop.station),
            };
            rides.get(reverse ? ride.to : ride.from).push(ride);
          }
        }
      }
    }
    return { order, reverse, time, rides, dayType: dayType(data, day),
      partial: data.coverage === 'partial' || firstServiceDay < data.firstDay || lastServiceDay > data.lastDay };
  }

  function findRoute({ order, reverse, time, rides }, transfer) {
    const start = order[0];
    const goal = order[order.length - 1];
    const best = new Map([[start, { time, previous: null }]]);
    // All rides advance along the corridor. The best time at a transfer station
    // dominates other times there because the transfer requirement is station-specific.
    for (const station of order) {
      const current = best.get(station);
      if (!current) continue;
      const margin = station === start ? 0 : (transfer[station] ?? 0) * 60;
      for (const ride of rides.get(station)) {
        const nextStation = reverse ? ride.from : ride.to;
        const nextTime = reverse ? ride.depart : ride.arrive;
        const next = best.get(nextStation);
        const feasible = reverse ? ride.arrive <= current.time - margin : ride.depart >= current.time + margin;
        const improves = !next || (reverse ? nextTime > next.time : nextTime < next.time);
        if (feasible && improves) best.set(nextStation, { time: nextTime, previous: current, ride });
      }
    }
    if (!best.has(goal)) return null;
    const legs = [];
    for (let current = best.get(goal); current.previous; current = current.previous) legs.push(current.ride);
    if (!reverse) legs.reverse();
    return { legs, departure: legs[0].depart, arrival: legs[legs.length - 1].arrive };
  }

  return { stations, searchStations, readTimetable, prepareSearch, findRoute, formatTime };
})();

if (typeof module !== 'undefined') module.exports = Timetable;
