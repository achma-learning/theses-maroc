"""Page 1 (page de garde) of each FMPM thesis PDF without downloading the whole file.
HTTP Range: first HEAD bytes + last TAIL bytes written at their real offsets into a sparse
file (the xref/trailer at the end then points correctly into page 1's objects at the start).
Steps: 300 KB+300 KB -> 3 MB+1 MB -> full file. Keeps page-1 text (or a PNG when there is
no text layer, for OCR). One request at a time, resumable.
Usage: python3 archive/fmpm/methode/fetch_page1.py <theses-fmpm-AAAA-AAAA.csv> <outdir> <tmpdir>
Then: python3 archive/specialites/page_de_garde.py <outdir>"""
import csv, os, re, subprocess, sys, time, urllib.request
src, out, tmp = sys.argv[1:4]
rows = list(csv.DictReader(open(src, encoding='utf-8-sig')))
UA = 'Mozilla/5.0 (these-research; one request at a time)'
log = open(os.path.join(out, '_log.tsv'), 'a', encoding='utf-8')


def get(url, rng=None):
    h = {'User-Agent': UA}
    if rng:
        h['Range'] = rng
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=180) as r:
        return r.status, r.headers, r.read()


def tail_and_size(url, n):
    st, hd, body = get(url, f'bytes=-{n}')
    m = re.search(r'/(\d+)', hd.get('Content-Range', ''))
    return body, (int(m.group(1)) if m else (len(body) if st == 200 else None))


def page1(pdf):
    return subprocess.run(['pdftotext', '-f', '1', '-l', '1', '-layout', pdf, '-'],
                          capture_output=True, text=True, timeout=60).stdout


def good(t):
    return len(t.strip()) >= 40 and re.search(r'jury|pr[ée]sident|th[èe]se', t, re.I)


for i, r in enumerate(rows):
    url = (r.get('PDF (texte intégral)') or '').strip()
    key = f"{r['Année']}-{r['N°']}"
    txt = os.path.join(out, key + '.txt')
    if not url or os.path.exists(txt) or os.path.exists(os.path.join(out, key + '.err')):
        continue
    pdf = os.path.join(tmp, 'cur.pdf')
    try:
        z, L = tail_and_size(url, 300_000)
        t, how = '', ''
        for head, tail in ((300_000, 300_000), (3_000_000, 1_000_000)):
            if not L or head + tail >= L:
                break
            _, _, a = get(url, f'bytes=0-{head-1}')
            if tail != len(z):
                _, _, z = get(url, f'bytes={L-tail}-{L-1}')
            b = bytearray(L)
            b[:len(a)] = a
            b[L-len(z):] = z
            open(pdf, 'wb').write(b)
            t, how = page1(pdf), f'range{head//1000}k'
            if good(t):
                break
        if not good(t):
            _, _, d = get(url)
            open(pdf, 'wb').write(d)
            t, how = page1(pdf), 'full'
        if len(t.strip()) < 40:
            subprocess.run(['pdftoppm', '-f', '1', '-l', '1', '-r', '200', '-gray', '-png',
                            '-singlefile', pdf, os.path.join(out, key)], timeout=180,
                           capture_output=True)
        open(txt, 'w', encoding='utf-8').write(t)
        log.write(f"{key}\tok\t{how}\t{L}\t{len(t.strip())}\t{url}\n")
    except Exception as e:
        open(os.path.join(out, key + '.err'), 'w').write(f"{url}\n{e!r}\n")
        log.write(f"{key}\terr\t{e!r}\t\t\t{url}\n")
    log.flush()
    if os.path.exists(pdf):
        os.remove(pdf)
    time.sleep(0.3)
    if i % 50 == 0:
        print(i, key, flush=True)
print('done', flush=True)
