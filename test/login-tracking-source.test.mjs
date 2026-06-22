import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

const loginSource = readFileSync(new URL("../bin/login.ts", import.meta.url), "utf8");

test("pinme login tracking sends login method through source", () => {
  assert.match(loginSource, /source:\s*['"]cli['"]/);
});
