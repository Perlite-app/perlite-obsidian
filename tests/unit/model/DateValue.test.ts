import { describe, expect, test } from "vitest";
import { dateValueCalendarDate, dateValueRawText, parseDateValue } from "../../../src/model/DateValue.js";

describe("parseDateValue", () => {
  test("a well-formed, valid date parses as valid", () => {
    const value = parseDateValue("2026-08-13");
    expect(value).toEqual({ kind: "valid", date: { year: 2026, month: 8, day: 13 } });
  });

  test("a shape-valid but out-of-range date is invalid, raw text preserved verbatim", () => {
    const value = parseDateValue("2026-13-45");
    expect(value).toEqual({ kind: "invalid", raw: "2026-13-45" });
  });

  test("garbage text is invalid, raw text preserved verbatim", () => {
    const value = parseDateValue("not a date");
    expect(value).toEqual({ kind: "invalid", raw: "not a date" });
  });
});

describe("dateValueCalendarDate", () => {
  test("extracts the date from valid, null for invalid", () => {
    expect(dateValueCalendarDate(parseDateValue("2026-08-13"))).toEqual({ year: 2026, month: 8, day: 13 });
    expect(dateValueCalendarDate(parseDateValue("garbage"))).toBeNull();
  });
});

describe("dateValueRawText", () => {
  test("valid formats back to ISO, invalid returns the original raw text", () => {
    expect(dateValueRawText(parseDateValue("2026-08-13"))).toBe("2026-08-13");
    expect(dateValueRawText(parseDateValue("2026-13-45"))).toBe("2026-13-45");
  });
});
