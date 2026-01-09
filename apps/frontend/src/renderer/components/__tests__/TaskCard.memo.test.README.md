# TaskCard React.memo Optimization Tests

## Overview

This test suite verifies that the `TaskCard` component's React.memo optimization correctly prevents unnecessary re-renders when other tasks in the Kanban board change.

## Test File

`TaskCard.memo.test.tsx`

## Test Coverage

### 1. Re-render Prevention - Task A changes should not affect Task B

Tests that verify when Task A's data changes, Task B's card does not re-render:

- ✅ Status changes to Task A don't re-render Task B
- ✅ Title changes to Task A don't re-render Task B
- ✅ Description changes to Task A don't re-render Task B
- ✅ Multiple tasks: only the changed task re-renders

### 2. Progress Updates - Selective Re-rendering

Tests that verify execution progress updates only re-render the affected card:

- ✅ Progress changes in Task A don't re-render Task B
- ✅ Phase changes trigger re-render of affected card only
- ✅ Phase progress changes trigger re-render
- ✅ Non-compared fields (message) don't trigger re-render

### 3. Subtask Changes - Selective Re-rendering

Tests that verify subtask updates only affect the parent task card:

- ✅ Subtask status changes trigger re-render
- ✅ Subtask count changes trigger re-render
- ✅ Debug logging shows subtask count changes

### 4. Metadata Changes

Tests that verify metadata field changes are properly detected:

- ✅ Priority changes trigger re-render
- ✅ Impact changes trigger re-render
- ✅ Security severity changes trigger re-render
- ✅ Category changes trigger re-render
- ✅ Complexity changes trigger re-render

### 5. Handler Stability

Tests that verify handler reference stability:

- ✅ Stable handler references prevent re-render
- ✅ Handler reference changes trigger re-render

### 6. Archive and PR URL Changes

Tests that verify archive and PR metadata:

- ✅ Archive timestamp changes trigger re-render
- ✅ PR URL additions trigger re-render

### 7. Review Reason Changes

Tests that verify review reason updates:

- ✅ Review reason changes trigger re-render

### 8. UpdatedAt Timestamp Changes

Tests that verify timestamp updates:

- ✅ UpdatedAt changes trigger re-render

### 9. Debug Logging

Tests that verify debug logging behavior:

- ✅ Re-renders are logged when DEBUG is enabled
- ✅ Changed fields are shown in debug logs
- ✅ No logs when card doesn't re-render

## How to Run Tests

### Prerequisites

```bash
cd apps/frontend
npm install
```

### Run All TaskCard Memo Tests

```bash
npm test -- TaskCard.memo.test.tsx
```

### Run Tests in Watch Mode

```bash
npm run test:watch -- TaskCard.memo.test.tsx
```

### Run with Coverage

```bash
npm run test:coverage -- TaskCard.memo.test.tsx
```

## Test Methodology

### Render Count Tracking

The tests use a `TaskCardWithRenderTracking` wrapper component that:

1. Tracks how many times each TaskCard renders
2. Uses a Map to store render counts by task ID
3. Allows verification that only affected cards re-render

### Debug Mode

Tests enable `window.DEBUG = true` to:

1. Activate the debug logging in `taskCardPropsAreEqual`
2. Verify that re-render logs show the correct changed fields
3. Confirm that unchanged cards don't log re-renders

### Verification Strategy

Each test:

1. Renders multiple TaskCard instances
2. Records initial render counts
3. Updates one task's data
4. Re-renders all cards
5. Verifies only the changed task increments its render count
6. Optionally checks debug logs for expected messages

## Expected Behavior

### ✅ Should Re-render When:

- Task's own `status` changes
- Task's own `title` changes
- Task's own `description` changes
- Task's own `executionProgress.phase` changes
- Task's own `executionProgress.phaseProgress` changes
- Task's own `subtasks` array length changes
- Task's own subtask statuses change
- Task's own `metadata.priority` changes
- Task's own `metadata.impact` changes
- Task's own `metadata.securitySeverity` changes
- Task's own `metadata.category` changes
- Task's own `metadata.complexity` changes
- Task's own `metadata.archivedAt` changes
- Task's own `metadata.prUrl` changes
- Task's own `reviewReason` changes
- Task's own `updatedAt` changes
- Handler props (`onClick`, `onStatusChange`) change

### ❌ Should NOT Re-render When:

- Other tasks in the same column change
- Non-compared fields change (e.g., `executionProgress.message`)
- Same task object reference with stable handlers

## Performance Impact

With React.memo optimization, in a Kanban board with 20 tasks:

- **Without optimization**: Status change to 1 task → 20 re-renders
- **With optimization**: Status change to 1 task → 1 re-render

This represents a **95% reduction** in unnecessary re-renders for typical operations.

## Debugging Failed Tests

If tests fail:

1. Check that `taskCardPropsAreEqual` includes all compared fields
2. Verify the comparison logic is correct (using `===` for primitives)
3. Check that array/object comparisons are shallow where appropriate
4. Enable `window.DEBUG = true` and check console logs
5. Verify handler references are stable in parent components

## Related Files

- `apps/frontend/src/renderer/components/TaskCard.tsx` - Component implementation
- `apps/frontend/src/renderer/components/SortableTaskCard.tsx` - Wrapper with drag-and-drop
- `apps/frontend/src/renderer/components/DroppableColumn.tsx` - Column component
- `apps/frontend/src/renderer/components/KanbanBoard.tsx` - Board component
