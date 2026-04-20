import { describe, it, expect } from 'vitest';
import { computeCostUsd, formatCostUsd, PRICING_USD_PER_1M } from '../../aiSkills/pricing.js';

describe('aiSkills.pricing.computeCostUsd', () => {
  it('returns 0 when model is null or unknown', () => {
    expect(computeCostUsd(null, 1000, 500)).toBe(0);
    expect(computeCostUsd('model-inexistant', 1000, 500)).toBe(0);
  });

  it('returns 0 when tokens are missing', () => {
    expect(computeCostUsd('claude-sonnet-4-6', null, null)).toBe(0);
  });

  it('computes cost for claude-sonnet-4-6 correctly', () => {
    // claude-sonnet-4-6 : $3 per 1M input, $15 per 1M output
    // 1000 in + 500 out = 1000*3/1M + 500*15/1M = 0.003 + 0.0075 = 0.0105
    expect(computeCostUsd('claude-sonnet-4-6', 1000, 500)).toBeCloseTo(0.0105, 6);
  });

  it('computes cost for gpt-4o-mini correctly', () => {
    // gpt-4o-mini : $0.15 per 1M input, $0.6 per 1M output
    // 10000 in + 2000 out = 10000*0.15/1M + 2000*0.6/1M = 0.0015 + 0.0012 = 0.0027
    expect(computeCostUsd('gpt-4o-mini', 10000, 2000)).toBeCloseTo(0.0027, 6);
  });

  it('handles undefined tokens as zero', () => {
    expect(computeCostUsd('claude-sonnet-4-6', undefined, 500))
      .toBeCloseTo(500 * 15 / 1_000_000, 8);
  });
});

describe('aiSkills.pricing.formatCostUsd', () => {
  it('shows em-dash for missing values', () => {
    expect(formatCostUsd(null)).toBe('—');
    expect(formatCostUsd(undefined)).toBe('—');
  });

  it('shows $0 for exact zero', () => {
    expect(formatCostUsd(0)).toBe('$0');
  });

  it('uses 6 decimals for very small values', () => {
    expect(formatCostUsd(0.000123)).toBe('$0.000123');
  });

  it('uses 4 decimals for mid values', () => {
    expect(formatCostUsd(0.0345)).toBe('$0.0345');
  });

  it('uses 3 decimals for larger values', () => {
    expect(formatCostUsd(0.345)).toBe('$0.345');
    expect(formatCostUsd(12.3456)).toBe('$12.346');
  });
});

describe('aiSkills.pricing — coverage of known models', () => {
  it('has non-zero in/out rates for every listed model', () => {
    for (const [model, p] of Object.entries(PRICING_USD_PER_1M)) {
      expect(p.in, `${model} input rate`).toBeGreaterThan(0);
      expect(p.out, `${model} output rate`).toBeGreaterThan(0);
    }
  });
});
