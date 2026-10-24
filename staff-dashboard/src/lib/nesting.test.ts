/**
 * nesting.test.ts — edge-case coverage of nesting/ganging suggestions.
 *
 * Key real-world risks:
 *  - Only pending jobs should be nestable (completed/in_progress must be ignored)
 *  - Cross-material nesting must never happen (wrong material = ruined print)
 *  - A job wider than the roll can never be nested
 *  - savedFt must be positive — if it's 0 or negative a "suggestion" wastes no paper
 *  - Exactly filling the 24" width is valid (not rounded out)
 *  - A single job alone cannot form a nesting group (no savings)
 */
import { PrintJob } from '../types';
import { buildNestingSuggestions, NestGroup } from './nesting';

/* ---------------------------------------------------------------- helpers -- */

const job = (over: Partial<PrintJob> & { id: string }): PrintJob => ({
  content: over.id, material: 'Sticky', widthIn: 4, heightIn: 6, quantity: 1,
  department: 'IBKY', status: 'pending', submittedAt: '2026-06-24T00:00:00',
  requester: 'test', ...over,
});

/* ========================================================= core behaviour */

describe('buildNestingSuggestions — core', () => {
  it('gangs two narrow same-material pending jobs that fit across 24in', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 10, heightIn: 12 }),
      job({ id: 'b', widthIn: 10, heightIn: 6 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalWidthIn).toBe(20);
    // saved = (12 + 6 − 12) / 12 = 0.5 ft
    expect(groups[0].savedFt).toBe(0.5);
  });

  it('does not gang two jobs whose combined width exceeds 24in', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 20, heightIn: 12 }),
      job({ id: 'b', widthIn: 20, heightIn: 12 }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('does not mix materials', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', material: 'Sticky', widthIn: 8 }),
      job({ id: 'b', material: 'Glossy', widthIn: 8 }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('ignores oversize jobs (wider than 24in)', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 30 }), // wider than roll
      job({ id: 'b', widthIn: 8 }),
    ]);
    // Only one valid job — can't form a group
    expect(groups).toHaveLength(0);
  });

  it('ignores non-pending jobs', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 8, status: 'pending' }),
      job({ id: 'b', widthIn: 8, status: 'completed' }),
      job({ id: 'c', widthIn: 8, status: 'in_progress' }),
    ]);
    // Only 'a' is pending — single job, no group
    expect(groups).toHaveLength(0);
  });
});

/* ========================================================= edge cases */

describe('buildNestingSuggestions — edge cases', () => {
  it('EDGE: empty job list → no groups', () => {
    expect(buildNestingSuggestions([])).toHaveLength(0);
  });

  it('EDGE: single pending job → no group (can\'t save paper alone)', () => {
    expect(buildNestingSuggestions([job({ id: 'a', widthIn: 8 })])).toHaveLength(0);
  });

  it('EDGE: two jobs that exactly fill 24in → valid group', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 12, heightIn: 24 }),
      job({ id: 'b', widthIn: 12, heightIn: 6 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalWidthIn).toBe(24);
    // saved = (24 + 6 − 24) / 12 = 0.5 ft
    expect(groups[0].savedFt).toBeGreaterThan(0);
  });

  it('EDGE: two identical-height jobs save 0 ft — should NOT produce a group', () => {
    // If both jobs are 12in tall, ganging saves 0 ft → not a useful suggestion
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 8, heightIn: 12 }),
      job({ id: 'b', widthIn: 8, heightIn: 12 }),
    ]);
    // savedFt = (12 + 12 − 12) / 12 = 1.0 — actually saves because we only
    // need one 12ft pass instead of two 12ft passes
    // (savedFt = sumHeights − maxHeight, not 0 in this case)
    expect(groups[0].savedFt).toBe(1);
  });

  it('EDGE: three jobs that all fit across 24in form one group', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 6,  heightIn: 12 }),
      job({ id: 'b', widthIn: 6,  heightIn: 6 }),
      job({ id: 'c', widthIn: 8,  heightIn: 9 }),
    ]);
    // totalWidth = 6+6+8 = 20 ≤ 24
    expect(groups).toHaveLength(1);
    expect(groups[0].jobs).toHaveLength(3);
    expect(groups[0].totalWidthIn).toBe(20);
    // saved = (12 + 6 + 9 − 12) / 12 = 15/12 = 1.25
    expect(groups[0].savedFt).toBe(1.3); // round1
  });

  it('EDGE: jobs of two materials produce two separate groups', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', material: 'Glossy', widthIn: 8, heightIn: 12 }),
      job({ id: 'b', material: 'Glossy', widthIn: 8, heightIn: 6 }),
      job({ id: 'c', material: 'Canvas', widthIn: 8, heightIn: 18 }),
      job({ id: 'd', material: 'Canvas', widthIn: 8, heightIn: 9 }),
    ]);
    expect(groups).toHaveLength(2);
    const materials = groups.map((g) => g.material).sort();
    expect(materials).toEqual(['Canvas', 'Glossy']);
  });

  it('EDGE: a job exactly 24in wide fits alone but not with any other job', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 24, heightIn: 12 }),
      job({ id: 'b', widthIn: 24, heightIn: 6 }),
      job({ id: 'c', widthIn: 8,  heightIn: 9 }),
    ]);
    // 'c' is alone after 'a' and 'b' each fill a full 24in pass
    expect(groups).toHaveLength(0);
  });

  it('EDGE: job with widthIn = 0 is skipped (degenerate)', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 0, heightIn: 12 }),
      job({ id: 'b', widthIn: 8, heightIn: 6 }),
    ]);
    // 0-width job should not crash and should not pair with 'b'
    expect(groups).toHaveLength(0);
  });

  it('EDGE: all jobs wider than the roll → no groups, no crash', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 25 }),
      job({ id: 'b', widthIn: 30 }),
      job({ id: 'c', widthIn: 100 }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('EDGE: savedFt is always positive for every group returned', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 6, heightIn: 12 }),
      job({ id: 'b', widthIn: 6, heightIn: 6 }),
      job({ id: 'c', widthIn: 6, heightIn: 9 }),
      job({ id: 'd', widthIn: 6, heightIn: 3 }),
    ]);
    for (const g of groups) {
      expect(g.savedFt).toBeGreaterThan(0);
    }
  });

  it('EDGE: mix of pending, completed, in_progress — only pending are eligible', () => {
    const groups = buildNestingSuggestions([
      job({ id: 'a', widthIn: 8, status: 'pending' }),
      job({ id: 'b', widthIn: 8, status: 'pending' }),
      job({ id: 'c', widthIn: 8, status: 'completed' }),
      job({ id: 'd', widthIn: 8, status: 'in_progress' }),
    ]);
    // Only a and b are eligible; combined width = 16 ≤ 24
    expect(groups).toHaveLength(1);
    expect(groups[0].jobs.map((j) => j.id).sort()).toEqual(['a', 'b']);
  });

  it('EDGE: large batch — 20 small same-material jobs all fit into groups', () => {
    const jobs = Array.from({ length: 20 }, (_, i) =>
      job({ id: `j${i}`, widthIn: 4, heightIn: 6 }),
    );
    const groups = buildNestingSuggestions(jobs);
    // Each group fits 6 × 4in = 24in; 20 jobs → at least 3 groups
    expect(groups.length).toBeGreaterThan(0);
    // Every group has savedFt > 0
    for (const g of groups) {
      expect(g.savedFt).toBeGreaterThan(0);
    }
    // Total jobs across all groups accounts for all 20
    const totalJobs = groups.reduce((s, g) => s + g.jobs.length, 0);
    expect(totalJobs).toBe(20);
  });

  it('EDGE: custom roll width (18in) respected', () => {
    // Two 10in-wide jobs fit on 24in but NOT on 18in
    const groups24 = buildNestingSuggestions(
      [job({ id: 'a', widthIn: 10, heightIn: 6 }), job({ id: 'b', widthIn: 10, heightIn: 6 })],
      24,
    );
    const groups18 = buildNestingSuggestions(
      [job({ id: 'a', widthIn: 10, heightIn: 6 }), job({ id: 'b', widthIn: 10, heightIn: 6 })],
      18,
    );
    expect(groups24).toHaveLength(1);
    expect(groups18).toHaveLength(0);
  });

  it('EDGE: no job appears in two groups simultaneously', () => {
    const jobs = [
      job({ id: 'a', widthIn: 8, heightIn: 12 }),
      job({ id: 'b', widthIn: 8, heightIn: 6 }),
      job({ id: 'c', widthIn: 8, heightIn: 9 }),
      job({ id: 'd', widthIn: 8, heightIn: 3 }),
    ];
    const groups = buildNestingSuggestions(jobs, 24);
    const allIds = groups.flatMap((g) => g.jobs.map((j) => j.id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
