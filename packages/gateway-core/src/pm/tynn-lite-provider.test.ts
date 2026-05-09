import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateTynnLiteStorage, TynnLitePmProvider } from "./tynn-lite-provider.js";

let projectRoot: string;
let provider: TynnLitePmProvider;

beforeEach(() => {
  projectRoot = join(tmpdir(), `tynn-lite-${String(Date.now())}-${String(Math.random()).slice(2)}`);
  mkdirSync(projectRoot, { recursive: true });
  provider = new TynnLitePmProvider({ projectRoot, projectName: "test-project" });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("TynnLitePmProvider — file layout + auto-create", () => {
  it("does not create .tynn-lite/ at construction time (lazy)", () => {
    expect(existsSync(join(projectRoot, ".tynn-lite"))).toBe(false);
  });

  it("auto-creates .tynn-lite/ on first write (createTask)", async () => {
    await provider.createTask({ storyId: "", title: "First task", description: "" });
    expect(existsSync(join(projectRoot, ".tynn-lite"))).toBe(true);
    expect(existsSync(join(projectRoot, ".tynn-lite", "tasks.jsonl"))).toBe(true);
  });

  it("auto-creates .tynn-lite/ on first state write", () => {
    provider.setState({ activeFocus: "story-1" });
    expect(existsSync(join(projectRoot, ".tynn-lite", "state.json"))).toBe(true);
  });
});

describe("TynnLitePmProvider — createTask + getTask round-trip", () => {
  it("creates a task with backlog status and a ULID-shaped id", async () => {
    const task = await provider.createTask({ storyId: "", title: "Probe", description: "Test" });
    expect(task.title).toBe("Probe");
    expect(task.description).toBe("Test");
    expect(task.status).toBe("backlog");
    expect(task.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("getTask retrieves a created task by id", async () => {
    const created = await provider.createTask({ storyId: "", title: "Probe", description: "" });
    const retrieved = await provider.getTask(created.id);
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.title).toBe("Probe");
  });

  it("getTask retrieves by number (1-indexed)", async () => {
    await provider.createTask({ storyId: "", title: "First", description: "" });
    const second = await provider.createTask({ storyId: "", title: "Second", description: "" });
    const retrieved = await provider.getTask(2);
    expect(retrieved?.id).toBe(second.id);
    expect(retrieved?.title).toBe("Second");
  });

  it("getTask returns null for unknown id", async () => {
    expect(await provider.getTask("01XXXXXXXXXXXXXXXXXXXXXXX9")).toBeNull();
  });

  it("createTask survives provider restart (round-trip via fresh instance)", async () => {
    const task = await provider.createTask({ storyId: "", title: "Persists", description: "" });
    const fresh = new TynnLitePmProvider({ projectRoot, projectName: "test-project" });
    const retrieved = await fresh.getTask(task.id);
    expect(retrieved?.id).toBe(task.id);
    expect(retrieved?.title).toBe("Persists");
  });
});

describe("TynnLitePmProvider — setTaskStatus + jsonl append-only semantics", () => {
  it("setTaskStatus folds last-write-wins through the jsonl", async () => {
    const task = await provider.createTask({ storyId: "", title: "Stateful", description: "" });
    await provider.setTaskStatus(task.id, "doing");
    await provider.setTaskStatus(task.id, "testing");
    const retrieved = await provider.getTask(task.id);
    expect(retrieved?.status).toBe("testing");
  });

  it("setTaskStatus stamps startedAt on first transition to doing", async () => {
    const task = await provider.createTask({ storyId: "", title: "T", description: "" });
    await provider.setTaskStatus(task.id, "doing");
    const folded = readFileSync(join(projectRoot, ".tynn-lite", "tasks.jsonl"), "utf-8");
    const lastLine = folded.trim().split("\n").pop()!;
    const parsed = JSON.parse(lastLine) as { status: string; startedAt: string | null };
    expect(parsed.status).toBe("doing");
    expect(parsed.startedAt).not.toBeNull();
  });

  it("setTaskStatus stamps finishedAt on transition to finished", async () => {
    const task = await provider.createTask({ storyId: "", title: "T", description: "" });
    await provider.setTaskStatus(task.id, "doing");
    await provider.setTaskStatus(task.id, "testing");
    await provider.setTaskStatus(task.id, "finished");
    const folded = readFileSync(join(projectRoot, ".tynn-lite", "tasks.jsonl"), "utf-8");
    const lastLine = folded.trim().split("\n").pop()!;
    const parsed = JSON.parse(lastLine) as { status: string; finishedAt: string | null };
    expect(parsed.status).toBe("finished");
    expect(parsed.finishedAt).not.toBeNull();
  });

  it("jsonl is genuinely append-only (each transition produces a new line)", async () => {
    const task = await provider.createTask({ storyId: "", title: "T", description: "" });
    await provider.setTaskStatus(task.id, "doing");
    await provider.setTaskStatus(task.id, "testing");
    const lines = readFileSync(join(projectRoot, ".tynn-lite", "tasks.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines.length).toBe(3);
  });

  it("setTaskStatus throws when the task id is unknown", async () => {
    await expect(provider.setTaskStatus("nonexistent", "doing")).rejects.toThrow(/unknown task/);
  });

  it("startedAt is preserved across subsequent transitions (only stamped once)", async () => {
    const task = await provider.createTask({ storyId: "", title: "T", description: "" });
    await provider.setTaskStatus(task.id, "doing");
    const firstStartedAt = JSON.parse(readFileSync(join(projectRoot, ".tynn-lite", "tasks.jsonl"), "utf-8").trim().split("\n").pop()!).startedAt as string;
    await new Promise((r) => setTimeout(r, 5));
    await provider.setTaskStatus(task.id, "testing");
    const laterStartedAt = JSON.parse(readFileSync(join(projectRoot, ".tynn-lite", "tasks.jsonl"), "utf-8").trim().split("\n").pop()!).startedAt as string;
    expect(laterStartedAt).toBe(firstStartedAt);
  });
});

describe("TynnLitePmProvider — getNext + findTasks + filtering", () => {
  it("getNext returns all non-archived tasks", async () => {
    await provider.createTask({ storyId: "", title: "A", description: "" });
    await provider.createTask({ storyId: "", title: "B", description: "" });
    const next = await provider.getNext();
    expect(next.tasks).toHaveLength(2);
    expect(next.version).toBeNull();
    expect(next.topStory).toBeNull();
  });

  it("getNext omits archived tasks", async () => {
    const t1 = await provider.createTask({ storyId: "", title: "A", description: "" });
    await provider.createTask({ storyId: "", title: "B", description: "" });
    await provider.setTaskStatus(t1.id, "archived");
    const next = await provider.getNext();
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0]?.title).toBe("B");
  });

  it("findTasks filters by status", async () => {
    const t1 = await provider.createTask({ storyId: "", title: "A", description: "" });
    await provider.createTask({ storyId: "", title: "B", description: "" });
    await provider.setTaskStatus(t1.id, "doing");
    const doingOnly = await provider.findTasks({ status: "doing" });
    expect(doingOnly).toHaveLength(1);
    expect(doingOnly[0]?.title).toBe("A");
  });

  it("findTasks filters by storyId (parentId)", async () => {
    await provider.createTask({ storyId: "story-1", title: "A", description: "" });
    await provider.createTask({ storyId: "story-2", title: "B", description: "" });
    const story1Tasks = await provider.findTasks({ storyId: "story-1" });
    expect(story1Tasks).toHaveLength(1);
    expect(story1Tasks[0]?.title).toBe("A");
  });

  it("findTasks respects limit", async () => {
    for (let i = 0; i < 5; i += 1) {
      await provider.createTask({ storyId: "", title: `T${String(i)}`, description: "" });
    }
    const limited = await provider.findTasks({ limit: 2 });
    expect(limited).toHaveLength(2);
  });
});

describe("TynnLitePmProvider — state.json round-trip + restart survival", () => {
  it("getState returns EMPTY_STATE when state.json is missing", () => {
    const state = provider.getState();
    expect(state).toEqual({ activeFocus: null, nextPick: null, lastIterationCommit: null });
  });

  it("setState writes atomically and getState reads back", () => {
    provider.setState({ activeFocus: "story-7", nextPick: "task-42" });
    expect(provider.getState()).toEqual({
      activeFocus: "story-7",
      nextPick: "task-42",
      lastIterationCommit: null,
    });
  });

  it("setState preserves unspecified fields", () => {
    provider.setState({ activeFocus: "story-7" });
    provider.setState({ nextPick: "task-42" });
    expect(provider.getState()).toEqual({
      activeFocus: "story-7",
      nextPick: "task-42",
      lastIterationCommit: null,
    });
  });

  it("state.json survives provider restart", () => {
    provider.setState({ activeFocus: "story-7", lastIterationCommit: "abc1234" });
    const fresh = new TynnLitePmProvider({ projectRoot, projectName: "test-project" });
    expect(fresh.getState()).toEqual({
      activeFocus: "story-7",
      nextPick: null,
      lastIterationCommit: "abc1234",
    });
  });

  it("setState writes via .tmp + rename (atomic — never leaves a partial state.json)", () => {
    provider.setState({ activeFocus: "story-7" });
    expect(existsSync(join(projectRoot, ".tynn-lite", "state.json.tmp"))).toBe(false);
    expect(existsSync(join(projectRoot, ".tynn-lite", "state.json"))).toBe(true);
  });

  it("getState returns EMPTY_STATE on malformed state.json (no throw)", () => {
    mkdirSync(join(projectRoot, ".tynn-lite"), { recursive: true });
    const malformedPath = join(projectRoot, ".tynn-lite", "state.json");
    writeFileSync(malformedPath, "{ this is not valid JSON", "utf-8");
    expect(provider.getState()).toEqual({ activeFocus: null, nextPick: null, lastIterationCommit: null });
  });
});

describe("TynnLitePmProvider — providerId + getProject", () => {
  it("providerId is 'tynn-lite' (matches PmProvider contract)", () => {
    expect(provider.providerId).toBe("tynn-lite");
  });

  it("getProject returns the configured projectName", async () => {
    const project = await provider.getProject();
    expect(project.name).toBe("test-project");
  });

  it("getProject defaults projectName to the project root basename when omitted", async () => {
    const fresh = new TynnLitePmProvider({ projectRoot });
    const project = await fresh.getProject();
    expect(project.name).toBe(projectRoot.split("/").pop());
  });
});

describe("TynnLitePmProvider — comments (cycle 46)", () => {
  it("getComments returns empty array when no comments persisted", async () => {
    expect(await provider.getComments("task", "any-id")).toEqual([]);
  });

  it("addComment writes to comments.jsonl and getComments reads back", async () => {
    const task = await provider.createTask({ storyId: "", title: "T", description: "" });
    const c1 = await provider.addComment("task", task.id, "first comment");
    const c2 = await provider.addComment("task", task.id, "second comment");

    const list = await provider.getComments("task", task.id);
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe(c1.id);
    expect(list[0]?.body).toBe("first comment");
    expect(list[1]?.id).toBe(c2.id);
    expect(list[1]?.body).toBe("second comment");
  });

  it("getComments filters by entityType + entityId (no cross-bleed)", async () => {
    const t1 = await provider.createTask({ storyId: "", title: "T1", description: "" });
    const t2 = await provider.createTask({ storyId: "", title: "T2", description: "" });
    await provider.addComment("task", t1.id, "for t1");
    await provider.addComment("task", t2.id, "for t2");

    const t1Comments = await provider.getComments("task", t1.id);
    expect(t1Comments).toHaveLength(1);
    expect(t1Comments[0]?.body).toBe("for t1");
  });

  it("comments survive provider restart (round-trip via fresh instance)", async () => {
    const task = await provider.createTask({ storyId: "", title: "T", description: "" });
    await provider.addComment("task", task.id, "persistent");

    const fresh = new TynnLitePmProvider({ projectRoot, projectName: "test-project" });
    const list = await fresh.getComments("task", task.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.body).toBe("persistent");
  });

  it("comments.jsonl is genuinely append-only (each addComment is one new line)", async () => {
    const task = await provider.createTask({ storyId: "", title: "T", description: "" });
    await provider.addComment("task", task.id, "a");
    await provider.addComment("task", task.id, "b");
    await provider.addComment("task", task.id, "c");

    const lines = readFileSync(join(projectRoot, ".tynn-lite", "comments.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(3);
  });
});

describe("TynnLitePmProvider — updateTask (cycle 46)", () => {
  it("updateTask appends a new snapshot with the patched fields", async () => {
    const task = await provider.createTask({ storyId: "", title: "Original", description: "Old" });
    const updated = await provider.updateTask(task.id, { title: "Renamed", description: "New" });

    expect(updated.id).toBe(task.id);
    expect(updated.title).toBe("Renamed");
    expect(updated.description).toBe("New");
  });

  it("updateTask preserves unspecified fields", async () => {
    const task = await provider.createTask({
      storyId: "",
      title: "T",
      description: "Desc",
      codeArea: "src/foo.ts",
    });
    const updated = await provider.updateTask(task.id, { title: "Renamed" });

    expect(updated.title).toBe("Renamed");
    expect(updated.description).toBe("Desc");
    expect(updated.codeArea).toBe("src/foo.ts");
  });

  it("updateTask preserves status (does not reset to backlog)", async () => {
    const task = await provider.createTask({ storyId: "", title: "T", description: "" });
    await provider.setTaskStatus(task.id, "doing");
    const updated = await provider.updateTask(task.id, { title: "Renamed" });

    expect(updated.status).toBe("doing");
  });

  it("updateTask throws when the task id is unknown", async () => {
    await expect(provider.updateTask("nonexistent", { title: "x" })).rejects.toThrow(/unknown task/);
  });

  it("updateTask appends to the same tasks.jsonl (one extra line per update)", async () => {
    const task = await provider.createTask({ storyId: "", title: "T", description: "" });
    await provider.updateTask(task.id, { title: "T2" });
    await provider.updateTask(task.id, { title: "T3" });

    const lines = readFileSync(join(projectRoot, ".tynn-lite", "tasks.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(3); // create + 2 updates
  });
});

describe("TynnLitePmProvider — iWish (cycle 46)", () => {
  it("iWish writes to wishes.jsonl and returns {id, title}", async () => {
    const wish = await provider.iWish({
      title: "Add dark mode",
      had: "system theme detection",
      priority: "normal",
    });

    expect(wish.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(wish.title).toBe("Add dark mode");
    expect(existsSync(join(projectRoot, ".tynn-lite", "wishes.jsonl"))).toBe(true);
  });

  it("listWishes returns most-recent-first across restart", async () => {
    await provider.iWish({ title: "First wish" });
    await provider.iWish({ title: "Second wish" });

    const fresh = new TynnLitePmProvider({ projectRoot, projectName: "test-project" });
    const list = fresh.listWishes();
    expect(list).toHaveLength(2);
    expect(list[0]?.title).toBe("Second wish");
    expect(list[1]?.title).toBe("First wish");
  });

  it("iWish persists all PmIWishInput fields", async () => {
    await provider.iWish({
      title: "Bug",
      didnt: "rendered correctly",
      when: "on Safari iOS",
      priority: "high",
    });
    const list = provider.listWishes();
    expect(list[0]).toMatchObject({
      title: "Bug",
      didnt: "rendered correctly",
      when: "on Safari iOS",
      priority: "high",
    });
  });
});

describe("TynnLitePmProvider — methods still stubbed (cycle 47+ scope)", () => {
  it("getStory still returns null (no story concept in tynn-lite yet)", async () => {
    expect(await provider.getStory("any-id")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// s155 t670 — pluggable storage dir + migration helper
// ---------------------------------------------------------------------------

describe("TynnLitePmProvider — pluggable storageDir (s155 t670)", () => {
  let testRoot: string;
  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "tlp-storage-"));
  });
  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("defaults to <projectRoot>/.tynn-lite/ when storageDir is omitted", () => {
    const p = new TynnLitePmProvider({ projectRoot: testRoot });
    expect(p.storageDir).toBe(join(testRoot, ".tynn-lite"));
  });

  it("relative storageDir joins with projectRoot (e.g. 'k/pm')", () => {
    const p = new TynnLitePmProvider({ projectRoot: testRoot, storageDir: "k/pm" });
    expect(p.storageDir).toBe(join(testRoot, "k", "pm"));
  });

  it("absolute storageDir lands as-is, ignoring projectRoot", () => {
    const abs = join(testRoot, "elsewhere", "pm");
    const p = new TynnLitePmProvider({ projectRoot: testRoot, storageDir: abs });
    expect(p.storageDir).toBe(abs);
  });

  it("create+findTasks roundtrip works with the k/pm/ storage layout", async () => {
    const p = new TynnLitePmProvider({ projectRoot: testRoot, storageDir: "k/pm" });
    await p.createTask({ storyId: "s1", title: "Sample", description: "" });
    const tasks = await p.findTasks();
    expect(tasks.map((t) => t.title)).toEqual(["Sample"]);
    expect(existsSync(join(testRoot, "k", "pm", "tasks.jsonl"))).toBe(true);
    expect(existsSync(join(testRoot, ".tynn-lite", "tasks.jsonl"))).toBe(false);
  });
});

describe("migrateTynnLiteStorage (s155 t670)", () => {
  let testRoot: string;
  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "tlp-mig-"));
  });
  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("copies all four canonical files when present in legacy", () => {
    const legacy = join(testRoot, ".tynn-lite");
    const canonical = join(testRoot, "k", "pm");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "tasks.jsonl"), `{"id":"t1"}\n`, "utf-8");
    writeFileSync(join(legacy, "comments.jsonl"), `{"id":"c1"}\n`, "utf-8");
    writeFileSync(join(legacy, "wishes.jsonl"), `{"id":"w1"}\n`, "utf-8");
    writeFileSync(join(legacy, "state.json"), `{"activeFocus":null}\n`, "utf-8");

    const r = migrateTynnLiteStorage(legacy, canonical);
    expect(r.migrated).toBe(true);
    expect(r.skipped).toBe(false);
    expect(new Set(r.copied)).toEqual(new Set(["tasks.jsonl", "comments.jsonl", "wishes.jsonl", "state.json"]));
    expect(existsSync(join(canonical, "tasks.jsonl"))).toBe(true);
    expect(existsSync(join(canonical, "state.json"))).toBe(true);
    // Legacy preserved as backup
    expect(existsSync(join(legacy, "tasks.jsonl"))).toBe(true);
  });

  it("is a no-op when legacy dir is absent", () => {
    const r = migrateTynnLiteStorage(join(testRoot, "missing"), join(testRoot, "k", "pm"));
    expect(r).toEqual({ migrated: false, skipped: false, copied: [], errors: [] });
  });

  it("skips when canonical already contains any TynnLite file (no clobber)", () => {
    const legacy = join(testRoot, ".tynn-lite");
    const canonical = join(testRoot, "k", "pm");
    mkdirSync(legacy, { recursive: true });
    mkdirSync(canonical, { recursive: true });
    writeFileSync(join(legacy, "tasks.jsonl"), `{"id":"legacy"}\n`, "utf-8");
    writeFileSync(join(canonical, "tasks.jsonl"), `{"id":"already-here"}\n`, "utf-8");

    const r = migrateTynnLiteStorage(legacy, canonical);
    expect(r.migrated).toBe(false);
    expect(r.skipped).toBe(true);
    expect(r.copied).toEqual([]);
    expect(readFileSync(join(canonical, "tasks.jsonl"), "utf-8")).toContain("already-here");
  });

  it("copies only files that exist in legacy (skips absent)", () => {
    const legacy = join(testRoot, ".tynn-lite");
    const canonical = join(testRoot, "k", "pm");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "tasks.jsonl"), `{"id":"t1"}\n`, "utf-8");
    const r = migrateTynnLiteStorage(legacy, canonical);
    expect(r.migrated).toBe(true);
    expect(r.copied).toEqual(["tasks.jsonl"]);
  });

  it("a TynnLitePmProvider can read the migrated state seamlessly", async () => {
    const projectRoot = testRoot;
    const legacy = join(projectRoot, ".tynn-lite");
    const canonical = join(projectRoot, "k", "pm");

    const legacyProvider = new TynnLitePmProvider({ projectRoot });
    await legacyProvider.createTask({ storyId: "s1", title: "From legacy", description: "" });
    expect(existsSync(join(legacy, "tasks.jsonl"))).toBe(true);

    const r = migrateTynnLiteStorage(legacy, canonical);
    expect(r.migrated).toBe(true);

    const newProvider = new TynnLitePmProvider({ projectRoot, storageDir: "k/pm" });
    const tasks = await newProvider.findTasks();
    expect(tasks.map((t) => t.title)).toEqual(["From legacy"]);
  });
});
