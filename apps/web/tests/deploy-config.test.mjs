import test from "node:test";
import assert from "node:assert/strict";
import { injectBuiltD1DatabaseId, injectD1DatabaseId } from "../scripts/deploy-worker.mjs";

const placeholder = "00000000-0000-4000-8000-000000000001";
const productionId = "c1234567-89ab-4def-8123-456789abcdef";

test("D1 ID injection replaces only the deployment placeholder", () => {
  const config = `{"database_id": "${placeholder}", "other": "${placeholder}"}`;
  assert.equal(injectD1DatabaseId(config, productionId), `{"database_id": "${productionId}", "other": "${placeholder}"}`);
});

test("D1 ID injection rejects malformed IDs and missing or duplicate placeholders", () => {
  assert.throws(() => injectD1DatabaseId(`{"database_id": "${placeholder}"}`, "not-an-id"), /must be a UUID/);
  assert.throws(() => injectD1DatabaseId("{}", productionId), /exactly one/);
  assert.throws(() => injectD1DatabaseId(`{"a":"${placeholder}","b":"${placeholder}"}`, productionId), /exactly one/);
});

test("built Worker config receives the D1 ID without changing other bindings", () => {
  const input = JSON.stringify({
    d1_databases: [
      { binding: "DB", database_id: placeholder },
      { binding: "OTHER_DB", database_id: "other" }
    ]
  });
  assert.deepEqual(JSON.parse(injectBuiltD1DatabaseId(input, productionId)), {
    d1_databases: [
      { binding: "DB", database_id: productionId },
      { binding: "OTHER_DB", database_id: "other" }
    ]
  });
  assert.throws(() => injectBuiltD1DatabaseId("{}", productionId), /exactly one/);
});
