import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {}, pool: {} }));

import { creditPeriodWindow } from "../trade-pilot";

// Helper: waktu WIB -> Date.
const wib = (iso: string) => new Date(`${iso}+07:00`);

describe("creditPeriodWindow (berjangkar pada pertama kali pakai)", () => {
  it("bulanan: reset di tanggal yang sama setiap bulan pukul 00:00 WIB", () => {
    const anchor = wib("2026-10-29T13:12:00");
    expect(creditPeriodWindow("monthly", anchor, wib("2026-10-29T13:15:00"))).toEqual({
      start: wib("2026-10-29T00:00:00"),
      end: wib("2026-11-29T00:00:00"),
    });
    expect(creditPeriodWindow("monthly", anchor, wib("2026-12-05T08:00:00"))).toEqual({
      start: wib("2026-11-29T00:00:00"),
      end: wib("2026-12-29T00:00:00"),
    });
  });

  it("bulanan: tanggal 31 jatuh ke akhir bulan pendek lalu kembali ke 31", () => {
    const anchor = wib("2026-01-31T10:00:00");
    expect(creditPeriodWindow("monthly", anchor, wib("2026-02-15T10:00:00"))).toEqual({
      start: wib("2026-01-31T00:00:00"),
      end: wib("2026-02-28T00:00:00"),
    });
    expect(creditPeriodWindow("monthly", anchor, wib("2026-03-10T10:00:00"))).toEqual({
      start: wib("2026-02-28T00:00:00"),
      end: wib("2026-03-31T00:00:00"),
    });
  });

  it("bulanan: tepat di batas reset masuk ke periode baru", () => {
    const anchor = wib("2026-10-29T13:12:00");
    expect(creditPeriodWindow("monthly", anchor, wib("2026-11-29T00:00:00")).start).toEqual(wib("2026-11-29T00:00:00"));
    expect(creditPeriodWindow("monthly", anchor, wib("2026-11-28T23:59:00")).end).toEqual(wib("2026-11-29T00:00:00"));
  });

  it("mingguan: setiap 7 hari sejak hari pertama pakai", () => {
    const anchor = wib("2026-10-29T13:12:00"); // Kamis
    expect(creditPeriodWindow("weekly", anchor, wib("2026-11-07T09:00:00"))).toEqual({
      start: wib("2026-11-05T00:00:00"),
      end: wib("2026-11-12T00:00:00"),
    });
  });

  it("harian: reset setiap 00:00 WIB", () => {
    expect(creditPeriodWindow("daily", wib("2026-10-01T10:00:00"), wib("2026-10-29T06:30:00"))).toEqual({
      start: wib("2026-10-29T00:00:00"),
      end: wib("2026-10-30T00:00:00"),
    });
  });
});
