"""Convert an authorized JR East GTFS Schedule ZIP to this app's timetable JSON."""

import argparse
from collections import defaultdict
import csv
from datetime import date, timedelta
from io import TextIOWrapper
import json
import re
import sys
from zipfile import BadZipFile, ZipFile


STATIONS = {
    '津田沼': 't', '幕張本郷': 'makuhariHongo', '幕張': 'makuhari', '新検見川': 'shinKemigawa',
    '稲毛': 'inage', '西千葉': 'nishiChiba', '千葉': 'c', '本千葉': 'honChiba', '蘇我': 's',
    '鎌取': 'kamatori', '誉田': 'honda', '土気': 'toke', '大網': 'o', '永田': 'nagata',
    '本納': 'honno', '新茂原': 'shinMobara', '茂原': 'm', '八積': 'yatsumi',
    '上総一ノ宮': 'i', '東浪見': 'torami', '太東': 'a',
}
SEARCH_STATIONS = {'t', 'c', 's', 'i', 'a'}
WEEK = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')


def rows(feed, name, optional=False):
    if optional and name not in feed.namelist():
        return
    with feed.open(name) as raw, TextIOWrapper(raw, encoding='utf-8-sig', newline='') as text:
        yield from csv.DictReader(text)


def service_dates(feed, first, last):
    active = defaultdict(set)
    for row in rows(feed, 'calendar.txt', optional=True):
        day = max(first, date.fromisoformat(row['start_date']))
        end = min(last, date.fromisoformat(row['end_date']))
        while day <= end:
            if row[WEEK[day.weekday()]] == '1':
                active[row['service_id']].add(day)
            day += timedelta(days=1)
    for row in rows(feed, 'calendar_dates.txt', optional=True):
        day = date.fromisoformat(row['date'])
        if not first <= day <= last:
            continue
        if row['exception_type'] == '1':
            active[row['service_id']].add(day)
        elif row['exception_type'] == '2':
            active[row['service_id']].discard(day)
        else:
            raise ValueError('Unsupported calendar exception: ' + row['exception_type'])
    return {key: [day.isoformat() for day in sorted(days)] for key, days in active.items()}


def station_code(stop):
    name = stop.get('stop_name', '').strip().removesuffix('駅')
    return STATIONS.get(name)


def as_station_stop(row, code):
    if row.get('timepoint') == '0':
        raise ValueError('Estimated stop time in trip ' + row['trip_id'])
    times = {}
    for field in ('arrival', 'departure'):
        clock = row[field + '_time']
        if not re.fullmatch(r'[0-9]{1,2}:[0-5][0-9]:[0-5][0-9]', clock) or int(clock.split(':')[0]) > 47:
            raise ValueError('Missing or unsupported stop time in trip ' + row['trip_id'])
        times[field] = clock.zfill(8)
    return {
        'station': code, **times,
        'pickup': row.get('pickup_type', '') in ('', '0'),
        'dropOff': row.get('drop_off_type', '') in ('', '0'),
    }


def convert(feed, first, last):
    active = service_dates(feed, first, last)
    stations = {row['stop_id']: row for row in rows(feed, 'stops.txt')}
    codes = {}
    for stop_id, stop in stations.items():
        code = station_code(stations.get(stop.get('parent_station'), {})) or station_code(stop)
        if code:
            codes[stop_id] = code
    missing = SEARCH_STATIONS - set(codes.values())
    if missing:
        names = [name for name, code in STATIONS.items() if code in missing]
        raise ValueError('Stations missing from the feed: ' + ', '.join(names))

    routes = {}
    for row in rows(feed, 'routes.txt'):
        kind = int(row['route_type'])
        if kind == 2 or 100 <= kind <= 117:
            routes[row['route_id']] = row.get('route_long_name') or row.get('route_short_name')
    trip_rows = {row['trip_id']: row for row in rows(feed, 'trips.txt')
                 if row['route_id'] in routes and active.get(row['service_id'])}
    stops = defaultdict(list)
    for row in rows(feed, 'stop_times.txt'):
        code = codes.get(row.get('stop_id'))
        if code and row['trip_id'] in trip_rows:
            stops[row['trip_id']].append((int(row['stop_sequence']), code, row))
    frequencies = {row['trip_id'] for row in rows(feed, 'frequencies.txt', optional=True)}
    station_rank = {code: rank for rank, code in enumerate(STATIONS.values())}
    result = []
    for trip_id, entries in stops.items():
        entries.sort(key=lambda item: item[0])
        if len({code for _, code, _ in entries if code in SEARCH_STATIONS}) < 2:
            continue
        ranks = [station_rank[code] for _, code, _ in entries]
        if ranks not in (sorted(set(ranks)), sorted(set(ranks), reverse=True)):
            raise ValueError('Stops do not follow the corridor in trip ' + trip_id)
        if trip_id in frequencies:
            raise ValueError('Frequency-based timetable for trip ' + trip_id)
        trip = trip_rows[trip_id]
        line = routes[trip['route_id']]
        if not line:
            raise ValueError('Missing route name for trip ' + trip_id)
        item = {
            'id': trip_id, 'line': line, 'name': trip.get('trip_short_name') or line,
            'dayTypes': [], 'addDates': active[trip['service_id']],
            'stops': [as_station_stop(row, code) for _, code, row in entries],
        }
        if trip.get('trip_headsign'):
            item['destination'] = trip['trip_headsign']
        result.append(item)
    if not result:
        raise ValueError('No trains with at least two search stations in the specified period')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip_path')
    parser.add_argument('--valid-from', required=True, type=date.fromisoformat)
    parser.add_argument('--valid-through', required=True, type=date.fromisoformat)
    parser.add_argument('--updated-on', required=True, type=date.fromisoformat)
    parser.add_argument('--source-name', required=True)
    parser.add_argument('--source-url', required=True)
    args = parser.parse_args()
    if args.valid_from > args.valid_through:
        parser.error('--valid-from must be on or before --valid-through')
    try:
        with ZipFile(args.zip_path) as feed:
            trips = convert(feed, args.valid_from, args.valid_through)
    except (BadZipFile, OSError, KeyError, ValueError) as error:
        parser.error(str(error))
    json.dump({
        'version': 1, 'coverage': 'partial',
        'validFrom': args.valid_from.isoformat(), 'validThrough': args.valid_through.isoformat(),
        'source': {'name': args.source_name, 'url': args.source_url, 'updatedOn': args.updated_on.isoformat()},
        'trips': trips,
    }, sys.stdout, ensure_ascii=False, separators=(',', ':'))
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
