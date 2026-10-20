import test from "node:test";
import assert from "node:assert/strict";
import { LocalEditQueue } from "../lib/local-edit-queue.ts";

function harness(initial = { generation: 0, items: [] }) {
  const storage = { value: initial };
  const shown = [];
  let blockWrites;
  const queue = new LocalEditQueue(initial, {
    async write(value, expectedGeneration) {
      if (blockWrites) await blockWrites;
      if (storage.value.generation !== expectedGeneration) throw new Error("Local data changed in another tab.");
      storage.value = value;
    },
    show(value, source) { shown.push({ items: value.items, source }); }
  });
  return { queue, storage, shown, block() { let release; blockWrites = new Promise(resolve => { release = resolve; }); return () => { blockWrites = undefined; release(); }; } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const add = item => base => ({ ...base, generation: base.generation + 1, items: [...base.items, item] });

test("edits show immediately and commit in order", async () => {
  const { queue, storage, shown } = harness();
  const first = queue.edit(add("a"));
  const second = queue.edit(add("b"));
  assert.deepEqual(queue.current.items, ["a", "b"]);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(storage.value, { generation: 2, items: ["a", "b"] });
  assert.deepEqual(shown.map(item => item.items), [["a"], ["a", "b"]]);
});

test("an edit made while sync commits remote state is replayed on it instead of failing or overwriting it", async () => {
  const { queue, storage, shown } = harness();
  let finishPull;
  const pulled = queue.run(adopt => new Promise(resolve => { finishPull = () => {
    storage.value = { generation: 1, items: ["remote"] };
    adopt(storage.value);
    resolve();
  }; }));
  await tick();
  // The user edits while the pull is still applying; the optimistic view does not have the remote item yet.
  const edit = queue.edit(add("local"));
  assert.deepEqual(queue.current.items, ["local"]);
  finishPull();
  await pulled;
  assert.equal(await edit, true);
  assert.deepEqual(storage.value, { generation: 2, items: ["remote", "local"] });
  assert.deepEqual(queue.current.items, ["remote", "local"]);
  // The remote state is not shown on its own while the edit is queued, so the local edit never flickers away.
  assert.deepEqual(shown.map(item => item.items), [["local"], ["remote", "local"]]);
});

test("synced state shows directly when no local edits are waiting", async () => {
  const { queue, storage, shown } = harness();
  await queue.run(async adopt => { storage.value = { generation: 1, items: ["remote"] }; adopt(storage.value); });
  assert.deepEqual(queue.current.items, ["remote"]);
  assert.deepEqual(shown, [{ items: ["remote"], source: "sync" }]);
  assert.equal(await queue.edit(add("local")), true);
  assert.deepEqual(storage.value.items, ["remote", "local"]);
});

test("an edit that becomes a no-op on newer state commits nothing and shows the newer state", async () => {
  const { queue, storage } = harness({ generation: 0, items: ["x"] });
  const removeX = base => base.items.includes("x") ? { ...base, generation: base.generation + 1, items: base.items.filter(item => item !== "x") } : base;
  let finish;
  const pulled = queue.run(adopt => new Promise(resolve => { finish = () => { storage.value = { generation: 1, items: [] }; adopt(storage.value); resolve(); }; }));
  await tick();
  const edit = queue.edit(removeX);
  finish();
  await pulled;
  assert.equal(await edit, false);
  assert.deepEqual(storage.value, { generation: 1, items: [] });
  assert.deepEqual(queue.current, storage.value);
});

test("a later queued edit keeps its own optimistic view until it commits", async () => {
  const { queue, storage, shown, block } = harness();
  const release = block();
  const first = queue.edit(add("a"));
  const second = queue.edit(add("b"));
  release();
  await Promise.all([first, second]);
  assert.deepEqual(storage.value.items, ["a", "b"]);
  assert.ok(shown.every(item => item.source === "edit"));
  assert.deepEqual(queue.current.items, ["a", "b"]);
});

test("a rejected write rejects its edit without blocking queued sync work", async () => {
  const queue = new LocalEditQueue({ generation: 0 }, { write: async () => { throw new Error("disk full"); }, show() {} });
  await assert.rejects(queue.edit(base => ({ generation: base.generation + 1 })), /disk full/);
  assert.equal(await queue.run(async () => "pulled"), "pulled");
  assert.equal(queue.edit(base => base), undefined);
});
