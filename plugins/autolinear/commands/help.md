---
name: autolinear-help
description: Show comprehensive help for the AutoLinear plugin
allowed-tools: Read
---

<role>
  <identity>AutoLinear Help Assistant</identity>
  <mission>
    Provide comprehensive help about autolinear plugin commands,
    configuration, and workflow.
  </mission>
</role>

<instructions>
  <workflow>
    <step>Display help message (see formatting)</step>
  </workflow>
</instructions>

<formatting>
  <help_message>
# AutoLinear Plugin Help

**Version**: 0.3.0
**Purpose**: Autonomous task execution with Linear integration

## Commands

| Command | Description |
|---------|-------------|
| `/autolinear:create-task` | Create Linear task and assign to autolinear |
| `/autolinear:status [id]` | Check status, queue, and progress |
| `/autolinear:config` | Configure Linear integration |
| `/autolinear:run <id>` | Manually trigger task execution |
| `/autolinear:help` | Show this help |

## Quick Start

1. **Configure**: `/autolinear:config`
   - Set up Linear API key
   - Select team and project
   - Customize tag mappings

2. **Create Task**: `/autolinear:create-task Add user profile page`
   - Classifies task type
   - Generates acceptance criteria
   - Creates Linear issue with autolinear assignment

3. **Monitor**: `/autolinear:status`
   - View queue and active tasks
   - Check task progress
   - See recent completions

## Tag-to-Command Mapping

| Tag | Command | Use Case |
|-----|---------|----------|
| @frontend | /dev:feature | React/Vue implementation |
| @backend | /dev:implement | API/database work |
| @debug | /dev:debug | Bug investigation |
| @test | /dev:test-architect | Test creation |
| @review | /commit-commands:commit-push-pr | Code review + PR |
| @ui | /dev:ui | Design validation |

## Workflow

```
Linear Issue (with @autolinear label)
        |
        v
   Tag Detection --> Command Selection
        |
        v
   Task Execution (via appropriate agent)
        |
        v
   Proof Generation (screenshots, tests, deployment)
        |
        v
   Validation (confidence score)
        |
        v
   State Transition (Todo -> In Progress -> In Review -> Done)
```

## Configuration Files

- `.env`: LINEAR_API_KEY, LINEAR_WEBHOOK_SECRET
- `.claude/autolinear.local.md`: Team/project settings, tag mappings

## Requirements

- Linear API key (personal or OAuth)
- @linear/sdk installed
- playwright (for screenshots)
- Webhook server running (for automatic pickup)

## More Information

- Plugin README: plugins/autolinear/README.md
- Skills: `/autolinear:linear-integration`, `/autolinear:tag-command-mapping`
  </help_message>
</formatting>
