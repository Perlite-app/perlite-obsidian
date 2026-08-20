import { describe, expect, test } from "vitest";
import { clockTimeToISOString, isValidClockTime, parseClockTime } from "../../../src/model/ClockTime.js";

describe("parseClockTime", () => {
  test("parses a well-formed time", () => {
    expect(parseClockTime("20:15")).toEqual({ hour: 20, minute: 15 });
  });

  test("rejects wrong segment lengths", () => {
    expect(parseClockTime("2:15")).toBeNull();
    expect(parseClockTime("20:5")).toBeNull();
  });

  test("does not validate range — that's isValidClockTime's job", () => {
    expect(parseClockTime("25:99")).toEqual({ hour: 25, minute: 99 });
  });

  test("rejects non-digit segments", () => {
    expect(parseClockTime("aa:15")).toBeNull();
  });
});

describe("isValidClockTime", () => {
  test("accepts boundary values", () => {
    expect(isValidClockTime({ hour: 0, minute: 0 })).toBe(true);
    expect(isValidClockTime({ hour: 23, minute: 59 })).toBe(true);
  });

  test("rejects out-of-range hour and minute", () => {
    expect(isValidClockTime({ hour: 24, minute: 0 })).toBe(false);
    expect(isValidClockTime({ hour: 0, minute: 60 })).toBe(false);
  });
});

describe("clockTimeToISOString", () => {
  test("zero-pads", () => {
    expect(clockTimeToISOString({ hour: 8, minute: 5 })).toBe("08:05");
  });
});
