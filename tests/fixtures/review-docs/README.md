# Review document extraction input fixtures

These are test inputs, not output templates. They contain synthetic artists/lyrics.

- `table-two-tracks.docx`: actual OOXML tables with checked/unchecked Word content controls and repeated Korean lyrics.
- `conflicting-revision.docx`: the same album/tracks with conflicting company/lyrics.
- `multiple-albums.docx`: two album headings in one source.
- `track-count-mismatch.docx`: stated 2 tracks but 3 extracted tracks.
- `binary-word.doc`: genuine Word 97 OLE DOC converted from the synthetic table DOCX with LibreOffice in the worker image; antiword table continuation lines preserve repeated lyrics.
- `rtf-word.doc`: actual RTF with Unicode escapes and a `.doc` filename.
- `text-korean.pdf`: Korean text PDF.
- `pdf-two-albums-tables.pdf`: two albums with outside text headers and separate ruled tables on the same page, testing spatial reading order.
- `scanned.pdf`: a rasterized Korean text PDF; genuinely no text layer. Tests either actual configured OCR or the explicit missing-engine/language message.
- `sample-5017.hwp`, `table.hwp`, `password-12345.hwp`: upstream pyhwp HWP 5 binary fixtures, downloaded from https://github.com/mete0r/pyhwp/tree/master/tests/hwp5_tests/fixtures . The upstream project is Copyright (C) 2010-2015 mete0r, AGPL-3.0-or-later. See `PYHWP-LICENSE.txt` and the upstream repository for corresponding source.
- `multiple-tracks.hwp`: derived from `sample-5017.hwp` by `scripts/create-review-input-fixtures.py`, retaining compressed full BodyText, tables, and OLE structure while replacing two paragraph payloads with synthetic album/track/lyric fields. It deliberately retains nonmusic table/caption text so the adapter requires source review rather than claiming a perfect music structure.

Regenerate synthetic fixtures with the pinned converter venv plus test-only `python-docx==1.2.0` and `reportlab==4.4.9`:

```sh
python scripts/create-review-input-fixtures.py
REVIEW_DOCS_PYTHON=/path/to/venv/bin/python node --test --import tsx tests/review-docs-inputs.test.ts
```

Converter-only tests explicitly skip when `REVIEW_DOCS_PYTHON` is absent. The documented local run sets it and ran every test. Neither customer files nor external album pages are repeatedly collected for tests.
