# 最速乗換（JR津田沼 ⇄ 太東）

JR津田沼〜太東を往復検索します。別の列車への乗換は千葉・蘇我・上総一ノ宮で探索し、同じ列車に乗り続ける場合は乗換時間を加えません。

## 使い方

1. ブラウザで `index.html` を開き、利用許諾のある時刻表JSONを読み込みます。時刻表はブラウザ内で読み取り、ページを開き直した場合は再読み込みが必要です。
2. 方向、出発または到着の希望日時（日本時間）を選択します。
3. 必要に応じて各駅の乗換時間を設定し、検索します。設定はブラウザに保存します。

出発指定は指定日時から24時間以内の最早到着、到着指定は指定日時までの24時間以内の最遅出発を求めます。どちらの場合も、同じ時刻表で設定時間と乗換0分の結果を表示します。0分の結果は実際の乗車には使えません。日付をまたぐ便は各便の運行日と発着の暦日を区別して計算します。部分収録や有効期間の境界では、結果を収録範囲内として表示します。実際の乗車前には臨時の運休・遅延を確認してください。[JR東日本の公式時刻表](https://timetables.jreast.co.jp/) · [運行情報](https://traininfo.jreast.co.jp/train_info/kanto.aspx)

## 時刻表データの調査結果（2026年11月20日）

| 提供元 | 確認できた内容 | 取り込み |
| --- | --- | --- |
| [JR東日本の公式時刻表](https://timetables.jreast.co.jp/) | [太東駅の平日・土休日時刻表](https://timetables.jreast.co.jp/timetable/list0927.html)と、[列車ごとの停車駅・発着時刻・運転日](https://timetables.jreast.co.jp/2611/train/115/115311.html)を閲覧できます。データの無断転載・複写・加工を禁止しています。 | 権利者の許諾が必要です。 |
| ODPTのJR東日本データ | [GTFS](https://ckan.odpt.org/ja/dataset/jreast_tokyo_area)と[列車時刻表JSON](https://ckan.odpt.org/dataset/jreast__r_train_timetable)を提供しています。2026年のチャレンジ限定で、登録後のAPIキーと[限定ライセンス](https://developer.odpt.org/challenge_license)・特定利用条件が適用されます。カタログによると一部の臨時列車・直通列車は含まれない場合があります。 | APIキーと本プロジェクトへの適用条件を確認できていません。対象区間の実データと収録範囲も未確認です。 |
| [交通新聞社の時刻情報データ販売](https://www.kotsu.co.jp/service/jikoku_solution/data_sales/) | JRの時刻情報を契約で提供しています。 | 対象区間・更新頻度・アプリでの表示と加工の許諾を販売元に確認します。 |
| [駅すぱあと API](https://api-info.ekispert.com/plan/) | 時刻表APIがあります。フリープランではダイヤ探索が利用できません。 | 時刻表の取得・保存・表示を許す契約とキーが必要です。 |
| [内閣府「国民の祝日」CSV](https://data.e-gov.go.jp/data/dataset/cao_20190522_0002/resource/d9ad35a5-6c9c-4127-bdbe-aa138fdffe42) | e-Govのデータカタログで CC BY として公開されています。 | 2026・2027年の日付を抽出して `holidays.js` に取り込みました。 |

列車の時刻表は同梱していません。ファイル未登録時は検索が無効です。テスト専用の架空時刻が画面に読み込まれることはありません。

### 実データの導入に必要なもの

- 総武線各駅停車・総武快速線・外房線と、対象区間を走る内房線・京葉線等からの直通列車について、上下両方向の列車単位の時刻表が必要です。駅の発車時刻表だけでは、乗換に使う到着時刻や同一列車での直通を確定できません。
- 各便の列車ID、停車駅順、実際の発時刻・着時刻、運行日、有効期間、臨時の運転日・運休日を提供元で確認してください。直通列車は、途中で列車番号が変わっても継続乗車できると確認できた場合に同じ便としてまとめます。
- ODPTを利用できる場合は、提供条件を確認して取得したGTFSを下記の方法で変換します。公式時刻表と両方向・平日・土休日・直通列車を照合し、欠落があれば部分収録として使うか、別途許諾を得たデータで補います。継続利用には、利用条件が合う提供元との契約または権利者の許諾が必要です。

### GTFSからの変換

Python 3.11以上で、取得済みのJR東日本GTFS Schedule ZIPを変換できます。`FROM`、`TO`、`UPDATED` は提供元で確認した日付（`YYYY-MM-DD`）、`SOURCE_URL` はAPIキーを含まない提供元ページのHTTPS URLです。利用条件に従ってZIPとJSONを管理してください。

```sh
python3 tools/import_gtfs.py /path/to/jr-east.zip \
  --valid-from "$FROM" --valid-through "$TO" --updated-on "$UPDATED" \
  --source-name 'JR東日本 / 提供元名' --source-url "$SOURCE_URL" \
  > /path/to/timetable.json
```

変換は駅名（または親駅名）、停車順、発着時刻、乗降可否、`calendar.txt` と `calendar_dates.txt` の運行日を使用します。公式GTFSでの検証は、利用できる実ファイルを取得した後に行う必要があります。出力は常に部分収録とします。頻度制・推定時刻の便はエラーとし、GTFSで複数の便に分かれた直通の結合やリアルタイム情報は扱いません。[GTFS Schedule仕様](https://gtfs.org/documentation/schedule/reference/)

### 時刻表JSON（version 1）

| フィールド | 内容 |
| --- | --- |
| `version`, `coverage` | `1`。収録範囲は `complete` または `partial`。両方向・運行日・対象便をすべて確認できた場合のみ `complete`。 |
| `source` | `name`（提供元）、`url`（HTTPS）、`updatedOn`（データ更新日）。 |
| `validFrom`, `validThrough` | 有効な運行日の初日・最終日（両端を含む）。日付は `YYYY-MM-DD`。内閣府の祝日データを取り込んだ2026〜2027年に対応。 |
| `dayOverrides` | 任意。年末年始などの日付をキーに `weekday` または `weekendHoliday` を指定。 |
| `trips[]` | `id`（データ内で一意）、`line`（路線）、`name`（列車名・種別など）、任意の `destination`（行先）。同一便は1件。 |
| `trips[].dayTypes` | 運行するダイヤ区分の配列。`weekday` は平日、`weekendHoliday` は土曜・日曜・祝日。日付指定のみの便は空配列。 |
| `trips[].addDates`, `trips[].removeDates` | 任意。増発・運休など、便単位で追加・除外する運行日の配列。 |
| `trips[].stops[]` | 実際の停車順に `station`、`arrival`、`departure` を指定。時刻は日本時間の `HH:MM` または `HH:MM:SS`。翌日は `24:00`〜`47:59:59`。先頭駅の着と末尾駅の発は `null` 可。乗降の制限は任意の `pickup: false`、`dropOff: false` で指定。 |

駅コードは `t`（津田沼）、`c`（千葉）、`s`（蘇我）、`i`（上総一ノ宮）、`a`（太東）。途中停車駅は [timetable.js](./timetable.js) の駅一覧を参照してください。

## テスト

```sh
node --test
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test
```

テストでは合成データを使い、最早到着・最遅出発、往復、直通、乗換時間と発着時刻の境界、土休日と運行日の例外、日付またぎ、データ欠落と無効な入力を確認します。
