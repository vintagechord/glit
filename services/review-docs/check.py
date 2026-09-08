#!/usr/bin/env python3
"""Read-only converter readiness check. Never reads a document or network secret."""
import importlib
import json
import shutil
import subprocess
import sys


class CheckError(Exception):
    def __init__(self, code):
        self.code = code


def check_converters():
    try:
        for module in ('olefile', 'striprtf.striprtf', 'hwp5.xmlmodel', 'lxml.etree', 'pdfplumber'):
            importlib.import_module(module)
    except Exception:
        raise CheckError('PYTHON_DEPENDENCIES_UNAVAILABLE') from None

    for name, arguments, code, allowed in (
        ('antiword', ['-h'], 'DOC_CONVERTER_UNAVAILABLE', (0, 1)),
        ('pdftoppm', ['-v'], 'PDF_CONVERTER_UNAVAILABLE', (0,)),
        ('tesseract', ['--version'], 'OCR_CONVERTER_UNAVAILABLE', (0,)),
    ):
        executable = shutil.which(name)
        if not executable:
            raise CheckError(code)
        try:
            result = subprocess.run([executable, *arguments], capture_output=True, timeout=5)
            if result.returncode not in allowed:
                raise CheckError(code)
        except (OSError, subprocess.SubprocessError):
            raise CheckError(code) from None

    try:
        languages = subprocess.run(
            [shutil.which('tesseract'), '--list-langs'], capture_output=True, text=True, timeout=5,
        )
        if languages.returncode or not {'kor', 'eng', 'jpn'}.issubset(set(languages.stdout.splitlines())):
            raise CheckError('OCR_LANGUAGES_UNAVAILABLE')
    except (OSError, subprocess.SubprocessError):
        raise CheckError('OCR_CONVERTER_UNAVAILABLE') from None


def main():
    try:
        check_converters()
        print(json.dumps({'ok': True}))
        return 0
    except CheckError as error:
        print(json.dumps({'ok': False, 'code': error.code}))
        return 1
    except Exception:
        print(json.dumps({'ok': False, 'code': 'CONVERTER_CHECK_FAILED'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
