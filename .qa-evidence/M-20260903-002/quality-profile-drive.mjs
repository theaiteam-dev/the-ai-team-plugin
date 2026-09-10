// Frankie's DoD driver for statements 8, 9, 10, 11.
// Executes the SHIPPED resolver (scripts/hooks/lib/qa-contract.js) — no re-implementation.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  resolveQualityProfile,
  resolveExecutionContract,
  readExecutionContract,
} from '../../scripts/hooks/lib/qa-contract.js';

const line = (s) => console.log(s);
const digest = () =>
  createHash('sha256').update(readFileSync('ateam.config.json')).digest('hex').slice(0, 16);

const before = digest();
line(`ateam.config.json sha256[0:16] BEFORE : ${before}`);
line('');

line('--- DoD 8: --quality deep => full-dod + hands-on ---');
const deep = resolveQualityProfile('deep');
line(JSON.stringify(deep, null, 2));
line(`deep.testing_level === 'full-dod' : ${deep.testing_level === 'full-dod'}`);
line(`deep.review_tier  === 'hands-on' : ${deep.review_tier === 'hands-on'}`);
line(`deep carries probing_guidance    : ${Boolean(deep.probing_guidance)}`);
line('');

line('--- Other two profiles (bundle definitions, FR-8) ---');
for (const name of ['quick', 'normal']) {
  const p = resolveQualityProfile(name);
  line(`${name.padEnd(6)} -> testing_level=${p.testing_level} review_tier=${p.review_tier} probing_guidance=${Boolean(p.probing_guidance)}`);
}
line('');

line('--- DoD 9: invalid --quality is rejected, naming all three ---');
for (const bad of ['deeep', 'DEEP', '', 'thorough']) {
  try {
    resolveQualityProfile(bad);
    line(`  ${JSON.stringify(bad).padEnd(12)} : NO THROW  <-- FAIL`);
  } catch (e) {
    const names = ['quick', 'normal', 'deep'].filter((n) => e.message.includes(n));
    line(`  ${JSON.stringify(bad).padEnd(12)} : threw; names=[${names.join(',')}] all3=${names.length === 3}`);
    line(`      message: ${e.message}`);
  }
}
line('');

line('--- DoD 11: mission WITHOUT a stored contract falls back to ateam.config.json ---');
const cfg = readExecutionContract();
line(`config testing_level=${cfg.testing_level} review_tier=${cfg.review_tier}`);
const fallback = resolveExecutionContract(null);
line(`resolveExecutionContract(null) -> testing_level=${fallback.testing_level} review_tier=${fallback.review_tier}`);
line(`matches config exactly : ${fallback.testing_level === cfg.testing_level && fallback.review_tier === cfg.review_tier}`);
line('');

line('--- DoD 10: a stored mission contract WINS over config ---');
const stored = resolveExecutionContract({ testing_level: 'full-dod', review_tier: 'hands-on' });
line(`stored-contract mission -> testing_level=${stored.testing_level} review_tier=${stored.review_tier}`);
line(`overrides config('${cfg.testing_level}') : ${stored.testing_level === 'full-dod'}`);
line('');

line('--- Repo facts still come from config, not the profile (FR-10) ---');
line(`surfaces=${JSON.stringify(stored.surfaces)} qa.drive=${stored.qa?.drive}`);
line('');

const after = digest();
line(`ateam.config.json sha256[0:16] AFTER  : ${after}`);
line(`config UNCHANGED by profile resolution : ${before === after}`);
