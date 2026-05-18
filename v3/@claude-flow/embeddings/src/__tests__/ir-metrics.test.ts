/**
 * ADR-121 Phase 13 — IR metrics tests.
 *
 * Coverage uses hand-computed values from standard IR textbook examples
 * so the math is auditable.
 */

import { describe, it, expect } from 'vitest';
import {
  recallAtK,
  precisionAtK,
  reciprocalRank,
  meanReciprocalRank,
  dcgAtK,
  idcgAtK,
  ndcgAtK,
} from '../ir-metrics.js';

describe('recallAtK', () => {
  it('1.0 when all relevant items are in top-k', () => {
    expect(recallAtK(['a', 'b', 'c'], ['a', 'b'], 3)).toBe(1);
  });

  it('partial recall when only some relevant items are in top-k', () => {
    // 1 of 2 relevant found → 0.5
    expect(recallAtK(['a', 'x', 'y'], ['a', 'b'], 3)).toBe(0.5);
  });

  it('0 when no relevant items in top-k', () => {
    expect(recallAtK(['x', 'y', 'z'], ['a', 'b'], 3)).toBe(0);
  });

  it('0 when relevant set is empty (no signal to recall)', () => {
    expect(recallAtK(['a', 'b'], [], 2)).toBe(0);
  });

  it('only counts up to k', () => {
    // 'b' is at position 4, k=3, so we miss it
    expect(recallAtK(['a', 'x', 'y', 'b'], ['a', 'b'], 3)).toBe(0.5);
  });

  it('accepts a Set as the relevance input', () => {
    expect(recallAtK(['a', 'b'], new Set(['a']), 2)).toBe(1);
  });
});

describe('precisionAtK', () => {
  it('1.0 when every top-k item is relevant', () => {
    expect(precisionAtK(['a', 'b'], ['a', 'b', 'c'], 2)).toBe(1);
  });

  it('0.5 when half of top-k is relevant', () => {
    expect(precisionAtK(['a', 'x'], ['a'], 2)).toBe(0.5);
  });

  it('returns 0 for k <= 0', () => {
    expect(precisionAtK(['a'], ['a'], 0)).toBe(0);
    expect(precisionAtK(['a'], ['a'], -1)).toBe(0);
  });
});

describe('reciprocalRank', () => {
  it('1.0 when first item is relevant', () => {
    expect(reciprocalRank(['a', 'b'], ['a'])).toBe(1);
  });

  it('0.5 when second item is the first relevant', () => {
    expect(reciprocalRank(['x', 'a', 'b'], ['a'])).toBe(0.5);
  });

  it('1/3 when third item is the first relevant', () => {
    expect(reciprocalRank(['x', 'y', 'a'], ['a'])).toBeCloseTo(1 / 3, 8);
  });

  it('0 when no relevant item appears', () => {
    expect(reciprocalRank(['x', 'y', 'z'], ['a'])).toBe(0);
  });
});

describe('meanReciprocalRank', () => {
  it('averages RR across a query set', () => {
    // q1: RR = 1 (first item)
    // q2: RR = 0.5 (second item)
    // q3: RR = 0 (no relevant)
    // mean = (1 + 0.5 + 0) / 3 = 0.5
    const mrr = meanReciprocalRank([
      { retrieved: ['a', 'b'], relevant: ['a'] },
      { retrieved: ['x', 'b'], relevant: ['b'] },
      { retrieved: ['x', 'y'], relevant: ['z'] },
    ]);
    expect(mrr).toBeCloseTo(0.5, 6);
  });

  it('returns 0 on empty query set', () => {
    expect(meanReciprocalRank([])).toBe(0);
  });
});

describe('dcgAtK', () => {
  it('matches hand-computed DCG on binary judgements', () => {
    // top-3 = [a(1), x(0), b(1)] → DCG = 1/log2(2) + 0 + 1/log2(4) = 1 + 0.5 = 1.5
    const dcg = dcgAtK(['a', 'x', 'b'], { a: 1, b: 1 }, 3);
    expect(dcg).toBeCloseTo(1.5, 6);
  });

  it('handles graded relevance', () => {
    // top-2 = [a(3), b(2)] → DCG = 3/log2(2) + 2/log2(3) = 3 + 2/1.585 ≈ 4.262
    const dcg = dcgAtK(['a', 'b'], { a: 3, b: 2 }, 2);
    expect(dcg).toBeCloseTo(3 + 2 / Math.log2(3), 6);
  });

  it('treats missing ids as relevance 0', () => {
    expect(dcgAtK(['unknown'], { a: 1 }, 1)).toBe(0);
  });
});

describe('idcgAtK', () => {
  it('orders judgements by grade descending for the ideal', () => {
    // Grades = [3, 2, 1] → ideal DCG@3 = 3/log2(2) + 2/log2(3) + 1/log2(4)
    const idcg = idcgAtK({ a: 1, b: 3, c: 2 }, 3);
    const expected = 3 / Math.log2(2) + 2 / Math.log2(3) + 1 / Math.log2(4);
    expect(idcg).toBeCloseTo(expected, 6);
  });

  it('truncates to k', () => {
    // Grades sorted = [3, 2], k=1 → IDCG@1 = 3
    expect(idcgAtK({ a: 1, b: 3, c: 2 }, 1)).toBeCloseTo(3, 6);
  });
});

describe('ndcgAtK', () => {
  it('1.0 when the retrieved ordering matches the ideal', () => {
    // Ideal order = a(3), b(2), c(1)
    const n = ndcgAtK(['a', 'b', 'c'], { a: 3, b: 2, c: 1 }, 3);
    expect(n).toBeCloseTo(1, 6);
  });

  it('< 1 when the ordering inverts grades', () => {
    // Retrieved = c(1), b(2), a(3) — worst possible order
    const n = ndcgAtK(['c', 'b', 'a'], { a: 3, b: 2, c: 1 }, 3);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(1);
  });

  it('0 when no relevant items exist', () => {
    expect(ndcgAtK(['a'], {}, 1)).toBe(0);
  });

  it('accepts binary judgements (Set or Array)', () => {
    // Same as graded with grade=1 each.
    const bin = ndcgAtK(['a', 'b'], new Set(['a', 'b']), 2);
    const graded = ndcgAtK(['a', 'b'], { a: 1, b: 1 }, 2);
    expect(bin).toBeCloseTo(graded, 6);
    expect(bin).toBeCloseTo(1, 6);
  });

  it('clamps to [0, 1]', () => {
    // Manufacture a pathological case — retrieved=[unknown], grades=[a:1].
    // DCG=0, IDCG=1 → nDCG=0 (not negative).
    expect(ndcgAtK(['unknown'], { a: 1 }, 1)).toBe(0);
  });
});
