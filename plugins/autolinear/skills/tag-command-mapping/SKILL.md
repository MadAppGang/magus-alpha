---
name: tag-command-mapping
description: How tag-to-command routing works in autolinear. Defines default mappings, precedence rules, and customization patterns.
user-invocable: false
---
plugin: autolinear
updated: 2026-01-20

# Tag-to-Command Mapping

**Version:** 0.1.0
**Purpose:** Route Linear tasks to appropriate Claude Code commands based on tags
**Status:** Phase 1

## When to Use

Use this skill when you need to:
- Understand how Linear tags map to Claude Code commands
- Customize tag-to-command mappings for a project
- Handle tasks with multiple tags (precedence rules)
- Classify tasks based on title/description text
- Resolve the correct agent/command for a task

## Overview

Tag-to-command mapping is the core routing mechanism in autolinear. When a task arrives from Linear, its labels determine which Claude Code command/agent handles execution.

## Default Mappings

| Linear Tag | Command | Agent | Skills |
|------------|---------|-------|--------|
| @frontend | /dev:dev | developer | react-typescript |
| @backend | /dev:dev | developer | golang, api-design |
| @debug | /dev:debug | debugger | systematic-debugging |
| @test | /dev:dev | test-architect | testing-strategies |
| @review | /dev:audit | reviewer | universal-patterns |
| @refactor | /dev:dev | developer | universal-patterns |
| @research | /dev:research | researcher | n/a |
| @ui | /dev:design-system | frontend | design-system-guardrails |

## Precedence Rules

When multiple tags are present, apply precedence order:

```typescript
const PRECEDENCE = [
  '@debug',    // Bug fixing takes priority
  '@test',     // Tests before implementation
  '@ui',       // UI before generic frontend
  '@frontend', // Frontend before generic
  '@backend',  // Backend before generic
  '@review',   // Review after implementation
  '@refactor', // Refactoring is lower priority
  '@research'  // Research is lowest
];

function selectTag(labels: string[]): string {
  const agentTags = labels.filter(l => l.startsWith('@'));

  if (agentTags.length === 0) return 'default';
  if (agentTags.length === 1) return agentTags[0];

  // Multiple tags - apply precedence
  for (const tag of PRECEDENCE) {
    if (agentTags.includes(tag)) return tag;
  }

  return 'default';
}
```

## Custom Mappings

Users can define custom mappings in `.claude/autolinear.local.md`:

```yaml
---
tag_mappings:
  "@database":
    command: "/dev:dev"
    agent: "developer"
    skills: ["database-patterns"]
    systemPrompt: "You are a database specialist."

  "@performance":
    command: "/dev:dev"
    agent: "developer"
    skills: ["universal-patterns"]
    systemPrompt: "You are a performance optimization expert."
---
```

## Task Classification

Beyond explicit tags, classify tasks from text:

```typescript
function classifyTask(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();

  // Keyword patterns
  if (/\b(fix|bug|error|crash|broken)\b/.test(text)) return 'BUG_FIX';
  if (/\b(add|implement|create|new|feature)\b/.test(text)) return 'FEATURE';
  if (/\b(refactor|clean|optimize|improve)\b/.test(text)) return 'REFACTOR';
  if (/\b(ui|design|component|style|visual)\b/.test(text)) return 'UI_CHANGE';
  if (/\b(test|coverage|e2e|spec)\b/.test(text)) return 'TEST';
  if (/\b(doc|documentation|readme)\b/.test(text)) return 'DOCUMENTATION';

  return 'UNKNOWN';
}
```

## Mapping Resolution

Complete resolution algorithm:

```typescript
function resolveMapping(labels: string[], title: string, desc: string) {
  // 1. Check explicit tags
  const tag = selectTag(labels);

  if (tag !== 'default') {
    return getMappingForTag(tag);
  }

  // 2. Classify from text
  const taskType = classifyTask(title, desc);

  // 3. Map task type to default tag
  const typeToTag = {
    'BUG_FIX': '@debug',
    'FEATURE': '@frontend',
    'UI_CHANGE': '@ui',
    'TEST': '@test',
    'REFACTOR': '@refactor',
    'DOCUMENTATION': '@research',
  };

  return getMappingForTag(typeToTag[taskType] || '@frontend');
}
```

## Examples

### Example 1: Single Tag Resolution

```typescript
// Task with @frontend label
const labels = ['@frontend', 'feature'];
const tag = selectTag(labels);  // '@frontend'
const mapping = getMappingForTag(tag);
// Result: { command: '/dev:dev', agent: 'developer', skills: ['react-typescript'] }
```

### Example 2: Multiple Tag Precedence

```typescript
// Task with both @frontend and @debug
const labels = ['@frontend', '@debug'];
const tag = selectTag(labels);  // '@debug' (higher precedence)
const mapping = getMappingForTag(tag);
// Result: { command: '/dev:debug', agent: 'debugger', skills: ['systematic-debugging'] }
```

### Example 3: Text Classification Fallback

```typescript
// Task without tags
const labels = [];
const title = "Fix login button not working";
const mapping = resolveMapping(labels, title, "");
// Classifies as BUG_FIX -> @debug
// Result: { command: '/dev:debug', agent: 'debugger', skills: ['systematic-debugging'] }
```

## Best Practices

- Use explicit tags over relying on classification
- Create custom mappings for project-specific workflows
- Debug > Test > UI > Frontend precedence makes sense
- Review mapping effectiveness periodically
- Keep tag names short and descriptive (start with @)
