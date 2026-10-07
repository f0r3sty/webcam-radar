#!/usr/bin/env python3
import re, json, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
BASE = 'https://www.skylinewebcams.com/'
COUNTRIES = json.load(open('/Users/puny/webcam-radar/tools/countries.json'))

CAMS = open('/tmp/swc_home.html', encoding='utf-8', errors='ignore').read()

def get(url, timeout=25):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', 'ignore')

TILE = re.compile(
    r'<a[^>]+href="(?:/)?(en/webcam/[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+\.html)"[^>]*>(.*?)</a>',
    re.S | re.I)
IMGALT = re.compile(r'<img[^>]*alt="([^"]*)"', re.I)
TCAM = re.compile(r'<p class="tcam">(.*?)</p>', re.S | re.I)
SUBT = re.compile(r'<p class="subt">(.*?)</p>', re.S | re.I)
IMG = re.compile(r'<img[^>]*src="(https://cdn\.skylinewebcams\.com/[^"]+)"', re.I)

def clean(t):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', t or '')).strip()

def parse_page(html):
    out = []
    for m in TILE.finditer(html):
        link, block = m.group(1), m.group(2)
        path = link.split('/')  # en/webcam/{country}/{region}/{city}/{slug}.html
        if len(path) < 6:
            continue
        country, region, city = path[2], path[3], path[4]
        name = clean(TCAM.search(block).group(1)) if TCAM.search(block) else ''
        alt = IMGALT.search(block)
        alt = clean(alt.group(1)) if alt else ''
        subt = SUBT.search(block)
        subt = clean(subt.group(1)) if subt else ''
        img = IMG.search(block)
        thumb = img.group(1) if img else ''
        title = name or alt or city.replace('-', ' ').title()
        out.append({
            'url': BASE + link,
            'name': title,
            'desc': subt,
            'country': country,
            'region': region,
            'city': city,
            'thumb': thumb,
        })
    return out

def crawl(country):
    try:
        html = get(BASE + 'en/webcam/' + country + '.html')
        return country, parse_page(html)
    except Exception as e:
        print(f'  ! {country}: {e}', file=sys.stderr)
        return country, []

all_cams = {}
# homepage featured first
for c in parse_page(CAMS):
    all_cams[c['url']] = c

with ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(crawl, c): c for c in COUNTRIES}
    done = 0
    for f in as_completed(futs):
        country, cams = f.result()
        for c in cams:
            all_cams.setdefault(c['url'], c)
        done += 1
        print(f'[{done}/{len(COUNTRIES)}] {country}: +{len(cams)} (total {len(all_cams)})')

catalog = sorted(all_cams.values(), key=lambda c: (c['country'], c['city'], c['name']))
json.dump(catalog, open('/Users/puny/webcam-radar/catalog.json', 'w'), ensure_ascii=False, indent=1)
print('WROTE', len(catalog), 'cams')
from collections import Counter
print('by country:', Counter(c['country'] for c in catalog).most_common(15))
