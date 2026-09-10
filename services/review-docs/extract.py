#!/usr/bin/env python3
"""Bounded, reader-only extraction. Input is a private temporary file, never a URL.
No macros, OLE objects, relationships, hyperlinks, or field instructions are executed.
"""
import csv
import signal
import io
import json
import os
import pathlib
import re
import resource
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zipfile
from xml.etree import ElementTree as ET

MAX_PAGES = 80
MAX_TEXT = 600000
MAX_EXPANDED = 80 * 1024 * 1024
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
W14 = '{http://schemas.microsoft.com/office/word/2010/wordml}'

class ExtractError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(message)

def child_lifetime():
    # Linux worker: converter SIGKILL/timeout also kills each reader/OCR child.
    # Remain in the worker supervisor's process group (no detached subprocesses).
    if sys.platform.startswith('linux'):
        import ctypes
        parent = os.getppid()
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0: os._exit(127)  # PR_SET_PDEATHSIG
        if os.getppid() != parent: os.kill(os.getpid(), signal.SIGKILL)

def run_reader(*args, **kwargs):
    if sys.platform.startswith('linux'): kwargs['preexec_fn'] = child_lifetime
    return subprocess.run(*args, **kwargs)

def safe_xml(raw):
    if re.search(br'<!\s*(?:DOCTYPE|ENTITY)', raw, re.I):
        raise ExtractError('XML_UNSAFE', '외부 엔티티 또는 DTD가 포함된 XML은 처리할 수 없습니다.')
    return ET.fromstring(raw)

def block(text, location, **extra):
    return dict(text=text, location=location, **extra)

def docx(path):
    out = []
    warnings = []
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) > 3000 or sum(i.file_size for i in infos) > MAX_EXPANDED:
                raise ExtractError('ARCHIVE_LIMIT', '압축 해제 크기 또는 파일 수 제한을 초과했습니다.')
            for i in infos:
                if i.flag_bits & 1:
                    raise ExtractError('ENCRYPTED', '암호화된 문서는 지원하지 않습니다.')
                if i.filename.startswith('/') or '..' in pathlib.PurePosixPath(i.filename).parts or '\\' in i.filename:
                    raise ExtractError('ARCHIVE_PATH', '안전하지 않은 압축 경로가 포함되어 있습니다.')
                if i.file_size > 1024 * 1024 and i.file_size > max(i.compress_size, 1) * 200:
                    raise ExtractError('ARCHIVE_LIMIT', '비정상 압축률의 문서는 처리할 수 없습니다.')
                if re.search(r'(vbaProject|embeddings/|activeX/)', i.filename, re.I):
                    raise ExtractError('ACTIVE_CONTENT', '매크로·OLE 개체가 포함된 문서는 제거 후 업로드해주세요.')
            if 'word/document.xml' not in archive.namelist():
                raise ExtractError('FORMAT_MISMATCH', '실제 DOCX 문서가 아닙니다.')
            for i in infos:
                if i.filename.endswith('.rels'):
                    rels = safe_xml(archive.read(i))
                    if any(r.attrib.get('TargetMode') == 'External' for r in rels):
                        warnings.append('외부 링크는 읽거나 불러오지 않았습니다.')
            def paragraph_text(p):
                pieces = []
                # State comes from content-control/legacy checkbox, not its displayed placeholder glyph.
                for e in p.iter():
                    if e.tag == W+'t': pieces.append(e.text or '')
                    elif e.tag == W+'tab': pieces.append('\t')
                    elif e.tag in (W+'br', W+'cr'): pieces.append('\n')
                    elif e.tag == W14+'checked': pieces.append('☑' if e.attrib.get(W14+'val', '1') in ('1', 'true') else '□')
                    elif e.tag == W+'checkBox':
                        checked = e.find(W+'checked')
                        if checked is None: checked = e.find(W+'default')
                        pieces.append('☑' if checked is not None and checked.attrib.get(W+'val', '1') in ('1', 'true') else '□')
                return ''.join(pieces).strip()
            def visit(parent, location):
                for idx, child in enumerate(parent):
                    loc = f'{location}/{idx+1}'
                    if child.tag == W+'p':
                        value = paragraph_text(child)
                        if value: out.append(block(value, loc, kind='paragraph'))
                    elif child.tag == W+'tbl':
                        for row_no, row in enumerate(child.findall(W+'tr')):
                            cells = []
                            for col_no, cell in enumerate(row.findall(W+'tc')):
                                value = '\n'.join(paragraph_text(p) for p in cell.findall('.//'+W+'p')).strip()
                                span = cell.find('./'+W+'tcPr/'+W+'gridSpan')
                                merge = cell.find('./'+W+'tcPr/'+W+'vMerge')
                                cells.append(dict(text=value, column=col_no+1, colSpan=int(span.attrib.get(W+'val', '1')) if span is not None else 1, verticalMerge=merge.attrib.get(W+'val','continue') if merge is not None else None))
                            if any(c['text'] for c in cells): out.append(block('\t'.join(c['text'] for c in cells), f'{loc}/row:{row_no+1}', kind='tableRow', cells=cells))
                    elif child.tag in (W+'sdt', W+'sdtContent', W+'customXml'):
                        visit(child, loc)
            main = safe_xml(archive.read('word/document.xml'))
            visit(main.find(W+'body'), '본문')
            # Headers/footers/notes are retained as evidence, never dropped silently.
            for name in archive.namelist():
                if re.match(r'word/(header\d+|footer\d+|footnotes|endnotes)\.xml$', name):
                    visit(safe_xml(archive.read(name)), name)
    except zipfile.BadZipFile:
        raise ExtractError('CORRUPT', 'DOCX 압축 구조가 손상되었습니다.')
    return dict(format='docx', blocks=out, warnings=list(dict.fromkeys(warnings)))

def hwp(path):
    import olefile
    try:
        with olefile.OleFileIO(path) as ole:
            if not ole.exists('FileHeader'): raise ExtractError('FORMAT_MISMATCH', 'HWP 5 문서가 아닙니다.')
            header = ole.openstream('FileHeader').read(256)
            if not header.startswith(b'HWP Document File'): raise ExtractError('FORMAT_MISMATCH', 'HWP 문서 시그니처가 일치하지 않습니다.')
            if len(header) < 40: raise ExtractError('CORRUPT', 'HWP 헤더가 손상되었습니다.')
            flags = struct.unpack_from('<I', header, 36)[0]
            if flags & 2: raise ExtractError('ENCRYPTED', '암호화된 HWP는 암호를 해제 후 업로드해주세요.')
            if flags & 4: raise ExtractError('HWP_DISTRIBUTION', '배포용 HWP는 지원하지 않습니다. 일반 HWP 또는 DOCX로 저장해주세요.')
            if flags & (1 << 4): raise ExtractError('HWP_DRM', 'DRM으로 보호된 HWP는 지원하지 않습니다.')
            if not any(p[0] == 'BodyText' for p in ole.listdir()): raise ExtractError('HWP_BODY_MISSING', 'HWP 전체 본문이 없습니다. 미리보기 텍스트로 대체하지 않습니다.')
            # Preflight ALL compressed BodyText streams with bounded decompression.
            import zlib
            total = 0
            for entry in ole.listdir():
                if entry[0] != 'BodyText': continue
                raw = ole.openstream(entry).read(MAX_EXPANDED+1)
                if flags & 1:
                    decoder = zlib.decompressobj(-15)
                    raw = decoder.decompress(raw, MAX_EXPANDED-total+1)
                    if decoder.unconsumed_tail or not decoder.eof: raise ExtractError('ARCHIVE_LIMIT', 'HWP 본문 압축 크기가 제한을 초과했거나 손상되었습니다.')
                total += len(raw)
                if total > MAX_EXPANDED: raise ExtractError('ARCHIVE_LIMIT', 'HWP 전체 본문이 제한을 초과했습니다.')
        from hwp5.xmlmodel import Hwp5File
        with_file = Hwp5File(str(path))
        try:
            chunks, size = [], 0
            for chunk in with_file.xmlevents().bytechunks():
                size += len(chunk)
                if size > MAX_EXPANDED: raise ExtractError('ARCHIVE_LIMIT', 'HWP XML 본문이 제한을 초과했습니다.')
                chunks.append(chunk)
            root = safe_xml(b''.join(chunks))
        finally: with_file.close()
        out = []
        def paragraph_text(element):
            pieces = []
            for t in element.iter():
                if t.tag == 'Text': pieces.append(t.text or '')
                elif t.tag == 'ControlChar' and t.attrib.get('code') in ('10','9'):
                    pieces.append('\n' if t.attrib.get('code') == '10' else '\t')
            return ''.join(pieces)
        def visit(element, location='HWP본문'):
            if element.tag == 'TableRow':
                cells = [{'text': '\n'.join(paragraph_text(p) for p in c.iter('Paragraph')).strip(), 'column': idx+1} for idx,c in enumerate(element) if c.tag == 'TableCell']
                out.append(block('\t'.join(c['text'] for c in cells), location, kind='tableRow', cells=cells))
            elif element.tag == 'Paragraph' and not element.findall('.//TableControl'):
                text = paragraph_text(element)
                if text.strip(): out.append(block(text, location, kind='paragraph'))
            else:
                for idx, child in enumerate(element): visit(child, f'{location}/{child.tag}:{idx+1}')
        body = root.find('.//BodyText')
        if body is None: raise ExtractError('HWP_BODY_MISSING', 'HWP 전체 본문 구조를 읽지 못했습니다.')
        visit(body)
        return dict(format='hwp5', blocks=out, warnings=['HWP 전체 BodyText 본문·표를 읽었습니다. 복잡한 컨트롤과 표의 가사 읽기 순서를 원문과 비교해주세요.'])
    except ExtractError: raise
    except Exception:
        raise ExtractError('HWP_CORRUPT_OR_UNSUPPORTED', 'HWP 본문 파싱에 실패했습니다. 손상되었거나 지원하지 않는 HWP 구조입니다. DOCX로 저장 후 재시도해주세요.')

def word_doc(path):
    raw = path.read_bytes()
    if raw.lstrip().startswith(b'{\\rtf'):
        from striprtf.striprtf import rtf_to_text
        # The library decodes \ansicpg and Unicode escapes without executing fields/objects.
        if re.search(br'\\(?:object|objdata|pict)\b', raw, re.I):
            raise ExtractError('ACTIVE_CONTENT', '개체가 포함된 RTF는 텍스트 전용 문서로 저장해주세요.')
        value = rtf_to_text(raw.decode('latin1'), errors='strict')
        return dict(format='rtf-doc', blocks=[block(t, f'RTF/문단:{i+1}', kind='paragraph') for i,t in enumerate(value.splitlines()) if t.strip()], warnings=['RTF 기반 DOC입니다. 표와 반복 영역의 순서를 원문과 비교해주세요.'])
    import olefile
    try:
        with olefile.OleFileIO(path) as ole:
            if not ole.exists('WordDocument'): raise ExtractError('FORMAT_MISMATCH', '실제 바이너리 Word DOC 문서가 아닙니다.')
            header = ole.openstream('WordDocument').read(32)
            if len(header) < 12: raise ExtractError('CORRUPT', 'Word DOC 헤더가 손상되었습니다.')
            if struct.unpack_from('<H', header, 10)[0] & (0x100 | 0x8000): raise ExtractError('ENCRYPTED', '암호화된 Word DOC는 지원하지 않습니다.')
    except ExtractError: raise
    except Exception: raise ExtractError('CORRUPT', 'Word DOC 구조가 손상되었습니다.')
    antiword = shutil.which('antiword')
    if not antiword: raise ExtractError('CONVERTER_UNAVAILABLE', '바이너리 DOC 변환기 antiword가 없습니다. 워커 이미지의 antiword 설치를 확인해주세요.')
    env = {'PATH': os.environ.get('PATH',''), 'LANG': 'C.UTF-8', 'HOME': str(path.parent)}
    result = run_reader([antiword, '-m', 'UTF-8.txt', '-w', '0', str(path)], capture_output=True, timeout=60, env=env)
    if result.returncode: raise ExtractError('DOC_CONVERSION_FAILED', 'Word DOC 본문을 읽지 못했습니다. 손상 여부를 확인해주세요.')
    value = result.stdout.decode('utf-8', 'strict')
    out = []
    for i, text in enumerate(value.splitlines()):
        if not text.strip(): continue
        stripped = text.strip()
        if stripped.startswith('|') and stripped.endswith('|'):
            cells = [dict(text=v.strip(), column=ci+1) for ci,v in enumerate(stripped[1:-1].split('|'))]
            # antiword splits multiline cells across visual pipe rows. A blank first
            # cell continues the previous logical row; retain each column separately.
            if cells and not cells[0]['text'] and out and out[-1].get('kind') == 'tableRow' and len(out[-1]['cells']) == len(cells):
                previous = out[-1]
                for old, new in zip(previous['cells'], cells):
                    if new['text']: old['text'] += ('\n' if old['text'] else '') + new['text']
                previous['text'] = '\t'.join(c['text'] for c in previous['cells'])
                previous['location'] += f'/이어짐:{i+1}'
            else:
                out.append(block('\t'.join(c['text'] for c in cells), f'DOC/표행:{i+1}', kind='tableRow', cells=cells))
        else: out.append(block(text, f'DOC/문단:{i+1}', kind='paragraph'))
    return dict(format='binary-doc', blocks=out, warnings=['구형 Word DOC 변환 결과입니다. 표·곡 매칭을 원문과 비교해주세요.'])

def ocr_lines(output):
    lines = {}
    for row in csv.DictReader(io.StringIO(output), delimiter='\t'):
        if not row.get('text', '').strip(): continue
        key = (row['block_num'], row['par_num'], row['line_num'])
        lines.setdefault(key, []).append(row)
    if sum(len(row['text']) for words in lines.values() for row in words) > MAX_TEXT:
        raise ExtractError('TEXT_LIMIT', 'OCR 본문이 허용 길이를 초과했습니다. 자료를 나눠주세요.')
    return lines

def ocr_fields(lines):
    labels = {'앨범명':'album', '음반명':'album', '아티스트':'artist', '아티스트명':'artist', '가수':'artist', '가수명':'artist',
              '곡명':'title', '곡제목':'title', '노래제목':'title', '작사':'lyricist', '작사가':'lyricist', '작곡':'composer', '작곡가':'composer', '편곡':'arranger', '가사':'lyrics', '기획사':'company', '제작사':'company'}
    fields = {}
    for words in lines.values():
        match = re.match(r'^([^:：]{1,30})[:：]\s*(.+)$', ' '.join(word['text'] for word in words))
        if not match: continue
        field = labels.get(re.sub(r'\s+', '', match[1]))
        if field: fields.setdefault(field, set()).add(re.sub(r'\s+', '', match[2]))
    return fields

def has_ocr_track_heading(lines):
    # Be at least as conservative as the Node structurer: existing English
    # labels, numbered headings and MV artist-title lines are also real tracks.
    for words in lines.values():
        line = ' '.join(word['text'] for word in words).strip()
        labeled = re.match(r'^([^:：\t]{1,30})\s*[:：\t]\s*(.*)$', line)
        if labeled and re.sub(r'[\s:：.\-_/()[\]]', '', labeled[1].lower()) in {'곡명','곡제목','노래제목','title','tracktitle','트랙'}:
            return True
        if re.match(r'^(?:트랙\s*)?\d{1,3}[.)]\s+.+$', line) or re.match(r'^.+?\s+-\s+.+$', line):
            return True
    return False

def prefer_ocr_fallback(primary, candidate):
    original, retry = ocr_fields(primary), ocr_fields(candidate)
    # Never flatten an already recognized song/table or replace a recognized field
    # with a conflicting value. PSM 6 is only useful when auto layout missed the
    # track label and a single column recovers several explicit application fields.
    return (not has_ocr_track_heading(primary) and 'title' in retry and len(retry) >= max(3, len(original)+2)
            and all(values.issubset(retry.get(field, set())) for field, values in original.items()))

def read_ocr(image, fallback_deadline):
    command = ['tesseract', str(image), 'stdout', '-l', 'kor+eng+jpn', '--psm']
    primary = ocr_lines(run_reader(command+['3', 'tsv'], check=True, capture_output=True, text=True, timeout=60).stdout)
    if fallback_deadline is None or has_ocr_track_heading(primary): return primary, None
    remaining = min(20, fallback_deadline-time.monotonic())
    if remaining <= 0: return primary, None
    try:
        candidate = ocr_lines(run_reader(command+['6', 'tsv'], check=True, capture_output=True, text=True, timeout=remaining).stdout)
    except Exception:
        return primary, None  # A failed optional retry must retain the first pass.
    return (candidate, primary) if prefer_ocr_fallback(primary, candidate) else (primary, None)

def pdf(path):
    import pdfplumber
    blocks, warnings = [], []
    # Optional OCR retry shares the existing 90-second Node wall/80-second CPU
    # budget. Only single-page inputs retry, so no later page loses its budget.
    started = time.monotonic()
    try:
        with pdfplumber.open(path, password='') as document:
            if len(document.pages) > MAX_PAGES: raise ExtractError('PAGE_LIMIT', f'{MAX_PAGES}페이지까지 처리할 수 있습니다.')
            fallback_deadline = started+75 if len(document.pages)==1 else None
            for page_no, page in enumerate(document.pages, 1):
                if len(page.chars) > 0:
                    tables = page.find_tables()
                    positioned = []
                    for ti, table in enumerate(tables):
                        for ri, row in enumerate(table.extract()):
                            cells = [dict(text=c or '', column=ci+1) for ci,c in enumerate(row)]
                            bounds = table.rows[ri].bbox if ri < len(table.rows) else table.bbox
                            positioned.append(block('\t'.join(c['text'] for c in cells), f'페이지:{page_no}/표:{ti+1}/행:{ri+1}', kind='tableRow', cells=cells, page=page_no, bbox=list(bounds)))
                    outside = page.filter(lambda obj: not any(obj.get('x0',0) >= t.bbox[0] and obj.get('x1',0) <= t.bbox[2] and obj.get('top',0) >= t.bbox[1] and obj.get('bottom',0) <= t.bbox[3] for t in tables))
                    # Positioned lines and table rows share ONE ordered stream. Headers must
                    # precede the tracks they describe, including multiple albums on a page.
                    for li, line in enumerate(outside.extract_text_lines(layout=False, strip=False, return_chars=True)):
                        value = line['text']
                        if not value.strip(): continue
                        chars = sorted(line.get('chars', []), key=lambda c: c['x0'])
                        if any(right['x0']-left['x1'] > 30 for left,right in zip(chars,chars[1:])):
                            warnings.append(f'{page_no}페이지에 다단 배치가 있습니다. 읽기 순서를 확인해주세요.')
                        positioned.append(block(value, f'페이지:{page_no}/배치행:{li+1}', kind='layout', page=page_no, bbox=[line['x0'],line['top'],line['x1'],line['bottom']]))
                    positioned.sort(key=lambda item:(item['bbox'][1],item['bbox'][0]))
                    blocks.extend(positioned)
                    if any((i.get('width',0)*i.get('height',0)) > page.width*page.height*0.2 for i in page.images):
                        warnings.append(f'{page_no}페이지에 텍스트와 큰 이미지가 함께 있습니다. 이미지 속 가사 누락 여부를 확인해주세요. 텍스트가 있는 페이지에는 자동 OCR을 적용하지 않았습니다.')
                elif page.images:
                    if not shutil.which('pdftoppm') or not shutil.which('tesseract'):
                        raise ExtractError('OCR_UNAVAILABLE', f'{page_no}페이지는 스캔입니다. 워커에 poppler-utils, tesseract-ocr 및 kor/eng/jpn 언어팩이 필요합니다.')
                    languages = run_reader(['tesseract', '--list-langs'], capture_output=True, text=True, timeout=10)
                    installed = set(languages.stdout.splitlines())
                    missing = {'kor','eng','jpn'} - installed
                    if missing: raise ExtractError('OCR_LANGUAGE_MISSING', 'OCR 언어팩이 없습니다: '+', '.join(sorted(missing)))
                    with tempfile.TemporaryDirectory(prefix='review-ocr-', dir=path.parent) as tmp:
                        image_prefix = str(pathlib.Path(tmp)/'page')
                        run_reader(['pdftoppm', '-f', str(page_no), '-l', str(page_no), '-scale-to', '3000', '-singlefile', '-png', str(path), image_prefix], check=True, capture_output=True, timeout=30)
                        lines, original = read_ocr(image_prefix+'.png', fallback_deadline)
                        for entries, alternative in [(lines, False), (original or {}, True)]:
                            for key, words in entries.items():
                                variant = '자동배치원문:' if alternative else '단일열:' if original is not None else ''
                                blocks.append(block(' '.join(w['text'] for w in words), f'페이지:{page_no}/OCR:{variant}{"-".join(key)}', kind='ocrAlternative' if alternative else 'ocr', page=page_no, bbox=[int(words[0]['left']),int(words[0]['top'])], confidence=min(float(w['conf']) for w in words)))
                        if original is not None:
                            warnings.append(f'{page_no}페이지의 곡명 누락을 추가 OCR로 보완했습니다. 최초 인식 원문도 근거에 보존했으며 표·다단 배치와 가사 순서를 확인해주세요.')
                    warnings.append(f'{page_no}페이지에 한글·영어·일본어 OCR을 적용했습니다. 아티스트·곡명·크레딧·가사 확인이 필요합니다.')
            return dict(format='pdf', blocks=blocks, pageCount=len(document.pages), warnings=warnings)
    except ExtractError: raise
    except Exception as error:
        if type(error).__name__ in ('PDFPasswordIncorrect','PDFEncryptionError'): raise ExtractError('ENCRYPTED', '암호화된 PDF는 지원하지 않습니다.')
        raise ExtractError('PDF_EXTRACTION_FAILED', 'PDF 본문 또는 OCR 처리에 실패했습니다. 손상 여부와 워커 변환기 설정을 확인해주세요.')

def main():
    # Dedicated process: hard wall timeout in Node, CPU/address-space/file limits here.
    resource.setrlimit(resource.RLIMIT_CPU, (80, 85))
    resource.setrlimit(resource.RLIMIT_FSIZE, (100*1024*1024, 100*1024*1024))
    if sys.platform.startswith('linux'): resource.setrlimit(resource.RLIMIT_AS, (768*1024*1024, 768*1024*1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128,128))
    path = pathlib.Path(sys.argv[1])
    kind = sys.argv[2]
    try:
        result = {'docx':docx, 'doc':word_doc, 'hwp':hwp, 'pdf':pdf}[kind](path)
        text_length = sum(len(b['text']) for b in result['blocks'])
        if text_length > MAX_TEXT: raise ExtractError('TEXT_LIMIT', f'본문이 {MAX_TEXT:,}자를 초과했습니다. 뒷부분을 버리지 않았으며 자료를 나눠야 합니다.')
        if not text_length: raise ExtractError('EMPTY_DOCUMENT', '전체 본문에서 텍스트를 추출하지 못했습니다.')
        print(json.dumps(result, ensure_ascii=False))
    except ExtractError as error:
        print(json.dumps(dict(error=dict(code=error.code, message=error.message)), ensure_ascii=False)); sys.exit(2)
    except ImportError:
        print(json.dumps(dict(error=dict(code='CONVERTER_UNAVAILABLE', message='문서 추출 의존성이 설치되지 않았습니다. services/review-docs/requirements.txt를 확인해주세요.')), ensure_ascii=False)); sys.exit(2)
    except Exception:
        print(json.dumps(dict(error=dict(code='CORRUPT', message='파일을 안전하게 읽지 못했습니다. 손상 또는 지원하지 않는 문서 구조를 확인해주세요.')), ensure_ascii=False)); sys.exit(2)

if __name__ == '__main__': main()
