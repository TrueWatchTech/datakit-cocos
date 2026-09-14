#!/usr/bin/env python3
"""Check every native library in an APK; requires only Python's standard library.

This verifies packaging/ELF structure, not runtime page-size assumptions.
"""
import argparse
import json
import struct
import zipfile

PAGE_SIZE = 16384


def inspect_elf(data):
    if data[:4] != b'\x7fELF' or data[4:6] not in (b'\x01\x01', b'\x02\x01'):
        raise ValueError('expected a little-endian ELF32 or ELF64 library')
    is64 = data[4] == 2
    phoff = struct.unpack_from('<Q' if is64 else '<I', data, 32 if is64 else 28)[0]
    entsize, count = struct.unpack_from('<HH', data, 54 if is64 else 42)
    expected = 56 if is64 else 32
    if entsize < expected or phoff + entsize * count > len(data):
        raise ValueError('invalid program header table')
    loads, relro, errors = [], [], []
    for index in range(count):
        offset = phoff + index * entsize
        if is64:
            kind, _, file_offset, address, _, _, memsize, align = struct.unpack_from('<IIQQQQQQ', data, offset)
        else:
            kind, file_offset, address, _, _, memsize, _, align = struct.unpack_from('<IIIIIIII', data, offset)
        if kind == 1:
            loads.append(align)
            if align < PAGE_SIZE or align & (align - 1):
                errors.append(f'LOAD[{index}] alignment {align} is not a power of two >= {PAGE_SIZE}')
            if (address - file_offset) % PAGE_SIZE:
                errors.append(f'LOAD[{index}] address/offset are not congruent modulo {PAGE_SIZE}')
        elif kind == 0x6474e552:
            relro.append(address + memsize)
            if (address + memsize) % PAGE_SIZE:
                errors.append(f'GNU_RELRO[{index}] end is not aligned to {PAGE_SIZE}')
    if not loads:
        errors.append('no LOAD segments')
    return {'load_alignments': loads, 'relro_ends': relro, 'errors': errors}


def inspect_apk(filename):
    libraries = []
    with zipfile.ZipFile(filename) as apk, open(filename, 'rb') as raw:
        for entry in apk.infolist():
            if not entry.filename.startswith('lib/') or not entry.filename.endswith('.so'):
                continue
            try:
                result = inspect_elf(apk.read(entry))
            except (ValueError, IndexError, struct.error) as error:
                result = {'errors': [f'invalid ELF: {error}']}
            result['library'] = entry.filename
            result['compressed'] = entry.compress_type != zipfile.ZIP_STORED
            if not result['compressed']:
                raw.seek(entry.header_offset)
                header = raw.read(30)
                name_length, extra_length = struct.unpack_from('<HH', header, 26)
                data_offset = entry.header_offset + 30 + name_length + extra_length
                result['zip_data_offset'] = data_offset
                if data_offset % PAGE_SIZE:
                    result['errors'].append(f'uncompressed ZIP entry offset {data_offset} is not 16 KB aligned')
            libraries.append(result)
    errors = ['APK contains no native libraries'] if not libraries else []
    return {'apk': str(filename), 'page_size': PAGE_SIZE, 'libraries': libraries,
            'errors': errors, 'passed': bool(libraries) and not any(item['errors'] for item in libraries)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk')
    args = parser.parse_args()
    report = inspect_apk(args.apk)
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['passed'] else 1)
