import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { birthdayOccurrences, daysUntilBirthday, normalizeBirthday, parseBirthday } from "../server/utils/birthdays.ts";

describe("normalizeBirthday", () => {
  const cases: [string, string | null][] = [
    ["1990-04-21", "1990-04-21"],
    ["1990-4-1", "1990-04-01"],
    ["1990-04-21T00:00:00Z", "1990-04-21"],
    ["1990/04/21", "1990-04-21"],
    ["--04-21", "--04-21"],
    ["--0421", "--04-21"],
    ["19900421", "1990-04-21"],
    ["21.04.1990", "1990-04-21"],
    ["04/21/1990", "1990-04-21"],
    ["21/04/1990", "1990-04-21"],
    ["04/05/1990", null], // ambiguous
    ["April 21, 1990", "1990-04-21"],
    ["Apr 21", "--04-21"],
    ["21st April 1990", "1990-04-21"],
    ["21 apr", "--04-21"],
    ["1604-04-21", "--04-21"], // Apple's "no year"
    ["0000-04-21", "--04-21"],
    ["1990-02-30", null],
    ["2023-02-29", null],
    ["2024-02-29", "2024-02-29"],
    ["--02-29", "--02-29"],
    ["Smarch 3", null],
    ["", null],
    ["someday", null],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => assert.equal(normalizeBirthday(input), expected));
  }
  it("handles null and undefined", () => {
    assert.equal(normalizeBirthday(null), null);
    assert.equal(normalizeBirthday(undefined), null);
  });
});

describe("parseBirthday", () => {
  it("parses both stored formats", () => {
    assert.deepEqual(parseBirthday("1990-04-21"), { year: 1990, month: 4, day: 21 });
    assert.deepEqual(parseBirthday("--04-21"), { year: null, month: 4, day: 21 });
  });
  it("rejects impossible dates", () => {
    assert.equal(parseBirthday("--13-01"), null);
    assert.equal(parseBirthday("1990-04-31"), null);
  });
});

describe("daysUntilBirthday", () => {
  const today = new Date("2026-11-20T15:00:00Z");
  it("counts today as 0", () => assert.equal(daysUntilBirthday("1990-11-20", today), 0));
  it("counts forward within the year", () => assert.equal(daysUntilBirthday("--12-01", today), 11));
  it("wraps into next year", () => assert.equal(daysUntilBirthday("--11-19", today), 364));
  it("puts Feb 29 on Feb 28 in common years", () => assert.equal(daysUntilBirthday("2000-02-29", today), 100));
});

describe("birthdayOccurrences", () => {
  const today = new Date("2026-11-20T09:00:00Z");

  it("lists past ones from `from` and ends with the next one", () => {
    assert.deepEqual(birthdayOccurrences("1990-03-05", { from: new Date("2024-06-01T00:00:00Z"), today }), [
      { date: "2025-03-05", age: 35 },
      { date: "2026-03-05", age: 36 },
      { date: "2027-03-05", age: 37 },
    ]);
  });

  it("stops at today when the birthday is today", () => {
    assert.deepEqual(birthdayOccurrences("--11-20", { from: new Date("2026-01-01T00:00:00Z"), today }), [{ date: "2026-11-20", age: null }]);
  });

  it("includes a birthday on the `from` day", () => {
    assert.deepEqual(birthdayOccurrences("--06-01", { from: new Date("2026-06-01T18:00:00Z"), today }), [
      { date: "2026-06-01", age: null },
      { date: "2027-06-01", age: null },
    ]);
  });

  it("skips years before the person was born", () => {
    assert.deepEqual(birthdayOccurrences("2026-01-10", { from: new Date("2020-01-01T00:00:00Z"), today }), [{ date: "2027-01-10", age: 1 }]);
  });

  it("uses Feb 28 for leap-day birthdays in common years", () => {
    assert.deepEqual(birthdayOccurrences("2000-02-29", { from: new Date("2027-01-01T00:00:00Z"), today: new Date("2028-01-01T00:00:00Z") }), [
      { date: "2027-02-28", age: 27 },
      { date: "2028-02-29", age: 28 },
    ]);
  });

  it("returns nothing for unparseable birthdays", () => {
    assert.deepEqual(birthdayOccurrences("nope", { from: today, today }), []);
  });
});
