import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AVATAR_TONES, initialsOf, toneForSeed } from "../src/components/avatarModel";

describe("initialsOf", () => {
  it("takes the first and the last word of a name", () => {
    assert.equal(initialsOf("Max Müller"), "MM");
    assert.equal(initialsOf("Anna Maria Berg"), "AB");
    assert.equal(initialsOf("Dr. Anna-Lena von Berg"), "AB");
    assert.equal(initialsOf("max"), "M");
  });

  it("works from an address when there is no name", () => {
    assert.equal(initialsOf("max@example.com"), "M");
    assert.equal(initialsOf("anna.berg@example.com"), "AB");
    assert.equal(initialsOf("Paul <paul@x.de>"), "P");
  });

  it("copes with letters outside ASCII and with nothing at all", () => {
    assert.equal(initialsOf("élodie Çelik"), "ÉÇ");
    assert.equal(initialsOf("Łukasz"), "Ł");
    assert.equal(initialsOf(""), "?");
    assert.equal(initialsOf("123 456"), "?");
  });
});

describe("toneForSeed", () => {
  it("gives the same person the same colour every time, whatever the case", () => {
    assert.equal(toneForSeed("Max Müller"), toneForSeed("max müller"));
    assert.equal(toneForSeed("anna@x.de"), toneForSeed("anna@x.de"));
  });

  it("only uses tones people can have, and uses several of them", () => {
    const seen = new Set<string>();
    for (const name of ["Max", "Anna", "Tom", "Lea", "Jan", "Eva", "Paul", "Nora", "Ben", "Mia", "Karl", "Ida"]) {
      const t = toneForSeed(name);
      assert.ok(AVATAR_TONES.includes(t), t);
      seen.add(t);
    }
    assert.ok(seen.size >= 3, `only ${seen.size} different tones`);
  });
});
