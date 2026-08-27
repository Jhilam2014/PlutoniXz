import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appStyles = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
const studioStyles = readFileSync(new URL("../src/pages/StudioPage.css", import.meta.url), "utf8");

test("dark mode defines one restrained palette for navigation controls and fields", () => {
  for (const token of [
    "--px-control-surface",
    "--px-control-surface-hover",
    "--px-control-surface-active",
    "--px-control-border",
    "--px-control-text",
    "--px-field-surface",
    "--px-field-surface-focus",
    "--px-field-placeholder"
  ]) {
    assert.ok(appStyles.includes(token), `missing ${token}`);
  }

  assert.ok(appStyles.includes(':root[data-theme="dark"] .workspace-tabs > button'));
  assert.ok(appStyles.includes(':root[data-theme="dark"] .workspace-tabs .theme-switch button.active'));
  assert.ok(appStyles.includes('background: var(--px-control-surface-active)'));
});

test("dark mode applies the shared field surface without restyling specialized inputs", () => {
  assert.ok(appStyles.includes(':root[data-theme="dark"] .workspace-shell textarea'));
  assert.ok(appStyles.includes(':root[data-theme="dark"] .workspace-shell select'));
  assert.ok(appStyles.includes(':not([type="checkbox"])'));
  assert.ok(appStyles.includes(':not([type="radio"])'));
  assert.ok(appStyles.includes(':not([type="range"])'));
  assert.ok(appStyles.includes(':not([type="color"])'));
  assert.ok(appStyles.includes(':not([type="file"])'));
  assert.ok(appStyles.includes('background: var(--px-field-surface)'));
  assert.ok(appStyles.includes('background: var(--px-field-surface-focus)'));
});

test("Studio authorized navigation uses the muted dark control palette", () => {
  const darkAppRule = studioStyles.match(
    /:root\[data-theme="dark"\] \.studio-section-nav \.studio-section-nav-app \{([^}]+)\}/
  );
  assert.ok(darkAppRule);
  assert.ok(darkAppRule[1].includes("background: #1b2e48"));
  assert.equal(darkAppRule[1].includes("background: #d8f6f1"), false);
});
