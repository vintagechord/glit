"""Reproducible synthetic INPUT fixtures, never customer/output templates.
Requires python-docx==1.2.0, reportlab==4.4.9, Pillow and olefile (test tooling).
Upstream HWP fixture attribution: tests/fixtures/review-docs/README.md.
"""
from pathlib import Path
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from PIL import Image, ImageDraw
import shutil, struct, zlib, olefile
out=Path(__file__).resolve().parents[1]/'tests/fixtures/review-docs'
out.mkdir(parents=True,exist_ok=True)

def make_docx(name, lyrics, company='실제 제작사', album='두 곡 앨범', extra=False):
 d=Document()
 meta=d.add_table(rows=0, cols=2)
 for k,v in [('아티스트','검수 가수'),('앨범명',album),('기획사',company),('발매일','2026.09.07'),('트랙수','2')]:
  cells=meta.add_row().cells;cells[0].text=k;cells[1].text=v
 table=d.add_table(rows=1,cols=6)
 for c,v in zip(table.rows[0].cells,['번호','곡명','타이틀 여부','작사','작곡','가사']):c.text=v
 for num,title,flag,lyric in [('1','첫 곡','checked',lyrics),('2','Mr. Moon','unchecked','달빛을 따라\n다시 달빛을 따라')]:
  cells=table.add_row().cells
  for c,v in zip(cells,[num,title,'','작사인','작곡인',lyric]):c.text=v
  p=cells[2].paragraphs[0]._p
  sdt=OxmlElement('w:sdt'); pr=OxmlElement('w:sdtPr')
  check=OxmlElement('w14:checkbox');checked=OxmlElement('w14:checked');checked.set(qn('w14:val'),'1' if flag=='checked' else '0');check.append(checked);pr.append(check);sdt.append(pr)
  content=OxmlElement('w:sdtContent');r=OxmlElement('w:r');t=OxmlElement('w:t');t.text='☒' if flag=='checked' else '☐';r.append(t);content.append(r);sdt.append(content);p.append(sdt)
 d.add_paragraph('곡명: 세 번째 검수곡' if extra else '참고: 합성 입력 테스트 자료')
 if extra:d.add_paragraph('가사: 마지막 곡의 가사')
 d.save(out/name)
make_docx('table-two-tracks.docx','반복 가사\n반복 가사\n끝 가사')
make_docx('conflicting-revision.docx','수정된 다른 가사',company='다른 제작사')
make_docx('track-count-mismatch.docx','첫 가사',extra=True)
d=Document()
for title,lyric in [('첫 번째 앨범','첫 앨범 가사'),('두 번째 앨범','다음 앨범 가사')]:
 for line in [f'앨범명: {title}','아티스트: 검수 가수','곡명: 노래',f'가사: {lyric}']:d.add_paragraph(line)
d.save(out/'multiple-albums.docx')
# RTF Unicode escapes with a .doc filename: genuine RTF, not renamed DOCX.
lines=['아티스트: 검수 가수','곡명: 원문 노래','가사: 반복 구절','반복 구절']
def rtf_encode(s):return ''.join(c if ord(c)<128 else '\\u'+str(ord(c) if ord(c)<32768 else ord(c)-65536)+'?' for c in s)
(out/'rtf-word.doc').write_text('{\\rtf1\\ansi\\ansicpg949\\uc1 '+r'\par '.join(map(rtf_encode,lines))+'}',encoding='ascii')
pdfmetrics.registerFont(UnicodeCIDFont('HYSMyeongJo-Medium'))
c=canvas.Canvas(str(out/'text-korean.pdf'));c.setFont('HYSMyeongJo-Medium',12)
for i,line in enumerate(lines):c.drawString(60,780-i*24,line)
c.save()
im=Image.new('RGB',(900,600),'white');draw=ImageDraw.Draw(im);draw.text((30,30),'SCANNED REVIEW LYRICS',fill='black')
c=canvas.Canvas(str(out/'scanned.pdf'));c.drawInlineImage(im,40,200,width=500,height=333);c.save()
# Derive a valid multi-track HWP by replacing UTF-16 paragraph payloads in a real
# HWP 5 compressed BodyText stream, retaining record lengths/DocInfo/OLE layout.
base=out/'sample-5017.hwp';target=out/'multiple-tracks.hwp';shutil.copyfile(base,target)
with olefile.OleFileIO(target,write_mode=True) as ole:
 raw=ole.openstream('BodyText/Section0').read(); data=bytearray(zlib.decompress(raw,-15)); pos=0; replaced=0
 replacements=['아티스트: 검수 가수\n앨범명: 한글 앨범\n곡명: 첫 노래\n가사: 반복 구절\n반복 구절', '곡명: 둘째 노래\n작사: 작사인\n가사: 마지막 전체 본문 가사\n끝까지 보존']
 while pos+4<=len(data):
  header=struct.unpack_from('<I',data,pos)[0];tag=header&0x3ff;size=(header>>20)&0xfff;start=pos+4
  if size==0xfff:size=struct.unpack_from('<I',data,start)[0];start+=4
  payload=data[start:start+size]
  if tag==67 and size>=180 and replaced<2:
   encoded=replacements[replaced].encode('utf-16le')
   if len(encoded)<=size-2:
    data[start:start+size]=encoded+b' \x00'*((size-2-len(encoded))//2)+b'\r\x00';replaced+=1
  pos=start+size
 compressed=zlib.compress(bytes(data))[2:-4]
 if replaced!=2 or len(compressed)>len(raw):raise RuntimeError('HWP fixture replacement failed')
 ole.write_stream('BodyText/Section0',compressed.ljust(len(raw),b'\0'))
print('Created synthetic input fixtures in',out)
# Two album headers must precede their own table rows when mixed on one PDF page.
c=canvas.Canvas(str(out/'pdf-two-albums-tables.pdf'))
for top,title,track in [(760,'첫 앨범','첫 곡'),(440,'둘째 앨범','둘째 곡')]:
 c.setFont('HYSMyeongJo-Medium',12);c.drawString(50,top,f'앨범명: {title}');c.drawString(50,top-25,'아티스트: 검수 가수')
 columns=[50,90,220,360,550]; top-=50
 rows=[['번호','곡명','작곡','가사'],['1',track,'작곡인','반복 가사']]
 for row_no,values in enumerate(rows):
  y=top-row_no*40
  for i,value in enumerate(values):
   c.rect(columns[i],y-40,columns[i+1]-columns[i],40);c.drawString(columns[i]+4,y-22,value)
c.save()
# Scanner simulation rasterizes a real Korean text PDF; no hidden text layer remains.
import pypdfium2 as pdfium
pdfdoc=pdfium.PdfDocument(str(out/'text-korean.pdf'));bitmap=pdfdoc[0].render(scale=2);image=bitmap.to_pil()
c=canvas.Canvas(str(out/'scanned.pdf'));c.drawInlineImage(image,0,0,width=595,height=842);c.save()
