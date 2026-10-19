import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAttachment, fileSize, MAX_ATTACHMENT_BYTES, sniffMime } from '../../shared/attachments.js';

test('checkAttachment accepts a photo or PDF within 5 MB', () => {
  assert.equal(checkAttachment({ type: 'photo', mime: 'image/jpeg', size: 1000 }), null);
  assert.equal(checkAttachment({ type: 'photo', mime: 'image/png', size: 1000, category: 'Scan' }), null);
  assert.equal(checkAttachment({ type: 'pdf', mime: 'application/pdf', size: MAX_ATTACHMENT_BYTES }), null);
});

test('checkAttachment rejects wrong type, size, mismatch and long category', () => {
  assert.equal(checkAttachment({ type: '', mime: 'image/jpeg', size: 10 }), 'type');
  assert.equal(checkAttachment({ type: 'photo', mime: 'image/jpeg', size: 0 }), 'empty');
  assert.equal(checkAttachment({ type: 'pdf', mime: 'application/pdf', size: MAX_ATTACHMENT_BYTES + 1 }), 'size');
  assert.equal(checkAttachment({ type: 'pdf', mime: 'image/jpeg', size: 10 }), 'mismatch');
  assert.equal(checkAttachment({ type: 'photo', mime: 'application/pdf', size: 10 }), 'mismatch');
  assert.equal(checkAttachment({ type: 'photo', mime: 'image/gif', size: 10 }), 'mismatch');
  assert.equal(checkAttachment({ type: 'pdf', mime: 'application/pdf', size: 10, category: 'x'.repeat(61) }), 'category');
});

test('sniffMime reads the real format from the first bytes', () => {
  assert.equal(sniffMime(Buffer.from('%PDF-1.7\n')), 'application/pdf');
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
  assert.equal(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffMime(Buffer.from('MZ not a pdf')), null);
});

test('fileSize formats bytes', () => {
  assert.equal(fileSize(500), '500 B');
  assert.equal(fileSize(1536), '1.5 KB');
  assert.equal(fileSize(2.5 * 1024 * 1024), '2.5 MB');
});
