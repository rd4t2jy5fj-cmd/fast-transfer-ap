'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readTimetable, prepareSearch, findRoute, formatTime } = require('../timetable.js');

// Synthetic fixtures only. The application never loads this file.
function train(id, stops, extra = {}) {
  return {
    id, name: 'TEST ONLY', line: 'TEST ONLY', dayTypes: ['weekday'],
    stops: stops.map(([station, arrival, departure]) => ({ station, arrival, departure })),
    ...extra,
  };
}

function timetable(trips, extra = {}) {
  return {
    version: 1, coverage: 'complete', validFrom: '2026-11-01', validThrough: '2026-11-30',
    source: { name: 'TEST ONLY', url: 'https://example.test/', updatedOn: '2026-11-01' },
    trips, ...extra,
  };
}

function plan(trips, query = {}, extra = {}) {
  return prepareSearch(readTimetable(timetable(trips, extra)), {
    date: '2026-11-20', clock: '06:00', direction: 'out', mode: 'depart', ...query,
  });
}

const first = train('first', [['t', null, '06:00'], ['c', '06:15', null]]);
const through = train('through', [['t', null, '06:04'], ['c', '06:20', '06:23'], ['s', '06:31', '06:32'], ['i', '06:50', null]]);
const tight = train('tight', [['c', null, '06:15'], ['s', '06:24', '06:25'], ['i', '06:45', null]]);
const last = train('last', [['i', null, '06:48'], ['torami', '06:53', '06:53'], ['a', '06:57', null]]);
const later = train('later', [['i', null, '06:55'], ['a', '07:04', null]]);

test('earliest arrival includes all eligible departures and preserves through trains', () => {
  const search = plan([last, later, through, first, tight]);
  const custom = findRoute(search, { c: 1, s: 30, i: 3 });
  const zero = findRoute(search, {});
  assert.deepEqual(custom.legs.map(leg => leg.tripId), ['through', 'later']);
  assert.deepEqual(custom.legs[0].via, ['c', 's']);
  assert.equal(formatTime(custom.arrival), '2026-11-20 07:04');
  assert.deepEqual(zero.legs.map(leg => leg.tripId), ['first', 'tight', 'last']);
  assert.deepEqual(zero.legs[2].via, ['torami']);
  assert.equal(formatTime(zero.arrival), '2026-11-20 06:57');
});

test('arrival deadline finds latest departure and ignores trips arriving after it', () => {
  const eligible = train('direct', [['t', null, '06:05'], ['a', '07:01', null]]);
  const misses = train('late', [['t', null, '06:10'], ['a', '07:05', null]]);
  const search = plan([first, through, tight, last, later, eligible, misses], { mode: 'arrive', clock: '07:04' });
  assert.equal(formatTime(findRoute(search, { i: 5 }).departure), '2026-11-20 06:05');
  const reverseComparison = plan([first, through, tight, last, later], { mode: 'arrive', clock: '06:57' });
  assert.equal(findRoute(reverseComparison, { c: 1 }), null);
  assert.equal(formatTime(findRoute(reverseComparison, {}).departure), '2026-11-20 06:00');
});

test('uses 蘇我 in reverse direction and accounts for seconds at transfer', () => {
  const north = train('north', [['a', null, '08:02:00'], ['s', '08:40:30', null]]);
  const transfer = train('transfer', [['s', null, '08:41:00'], ['t', '09:00', null]]);
  const next = train('next', [['s', null, '08:41:30'], ['t', '09:05', null]]);
  const trips = [first, north, transfer, next];
  const search = plan(trips, { direction: 'back' });
  assert.equal(formatTime(findRoute(search, { s: 1 }).arrival), '2026-11-20 09:05');
  assert.equal(formatTime(findRoute(search, {}).arrival), '2026-11-20 09:00');
  const deadline = plan(trips, { direction: 'back', mode: 'arrive', clock: '09:00' });
  assert.equal(findRoute(deadline, { s: 1 }), null);
  assert.equal(formatTime(findRoute(deadline, {}).departure), '2026-11-20 08:02');
});

test('changing at 大網 or 茂原 is unavailable', () => {
  for (const station of ['o', 'm']) {
    const search = plan([
      train('before', [['t', null, '08:00'], [station, '08:25', null]]),
      train('after', [[station, null, '08:26'], ['a', '09:00', null]]),
    ]);
    assert.equal(findRoute(search, {}), null);
  }
});

test('boarding and alighting restrictions still allow staying on the same train', () => {
  const search = plan([
    train('no-boarding', [['t', null, '06:00'], ['a', '06:25', null]], {
      stops: [{ station: 't', departure: '06:00', pickup: false }, { station: 'a', arrival: '06:25' }],
    }),
    train('no-alighting', [], {
      stops: [{ station: 't', departure: '06:01' }, { station: 'i', arrival: '06:15', departure: '06:16', dropOff: false },
        { station: 'a', arrival: '06:30' }],
    }),
    train('transfer', [['i', null, '06:15'], ['a', '06:27', null]]),
  ]);
  const result = findRoute(search, {});
  assert.equal(formatTime(result.arrival), '2026-11-20 06:30');
  assert.deepEqual(result.legs[0].via, ['i']);
});

test('Saturday, Sunday, public holidays and date overrides use the correct timetable', () => {
  const weekday = train('weekday', [['t', null, '06:30'], ['a', '07:25', null]]);
  const weekend = train('holiday', [['t', null, '06:10'], ['a', '07:30', null]], { dayTypes: ['weekendHoliday'] });
  for (const date of ['2026-11-21', '2026-11-22', '2026-11-23']) {
    const search = plan([weekday, weekend], { date });
    assert.equal(search.dayType, 'weekendHoliday');
    assert.equal(findRoute(search, {}).legs[0].tripId, 'holiday');
  }
  const override = plan([weekday, weekend], { date: '2026-11-20' }, { dayOverrides: { '2026-11-20': 'weekendHoliday' } });
  assert.equal(findRoute(override, {}).legs[0].tripId, 'holiday');
});

test('an added one-day train replaces a cancelled train', () => {
  const canceled = { ...first, removeDates: ['2026-11-20'] };
  const special = train('special', [['t', null, '06:15'], ['a', '07:20', null]],
    { dayTypes: [], addDates: ['2026-11-20'] });
  assert.equal(findRoute(plan([canceled, tight, last, special]), {}).legs[0].tripId, 'special');
  assert.equal(findRoute(plan([special], { date: '2026-11-19', mode: 'arrive', clock: '23:00' }), {}), null);
});

test('extended hours keep their service date across Friday midnight into Saturday', () => {
  const overnight = train('night', [['t', null, '24:02'], ['i', '24:45', null]]);
  const saturday = train('saturday', [['i', null, '00:48'], ['a', '00:55', null]], { dayTypes: ['weekendHoliday'] });
  for (const query of [{ date: '2026-11-20', clock: '23:59' },
    { date: '2026-11-21', clock: '00:55', mode: 'arrive' }]) {
    const result = findRoute(plan([overnight, saturday], query), { i: 3 });
    assert.equal(formatTime(result.departure), '2026-11-21 00:02');
    assert.equal(formatTime(result.arrival), '2026-11-21 00:55');
  }
});

test('first departure and late-night searches obey the 24-hour query window', () => {
  const day = train('day', [['t', null, '05:30'], ['a', '06:20', null]], { dayTypes: ['weekday', 'weekendHoliday'] });
  assert.equal(formatTime(findRoute(plan([day], { clock: '04:00' }), {}).departure), '2026-11-20 05:30');
  assert.equal(formatTime(findRoute(plan([day], { clock: '23:59' }), {}).departure), '2026-11-21 05:30');
  assert.equal(findRoute(plan([day], { clock: '05:31' }), {}), null);
});

test('missing coverage and invalid search dates are distinguished from no route', () => {
  assert.equal(plan([first], { date: '2026-11-30' }).partial, true);
  assert.equal(plan([first], {}, { coverage: 'partial' }).partial, true);
  assert.equal(plan([first]).partial, false);
  assert.throws(() => plan([first], { date: '2026-12-01' }), /有効期間外/);
  assert.throws(() => plan([first], { date: '2026-02-30' }), /日付と時刻/);
});

test('rejects duplicate IDs, backward clocks, unknown stops, unsafe URLs and empty feeds', () => {
  assert.throws(() => readTimetable(timetable([first, first])), /重複/);
  assert.throws(() => readTimetable(timetable([train('bad', [['t', null, '23:00'], ['c', '00:15', null]])])), /発着時刻/);
  assert.throws(() => readTimetable(timetable([train('bad', [['t', null, '05:00'], ['???', '05:15', null]])])), /駅コード/);
  assert.throws(() => readTimetable(timetable([first], { source: { ...timetable([]).source, url: 'javascript:alert(1)' } })), /HTTPS/);
  assert.throws(() => readTimetable(timetable([])), /登録/);
  assert.throws(() => readTimetable(timetable([first], { validThrough: '2028-01-01' })), /祝日カレンダー/);
});
