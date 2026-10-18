import test from 'node:test';
import assert from 'node:assert/strict';
import {
  retrySheetsTransport,
  validateSheetsFiles,
  SHEETS_MAX_FILE_BYTES,
  SHEETS_MAX_FILES,
  SHEETS_MAX_TOTAL_BYTES,
} from '../src/sheets-api.js';

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

test('Google Sheets client retries transient transport failures', async () => {
  let calls = 0;
  const pauses = [];
  const result = await retrySheetsTransport(async () => {
    calls++;
    if (calls < 3) throw new Error('temporary redirect failure');
    return { ok: true };
  }, {
    attempts: 3,
    pause: async milliseconds => pauses.push(milliseconds),
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [350, 700]);
});

test('Google Sheets client stops retrying after the final transport failure', async () => {
  let calls = 0;
  await assert.rejects(
    retrySheetsTransport(async () => {
      calls++;
      throw new Error('still offline');
    }, { attempts: 3, pause: async () => {} }),
    /still offline/,
  );
  assert.equal(calls, 3);
});
