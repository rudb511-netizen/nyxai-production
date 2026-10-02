#!/usr/bin/env node
/** Produce a real Android App Bundle when the Android SDK is available. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const android = resolve(root, "android");
const gradlew = resolve(android, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const out = resolve(android, "app/build/outputs/bundle/release/app-release.aab");

if (!existsSync(gradlew)) {
  console.error("Android Gradle wrapper is missing.");
  process.exit(1);
}

const env = { ...process.env };
if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
  console.error("ANDROID_HOME is not set. Install the Android SDK, then run: npm run android:bundle");
  process.exit(2);
}

const result = spawnSync(gradlew, ["bundleRelease"], {
  cwd: android,
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(out)) {
  console.error("bundleRelease finished but app-release.aab was not produced.");
  process.exit(1);
}

console.log(`AAB ready: ${out}`);
