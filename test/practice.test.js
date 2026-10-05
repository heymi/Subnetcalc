import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { analyze, maskToPrefix, requiredPrefix } from '../lib/subnet.js';
import {
  DIFFICULTIES,
  EMPTY_STATS,
  FIXED_SPECS,
  QUESTION_TYPES,
  buildQuestion,
  grade,
  magicExampleHtml,
  magicOf,
  makeQuestion,
  practiceDrillsHtml,
  readStats,
  recordAnswer,
  worksheetHtml,
} from '../assets/js/practice-core.js';
import { hostsPrefixHtml, magicOctetHtml, sheetFigureHtml, sheetPdf } from '../scripts/cheat-sheet-assets.mjs';
import { group } from '../assets/js/ui.js';

const info = (input) => {
  const r = analyze(input);
  assert.equal(r.ok, true);
  return r.info;
};

describe('answers come from the engine', () => {
  const samples = [];
  for (let prefix = 8; prefix <= 32; prefix++) {
    const octet = prefix >= 24 ? 192 : 10;
    const host = prefix === 32 ? 9 : prefix === 31 ? 7 : 40;
    samples.push([prefix, [octet, prefix >= 16 ? 8 : 40, 19, host]]);
  }

  for (const [prefix, octets] of samples) {
    const input = `${octets.join('.')}/${prefix}`;
    const expected = info(input);

    test(`network /${prefix} matches analyze`, () => {
      const q = buildQuestion({ type: 'network', prefix, octets });
      assert.equal(q.answers.network, expected.network);
      assert.equal(q.answers.broadcast, expected.broadcast ?? 'none');
      assert.equal(q.answers.first, expected.firstHost);
      assert.equal(q.answers.last, expected.lastHost);
      assert.equal(magicOf(expected).network, expected.network);
      assert.equal(grade(q, q.answers).ok, true);
    });
  }

  test('/31 has no broadcast and both addresses are usable', () => {
    const expected = info('192.168.10.7/31');
    const q = buildQuestion({ type: 'network', prefix: 31, octets: [192, 168, 10, 7] });
    assert.equal(expected.broadcast, null);
    assert.equal(q.answers.broadcast, 'none');
    assert.equal(q.answers.first, expected.firstHost);
    assert.equal(q.answers.last, expected.lastHost);
    assert.equal(grade(q, { ...q.answers, broadcast: 'N/A' }).ok, true);
    assert.equal(grade(q, { ...q.answers, broadcast: '192.168.10.7' }).ok, false);
  });

  test('/32 is a single address', () => {
    const expected = info('10.0.0.5/32');
    const q = buildQuestion({ type: 'network', prefix: 32, octets: [10, 0, 0, 5] });
    assert.equal(q.answers.network, '10.0.0.5');
    assert.equal(q.answers.broadcast, 'none');
    assert.equal(q.answers.first, expected.firstHost);
    assert.equal(q.answers.last, expected.lastHost);
  });

  test('magic number crosses the third octet', () => {
    const expected = info('10.8.40.15/20');
    const q = buildQuestion({ type: 'magic', prefix: 20, octets: [10, 8, 40, 15] });
    assert.equal(q.answers.cidr, expected.cidr);
    assert.equal(magicOf(expected).index, 2);
    assert.match(q.explain.join(' '), /octet 3/);
    assert.match(q.explain.join(' '), /256 − 240 = 16/);
    assert.equal(grade(q, { cidr: '10.8.40.15/20' }).ok, false);
    assert.equal(grade(q, { cidr: expected.cidr }).ok, true);
  });

  test('magic number crosses the second octet', () => {
    const expected = info('10.40.15.9/12');
    const q = buildQuestion({ type: 'magic', prefix: 12, octets: [10, 40, 15, 9] });
    assert.equal(q.answers.cidr, expected.cidr);
    assert.equal(magicOf(expected).index, 1);
    assert.match(q.explain.join(' '), /octet 2/);
    assert.match(q.explain.join(' '), new RegExp(`256 − ${magicOf(expected).value} = ${magicOf(expected).block}`));
  });

  test('prefix, mask and host-count questions use the engine', () => {
    for (const hosts of [2, 6, 14, 30, 62, 126, 254, 510, 50, 70000]) {
      const q = buildQuestion({ type: 'hosts', hosts });
      assert.equal(q.answers.prefix, `/${requiredPrefix(hosts)}`);
      assert.equal(grade(q, { prefix: String(requiredPrefix(hosts)) }).ok, true);
    }
    const maskQ = buildQuestion({ type: 'prefix-mask', prefix: 23, octets: [10, 0, 0, 0] });
    const row = info('10.0.0.0/23');
    assert.equal(maskQ.answers.mask, row.netmask);
    assert.equal(maskQ.answers.usable.replace(/,/g, ''), String(row.usableHosts));
    assert.equal(grade(maskQ, { mask: row.netmask, usable: '510' }).ok, true);
    const prefixQ = buildQuestion({ type: 'mask-prefix', prefix: 22, octets: [10, 1, 2, 3] });
    assert.equal(prefixQ.answers.prefix, `/${maskToPrefix(info('10.1.2.3/22').netmask, 4)}`);
  });
});

describe('seeded sets', () => {
  test('the same seed and index repeat the question', () => {
    const opts = { seed: 'share1', index: 4, types: QUESTION_TYPES, difficulty: 'medium' };
    const a = makeQuestion(opts);
    const b = makeQuestion(opts);
    assert.deepEqual(a, b);
    assert.notEqual(makeQuestion({ ...opts, index: 5 }).prompt, a.prompt);
  });

  test('each type and difficulty can be selected and graded', () => {
    for (const difficulty of DIFFICULTIES) {
      for (const type of QUESTION_TYPES) {
        const q = makeQuestion({ seed: 'cover', index: 0, types: [type], difficulty });
        assert.equal(q.type, type);
        assert.equal(q.difficulty, difficulty);
        assert.equal(grade(q, q.answers).ok, true);
        assert.equal(grade(q, {}).blank, true);
        assert.equal(grade(q, { [q.fields[0].name]: 'not-an-answer' }).ok, false);
      }
    }
  });

  test('easy stays in /24–/30, medium in the third octet, hard includes /31 /32 and the second octet', () => {
    for (let i = 0; i < 20; i++) {
      const easy = makeQuestion({ seed: 'band', index: i, types: ['network', 'magic'], difficulty: 'easy' });
      assert.ok(easy.prefix >= 24 && easy.prefix <= 30);
      const medium = makeQuestion({ seed: 'band', index: i, types: ['network', 'magic'], difficulty: 'medium' });
      assert.ok(medium.prefix >= 16 && medium.prefix <= 23);
    }
    let saw31 = false;
    let saw32 = false;
    let sawSecond = false;
    for (let i = 0; i < 80; i++) {
      const q = makeQuestion({ seed: 'hardmix', index: i, types: ['network'], difficulty: 'hard' });
      if (q.prefix === 31) saw31 = true;
      else if (q.prefix === 32) saw32 = true;
      else if (q.prefix >= 8 && q.prefix <= 15) sawSecond = true;
    }
    assert.equal(saw31 && saw32 && sawSecond, true);
  });
});

describe('stats and static drills', () => {
  test('a storage that throws reads as zero and a write does not escape', () => {
    const broken = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    assert.deepEqual(readStats(broken), EMPTY_STATS);
    const after = recordAnswer(broken, true);
    assert.equal(after.correct, 1);
    assert.deepEqual(readStats(broken), EMPTY_STATS);
  });

  test('a memory store keeps the streak', () => {
    const mem = new Map();
    const storage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
    };
    recordAnswer(storage, true);
    recordAnswer(storage, true);
    const missed = recordAnswer(storage, false);
    assert.equal(missed.answered, 3);
    assert.equal(missed.correct, 2);
    assert.equal(missed.streak, 0);
    assert.equal(missed.best, 2);
    assert.deepEqual(readStats(storage), missed);
  });

  test('the ten written drills and the magic example quote the engine', () => {
    const html = practiceDrillsHtml();
    assert.equal(FIXED_SPECS.length, 10);
    for (const spec of FIXED_SPECS) {
      const q = buildQuestion(spec);
      assert.ok(html.includes(q.prompt));
      for (const value of Object.values(q.answers)) assert.ok(html.includes(value));
    }
    const example = buildQuestion({ type: 'magic', prefix: 26, octets: [192, 168, 1, 77] });
    const lesson = magicExampleHtml();
    assert.ok(lesson.includes(example.answers.cidr));
    assert.match(lesson, /256 − 192 = 64/);
  });

  test('a worksheet has 10 questions and a separate answer list', () => {
    const qs = Array.from({ length: 10 }, (_, i) =>
      makeQuestion({ seed: 'print', index: i, types: QUESTION_TYPES, difficulty: 'easy' }),
    );
    const html = worksheetHtml(qs, { seed: 'print', index: 0 });
    assert.equal(html.match(/<li>/g).length, 20);
    assert.match(html, /worksheet-answers/);
    assert.ok(html.includes(qs[0].answers[qs[0].fields[0].name]));
  });
});

describe('cheat sheet assets', () => {
  test('magic-number and hosts tables follow the engine', () => {
    const magic = magicOctetHtml();
    assert.match(magic, /0, 64, 128, 192/);
    const hosts = hostsPrefixHtml();
    for (const h of [2, 6, 14, 30, 62, 126, 254, 510]) {
      assert.match(hosts, new RegExp(`<td class="num">${h}</td>`));
      assert.match(hosts, new RegExp(`/${requiredPrefix(h)}`));
    }
  });

  test('the PDF is one page and carries both lookup tables', () => {
    const pdf = sheetPdf();
    const text = pdf.toString('latin1');
    assert.equal(text.split('/Type /Page /Parent').length - 1, 1);
    assert.match(text, /0, 64, 128, 192/);
    assert.match(text, /Hosts needed to prefix/);
    assert.match(text, /Hosts needed/);
    for (const h of [2, 6, 14, 30, 62, 126, 254, 510]) {
      assert.match(text, new RegExp(`\\(${group(h)}\\) Tj[\\s\\S]{0,140}Tm \\(/${requiredPrefix(h)}\\) Tj[\\s\\S]{0,140}Tm \\(255\\.`));
    }
    assert.match(sheetFigureHtml(), /alt="Subnet mask cheat sheet: CIDR table from \/0 to \/32"/);
  });
});
