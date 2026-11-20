import csv
from datetime import date
from io import BytesIO, StringIO
import unittest
from zipfile import ZipFile

from tools.import_gtfs import convert


class ImportGtfsTest(unittest.TestCase):
    # Synthetic feed. Nothing here is distributed as a passenger timetable.
    def make_feed(self, timepoint='1'):
        files = {
            'calendar.txt': [
                ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
                 'start_date', 'end_date'],
                ['service', '1', '1', '1', '1', '1', '0', '0', '20261120', '20261123'],
            ],
            'calendar_dates.txt': [
                ['service_id', 'date', 'exception_type'],
                ['service', '20261121', '1'],
                ['service', '20261123', '2'],
            ],
            'stops.txt': [
                ['stop_id', 'stop_name', 'parent_station'],
                ['station-t', '津田沼駅', ''], ['platform-1', '1番線', 'station-t'],
                ['station-c', '千葉', ''], ['station-s', '蘇我', ''],
                ['station-i', '上総一ノ宮', ''], ['station-a', '太東', ''],
            ],
            'routes.txt': [['route_id', 'route_type', 'route_long_name'], ['rail', '2', 'TEST ONLY']],
            'trips.txt': [
                ['route_id', 'service_id', 'trip_id', 'trip_headsign'],
                ['rail', 'service', 'test', 'TEST ONLY'],
            ],
            'stop_times.txt': [
                ['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time',
                 'pickup_type', 'drop_off_type', 'timepoint'],
                ['test', 'station-a', '3', '25:04:00', '25:04:00', '1', '0', '1'],
                ['test', 'platform-1', '1', '23:55:00', '23:55:00', '0', '1', '1'],
                ['test', 'station-i', '2', '24:50:30', '24:51:00', '0', '0', timepoint],
            ],
        }
        buffer = BytesIO()
        with ZipFile(buffer, 'w') as feed:
            for name, records in files.items():
                contents = StringIO()
                csv.writer(contents).writerows(records)
                feed.writestr(name, contents.getvalue())
        return ZipFile(buffer)

    def test_exact_schedule_includes_calendar_exceptions_and_stop_permissions(self):
        with self.make_feed() as feed:
            trip, = convert(feed, date(2026, 11, 20), date(2026, 11, 23))
        self.assertEqual(trip['addDates'], ['2026-11-20', '2026-11-21'])
        self.assertEqual([stop['station'] for stop in trip['stops']], ['t', 'i', 'a'])
        self.assertEqual(trip['stops'][1]['arrival'], '24:50:30')
        self.assertFalse(trip['stops'][0]['dropOff'])
        self.assertFalse(trip['stops'][2]['pickup'])

    def test_estimated_times_are_rejected(self):
        with self.make_feed(timepoint='0') as feed, self.assertRaisesRegex(ValueError, 'Estimated'):
            convert(feed, date(2026, 11, 20), date(2026, 11, 23))
