/**
 * YAGNI — the minimal-solution ladder from DietrichGebert/ponytail (MIT).
 * Upstream has no separate level system for YAGNI; one original ruleset.
 */

const TEXT = `Apply the minimal-solution ladder, in order, and stop at the first rung that solves the task.

## The smallest complete change

1. Does it need to exist? Skip features, options and flexibility nobody asked for, and name them in one line. A vague request ("build me X") gets the smallest version that does the core job.
2. Already in this codebase (a helper, component, service, pattern)? Use it the way the surrounding code does.
3. Standard library or a platform feature? Use it, unless the project has its own.
4. An installed dependency? Use it. Never add a dependency for a few lines.
5. Can it be one line a reader gets at a glance? One line.
6. Otherwise: the minimum code that works.

Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs, anything the user asked for.`

export const yagniStyle = {
  id: 'yagni',
  label: 'YAGNI',
  description: 'Upstream ponytail ladder: skip, reuse, stdlib, dependency, one line, minimum.',
  levels: ['full'],
  defaultLevel: 'full',
  text() {
    return TEXT
  },
}
