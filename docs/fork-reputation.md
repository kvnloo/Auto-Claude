# Fork Reputation System

This document describes the fork reputation system used in Auto Claude's distributed task coordination. The reputation system tracks fork reliability and contribution quality, helping maintainers identify trustworthy contributors.

## Table of Contents

- [Overview](#overview)
- [Scoring Rules](#scoring-rules)
- [Reputation Tiers](#reputation-tiers)
- [Decay Mechanism](#decay-mechanism)
- [Storage and Persistence](#storage-and-persistence)
- [Impact on Workflow](#impact-on-workflow)
- [Improving Your Reputation](#improving-your-reputation)
- [Checking Your Reputation](#checking-your-reputation)
- [Technical Details](#technical-details)

---

## Overview

Every fork that claims tasks builds a reputation score over time. This score reflects your track record of successfully completing claimed tasks. The system is designed to:

- **Reward reliability**: Contributors who complete their claims earn points
- **Discourage abandonment**: Leaving claims unfinished results in point penalties
- **Stay current**: Inactive contributors experience score decay over time
- **Be transparent**: Your reputation is visible in claim comments

---

## Scoring Rules

Your reputation score changes based on how you handle claimed tasks:

| Event | Points | When It Happens |
|-------|--------|-----------------|
| **PR Merged** | **+10** | Your PR for a claimed issue is merged to the main branch |
| **Claim Abandoned** | **-5** | You claimed an issue but never submitted a PR and didn't release the claim |
| **Stale Timeout** | **-3** | Your claim automatically expired after 7 days of inactivity |
| **Voluntary Release** | **0** | You released a claim before the timeout (no penalty) |
| **Claim Completed** | **0** | Claim marked as completed (tracked for history) |

### Examples

**Building reputation (+10 each):**
```
Start: 0 points (New)
Merge PR #1: +10 → 10 points (Bronze)
Merge PR #2: +10 → 20 points (Bronze)
Merge PR #3: +10 → 30 points (Silver)
```

**Losing reputation:**
```
Current: 50 points (Gold)
Abandon claim: -5 → 45 points (Silver)
Stale timeout: -3 → 42 points (Silver)
```

### Minimum Score

Your score cannot drop below **0 points**. Even with multiple penalties, you'll never have a negative reputation.

---

## Reputation Tiers

Your score maps to a tier that indicates your experience level:

| Tier | Score Range | Description | Badge |
|------|-------------|-------------|-------|
| **New** | 0 points | Just getting started, no contribution history | 🆕 |
| **Bronze** | 1 - 24 points | Proven contributor with some successful merges | 🥉 |
| **Silver** | 25 - 49 points | Reliable contributor with consistent track record | 🥈 |
| **Gold** | 50 - 99 points | Highly trusted contributor | 🥇 |
| **Platinum** | 100+ points | Elite contributor with exceptional track record | 💎 |

### Tier Progression

To reach each tier:

- **Bronze**: Complete 1-2 tasks successfully
- **Silver**: Complete 3-4 tasks successfully (or more if you have penalties)
- **Gold**: Complete 5-9 tasks successfully with minimal penalties
- **Platinum**: Complete 10+ tasks successfully while maintaining low abandonment

---

## Decay Mechanism

To keep the leaderboard fresh and reward active contributors, reputation scores experience **time-based decay** during periods of inactivity.

### How Decay Works

| Parameter | Value |
|-----------|-------|
| **Decay Interval** | 30 days of inactivity |
| **Decay Rate** | 10% of current score per interval |
| **Minimum After Decay** | 0 points |

### Decay Formula

```
New Score = Current Score × (1 - 0.10)^(intervals of inactivity)
```

### Decay Examples

**Single decay period (30 days inactive):**
```
100 points × 0.90 = 90 points
50 points × 0.90 = 45 points
20 points × 0.90 = 18 points
```

**Multiple decay periods (90 days inactive = 3 periods):**
```
100 points × 0.90³ = 72.9 → 72 points
50 points × 0.90³ = 36.4 → 36 points
```

### Why Decay Exists

1. **Prevents gaming**: One-time contributors can't maintain high scores indefinitely
2. **Rewards activity**: Active contributors stay at the top of the leaderboard
3. **Reflects current reliability**: Recent activity is a better indicator of availability
4. **Encourages ongoing participation**: Keeps the community engaged

### Preventing Decay

Any of these activities reset your decay timer:

- Claiming a new task
- Submitting a PR for a claimed task
- Having a PR merged
- Releasing a claim (even voluntary releases count as activity)

---

## Storage and Persistence

Reputation data is stored in multiple ways to ensure durability and accessibility.

### Primary Storage: GitHub API

Reputation is persisted via GitHub's API using:

1. **Claim Comments**: Every claim comment includes your current reputation metadata
2. **Reputation Issue**: A special issue (configurable) stores the full leaderboard
3. **PR Metadata**: PRs include `Claimed-By` and reputation information

### Claim Comment Metadata Format

When you claim a task, a comment is posted with embedded metadata:

```markdown
## Task Claimed by @your-username

**Claim ID:** `claim-1703644800-abc123`
**Timestamp:** 2024-12-27T00:00:00Z

### Fork Reputation
- **Score:** 42 (silver)
- **Completed Tasks:** 5
- **Reliability:** 83%

---
*This claim will expire in 7 days if no PR is submitted.*

<!-- CLAIM_METADATA: {"claimed_by":"your-username","claim_id":"claim-1703644800-abc123","timestamp":"2024-12-27T00:00:00Z","fork_reputation":{"score":42,"tier":"silver","total_claims":6,"successful_merges":5,"reliability_score":0.83},"issue_number":123} -->
```

### Local Storage (Backend)

For backend operations, reputation is also cached locally:

```
.auto-claude/github/reputation/
├── your-username.json
├── another-contributor.json
└── ...
```

Each file contains the full reputation history for that fork.

### Data Included

| Field | Description |
|-------|-------------|
| `fork_owner` | GitHub username |
| `score` | Current numeric score |
| `tier` | Current tier (new/bronze/silver/gold/platinum) |
| `total_claims` | Total number of claims made |
| `successful_merges` | Number of PRs merged |
| `abandoned_claims` | Claims abandoned without PR |
| `timed_out_claims` | Claims that expired |
| `released_claims` | Voluntary releases |
| `last_activity_at` | Timestamp of last activity |
| `events` | Recent reputation events (last 50) |

---

## Impact on Workflow

Your reputation affects how the task claiming system treats you.

### Current Impact

| Aspect | How Reputation Affects It |
|--------|---------------------------|
| **Claim Comments** | Your reputation is displayed publicly when you claim |
| **Maintainer Review** | Maintainers can see your track record when reviewing PRs |
| **Leaderboard** | Higher reputation = higher ranking on the contributor leaderboard |

### Advisory Nature

Currently, reputation is **advisory only**:

- Anyone can still claim available tasks regardless of reputation
- Low reputation doesn't block you from claiming
- Maintainers use reputation as one factor when prioritizing PRs

### Future Enhancements (Planned)

| Feature | Description | Status |
|---------|-------------|--------|
| Priority claiming | High-reputation forks get priority in race conditions | Planned |
| Claim limits | Low-reputation forks limited to fewer concurrent claims | Planned |
| Auto-approval | Platinum contributors' PRs fast-tracked | Planned |
| Reputation-based assignments | Auto-assign complex issues to high-reputation forks | Planned |

---

## Improving Your Reputation

### Best Practices

1. **Start Small**
   - Begin with `good first issue` or small tasks
   - Build a track record before claiming complex work
   - Each successful merge adds +10 points

2. **Complete What You Claim**
   - Only claim tasks you can realistically finish
   - Consider your available time before claiming
   - Unfinished claims hurt your reputation

3. **Release Early If Blocked**
   - If you realize you can't complete a task, release it immediately
   - Voluntary releases have **no penalty** (0 points)
   - This is much better than waiting for a stale timeout (-3 points)

4. **Submit Quality PRs**
   - Merged PRs give the biggest reputation boost (+10)
   - Follow contribution guidelines to increase merge chances
   - Address review feedback promptly

5. **Stay Active**
   - Regular activity prevents score decay
   - Even small contributions keep your reputation current
   - Aim for at least one contribution per month

### Reputation Recovery

If your reputation has dropped:

| Starting Point | Recovery Strategy |
|----------------|-------------------|
| **0 points (New)** | Complete 3 tasks → 30 points (Silver) |
| **Negative history** | Focus on small, easy wins; avoid timeouts |
| **After abandonment** | Release claims properly; complete 1 task to offset (-5 + 10 = +5) |
| **After timeout** | Post progress updates; complete 1 task to offset (-3 + 10 = +7) |

### What NOT to Do

- ❌ Claim tasks you don't have time for
- ❌ Let claims go stale without communication
- ❌ Claim multiple tasks and abandon most of them
- ❌ Try to game the system with fake PRs (detected and penalized)
- ❌ Go inactive for long periods (causes decay)

---

## Checking Your Reputation

### In Claim Comments

Your reputation is displayed every time you claim a task:

```markdown
### Fork Reputation
- **Score:** 42 (silver)
- **Completed Tasks:** 5
- **Reliability:** 83%
```

### Via GitHub CLI

Check an issue you've claimed to see your reputation:

```bash
# View issue with your claim comment
gh issue view 123 --repo owner/Auto-Claude

# Find your claim comments across issues
gh search issues --repo owner/Auto-Claude --commenter your-username
```

### Reliability Score

The reliability score shows your success rate:

```
Reliability = Successful Merges / (Successful Merges + Abandoned + Timed Out)
```

| Reliability | Meaning |
|-------------|---------|
| 100% | Perfect record, all claims completed |
| 80%+ | Very reliable |
| 60-80% | Generally reliable |
| 40-60% | Some issues with completion |
| <40% | Needs improvement |

---

## Technical Details

### ReputationTracker Class

The backend uses `ReputationTracker` for all reputation operations:

```python
from apps.backend.runners.github.reputation_tracker import ReputationTracker

tracker = ReputationTracker(state_dir=Path(".auto-claude/github"))

# Record a successful merge
tracker.record_merge("fork-owner", issue_number=123, pr_number=456)

# Record a timeout
tracker.record_timeout("fork-owner", issue_number=123, days_stale=8)

# Get reputation
rep = tracker.get_reputation("fork-owner")
print(f"Score: {rep.score}, Tier: {rep.tier.value}")
```

### Event Types

| Event Type | Score Delta | Description |
|------------|-------------|-------------|
| `pr_merged` | +10 | PR successfully merged |
| `claim_abandoned` | -5 | Claim abandoned without release |
| `claim_timeout` | -3 | Claim expired (7+ days stale) |
| `claim_completed` | 0 | Claim marked complete (neutral) |
| `claim_released` | 0 | Voluntary release (neutral) |
| `decay_applied` | Variable | Time-based decay (negative) |

### Statistics Tracked

For each fork, the system tracks:

```python
@dataclass
class ReputationStats:
    total_claims: int       # All claims ever made
    successful_merges: int  # PRs merged to main
    abandoned_claims: int   # Claims abandoned
    timed_out_claims: int   # Claims that expired
    released_claims: int    # Voluntary releases
```

### Leaderboard

Get top contributors:

```python
leaderboard = tracker.get_leaderboard(limit=10)
for entry in leaderboard:
    print(f"{entry['rank']}. @{entry['fork_owner']}: {entry['score']} ({entry['tier']})")
```

---

## Related Documentation

- [Contributing from Forks](../.github/CONTRIBUTING.md) - How to claim and complete tasks
- [Task Claim Workflow](../.github/workflows/README.md) - Workflow documentation
- [Main Contributing Guide](../CONTRIBUTING.md) - General contribution guidelines

---

## FAQ

### Does releasing a claim hurt my reputation?
**No.** Voluntary releases have no penalty. It's much better to release early than to let a claim go stale.

### How long until my claim times out?
Claims expire after **7 days** of inactivity. You'll receive a warning at **5 days**.

### Can I have multiple claims at once?
Yes, but be realistic about what you can complete. Multiple timeouts will hurt your reputation.

### Will my reputation ever reset?
No, reputation is permanent. However, decay means old scores become less relevant over time.

### How do maintainers use reputation?
Reputation helps maintainers prioritize PR reviews and identify reliable contributors. It's advisory, not a hard requirement.

### What if I'm wrongly penalized?
Open an issue to discuss. Maintainers can manually adjust reputation in exceptional cases.
