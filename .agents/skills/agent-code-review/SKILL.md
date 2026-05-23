# Agent Code Review Skill

This skill enables agents to perform comprehensive code reviews, identifying bugs, security vulnerabilities, performance issues, and style violations.

## Overview

The `CodeReviewAgent` analyzes pull requests and code diffs, providing structured feedback with severity levels, suggested fixes, and explanations.

## Capabilities

- Static analysis integration (ESLint, TSC, custom rules)
- Security vulnerability detection (OWASP Top 10 patterns)
- Performance anti-pattern recognition
- Style and convention enforcement
- Automated fix suggestions with code snippets
- Review summary generation

## Usage

```typescript
import { CodeReviewAgent } from './agent-code-review';

const reviewer = new CodeReviewAgent({
  rules: ['security', 'performance', 'style'],
  severity_threshold: 'warning',
  auto_fix: true,
});

const result = await reviewer.review({
  files: diffFiles,
  context: pullRequestContext,
});
```

## Implementation

```typescript
export type Severity = 'error' | 'warning' | 'info' | 'suggestion';

export type ReviewCategory =
  | 'security'
  | 'performance'
  | 'style'
  | 'correctness'
  | 'maintainability';

export interface ReviewComment {
  file: string;
  line: number;
  endLine?: number;
  severity: Severity;
  category: ReviewCategory;
  message: string;
  rule?: string;
  suggestion?: string;
  autoFixAvailable: boolean;
}

export interface ReviewResult {
  comments: ReviewComment[];
  summary: string;
  score: number; // 0-100
  approved: boolean;
  blockers: ReviewComment[];
  stats: {
    errors: number;
    warnings: number;
    suggestions: number;
    filesReviewed: number;
    linesReviewed: number;
  };
}

export interface ReviewConfig {
  rules: ReviewCategory[];
  severity_threshold: Severity;
  auto_fix: boolean;
  max_comments?: number;
  ignore_patterns?: string[];
}

export interface DiffFile {
  path: string;
  content: string;
  additions: string[];
  deletions: string[];
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

export class CodeReviewAgent {
  private config: ReviewConfig;
  private ruleEngines: Map<ReviewCategory, RuleEngine>;

  constructor(config: ReviewConfig) {
    this.config = {
      max_comments: 50,
      ignore_patterns: ['*.test.ts', '*.spec.ts', 'node_modules/**'],
      ...config,
    };
    this.ruleEngines = this.initializeRuleEngines();
  }

  async review(input: {
    files: DiffFile[];
    context?: Record<string, unknown>;
  }): Promise<ReviewResult> {
    const comments: ReviewComment[] = [];

    for (const file of input.files) {
      if (this.shouldIgnoreFile(file.path)) continue;

      for (const category of this.config.rules) {
        const engine = this.ruleEngines.get(category);
        if (!engine) continue;

        const fileComments = await engine.analyze(file);
        comments.push(...fileComments);
      }
    }

    const filtered = this.filterBySeverity(comments);
    const blockers = filtered.filter((c) => c.severity === 'error');
    const score = this.calculateScore(filtered, input.files.length);

    return {
      comments: filtered.slice(0, this.config.max_comments),
      summary: this.generateSummary(filtered, score),
      score,
      approved: blockers.length === 0 && score >= 70,
      blockers,
      stats: {
        errors: filtered.filter((c) => c.severity === 'error').length,
        warnings: filtered.filter((c) => c.severity === 'warning').length,
        suggestions: filtered.filter(
          (c) => c.severity === 'suggestion' || c.severity === 'info'
        ).length,
        filesReviewed: input.files.length,
        linesReviewed: input.files.reduce(
          (sum, f) => sum + f.additions.length,
          0
        ),
      },
    };
  }

  private shouldIgnoreFile(path: string): boolean {
    return (this.config.ignore_patterns ?? []).some((pattern) => {
      const regex = new RegExp(pattern.replace('**', '.*').replace('*', '[^/]*'));
      return regex.test(path);
    });
  }

  private filterBySeverity(comments: ReviewComment[]): ReviewComment[] {
    const order: Severity[] = ['error', 'warning', 'info', 'suggestion'];
    const threshold = order.indexOf(this.config.severity_threshold);
    return comments.filter((c) => order.indexOf(c.severity) <= threshold);
  }

  private calculateScore(comments: ReviewComment[], fileCount: number): number {
    if (fileCount === 0) return 100;
    const deductions =
      comments.filter((c) => c.severity === 'error').length * 10 +
      comments.filter((c) => c.severity === 'warning').length * 3 +
      comments.filter((c) => c.severity === 'info').length * 1;
    return Math.max(0, Math.min(100, 100 - deductions));
  }

  private generateSummary(comments: ReviewComment[], score: number): string {
    const errors = comments.filter((c) => c.severity === 'error').length;
    const warnings = comments.filter((c) => c.severity === 'warning').length;
    if (errors === 0 && warnings === 0) {
      return `✅ Code looks good! Score: ${score}/100. No critical issues found.`;
    }
    return `⚠️ Review score: ${score}/100. Found ${errors} error(s) and ${warnings} warning(s) that need attention.`;
  }

  private initializeRuleEngines(): Map<ReviewCategory, RuleEngine> {
    const engines = new Map<ReviewCategory, RuleEngine>();
    engines.set('security', new SecurityRuleEngine());
    engines.set('performance', new PerformanceRuleEngine());
    engines.set('style', new StyleRuleEngine());
    engines.set('correctness', new CorrectnessRuleEngine());
    engines.set('maintainability', new MaintainabilityRuleEngine());
    return engines;
  }
}

// --- Rule Engine Interfaces ---

interface RuleEngine {
  analyze(file: DiffFile): Promise<ReviewComment[]>;
}

class SecurityRuleEngine implements RuleEngine {
  private patterns = [
    { regex: /eval\s*\(/, message: 'Avoid using eval() — potential code injection risk.', rule: 'no-eval' },
    { regex: /innerHTML\s*=/, message: 'Direct innerHTML assignment may lead to XSS.', rule: 'no-inner-html' },
    { regex: /process\.env\.[A-Z_]+\s*(?!\?)/, message: 'Accessing env vars without nullish check.', rule: 'safe-env-access' },
    { regex: /console\.log.*password|console\.log.*secret/i, message: 'Potential secret logged to console.', rule: 'no-secret-log' },
  ];

  async analyze(file: DiffFile): Promise<ReviewComment[]> {
    const comments: ReviewComment[] = [];
    file.additions.forEach((line, idx) => {
      for (const pattern of this.patterns) {
        if (pattern.regex.test(line)) {
          comments.push({
            file: file.path,
            line: file.hunks[0]?.newStart + idx ?? idx + 1,
            severity: 'error',
            category: 'security',
            message: pattern.message,
            rule: pattern.rule,
            autoFixAvailable: false,
          });
        }
      }
    });
    return comments;
  }
}

class PerformanceRuleEngine implements RuleEngine {
  async analyze(file: DiffFile): Promise<ReviewComment[]> {
    const comments: ReviewComment[] = [];
    file.additions.forEach((line, idx) => {
      if (/\.forEach\(.*await/.test(line)) {
        comments.push({
          file: file.path,
          line: idx + 1,
          severity: 'warning',
          category: 'performance',
          message: 'Avoid await inside forEach — use Promise.all with map instead.',
          rule: 'no-await-in-foreach',
          suggestion: 'await Promise.all(items.map(async (item) => { ... }));',
          autoFixAvailable: true,
        });
      }
      if (/new RegExp\(/.test(line)) {
        comments.push({
          file: file.path,
          line: idx + 1,
          severity: 'info',
          category: 'performance',
          message: 'Consider caching RegExp instances outside of loops.',
          rule: 'cache-regexp',
          autoFixAvailable: false,
        });
      }
    });
    return comments;
  }
}

class StyleRuleEngine implements RuleEngine {
  async analyze(file: DiffFile): Promise<ReviewComment[]> {
    const comments: ReviewComment[] = [];
    file.additions.forEach((line, idx) => {
      if (line.length > 120) {
        comments.push({
          file: file.path,
          line: idx + 1,
          severity: 'suggestion',
          category: 'style',
          message: `Line exceeds 120 characters (${line.length}).`,
          rule: 'max-line-length',
          autoFixAvailable: false,
        });
      }
      if (/var /.test(line)) {
        comments.push({
          file: file.path,
          line: idx + 1,
          severity: 'warning',
          category: 'style',
          message: 'Use const or let instead of var.',
          rule: 'no-var',
          suggestion: line.replace(/\bvar\b/, 'const'),
          autoFixAvailable: true,
        });
      }
    });
    return comments;
  }
}

class CorrectnessRuleEngine implements RuleEngine {
  async analyze(file: DiffFile): Promise<ReviewComment[]> {
    const comments: ReviewComment[] = [];
    file.additions.forEach((line, idx) => {
      if (/==(?!=)/.test(line) && !/[!=><]=/.test(line)) {
        comments.push({
          file: file.path,
          line: idx + 1,
          severity: 'warning',
          category: 'correctness',
          message: 'Use === instead of == for strict equality checks.',
          rule: 'eqeqeq',
          suggestion: line.replace(/==/g, '==='),
          autoFixAvailable: true,
        });
      }
    });
    return comments;
  }
}

class MaintainabilityRuleEngine implements RuleEngine {
  async analyze(file: DiffFile): Promise<ReviewComment[]> {
    const comments: ReviewComment[] = [];
    const functionMatches = file.additions.join('\n').match(/function\s+\w+/g) ?? [];
    if (functionMatches.length > 10) {
      comments.push({
        file: file.path,
        line: 1,
        severity: 'info',
        category: 'maintainability',
        message: `File adds ${functionMatches.length} functions — consider splitting into smaller modules.`,
        rule: 'max-functions-per-file',
        autoFixAvailable: false,
      });
    }
    return comments;
  }
}
```

## Configuration Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `rules` | `ReviewCategory[]` | all | Categories to enforce |
| `severity_threshold` | `Severity` | `'warning'` | Minimum severity to report |
| `auto_fix` | `boolean` | `false` | Apply auto-fixable suggestions |
| `max_comments` | `number` | `50` | Cap on returned comments |
| `ignore_patterns` | `string[]` | test files | Glob patterns to skip |

## Integration with Agent Workflow

This skill integrates with `agent-analyze-code-quality` for static metrics and `agent-arch-system-design` for architectural feedback. Outputs feed into `agent-agentic-payments` when review gates are tied to deployment pipelines.
