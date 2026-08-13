import test from "node:test";
import assert from "node:assert/strict";
import { resolveDirectNavigation } from "../direct-navigation";

test("direct navigation resolves conversational project requests to Idea Workshop", () => {
  assert.deepEqual(resolveDirectNavigation("Could you open up projects?"), {
    route: "/idea-workshop",
    label: "Idea Workshop",
  });
  assert.deepEqual(resolveDirectNavigation("Akira, please open up my projects."), {
    route: "/idea-workshop",
    label: "Idea Workshop",
  });
  assert.deepEqual(resolveDirectNavigation("pull up the Idea Workshop"), {
    route: "/idea-workshop",
    label: "Idea Workshop",
  });
});

test("direct navigation ignores non-navigation conversation", () => {
  assert.equal(resolveDirectNavigation("Tell me about my projects"), null);
  assert.equal(resolveDirectNavigation("Open a project named Akira"), null);
});
