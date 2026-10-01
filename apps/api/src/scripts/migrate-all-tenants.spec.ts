import { setTimeout as wait } from "node:timers/promises";

const pools = [
  { end: jest.fn().mockResolvedValue(undefined) },
  { end: jest.fn().mockResolvedValue(undefined) },
];

jest.mock("mysql2/promise", () => ({
  createPool: jest.fn()
    .mockImplementationOnce(() => pools[0])
    .mockImplementationOnce(() => pools[1]),
}));

jest.mock("drizzle-orm/mysql2", () => ({
  drizzle: jest.fn().mockReturnValue({
    select: () => ({
      from: async () => [{
        tenant_code: "BROKEN",
        db_host: "localhost",
        db_port: 3306,
        db_user: "root",
        db_password: "",
        db_name: "nf_broken",
      }],
    }),
  }),
}));

jest.mock("drizzle-orm/mysql2/migrator", () => ({
  migrate: jest.fn().mockRejectedValue(new Error("migration exploded")),
}));

describe("migrate-all-tenants process result", () => {
  const originalExitCode = process.exitCode;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeAll(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterAll(() => {
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("sets a failing exit code when any registered tenant migration fails", async () => {
    process.exitCode = undefined;
    await import("./migrate-all-tenants.js");

    for (let attempt = 0; attempt < 20 && process.exitCode === undefined; attempt += 1) {
      await wait(10);
    }

    expect(process.exitCode).toBe(1);
    expect(pools[0].end).toHaveBeenCalled();
    expect(pools[1].end).toHaveBeenCalled();
  });
});
