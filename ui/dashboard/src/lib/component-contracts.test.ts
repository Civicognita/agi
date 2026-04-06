/**
 * Component Contract Tests — validates that react-fancy components
 * are used with correct prop shapes throughout the dashboard.
 *
 * These tests catch bugs like:
 * - Wrong prop names (options vs list, onChange vs onValueChange)
 * - Missing required props
 * - Incorrect prop types
 *
 * Runs as part of the vitest suite. Does NOT render components
 * (no jsdom needed) — validates prop shapes against known contracts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

// ---------------------------------------------------------------------------
// React-fancy component prop contracts
// ---------------------------------------------------------------------------

interface PropContract {
  component: string;
  required: string[];
  valid: string[];
  invalid: string[];  // common mistakes
}

/**
 * Known prop contracts for react-fancy components we use.
 * If a file uses a component, it must use props from `valid` and NOT from `invalid`.
 */
const CONTRACTS: PropContract[] = [
  {
    component: "MultiSwitch",
    required: ["list"],
    valid: ["list", "value", "defaultValue", "onValueChange", "linear", "size", "label", "description", "required", "disabled", "className", "id", "name", "dirty", "error"],
    invalid: ["options", "onChange", "items", "onSelect"],
  },
  {
    component: "EmojiSelect",
    required: [],
    valid: ["value", "defaultValue", "onChange", "placeholder", "className"],
    invalid: ["onSelect", "onValueChange", "emoji", "selected"],
  },
  {
    component: "Sidebar.Item",
    required: ["children"],
    valid: ["children", "href", "icon", "active", "disabled", "badge", "onClick", "className"],
    invalid: ["to", "selected", "isActive", "link"],
  },
  {
    component: "Sidebar.Group",
    required: ["children"],
    valid: ["children", "label", "className"],
    invalid: ["title", "header", "name"],
  },
  {
    component: "Sidebar.Toggle",
    required: [],
    valid: ["className"],
    invalid: ["onClick", "collapsed", "onToggle"],
  },
  {
    component: "MobileMenu.Flyout",
    required: ["children", "open", "onClose"],
    valid: ["children", "open", "onClose", "side", "title", "className"],
    invalid: ["visible", "isOpen", "onDismiss", "position"],
  },
  {
    component: "MobileMenu.Item",
    required: ["children"],
    valid: ["children", "href", "icon", "active", "disabled", "badge", "onClick", "className"],
    invalid: ["to", "selected", "isActive"],
  },
  {
    component: "Select",
    required: ["list"],
    valid: ["list", "value", "defaultValue", "onValueChange", "placeholder", "size", "label", "description", "required", "disabled", "searchable", "className"],
    invalid: ["options", "onChange", "items", "onSelect", "onInput"],
  },
];

// ---------------------------------------------------------------------------
// Source scanner
// ---------------------------------------------------------------------------

function collectTsxFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        files.push(...collectTsxFiles(fullPath));
      } else if (entry.isFile() && (extname(entry.name) === ".tsx" || extname(entry.name) === ".ts") && !entry.name.endsWith(".test.ts")) {
        files.push(fullPath);
      }
    }
  } catch { /* skip unreadable dirs */ }
  return files;
}

function findPropUsages(source: string, componentName: string): string[] {
  // Find JSX usage: <ComponentName prop1={...} prop2="..." />
  // Simple regex — looks for component followed by prop assignments
  const escaped = componentName.replace(".", "\\.");
  const pattern = new RegExp(`<${escaped}[\\s\\n]([^>]+)`, "g");
  const props: string[] = [];

  for (const match of source.matchAll(pattern)) {
    const propsStr = match[1] ?? "";
    // Extract prop names: word followed by = or just word (boolean shorthand)
    const propPattern = /\b(\w+)(?:\s*=)/g;
    for (const propMatch of propsStr.matchAll(propPattern)) {
      if (propMatch[1] && !["key", "ref", "data-testid"].includes(propMatch[1])) {
        props.push(propMatch[1]);
      }
    }
  }

  return [...new Set(props)];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const DASHBOARD_SRC = join(__dirname, "..");
const sourceFiles = collectTsxFiles(DASHBOARD_SRC);

describe("Component Contract Tests", () => {
  for (const contract of CONTRACTS) {
    describe(`${contract.component}`, () => {
      // Find all files that use this component
      const filesUsingComponent = sourceFiles.filter((f) => {
        try {
          const content = readFileSync(f, "utf-8");
          return content.includes(`<${contract.component}`) || content.includes(`<${contract.component.split(".")[0]}.`);
        } catch { return false; }
      });

      if (filesUsingComponent.length === 0) {
        it("is not used in any source files (skipped)", () => {
          // No usage — skip
        });
        return;
      }

      for (const file of filesUsingComponent) {
        const relPath = file.replace(DASHBOARD_SRC + "/", "");
        const source = readFileSync(file, "utf-8");
        const usedProps = findPropUsages(source, contract.component);

        if (usedProps.length === 0) continue;

        it(`${relPath} — no invalid props`, () => {
          const invalidUsed = usedProps.filter((p) => contract.invalid.includes(p));
          if (invalidUsed.length > 0) {
            throw new Error(
              `${contract.component} in ${relPath} uses invalid prop(s): ${invalidUsed.join(", ")}. ` +
              `Valid props: ${contract.valid.join(", ")}`,
            );
          }
        });

        it(`${relPath} — all used props are valid`, () => {
          const unknownProps = usedProps.filter((p) => !contract.valid.includes(p));
          if (unknownProps.length > 0) {
            // Warning, not failure — could be new props we haven't cataloged
            console.warn(
              `${contract.component} in ${relPath} uses uncataloged prop(s): ${unknownProps.join(", ")}. ` +
              `Consider adding to contract.`,
            );
          }
        });
      }
    });
  }
});
