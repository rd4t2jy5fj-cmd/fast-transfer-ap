'use strict';

const { stations, searchStations, readTimetable, prepareSearch, findRoute, formatTime } = Timetable;
const settingsKey = 'saisoku-transfer-v1';
const defaults = { c: 3, s: 3, i: 3 };
const stationKeys = Object.keys(defaults);
const transfer = { ...defaults };

try {
  const saved = JSON.parse(localStorage.getItem(settingsKey));
  for (const station of stationKeys) {
    const minutes = saved?.[station];
    if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 30) transfer[station] = minutes;
  }
} catch {
  // Search also works when browser storage is disabled.
}

const $ = id => document.getElementById(id);
let timetable = null;
let loadAttempt = 0;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function updateRoute() {
  const order = $('direction').value === 'out' ? searchStations : [...searchStations].reverse();
  $('route').replaceChildren(...order.map((station, index) =>
    node('span', 'station' + (index === 0 ? ' origin' : index === order.length - 1 ? ' dest' : ''), stations[station])));
}

function duration(seconds) {
  const minutes = Math.floor(seconds / 60);
  return (minutes ? minutes + '分' : '') + (seconds % 60 ? seconds % 60 + '秒' : minutes ? '' : '0分');
}

function renderResult(id, label, route, partial) {
  const result = $(id);
  result.replaceChildren(node('h3', 'mode', label));
  if (id === 'zero') {
    result.append(node('p', 'notice', '同じ分・秒の乗換を含む理論値です。実際の乗車には使えません。'));
  }
  if (!route) {
    result.append(node('p', 'empty', partial
      ? '収録されている時刻表では経路を確認できませんでした。'
      : '検索範囲（指定日時から24時間以内）に条件を満たす経路がありません。'));
    return;
  }
  result.append(
    node('p', 'time', formatTime(route.departure) + ' 発'),
    node('p', 'time', formatTime(route.arrival) + ' 着'),
    node('p', 'hint', `所要 ${duration(route.arrival - route.departure)} · 乗換 ${route.legs.length - 1}回`),
  );
  const steps = node('ol', 'steps');
  for (const [index, leg] of route.legs.entries()) {
    const step = node('li', 'step');
    if (index > 0) {
      step.append(node('p', 'transfer', `${stations[leg.from]}で乗換 · 待ち時間 ${duration(leg.depart - route.legs[index - 1].arrive)}`));
    }
    step.append(
      node('strong', '', `${stations[leg.from]} → ${stations[leg.to]}`),
      node('p', '', [leg.line, leg.name, leg.destination && leg.destination + '行', 'ID ' + leg.tripId].filter(Boolean).join(' · ')),
      node('p', '', `${formatTime(leg.depart)} 発 → ${formatTime(leg.arrive)} 着`),
    );
    if (leg.via.length) step.append(node('p', '', '途中停車駅　' + leg.via.map(station => stations[station]).join('、')));
    steps.append(step);
  }
  result.append(steps);
}

function clearResults() {
  $('results').hidden = true;
  $('queryStatus').hidden = true;
}

function render() {
  clearResults();
  if (!timetable) return;
  const mode = $('mode').value;
  let plan;
  try {
    plan = prepareSearch(timetable, {
      date: $('date').value, clock: $('clock').value, direction: $('direction').value, mode,
    });
  } catch (error) {
    $('queryStatus').textContent = error.message;
    $('queryStatus').hidden = false;
    return;
  }
  const custom = findRoute(plan, transfer);
  const zero = findRoute(plan, {});
  renderResult('custom', '設定時間モード', custom, plan.partial);
  renderResult('zero', '0分モード', zero, plan.partial);

  const day = plan.dayType === 'weekday' ? '平日ダイヤ' : '土休日ダイヤ';
  const query = `${$('date').value} ${$('clock').value} ${mode === 'arrive' ? 'までに到着' : '以降に出発'}（日本時間・${day}）`;
  $('queryStatus').textContent = query + (plan.partial
    ? '。検索範囲に時刻表の未収録部分があり、収録分の結果を表示しています。' : '');
  $('queryStatus').hidden = false;

  let comparison = '';
  if (custom && zero) {
    const delta = mode === 'arrive' ? zero.departure - custom.departure : custom.arrival - zero.arrival;
    const metric = mode === 'arrive' ? '出発' : '到着';
    comparison = delta ? `0分モードは設定時間モードより${duration(delta)}${mode === 'arrive' ? '遅く' : '早く'}${metric}できます。`
      : `両モードの${metric}時刻は同じです。`;
  } else if (zero) {
    comparison = '0分モードでのみ、条件を満たす経路が見つかりました。';
  }
  $('comparison').textContent = comparison;
  $('comparison').hidden = !comparison;
  $('results').hidden = false;
}

$('timetableFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  const attempt = ++loadAttempt;
  timetable = null;
  $('search').disabled = true;
  $('sourceDetails').hidden = true;
  clearResults();
  if (!file) {
    $('dataStatus').textContent = '時刻表が未登録です。';
    return;
  }
  $('dataStatus').textContent = '時刻表を読み込んでいます。';
  try {
    const loaded = readTimetable(JSON.parse(await file.text()));
    if (attempt !== loadAttempt) return;
    timetable = loaded;
    $('sourceLink').href = loaded.source.url;
    $('sourceLink').textContent = loaded.source.name;
    $('sourceDates').textContent = `更新日 ${loaded.source.updatedOn} · 対象運行日 ${loaded.validFrom}〜${loaded.validThrough}`;
    $('sourceDetails').hidden = false;
    $('dataStatus').textContent = loaded.coverage === 'partial'
      ? '一部の列車を収録した時刻表を読み込みました。遅延・臨時の運休は運行情報で確認してください。'
      : '時刻表を読み込みました。遅延・臨時の運休は運行情報で確認してください。';
    $('search').disabled = false;
    render();
  } catch (error) {
    if (attempt !== loadAttempt) return;
    $('dataStatus').textContent = '時刻表を読み込めませんでした。' +
      (error instanceof SyntaxError ? 'JSONの書式を確認してください。' : error.message);
    event.target.value = '';
  }
});

$('direction').addEventListener('change', () => { updateRoute(); clearResults(); });
for (const field of ['mode', 'date', 'clock']) $(field).addEventListener('change', clearResults);
$('searchForm').addEventListener('submit', event => { event.preventDefault(); render(); });

function updateSettingsSummary() {
  $('transferSummary').textContent = stationKeys.map(station => `${stations[station]} ${transfer[station]}分`).join(' · ');
}

for (const station of stationKeys) {
  const label = node('label', '', stations[station] + '（分）');
  label.htmlFor = 'set-' + station;
  const input = node('input', 'time-input');
  input.type = 'number';
  input.id = label.htmlFor;
  input.min = 0;
  input.max = 30;
  input.step = 1;
  input.required = true;
  const group = node('div', 'setting field');
  group.append(label, input);
  $('settingControls').append(group);
}

function populateSettings(values) {
  for (const station of stationKeys) $('set-' + station).value = values[station];
}

$('settingsBtn').addEventListener('click', () => {
  populateSettings(transfer);
  $('settingsDialog').showModal();
});
$('resetBtn').addEventListener('click', () => populateSettings(defaults));
$('closeBtn').addEventListener('click', () => $('settingsDialog').close());
$('settingsForm').addEventListener('submit', () => {
  for (const station of stationKeys) transfer[station] = Number($('set-' + station).value);
  try { localStorage.setItem(settingsKey, JSON.stringify(transfer)); } catch {}
  updateSettingsSummary();
  render();
});

const nowInJapan = new Date(Date.now() + 9 * 3600000);
$('date').value = nowInJapan.toISOString().slice(0, 10);
updateRoute();
updateSettingsSummary();
