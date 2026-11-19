# Adding a Test Case

Our test suite uses Vitest to define test cases and check results.
For example, [tennisSwing.test.ts](test/tennisSwing.test.ts) tests
swing detection using simulated phone readings.

Most tests follow the **Arrange, Act, Assert** pattern:

- **Arrange:** Prepare the inputs and initial state.
- **Act:** Call the function being tested.
- **Assert:** Check that the result matches the expected behavior.

This walkthrough tests the acceleration-based detector in `accelerationSwing.js`,
which is preserved for orientation compatibility. The active phone controller uses
the separate gyro-based detector in `classifySwing.js`; its input format differs.

## 1. Create a test file

Create a new file in the project's `test/` folder for the feature you want
to test. Use a descriptive filename ending in `.test.ts`, such as
`test/myFeature.test.ts`.

Vitest automatically discovers files matching `test/**/*.test.ts`, so the
new file is included when you run `npm test`. You do not need to register
individual tests or change `package.json`.

This walkthrough uses the existing `test/tennisSwing.test.ts` as an example.
Do not overwrite it or add a duplicate test. To test another behavior of the
same feature, add a new `test(...)` block to the existing file instead.

## 2. Import the dependencies

Import `test` and `expect` from Vitest, along with the detector
and its threshold:

```ts
import { test, expect } from 'vitest';
import {
  createSwingDetector,
  SWING_LIMITS,
} from '../src/controller/accelerationSwing.js';
```

## 3. Define the test

Give the test a name that describes the expected behavior.
The callback contains the setup, action, and assertions:

```ts
test('detects a swing when accelMag meets the threshold', () => {
  // Arrange

  // Act

  // Assert
});
```

## 4. Arrange the inputs

Create a fresh detector and a simulated phone reading. Using
`SWING_LIMITS.start` places the acceleration exactly at the detection threshold.

```ts
const detector = createSwingDetector();
const sample = {
  timeMs: 0,
  accelMag: SWING_LIMITS.start,
};
```

## 5. Act on the input

Pass the reading to the detector using `push()`. Store the result
so the test can inspect it.

```ts
const result = detector.push(sample);
```

## 6. Assert the expected result

Check that a swing was detected and marked complete.

```ts
expect(result).not.toBeNull();
expect(result).toMatchObject({
  label: 'Forehand',
  complete: true,
});
```

This detector defaults to `Forehand` when orientation data is absent.
This case verifies threshold detection, rather than whether the detector
can distinguish forehands from backhands.

## Complete example

The complete test belongs in `test/tennisSwing.test.ts`:

```ts
import { test, expect } from 'vitest';
import {
  createSwingDetector,
  SWING_LIMITS,
} from '../src/controller/accelerationSwing.js';

test('detects a swing when accelMag meets the threshold', () => {
  // Arrange
  const detector = createSwingDetector();
  const sample = {
    timeMs: 0,
    accelMag: SWING_LIMITS.start,
  };

  // Act
  const result = detector.push(sample);

  // Assert
  expect(result).not.toBeNull();
  expect(result).toMatchObject({
    label: 'Forehand',
    complete: true,
  });
});
```

This behavior is already tested in the existing file. Use the example
as a guide rather than adding a duplicate test.

## 7. Run the test

From the project root, run the file:

```bash
npx vitest run test/tennisSwing.test.ts
```

To run only the test shown above, filter by its name:

```bash
npx vitest run test/tennisSwing.test.ts -t "detects a swing when"
```

A passing result means the assertions matched the function's output.
If it fails, inspect the expected and actual values in the terminal.

Before committing a new test or code change, run:

```bash
npm run check
npm test
```
