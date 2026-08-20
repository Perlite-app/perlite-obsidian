import { describe, expect, test } from "vitest";
import { parseReminderValue, reminderValueCalendarDate, reminderValueClockTime, reminderValueRawText } from "../../../src/model/ReminderValue.js";

describe("parseReminderValue", () => {
  test("a bare date with no time is valid, time null", () => {
    const value = parseReminderValue("2026-08-19");
    expect(value).toEqual({ kind: "valid", date: { year: 2026, month: 8, day: 19 }, time: null });
  });

  test("a date and time joined by a space is valid", () => {
    const value = parseReminderValue("2026-08-19 20:15");
    expect(value).toEqual({
      kind: "valid",
      date: { year: 2026, month: 8, day: 19 },
      time: { hour: 20, minute: 15 },
    });
  });

  test("an invalid date is invalid, raw preserved verbatim", () => {
    expect(parseReminderValue("2026-13-45")).toEqual({ kind: "invalid", raw: "2026-13-45" });
  });

  test("a valid date with an invalid time is invalid, raw preserved verbatim", () => {
    expect(parseReminderValue("2026-08-19 25:99")).toEqual({ kind: "invalid", raw: "2026-08-19 25:99" });
  });

  test("too many space-separated parts is invalid", () => {
    expect(parseReminderValue("2026-08-19 20:15 extra")).toEqual({ kind: "invalid", raw: "2026-08-19 20:15 extra" });
  });
});

describe("reminderValueCalendarDate / reminderValueClockTime", () => {
  test("extract date and (possibly null) time from a valid value", () => {
    const withTime = parseReminderValue("2026-08-19 20:15");
    expect(reminderValueCalendarDate(withTime)).toEqual({ year: 2026, month: 8, day: 19 });
    expect(reminderValueClockTime(withTime)).toEqual({ hour: 20, minute: 15 });

    const noTime = parseReminderValue("2026-08-19");
    expect(reminderValueClockTime(noTime)).toBeNull();
  });

  test("both are null for an invalid value", () => {
    const invalid = parseReminderValue("garbage");
    expect(reminderValueCalendarDate(invalid)).toBeNull();
    expect(reminderValueClockTime(invalid)).toBeNull();
  });
});

describe("reminderValueRawText", () => {
  test("date-only formats back to just the date", () => {
    expect(reminderValueRawText(parseReminderValue("2026-08-19"))).toBe("2026-08-19");
  });

  test("date+time formats back to date and time space-joined", () => {
    expect(reminderValueRawText(parseReminderValue("2026-08-19 20:15"))).toBe("2026-08-19 20:15");
  });

  test("invalid returns the original raw text", () => {
    expect(reminderValueRawText(parseReminderValue("garbage"))).toBe("garbage");
  });
});
