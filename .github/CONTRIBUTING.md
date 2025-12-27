# Contributing from Forks

This guide explains how community forks can contribute to Auto Claude using our distributed task coordination system. This system prevents duplicate work by allowing forks to safely claim issues before working on them.

## Table of Contents

- [Overview](#overview)
- [Finding Available Tasks](#finding-available-tasks)
- [Claiming a Task](#claiming-a-task)
- [Working on Your Claim](#working-on-your-claim)
- [Submitting Your Work](#submitting-your-work)
- [Releasing a Claim](#releasing-a-claim)
- [Reputation System](#reputation-system)
- [Stale Claims](#stale-claims)
- [Troubleshooting](#troubleshooting)

---

## Overview

When contributing from a fork, you should **claim an issue before starting work**. This prevents multiple contributors from working on the same task simultaneously.

### How It Works

1. **Find** an issue labeled `task:available`
2. **Claim** it using the task-claim workflow
3. **Work** on the issue in your fork
4. **Submit** a PR with claim metadata
5. **Release** the claim if you can't complete it

### Labels

| Label | Meaning |
|-------|---------|
| `task:available` | Issue is open for claiming - you can work on this |
| `task:claimed` | Already claimed by someone - choose a different issue |

---

## Finding Available Tasks

### Using GitHub CLI (Recommended)

```bash
# List all available tasks
gh issue list --repo owner/Auto-Claude --label "task:available"

# Filter by additional labels
gh issue list --repo owner/Auto-Claude --label "task:available" --label "good first issue"

# View details of a specific issue
gh issue view 123 --repo owner/Auto-Claude
```

### Using GitHub Web UI

1. Go to the [Issues page](../../issues)
2. Use the filter: `is:open label:task:available`
3. Browse available tasks and pick one that matches your skills

> **Tip:** Look for issues labeled `good first issue` if you're new to the project.

---

## Claiming a Task

Once you've found an issue to work on, claim it using the `task-claim` workflow.

### Step-by-Step

1. **Ensure you have the gh CLI installed** and authenticated:
   ```bash
   gh auth login
   ```

2. **Trigger the claim workflow** with the issue number:
   ```bash
   gh workflow run task-claim.yml -f issue_number=123 --repo owner/Auto-Claude
   ```

3. **Wait for the workflow to complete** (usually under 1 minute):
   ```bash
   gh run list --workflow=task-claim.yml --limit 1 --repo owner/Auto-Claude
   ```

4. **Verify the claim succeeded**:
   ```bash
   gh issue view 123 --repo owner/Auto-Claude
   # Should show: Labels: task:claimed
   ```

### What Happens When You Claim

- The `task:claimed` label is added to the issue
- The `task:available` label is removed
- A comment is posted with your claim details:
  - Your GitHub username
  - Unique claim ID
  - Claim timestamp
  - Your current reputation score

### Claim Failures

Your claim may fail if:

- **Issue already claimed**: Someone else claimed it first. Choose another issue.
- **Missing `task:available` label**: The issue isn't open for claiming yet.
- **Issue is closed**: You can only claim open issues.
- **Race condition**: Two people tried to claim simultaneously. One succeeds, one fails.

If your claim fails, the workflow will post a comment explaining why.

---

## Working on Your Claim

Once you've successfully claimed an issue:

### 1. Fork the Repository (if not already done)

```bash
gh repo fork owner/Auto-Claude --clone
cd Auto-Claude
```

### 2. Create a Branch

Follow the [branch naming conventions](../../CONTRIBUTING.md#branch-naming):

```bash
git checkout develop
git pull origin develop
git checkout -b feature/issue-123-description
```

### 3. Make Your Changes

- Follow the [code style guidelines](../../CONTRIBUTING.md#code-style)
- Write tests for new functionality
- Update documentation if needed

### 4. Post Progress Updates (Recommended)

For longer tasks, post updates on the issue to show you're actively working:

```bash
gh issue comment 123 --body "Progress update: Completed the API changes, working on tests now."
```

This prevents your claim from being considered stale.

---

## Submitting Your Work

When you're ready to submit your changes:

### 1. Commit Your Changes

```bash
git add .
git commit -m "feat: implement feature X

Fixes #123"
```

### 2. Push to Your Fork

```bash
git push origin feature/issue-123-description
```

### 3. Create a Pull Request

Include the claim metadata in your PR description:

```bash
gh pr create --base develop --title "feat: implement feature X" --body "$(cat <<'EOF'
## Summary

Brief description of what this PR does.

## Claim Information

**Fixes:** #123
**Claimed-By:** your-username
**Claim-ID:** claim-abc123-xyz789

## Changes

- Added X
- Modified Y
- Fixed Z

## Testing

- [ ] Unit tests pass
- [ ] Manual testing completed

EOF
)"
```

> **Important:** The `Claimed-By` and `Claim-ID` fields help maintainers verify your claim and update your reputation when the PR is merged.

### 4. Respond to Reviews

Address reviewer feedback promptly. Your claim remains active while your PR is under review.

---

## Releasing a Claim

If you can't complete a task (too busy, blocked, found a better approach, etc.), **release your claim** so others can work on it.

### How to Release

```bash
gh workflow run task-release.yml \
  -f issue_number=123 \
  -f reason="Unable to complete due to time constraints" \
  --repo owner/Auto-Claude
```

### What Happens When You Release

- The `task:claimed` label is removed
- The `task:available` label is restored
- A comment is posted documenting the release

### Why You Should Release Early

- **No reputation penalty** for voluntary releases
- Helps the community by freeing up tasks
- Better than letting a claim go stale (which does penalize reputation)

> **Best Practice:** If you realize you can't complete a task within a few days, release it immediately rather than waiting for it to go stale.

---

## Reputation System

Your fork builds a reputation score based on your contribution history. This helps maintainers identify reliable contributors.

### How Reputation Works

| Event | Points | Description |
|-------|--------|-------------|
| PR Merged | **+10** | Your claimed issue's PR was merged to the main branch |
| Claim Abandoned | **-5** | You claimed an issue but never submitted a PR or released |
| Stale Timeout | **-3** | Your claim expired after 7 days of inactivity |

### Reputation Tiers

| Tier | Score Range | Description |
|------|-------------|-------------|
| New | 0-9 | Just getting started |
| Bronze | 10-29 | Proven contributor |
| Silver | 30-59 | Reliable contributor |
| Gold | 60-99 | Highly trusted |
| Platinum | 100+ | Elite contributor |

### Reputation Decay

To keep the leaderboard fresh and accurate:

- Inactive accounts experience gradual score decay
- Recent contributions are weighted more heavily
- This prevents gaming the system with one-time contributions

### Checking Your Reputation

Your current reputation score is shown in claim comments. Maintainers can also view the fork leaderboard.

### Tips for Building Reputation

1. **Start small**: Claim `good first issue` tasks initially
2. **Complete what you claim**: Only claim tasks you can finish
3. **Release early if blocked**: No penalty for honest releases
4. **Submit quality PRs**: Merged PRs give the biggest reputation boost

For detailed information, see [Fork Reputation System](../../docs/fork-reputation.md).

---

## Stale Claims

Claims automatically expire if there's no activity for **7 days**.

### Timeline

| Days Since Claim | What Happens |
|------------------|--------------|
| 0-4 days | Active claim, work in progress |
| 5 days | **Warning comment** posted on the issue |
| 7 days | **Claim auto-released**, task becomes available again |

### What Counts as Activity

The stale check looks at:
- Claim timestamp (when you originally claimed)
- PR submissions linked to the issue
- Progress comments on the issue

### Avoiding Stale Timeouts

1. **Post progress updates** on the issue every few days
2. **Submit a draft PR** early, even if incomplete
3. **Release the claim** if you know you can't finish in time

### Consequences of Stale Timeout

- **-3 reputation points** per timeout
- Claim is automatically released
- Issue becomes available for others to claim
- A notification comment is posted mentioning you

---

## Troubleshooting

### "Issue does not have the 'task:available' label"

The issue isn't open for claiming. Possible reasons:
- Not yet approved by maintainers
- Already claimed by someone else
- Reserved for core team

**Solution:** Choose a different issue with the `task:available` label.

### "Issue is already claimed by @username"

Someone else claimed this issue before you.

**Solution:**
- Choose another issue
- Wait for the claim to expire (7 days) or be released
- Check if the claimer is actively working on it

### "Only the original claimant can release their claim"

You tried to release someone else's claim.

**Solution:** Only the person who claimed an issue can release it. If a claim seems abandoned, wait for the stale-check workflow to auto-release it.

### Workflow run failed

Check the workflow logs for details:

```bash
gh run list --workflow=task-claim.yml --limit 5 --repo owner/Auto-Claude
gh run view <run-id> --log --repo owner/Auto-Claude
```

Common causes:
- GitHub API rate limiting (wait and retry)
- Concurrent claim attempt (race condition)
- Invalid issue number

### My claim was released but I'm still working on it

Your claim went stale (7+ days without activity). To reclaim:

1. Check if the issue is still available
2. Run the claim workflow again
3. Post a comment explaining you're resuming work

> **Prevention:** Post progress updates on the issue to reset the stale timer.

---

## Quick Reference

### CLI Commands

```bash
# Find available tasks
gh issue list --repo owner/Auto-Claude --label "task:available"

# Claim a task
gh workflow run task-claim.yml -f issue_number=123 --repo owner/Auto-Claude

# Check claim status
gh issue view 123 --repo owner/Auto-Claude

# Release a claim
gh workflow run task-release.yml -f issue_number=123 --repo owner/Auto-Claude

# Check workflow status
gh run list --workflow=task-claim.yml --limit 1 --repo owner/Auto-Claude
```

### Checklist for Fork Contributors

- [ ] Find an issue with `task:available` label
- [ ] Claim the issue using `task-claim.yml` workflow
- [ ] Fork the repository (if not done already)
- [ ] Create a feature branch from `develop`
- [ ] Make changes following code style guidelines
- [ ] Post progress updates if working for more than a few days
- [ ] Create PR with `Claimed-By` and `Claim-ID` metadata
- [ ] Address review feedback
- [ ] If unable to complete: release claim with `task-release.yml`

---

## Related Documentation

- [Main Contributing Guide](../../CONTRIBUTING.md) - Full contribution guidelines
- [Workflow README](workflows/README.md) - Technical workflow documentation
- [Fork Reputation System](../../docs/fork-reputation.md) - Detailed reputation rules

---

## Questions?

If you have questions about the fork contribution process:

1. Check this guide and the [troubleshooting](#troubleshooting) section
2. Review the [workflow documentation](workflows/README.md)
3. Open an issue with the `question` label

Thank you for contributing to Auto Claude!
