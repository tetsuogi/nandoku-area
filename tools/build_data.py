#!/usr/bin/env python3
"""tools/places.txt を Wikipedia 日本語版と照合して data.js を作る。

使い方:  python3 tools/build_data.py          （照合して data.js を書き出す）
         python3 tools/build_data.py --check  （照合結果の表示だけ）

- 各地名の Wikipedia 記事の冒頭「（よみ）」と、places.txt の読みが一致するか確かめる
- 市区町村は「読み＋し／く／ちょう／まち／そん／むら」と一致すれば OK（種別の読みもここで決まる）
- 町名・駅名などは、記事の読みに地名の読みが含まれていれば OK
- 一致しないものは data.js に入れず、一覧を表示する
- 記事の座標も取り出して data.js に入れる（地図リンク用）
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'places.txt'
CACHE = ROOT / 'tools' / '.cache' / 'wiki.json'
OUT = ROOT / 'data.js'

PREFS = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川',
         '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫',
         '奈良', '和歌山', '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎',
         '熊本', '大分', '宮崎', '鹿児島', '沖縄']
SUFFIX_READ = {'市': ['し'], '区': ['く'], '町': ['ちょう', 'まち'], '村': ['むら', 'そん']}
HIRA = re.compile(r'^[ぁ-ゖー]+$')
UA = 'nandoku-area-builder/1.0 (personal study app; tetsuogi on GitHub)'


def parse():
    rows = []
    for n, line in enumerate(SRC.read_text(encoding='utf-8').splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        cols = line.split('|') + [''] * 10
        pref, name, suffix, yomi, traps, level, city, wiki, alt, area = [c.strip() for c in cols[:10]]
        if pref not in PREFS:
            sys.exit(f'{n}行目: 都道府県名が不正です: {pref}')
        rows.append({
            'line': n, 'pref': pref, 'name': name, 'suffix': suffix, 'yomi': yomi,
            'traps': [t for t in traps.split('、') if t], 'alt': [a for a in alt.split('、') if a], 'area': area,
            'level': int(level or 2), 'city': city,
            'wiki': wiki or (name + suffix if suffix else name + '駅'),
        })
    return rows


def fetch(titles):
    cache = json.loads(CACHE.read_text(encoding='utf-8')) if CACHE.exists() else {}
    todo = [t for t in dict.fromkeys(titles) if t not in cache]
    for i in range(0, len(todo), 20):
        batch = todo[i:i + 20]
        q = urllib.parse.urlencode({
            'action': 'query', 'format': 'json', 'formatversion': 2, 'redirects': 1,
            'prop': 'extracts|coordinates|pageprops', 'exintro': 1, 'explaintext': 1, 'exlimit': 20,
            'ppprop': 'disambiguation', 'titles': '|'.join(batch),
        })
        req = urllib.request.Request(f'https://ja.wikipedia.org/w/api.php?{q}', headers={'User-Agent': UA})
        for wait in (5, 15, 45, 90):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = json.load(r)['query']
                break
            except urllib.error.HTTPError as e:
                if e.code != 429:
                    raise
                time.sleep(wait)  # 混んでいるときは待ってからやり直す
        else:
            sys.exit('Wikipedia が混んでいます。しばらくしてからやり直してください')
        # 正規化・リダイレクトをたどって、元のタイトル → ページ を対応づける
        alias = {t: t for t in batch}
        for key in ('normalized', 'redirects'):
            for m in data.get(key, []):
                for t, cur in list(alias.items()):
                    if cur == m['from']:
                        alias[t] = m['to']
        pages = {p['title']: p for p in data['pages']}
        for t in batch:
            p = pages.get(alias[t], {})
            co = (p.get('coordinates') or [{}])[0]
            cache[t] = {
                'title': p.get('title'), 'missing': 'missing' in p or not p,
                'disambig': 'disambiguation' in (p.get('pageprops') or {}),
                'extract': (p.get('extract') or '')[:400], 'lat': co.get('lat'), 'lng': co.get('lon'),
            }
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding='utf-8')
        time.sleep(2)
    return cache


def wiki_reading(extract):
    m = re.search(r'（([^）]*)）', extract[:200])
    if not m:
        return ''
    first = re.split(r'[、,，;；]', m.group(1))[0]
    return re.sub(r'[\s・ 　\-‐]', '', first)


def large(s):
    return s.translate(str.maketrans('ぁぃぅぇぉっゃゅょゎ', 'あいうえおつやゆよわ'))


def check(row, info):
    problems = []
    if not info or info['missing']:
        return None, ['記事が見つからない']
    if info['disambig']:
        return None, ['曖昧さ回避ページ']
    yomi = row['yomi']
    if not HIRA.match(yomi):
        problems.append('読みがひらがなでない')
    traps = row['traps']
    if len(traps) < 3 or len(set(traps)) != len(traps) or yomi in traps or any(not HIRA.match(t) for t in traps):
        problems.append('ひっかけの読みが不正（3つ・重複なし・正解と別・ひらがな）')
    # 沖縄の「きゃん／きやん」のような小書きの違いは同じとみなす
    w = large(wiki_reading(info['extract']))
    sr = ''
    if row['suffix']:
        ok = [s for s in SUFFIX_READ[row['suffix']] if w == large(yomi + s)]
        if ok:
            sr = ok[0]
        else:
            problems.append(f'読みが違う（記事: {w or "なし"}）')
    elif large(yomi) not in w:
        problems.append(f'読みが違う（記事: {w or "なし"}）')
    if row['pref'] not in info['extract'] and not (row['city'] and row['city'] in info['extract']):
        problems.append('記事の冒頭に都道府県名がない')
    return sr, problems


def main():
    rows = parse()
    keys = [(r['pref'], r['name']) for r in rows]
    dup = {k for k in keys if keys.count(k) > 1}
    if dup:
        sys.exit(f'同じ都道府県に同じ地名が重複しています: {dup}')
    # 同じ都道府県に「読み＋種別の読み」まで同じ地名があると、読みから漢字を答える問題で区別がつかない。
    # その場合は地域の列（例: 道北・宗谷地方）を必ず埋める
    same = {}
    for r in rows:
        same.setdefault((r['pref'], r['yomi'], r['suffix']), []).append(r)
    clash = [g for g in same.values() if len(g) > 1 and (any(not r['area'] for r in g) or len({r['area'] for r in g}) < len(g))]
    if clash:
        sys.exit('同じ都道府県に同じ読みの地名があります。地域の列で見分けられるようにしてください: ' +
                 ' / '.join('・'.join(f"{r['name']}{r['suffix']}（{r['line']}行目）" for r in g) for g in clash))
    cache = fetch([r['wiki'] for r in rows])
    out, ng = [], []
    for r in rows:
        info = cache.get(r['wiki'])
        sr, problems = check(r, info)
        if problems:
            ng.append((r, info, problems))
            continue
        code = PREFS.index(r['pref']) + 1
        item = {
            'id': f"{code:02d}-{r['name']}", 'pref': r['pref'], 'name': r['name'], 'suffix': r['suffix'], 'sr': sr,
            'yomi': r['yomi'], 'traps': r['traps'], 'level': r['level'],
        }
        if r['alt']:
            item['alt'] = r['alt']
        if r['area']:
            item['area'] = r['area']
        if r['city']:
            item['city'] = r['city']
        if info.get('lat') is not None:
            item['lat'], item['lng'] = round(info['lat'], 4), round(info['lng'], 4)
        item['wiki'] = info['title']
        out.append(item)

    for r, info, problems in ng:
        ex = (info or {}).get('extract', '')[:90].replace('\n', ' ')
        print(f"NG {r['line']:>4} {r['pref']} {r['name']}{r['suffix']}（{r['yomi']}） [{r['wiki']}] {' / '.join(problems)}\n       {ex}")
    print(f'\nOK {len(out)}件 / NG {len(ng)}件')

    if '--check' in sys.argv:
        return
    lines = ',\n'.join('  ' + json.dumps(o, ensure_ascii=False, separators=(', ', ': ')) for o in out)
    OUT.write_text(
        '// 難読地名データ（tools/build_data.py が tools/places.txt から生成。直接編集しない）\n'
        '// 読みの確認: Wikipedia日本語版の各記事\n'
        f'window.PLACES = [\n{lines}\n];\n', encoding='utf-8')
    print(f'{OUT.name} に書き出しました')


if __name__ == '__main__':
    main()
