const test = require('node:test');
const assert = require('node:assert/strict');

const {
  jamendoSearchUrl,
  commercialRightsEvaluation,
  discoverOpenverseMusic
} = require('../lib/music_discovery');

test('Jamendo search excludes licences that are unsafe for commercial video synchronisation', () => {
  const url = new URL(jamendoSearchUrl('client', 'corporate instrumental', ['instrumental'], 5));
  assert.equal(url.searchParams.get('ccnc'), 'false');
  assert.equal(url.searchParams.get('ccnd'), 'false');
  assert.equal(url.searchParams.get('ccsa'), 'false');
  assert.equal(url.searchParams.get('audiodlformat'), 'mp32');
});

test('commercial rights gate accepts CC BY and rejects non-commercial material', () => {
  assert.equal(commercialRightsEvaluation({
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    downloadUrl: 'https://example.test/track.mp3'
  }).passed, true);
  assert.equal(commercialRightsEvaluation({
    licenceUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
    downloadUrl: 'https://example.test/track.mp3'
  }).passed, false);
});

test('Openverse discovery retains only commercially reusable, adaptable music', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      results: [
        {
          id: 'safe-track', title: 'Soft Corporate', creator: 'Creator', duration: 90000,
          url: 'https://example.test/safe.ogg', foreign_landing_url: 'https://example.test/safe',
          license: 'by', license_version: '4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/',
          attribution: 'Soft Corporate by Creator, CC BY 4.0', source: 'wikimedia_audio', filetype: 'ogg'
        },
        {
          id: 'unsafe-track', title: 'Restricted', creator: 'Creator', duration: 90000,
          url: 'https://example.test/unsafe.mp3', license: 'by-nc',
          license_url: 'https://creativecommons.org/licenses/by-nc/4.0/', source: 'example', filetype: 'mp3'
        }
      ]
    })
  });
  try {
    const result = await discoverOpenverseMusic({
      pack: { studio: { id: 'practical_open_source', name: 'Practical Open Source' }, fit: { keywords: [] } },
      topic: 'evidence workflow',
      limit: 2
    });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].id, 'safe-track');
    assert.equal(result.candidates[0].rights.attribution_required, true);
  } finally {
    global.fetch = originalFetch;
  }
});
