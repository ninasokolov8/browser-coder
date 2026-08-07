# Writing a marking harness

A task can ship checks the student runs themselves. They press **Check my work** and get
a line per check — what passed, what failed, and why — instead of a wall of output.

This page is for whoever writes the task.

## The two rules

**1. Name the file so it is hidden.** Anything whose name — or any folder above it —
starts with `X_HIDDEN_` is invisible to the student: not in the file tree, not openable
in a tab, and not in any export or download. It is still there when the program runs.

**2. Put `test` somewhere in the name.** That is what marks it as the harness rather
than a hidden solution or a hidden data file, both of which are also legitimate.

```
X_HIDDEN_tests.py        ✔ the harness
X_HIDDEN_test_math.js    ✔ also fine
X_HIDDEN_solution.py     ✘ hidden, but not a harness — never run
tests.py                 ✘ visible, so the student could edit their own marking
```

Exactly one per language per task. Two is refused rather than guessed at: marking a
student against an arbitrary one of them, differently depending on file order, is worse
than saying nothing ran.

## What the harness prints

Lines beginning with `BCTEST`. Everything else it prints is shown to the student as
ordinary output, so it can still `print` whatever is useful.

```
BCTEST plan 3
BCTEST case adds two numbers pass
BCTEST case handles zero fail expected 0 but got 1
BCTEST case negative numbers skip not covered yet
BCTEST done
```

| Line | Meaning |
| --- | --- |
| `BCTEST plan <n>` | optional; how many checks are coming |
| `BCTEST case <name…> <pass\|fail\|skip> [why…]` | one check |
| `BCTEST done` | the harness reached its end |

The status word comes **after** the name, so a name can contain spaces without any
quoting — `case adds two numbers pass` has a three-word name. The rest of the line is
the explanation, and it is the most valuable part of a failure: `expected 0 but got 1`
tells a student what to do next; `assertion failed` does not.

Send `BCTEST done`. Without it the IDE says "the harness stopped early, so some checks
did not run" — which is correct, and is what you want it to say if your harness really
did crash halfway.

## Why a printed line and not a real test framework

Because a framework cannot be reached from inside the sandbox, in five of the six
languages:

- **C#** builds with `--no-restore` and an empty `<RestoreSources>` — restore must never
  reach the network. xunit is a NuGet package.
- **Java** invokes `javac` directly. No Maven, no Gradle; JUnit is a jar to vendor.
- **PHP** runs `php -l` then `php`. PHPUnit is a phar to vendor.
- **JavaScript / TypeScript** have no `node_modules` in a job and no installer.
- **Python** runs isolated with no site-packages. `unittest` is stdlib and would work;
  pytest is not installed.

So a framework would buy Python and JavaScript, and need four vendored binaries plus
four different result formats for the rest. A printed line is something all six can do
with the tools they already have, and there is exactly one parser to get right.

## One harness per language

### Python — `X_HIDDEN_tests.py`

```python
from main import add          # the student's file

def check(name, actual, expected):
    if actual == expected:
        print(f"BCTEST case {name} pass")
    else:
        print(f"BCTEST case {name} fail expected {expected} but got {actual}")

print("BCTEST plan 2")
check("adds two numbers", add(2, 3), 5)
check("adds zero", add(0, 0), 0)
print("BCTEST done")
```

### JavaScript — `X_HIDDEN_tests.mjs`

```js
import { add } from './main.mjs';

const check = (name, actual, expected) =>
  console.log(actual === expected
    ? `BCTEST case ${name} pass`
    : `BCTEST case ${name} fail expected ${expected} but got ${actual}`);

console.log('BCTEST plan 2');
check('adds two numbers', add(2, 3), 5);
check('adds zero', add(0, 0), 0);
console.log('BCTEST done');
```

### Java — `X_HIDDEN_Tests.java`

The harness is the entry point, so it needs a `main`.

```java
public class X_HIDDEN_Tests {
  static void check(String name, int actual, int expected) {
    System.out.println(actual == expected
      ? "BCTEST case " + name + " pass"
      : "BCTEST case " + name + " fail expected " + expected + " but got " + actual);
  }

  public static void main(String[] args) {
    System.out.println("BCTEST plan 2");
    check("adds two numbers", Main.add(2, 3), 5);
    check("adds zero", Main.add(0, 0), 0);
    System.out.println("BCTEST done");
  }
}
```

### C# — `X_HIDDEN_Tests.cs`

The student's own file must not also declare a top-level `Main`, or the compiler will
not know which one to start. Give the task a class-shaped starter.

```csharp
class X_HIDDEN_Tests {
  static void Check(string name, int actual, int expected) {
    System.Console.WriteLine(actual == expected
      ? $"BCTEST case {name} pass"
      : $"BCTEST case {name} fail expected {expected} but got {actual}");
  }

  static void Main() {
    System.Console.WriteLine("BCTEST plan 2");
    Check("adds two numbers", Program.Add(2, 3), 5);
    System.Console.WriteLine("BCTEST done");
  }
}
```

### PHP — `X_HIDDEN_tests.php`

```php
<?php
require_once __DIR__ . '/main.php';

function check($name, $actual, $expected) {
    echo $actual === $expected
        ? "BCTEST case $name pass\n"
        : "BCTEST case $name fail expected $expected but got $actual\n";
}

echo "BCTEST plan 2\n";
check("adds two numbers", add(2, 3), 5);
echo "BCTEST done\n";
```

## What the student sees

```
── Check my work ───────────────────────────────────────────
✔ adds two numbers
✘ handles zero    expected 0 but got 1
– negative numbers    not covered yet

1 of 3 checks passed. 1 skipped. first failure: handles zero — expected 0 but got 1.
```

The count leads because it is the motivating number: "3 of 4" tells someone they are
nearly there, where "failed" tells them nothing.

## A harness that crashes

It is reported like any other crashing program — the traceback, and the IDE's
explanation of the error underneath it. No checks are invented, and nothing claims the
student failed: they did not fail, the harness did.
