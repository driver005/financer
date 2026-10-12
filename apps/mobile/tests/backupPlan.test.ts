import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  autoBackupName,
  autoBackupTime,
  autoBackupsToDelete,
  isBackupDue,
  manualBackupName,
  newestAutoBackup,
  parseBackupSettings,
  passphraseProblem,
} from "../src/backupPlan";

const H = 60 * 60 * 1000;
const DAY = 24 * H;
const at = (iso: string) => new Date(iso);

describe("isBackupDue", () => {
  const now = Date.UTC(2026, 9, 12, 12, 0, 0);
  it("is never due when off", () => {
    assert.equal(isBackupDue("off", null, now), false);
    assert.equal(isBackupDue("off", now - 100 * DAY, now), false);
  });
  it("is due when there is no backup yet", () => {
    assert.equal(isBackupDue("daily", null, now), true);
    assert.equal(isBackupDue("weekly", null, now), true);
  });
  it("daily: due after a day, not before", () => {
    assert.equal(isBackupDue("daily", now - 23 * H, now), false);
    assert.equal(isBackupDue("daily", now - 24 * H, now), true);
    assert.equal(isBackupDue("daily", now - 3 * DAY, now), true);
  });
  it("weekly: due after seven days, not before", () => {
    assert.equal(isBackupDue("weekly", now - 6 * DAY - 23 * H, now), false);
    assert.equal(isBackupDue("weekly", now - 7 * DAY, now), true);
  });
  it("a backup from the far future (wrong clock) does not block new ones", () => {
    assert.equal(isBackupDue("daily", now + 30 * DAY, now), true);
    assert.equal(isBackupDue("daily", now + 2 * H, now), false); // small skew is fine
  });
});

describe("backup file names", () => {
  it("auto names round-trip through autoBackupTime", () => {
    const d = at("2026-10-12T14:30:05Z");
    const name = autoBackupName(d);
    assert.equal(name, "financer-auto-20261012T143005Z.age");
    assert.equal(autoBackupTime(name), d.getTime());
  });
  it("only our own automatic names are recognised", () => {
    for (const n of ["financer-backup-2026-10-12.age", "financer-auto-2026.age", "notes.age", "financer-auto-20261012T143005Z.age.bak", ""]) {
      assert.equal(autoBackupTime(n), null, n);
    }
  });
  it("manual names carry the date", () => {
    assert.equal(manualBackupName(at("2026-03-02T23:59:59Z")), "financer-backup-2026-03-02.age");
  });
  it("finds the newest automatic backup and ignores other files", () => {
    const names = [
      autoBackupName(at("2026-10-01T00:00:00Z")),
      "holiday.jpg",
      autoBackupName(at("2026-10-09T08:00:00Z")),
      manualBackupName(at("2026-10-11T00:00:00Z")),
    ];
    assert.equal(newestAutoBackup(names), at("2026-10-09T08:00:00Z").getTime());
    assert.equal(newestAutoBackup(["a", "b"]), null);
    assert.equal(newestAutoBackup([]), null);
  });
});

describe("autoBackupsToDelete", () => {
  const names = ["2026-10-01", "2026-10-05", "2026-10-03", "2026-10-09", "2026-10-07"].map((d) => autoBackupName(at(`${d}T10:00:00Z`)));
  it("keeps the newest three and deletes the rest, oldest first irrelevant", () => {
    const del = autoBackupsToDelete(names, 3);
    assert.deepEqual(
      del.sort(),
      [autoBackupName(at("2026-10-01T10:00:00Z")), autoBackupName(at("2026-10-03T10:00:00Z"))].sort(),
    );
  });
  it("deletes nothing when there are at most `keep`", () => {
    assert.deepEqual(autoBackupsToDelete(names.slice(0, 3), 3), []);
    assert.deepEqual(autoBackupsToDelete([], 3), []);
  });
  it("never touches files that are not automatic backups", () => {
    const mixed = [...names, "financer-backup-2026-01-01.age", "photo.jpg"];
    const del = autoBackupsToDelete(mixed, 3);
    assert.equal(del.length, 2);
    assert.ok(!del.includes("photo.jpg") && !del.includes("financer-backup-2026-01-01.age"));
  });
  it("defaults to keeping three", () => {
    assert.equal(autoBackupsToDelete(names).length, 2);
  });
});

describe("parseBackupSettings", () => {
  it("falls back to off for missing or broken input", () => {
    for (const raw of [null, undefined, "", "{", "null", "[]", '{"schedule":"hourly"}', "42"]) {
      assert.deepEqual(parseBackupSettings(raw as string), { schedule: "off", folderUri: null }, String(raw));
    }
  });
  it("reads valid settings", () => {
    assert.deepEqual(parseBackupSettings('{"schedule":"weekly","folderUri":"content://x"}'), { schedule: "weekly", folderUri: "content://x" });
    assert.deepEqual(parseBackupSettings('{"schedule":"daily","folderUri":""}'), { schedule: "daily", folderUri: null });
  });
});

describe("passphraseProblem", () => {
  it("requires 8 characters, counting letters not bytes", () => {
    assert.ok(passphraseProblem("short"));
    assert.equal(passphraseProblem("12345678"), null);
    assert.ok(passphraseProblem("äöüäöüä")); // 7 characters, 14 bytes
  });
  it("checks the confirmation when given", () => {
    assert.ok(passphraseProblem("longenough", "different"));
    assert.equal(passphraseProblem("longenough", "longenough"), null);
  });
});
