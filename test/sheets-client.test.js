import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSheetsFiles, SHEETS_MAX_FILE_BYTES, SHEETS_MAX_FILES, SHEETS_MAX_TOTAL_BYTES } from '../src/sheets-api.js';

const file = (name, size = 1024) => ({ name, size });

test('Google Sheets client accepts the supported workshop file formats', () => {
  assert.doesNotThrow(() => validateSheetsFiles([
    file('poster.pdf'),
    file('letters.svg'),
    file('layout.dxf'),
    file('reference.png'),
    file('photo.JPG'),
  ]));
});

test('Google Sheets client enforces count, extension, per-file, and total limits', () => {
  assert.throws(() => validateSheetsFiles(Array.from({ length: SHEETS_MAX_FILES + 1 }, (_, index) => file(`${index}.pdf`))), /no more than/i);
  assert.throws(() => validateSheetsFiles([file('installer.exe')]), /PDF, SVG/i);
  assert.throws(() => validateSheetsFiles([file('oversize.pdf', SHEETS_MAX_FILE_BYTES + 1)]), /200 MB/i);
  assert.throws(() => validateSheetsFiles([file('one.pdf', SHEETS_MAX_TOTAL_BYTES), file('two.pdf', 1)]), /200 MB/i);
});
