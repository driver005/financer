import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Template } from "../src/api/types";
import { peopleText, personName, recipientStrings, sendProblem, oldestFirst } from "../src/logic/compose";
import { audienceText, BLANK_TEMPLATE, choiceKey, choiceLabel, exampleText, firstLine, parseAudience, templatesOf } from "../src/logic/templates";

const t = (id: number, kind: "greeting" | "closing", name: string): Template => ({ id, kind, name, text: "x", fallback: null, audience: [], is_default: false });

describe("templates", () => {
  it("shows a template with an example person and sender", () => {
    assert.equal(exampleText("Lieber {first_name},"), "Lieber Max,");
    assert.equal(exampleText("VG\n{my_first_name}"), "VG\nPaul");
    assert.equal(exampleText("Mit freundlichen Grüßen\n{me}"), "Mit freundlichen Grüßen\nPaul Meier");
    assert.equal(exampleText("Hallo {vorname}"), "Hallo {vorname}", "an unknown placeholder is left as it is");
  });

  it("reads and writes the audience", () => {
    assert.deepEqual(parseAudience("Max@X.de, @firma.de;  max@x.de\n@firma.de"), ["max@x.de", "@firma.de"]);
    assert.deepEqual(parseAudience(""), []);
    assert.equal(audienceText([]), "Anyone");
    assert.equal(audienceText(["a@b.de", "@c.de"]), "a@b.de, @c.de");
  });

  it("describes a choice in words", () => {
    const all = [t(1, "greeting", "Friendly"), t(2, "closing", "Short")];
    assert.equal(choiceLabel("auto", all), "Automatic");
    assert.equal(choiceLabel("none", all), "None");
    assert.equal(choiceLabel({ id: 2 }, all), "Short");
    assert.equal(choiceLabel({ id: 9 }, all), "Chosen template");
    assert.deepEqual(["auto", "none", { id: 3 }].map((c) => choiceKey(c as never)), ["auto", "none", "id:3"]);
  });

  it("filters by kind and shortens to the first line", () => {
    assert.deepEqual(templatesOf([t(1, "greeting", "a"), t(2, "closing", "b")], "closing").map((x) => x.id), [2]);
    assert.equal(firstLine("VG\nPaul"), "VG");
    assert.equal(firstLine(""), "");
  });

  it("starts a new template from a sensible example", () => {
    assert.match(BLANK_TEMPLATE.greeting.text, /\{first_name\}/);
    assert.equal(BLANK_TEMPLATE.closing.kind, "closing");
  });
});

describe("compose rules", () => {
  it("names people", () => {
    assert.equal(personName({ name: "Max Müller", email: "m@x.de" }), "Max Müller");
    assert.equal(personName({ name: null, email: "m@x.de" }), "m@x.de");
    assert.equal(peopleText([{ name: "Max", email: "a@x.de" }, { name: "Anna", email: "b@x.de" }, { name: null, email: "c@x.de" }]), "Max, Anna & c@x.de");
    assert.equal(peopleText([]), "");
  });

  it("gives recipients to the server with their names", () => {
    assert.deepEqual(recipientStrings([{ name: "Max Müller", email: "m@x.de" }, { name: "Meier, Paul", email: "p@x.de" }, { name: null, email: "a@x.de" }]), ["Max Müller <m@x.de>", '"Meier, Paul" <p@x.de>', "a@x.de"]);
  });

  it("says what is missing before a message can go", () => {
    assert.equal(sendProblem({ to: "", body: "x", subject: "s", isReply: false }), "Add who it goes to.");
    assert.equal(sendProblem({ to: "a@x.de", body: "  ", subject: "s", isReply: false }), "Write something first.");
    assert.equal(sendProblem({ to: "a@x.de", body: "x", subject: " ", isReply: false }), "A new topic needs a subject.");
    assert.equal(sendProblem({ to: "a@x.de", body: "x", subject: "", isReply: true }), null, "a reply takes the topic's subject");
    assert.equal(sendProblem({ to: "a@x.de", body: "x", subject: "s", isReply: false }), null);
  });

  it("reads a chat oldest first", () => {
    assert.deepEqual(oldestFirst([{ at: 3 }, { at: 1 }, { at: 2 }]).map((m) => m.at), [1, 2, 3]);
  });
});
