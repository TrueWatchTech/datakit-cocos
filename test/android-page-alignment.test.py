import importlib.util
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('alignment', Path(__file__).resolve().parents[1] / 'scripts/check-android-page-alignment.py')
alignment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alignment)


def elf(align=16384, relro_end=32768, address=16384, is64=True):
    data = bytearray(256)
    data[:6] = b'\x7fELF' + bytes([2 if is64 else 1, 1])
    if is64:
        struct.pack_into('<Q', data, 32, 64)
        struct.pack_into('<HH', data, 54, 56, 2)
        struct.pack_into('<IIQQQQQQ', data, 64, 1, 6, 0, address, 0, 0, 16384, align)
        struct.pack_into('<IIQQQQQQ', data, 120, 0x6474e552, 4, 0, 16384, 0, 0, relro_end - 16384, 1)
    else:
        struct.pack_into('<I', data, 28, 52)
        struct.pack_into('<HH', data, 42, 32, 2)
        struct.pack_into('<IIIIIIII', data, 52, 1, 0, address, 0, 0, 16384, 6, align)
        struct.pack_into('<IIIIIIII', data, 84, 0x6474e552, 0, 16384, 0, 0, relro_end - 16384, 4, 1)
    return data


class AlignmentTest(unittest.TestCase):
    def test_load_and_relro_are_independent_requirements(self):
        for is64 in (True, False):
            self.assertFalse(alignment.inspect_elf(elf(is64=is64))['errors'])
            self.assertTrue(alignment.inspect_elf(elf(align=4096, is64=is64))['errors'])
            self.assertTrue(alignment.inspect_elf(elf(relro_end=20480, is64=is64))['errors'])
            self.assertTrue(alignment.inspect_elf(elf(address=4096, is64=is64))['errors'])

    def test_rejects_invalid_header(self):
        with self.assertRaises(ValueError):
            alignment.inspect_elf(b'not an ELF')
        data = elf()
        struct.pack_into('<H', data, 56, 100)
        with self.assertRaises(ValueError):
            alignment.inspect_elf(data)

    def test_checks_all_libraries_and_zip_packaging(self):
        with tempfile.TemporaryDirectory() as root:
            apk = Path(root) / 'app.apk'
            for compression, payload, passed in (
                (zipfile.ZIP_DEFLATED, elf(), True),
                (zipfile.ZIP_DEFLATED, elf(align=4096), False),
                (zipfile.ZIP_STORED, elf(), False),
            ):
                with zipfile.ZipFile(apk, 'w', compression) as output:
                    output.writestr('lib/arm64-v8a/libgood.so', elf())
                    output.writestr('lib/arm64-v8a/libother.so', payload)
                report = alignment.inspect_apk(apk)
                self.assertEqual(len(report['libraries']), 2)
                self.assertEqual(report['passed'], passed)
            with zipfile.ZipFile(apk, 'w'):
                pass
            self.assertFalse(alignment.inspect_apk(apk)['passed'])


if __name__ == '__main__':
    unittest.main()
