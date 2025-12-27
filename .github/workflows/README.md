# Task Coordination Workflows

GitHub Actions workflows for distributed task claiming and coordination across forks.

## Overview

These workflows enable community forks to safely claim and work on GitHub issues in parallel without duplicate work. The system uses GitHub labels and comments as the coordination mechanism.

### Labels

| Label | Description |
|-------|-------------|
| `task:available` | Issue is available for claiming |
| `task:claimed` | Issue is currently claimed by a contributor |

### Claim Lifecycle

```
Issue Created → task:available → [Fork Claims] → task:claimed → [Work] → PR Merged → Closed
                      ↑                                    |
                      └──── task:available ←── [Released/Expired]
```

---

## Workflows

### task-claim.yml

Claims an available issue for your fork.

**Trigger:** `workflow_dispatch` (manual only)

**Inputs:**

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `issue_number` | number | Yes | Issue number to claim |

**Permissions:**
- `issues: write` - Add/remove labels, post comments
- `contents: read` - Read repository

**What it does:**
1. Validates your GitHub username format
2. Checks issue exists and is open
3. Verifies issue has `task:available` label
4. Adds `task:claimed` label
5. Removes `task:available` label
6. Posts claim comment with metadata (claim ID, timestamp)
7. Verifies claim succeeded (race condition check)

**Claim Comment Format:**
```markdown
## Task Claimed by @username

**Claim ID:** `claim-abc123-xyz789`
**Timestamp:** 2025-01-15T10:30:00Z

---
*This claim will expire in 7 days if no PR is submitted.*

<!-- CLAIM_METADATA: {"claimed_by":"username","claim_id":"claim-...","timestamp":"..."} -->
```

---

### task-release.yml

Releases a claim you previously made.

**Trigger:** `workflow_dispatch` (manual only)

**Inputs:**

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `issue_number` | number | Yes | - | Issue number to release |
| `reason` | string | No | "Unable to complete" | Reason for releasing |

**Permissions:**
- `issues: write` - Add/remove labels, post comments
- `contents: read` - Read repository

**What it does:**
1. Validates your GitHub username format
2. Checks issue has `task:claimed` label
3. Verifies you are the original claimant (via claim metadata)
4. Adds `task:available` label
5. Removes `task:claimed` label
6. Posts release comment with reason

**Security:** Only the original claimant can release their claim. Attempting to release someone else's claim will fail.

---

### task-stale-check.yml

Automatically releases stale claims and warns contributors.

**Triggers:**
- `schedule`: Daily at midnight UTC (`cron: '0 0 * * *'`)
- `workflow_dispatch`: Manual trigger for testing

**Inputs (workflow_dispatch only):**

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `dry_run` | boolean | No | `false` | Log actions without making changes |
| `warning_days` | number | No | `5` | Days before sending stale warning |
| `expiry_days` | number | No | `7` | Days before auto-releasing claim |

**Permissions:**
- `issues: write` - Add/remove labels, post comments
- `contents: read` - Read repository

**What it does:**
1. Searches for all issues with `task:claimed` label
2. Parses claim metadata to determine claim age
3. For claims >= 7 days old: Auto-releases and notifies claimant
4. For claims >= 5 days old: Posts warning comment (once)
5. Outputs statistics in job summary

**Reputation Impact:**
- Stale timeout: -3 points
- Recommendation: Release claims early if unable to complete (no penalty)

---

## Manual Testing

### Before Merging to Main

Workflows must exist on the default branch to trigger on issue events. Test using `workflow_dispatch` first:

```bash
# Test claiming an issue
gh workflow run task-claim.yml -f issue_number=123

# Check workflow status
gh run list --workflow=task-claim.yml --limit 1

# View logs
gh run view <run-id> --log
```

### Testing task-claim.yml

```bash
# 1. Create test issue
gh issue create --title "Test: Task Claim" --label "task:available"

# 2. Note the issue number, then claim it
gh workflow run task-claim.yml -f issue_number=<ISSUE_NUMBER>

# 3. Wait for completion and verify
gh run list --workflow=task-claim.yml --limit 1
gh issue view <ISSUE_NUMBER>  # Should show task:claimed label
```

### Testing task-release.yml

```bash
# Requires an issue you've already claimed
gh workflow run task-release.yml -f issue_number=<ISSUE_NUMBER> -f reason="Testing release"

# Verify
gh issue view <ISSUE_NUMBER>  # Should show task:available label
```

### Testing task-stale-check.yml

```bash
# Dry run first (no changes made)
gh workflow run task-stale-check.yml -f dry_run=true

# View summary
gh run view <run-id>

# For actual stale testing, you'd need a claim >7 days old
# Or temporarily modify the expiry_days input for testing
gh workflow run task-stale-check.yml -f expiry_days=1 -f warning_days=0
```

---

## Troubleshooting

### Common Errors

#### "Issue does not have the 'task:available' label"
**Cause:** Issue is not marked as available for claiming.

**Solution:** Check if the issue is already claimed or if maintainers haven't marked it as available yet.

```bash
gh issue view <ISSUE_NUMBER> --json labels
```

#### "Issue is already claimed by @username"
**Cause:** Another contributor claimed the issue first.

**Solution:** Choose a different issue or wait for the claim to expire/be released.

```bash
# Find available issues
gh issue list --label "task:available"
```

#### "Only the original claimant can release their claim"
**Cause:** You tried to release someone else's claim.

**Solution:** Only the user who originally claimed the issue can release it. If the claim is stale, wait for the stale-check workflow to auto-release it.

#### "Issue has conflicting labels (both available and claimed)"
**Cause:** Inconsistent label state, possibly from a failed workflow run.

**Solution:** Contact a maintainer to resolve. They can manually remove the incorrect label.

#### Race condition errors
**Cause:** Two users tried to claim the same issue simultaneously.

**Solution:** One claim will succeed, the other will fail gracefully. Try claiming a different issue.

### Debugging Workflow Runs

```bash
# List recent workflow runs
gh run list --workflow=task-claim.yml --limit 5

# View detailed logs
gh run view <run-id> --log

# View failed runs only
gh run list --workflow=task-claim.yml --status=failure
```

### Orphaned Claims

If an issue has `task:claimed` but no valid claim comment:
- The stale-check workflow will log it as "missing metadata"
- Maintainers can manually clean up by removing the label
- The release workflow supports "recovery mode" for orphaned claims

---

## Concurrency

Each workflow uses concurrency groups to prevent parallel runs on the same issue:

```yaml
concurrency:
  group: task-claim-${{ github.event.inputs.issue_number }}
  cancel-in-progress: false
```

This prevents race conditions within the same workflow. Cross-workflow conflicts are handled via label state verification.

---

## Outputs

### task-stale-check.yml

The stale check workflow provides outputs for downstream automation:

| Output | Description |
|--------|-------------|
| `processed` | Total issues checked |
| `released` | Claims auto-released |
| `warned` | Warnings sent |
| `active` | Active claims (not stale) |
| `errors` | Errors encountered |

---

## Related Documentation

- [CONTRIBUTING.md](../CONTRIBUTING.md) - Fork contribution workflow
- [Fork Reputation System](../../docs/fork-reputation.md) - Scoring and reputation rules
- [Spec](../../.auto-claude/specs/010-distributed-self-development-fork-coordination-sys/spec.md) - Full system specification

---

## Technical Notes

### Claim Metadata

Claims are tracked via HTML comments in issue comments:

```html
<!-- CLAIM_METADATA: {"claimed_by":"user","claim_id":"claim-...","timestamp":"..."} -->
```

This allows machine-readable parsing while keeping comments human-readable.

### Workflow Deployment

Workflows must be on the **default branch** (usually `main`) to trigger on issue events. During development, use `workflow_dispatch` for testing before merging.

### Rate Limiting

All GitHub API calls use `actions/github-script@v7` with retry configuration:
- 3 retries for transient errors
- Exempt status codes: 400, 401, 403, 404, 422 (immediate fail, no retry)

### Timeouts

| Workflow | Timeout |
|----------|---------|
| task-claim.yml | 5 minutes |
| task-release.yml | 5 minutes |
| task-stale-check.yml | 10 minutes |
