#!/bin/bash
# Assemble dist-translate/ — everything Translate needs to be served, and nothing else.
#
# WHY A CURATED LIST AND NOT `cp -R`. The previous version copied engine/ and
# liblouis/ wholesale. Those are 289 MB and 112 MB on disk, almost all of it
# Rust build intermediates and liblouis source that no browser ever asks for,
# and Cloudflare Pages caps a project at 20,000 files. The app tells us exactly
# what it needs — its own imports, its service worker's precache list, and two
# lazy loads — so that is what goes.
#
# THE PATHS ARE ABSOLUTE. index.html asks for /engine/liblouis-wasm.js and
# translate.mjs imports /Translate/verify.mjs, so the DEPLOY ROOT is this
# folder, with the app living at /Translate/. A root index.html redirects, so
# the bare domain lands somewhere useful.
#
# Run:  bash build-translate.sh
set -euo pipefail
cd "$(dirname "$0")"

OUT=dist-translate
rm -rf "$OUT"
mkdir -p "$OUT/Translate" "$OUT/engine/mathcat" "$OUT/liblouis" "$OUT/web"

# --- the app itself ------------------------------------------------------
# THE MODULE LIST IS DERIVED, NOT TYPED. A hand-written list was wrong the first
# time it was tried: it was built by grepping for absolute imports, so
# mathnode.mjs and ueb-symbols.mjs — imported RELATIVELY by their siblings —
# were missed, and the deployed app loaded, showed no error a user could see,
# and simply did nothing when you typed. Walking the graph from translate.mjs
# cannot make that mistake, and cannot go stale when an import is added.
python3 - "$OUT" <<'PYEOF'
import os, re, shutil, sys
out = sys.argv[1]
seen, queue = set(), ['Translate/translate.mjs']
while queue:
    f = queue.pop()
    if f in seen or not os.path.exists(f): continue
    seen.add(f)
    src = open(f, encoding='utf-8', errors='ignore').read()
    for m in re.findall(r"""(?:from|import)\s*\(?\s*['"]([^'"]+)['"]""", src):
        m = m.split('?')[0]
        if m.startswith('/'):   dep = os.path.normpath(m).lstrip('/')
        elif m.startswith('.'): dep = os.path.normpath(os.path.join(os.path.dirname(f), m))
        else: continue
        if dep not in seen: queue.append(dep)
missing = [m for m in seen if not os.path.exists(m)]
if missing:
    print('MISSING MODULES: ' + ', '.join(sorted(missing)), file=sys.stderr); sys.exit(1)
for m in sorted(seen):
    dst = os.path.join(out, m)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(m, dst)
print(f'  {len(seen)} modules copied (graph walked from translate.mjs)')
PYEOF

# The page itself and the files it names directly.
for f in index.html sw.js manifest.webmanifest 404.html; do
  cp "Translate/$f" "$OUT/Translate/$f"
done

# Example files a teacher can open from Load. The music ones do not travel:
# Translate no longer does music, so a music file here would only disappoint.
mkdir -p "$OUT/Translate/examples"
# .ebrl travels too — the Help tour IS one, and it 404s in production if this
# only ever looked for .brf.
for f in Translate/examples/*.brf Translate/examples/*.ebrl; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in music-*) continue ;; esac
  cp "$f" "$OUT/Translate/examples/"
done

# --- the engines ---------------------------------------------------------
# liblouis (braille translation) and MathCAT (maths braille and speech). Only
# the browser build of each: the Node builds and the Rust sources stay home.
cp engine/liblouis-wasm.js engine/liblouis-wasm.wasm \
   engine/brf-ascii.mjs engine/louis-browser.mjs "$OUT/engine/"
# Trailing /. copies the CONTENTS. The module walk above has already created
# this directory (emboss_mathcat.js is in the graph), and `cp -R src dst` with dst
# existing nests src INSIDE it — which put the wasm at pkg-web/pkg-web/ and left
# MathCAT 404ing in a build that otherwise looked complete.
mkdir -p "$OUT/engine/mathcat/pkg-web"
cp -R engine/mathcat/pkg-web/. "$OUT/engine/mathcat/pkg-web/"

# Every liblouis table, because the app offers 142 braille codes and fetches a
# table the first time one is chosen. 14 MB, and the alternative is an app that
# works in English and fails quietly in Welsh.
cp -R liblouis/tables "$OUT/liblouis/tables"

# --- the page's own assets ----------------------------------------------
cp web/logo.svg "$OUT/web/logo.svg"
cp -R web/fonts "$OUT/web/fonts"          # Inter + APH Braille Shadows, with licences
mkdir -p "$OUT/web/vendor"
cp web/vendor/temml.min.js "$OUT/web/vendor/temml.min.js"

# Nemeth tables and reader, loaded as classic scripts from the root.
cp nemeth-symbol-table.js nemeth-to-latex.js "$OUT/"

# PAGES SERVES THE NEAREST 404, WALKING UP. A copy under /Translate/ answers
# for /Translate/… only; a typo in a precache path under /engine/ or /web/ walks
# past it, finds nothing, and gets the root redirect with a 200 — which is the
# silent failure the 404 page exists to end. The root copy is what covers those.
cp Translate/404.html "$OUT/404.html"

# --- a root that goes somewhere -----------------------------------------
cat > "$OUT/index.html" <<'HTML'
<!doctype html>
<meta charset="utf-8">
<title>Translate</title>
<meta http-equiv="refresh" content="0; url=/Translate/">
<link rel="canonical" href="/Translate/">
<p>Opening <a href="/Translate/">Translate</a>…</p>
HTML

# --- the licences of everything we ship ----------------------------------
# EVERY DEPLOY DISTRIBUTES OTHER PEOPLE'S SOFTWARE (2026-09-02, the audit).
# liblouis is LGPL and Temml, MathCAT and Inter are MIT/OFL; the build shipped
# none of their texts, and the LGPL wants a source offer besides. The texts are
# copied from ONE place each, so they cannot drift from what is shipped, and
# licences/NOTICE.md is turned into a page the credits link to.
mkdir -p "$OUT/licences"
cp licences/NOTICE.md licences/Temml-MIT.txt licences/MathCAT-MIT.txt \
   licences/liblouis-LGPL-2.1.txt licences/Inter-OFL-1.1.txt "$OUT/licences/"
python3 - "$OUT" <<'PYEOF'
import html, sys, os
out = sys.argv[1]
notice = open('licences/NOTICE.md', encoding='utf-8').read()
files = sorted(f for f in os.listdir(os.path.join(out, 'licences')) if f.endswith('.txt'))
links = '\n'.join(f'<li><a href="/licences/{f}">{html.escape(f)}</a></li>' for f in files)
open(os.path.join(out, 'licences', 'index.html'), 'w', encoding='utf-8').write(f"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Translate - third-party licences</title>
<style>body{{max-width:44rem;margin:2rem auto;padding:0 1rem;font:16px/1.55 system-ui,sans-serif;color:#171d1c}}
pre{{white-space:pre-wrap;font:inherit}} a{{color:#0b5}} h1{{font-size:1.4rem}}</style>
<h1>Third-party licences</h1>
<pre>{html.escape(notice)}</pre>
<h2>Full texts</h2>
<ul>{links}</ul>
<p><a href="/Translate/">Back to Translate</a></p>
""")
print('  licences/ - NOTICE plus %d full texts' % len(files))
PYEOF

# --- security headers, with the inline scripts HASHED --------------------
# A CSP is the net under the escaping discipline for the day an escape is
# missed (2026-09-02, the audit). script-src 'self' alone would break the app:
# index.html carries three small inline scripts that bridge the two classic
# libraries into module scope. Their hashes are computed HERE, from the file
# being shipped, so the policy cannot go stale the way a typed hash would.
python3 - "$OUT" <<'PYEOF'
import base64, hashlib, re, sys, os
out = sys.argv[1]
src = open(os.path.join(out, 'Translate', 'index.html'), encoding='utf-8').read()
inline = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', src, re.S)
hashes = ' '.join("'sha256-%s'" % base64.b64encode(hashlib.sha256(b.encode('utf-8')).digest()).decode()
                  for b in inline)
policy = ("default-src 'self'; "
          "script-src 'self' 'wasm-unsafe-eval' " + hashes + "; "
          # Temml writes style attributes into the MathML it returns, and the
          # app's own stylesheet is inline in index.html.
          "style-src 'self' 'unsafe-inline'; "
          "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
          "object-src 'none'; base-uri 'self'; form-action 'self'; "
          "frame-ancestors 'none'")
open(os.path.join(out, '_headers'), 'w', encoding='utf-8').write(f"""/*
  Content-Security-Policy: {policy}
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
""")
print('  _headers - CSP with %d inline-script hashes' % len(inline))
PYEOF

# The one asset that is fetched by the wasm loader rather than by a URL in the
# source, so nothing else would notice it missing.
for required in engine/mathcat/pkg-web/emboss_mathcat_bg.wasm engine/liblouis-wasm.wasm \
                Translate/translate.mjs web/fonts/inter-latin.woff2; do
  [ -f "$OUT/$required" ] || { echo "✗ missing from the build: $required" >&2; exit 1; }
done

files=$(find "$OUT" -type f | wc -l | tr -d ' ')
size=$(du -sh "$OUT" | cut -f1)
echo "✓ $OUT — $files files, $size"
echo "  Cloudflare Pages allows 20,000 files and 25 MB per file."
[ "$files" -gt 20000 ] && { echo "✗ too many files for Pages" >&2; exit 1; }
big=$(find "$OUT" -type f -size +25M | head -1)
[ -n "$big" ] && { echo "✗ over 25 MB: $big" >&2; exit 1; }
exit 0
