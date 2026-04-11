import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ManagedDatabase = {
  url: string;
  cleanup: () => void;
};

function commandExists(command: string): boolean {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function ensureTestDatabase(): ManagedDatabase {
  if (process.env.DATABASE_URL) {
    return {
      url: process.env.DATABASE_URL,
      cleanup: () => undefined,
    };
  }

  const required = ["initdb", "pg_ctl", "createdb", "pg_isready"];
  for (const binary of required) {
    if (!commandExists(binary)) {
      throw new Error(`Missing required postgres binary for tests: ${binary}`);
    }
  }

  const baseDir = mkdtempSync(join(tmpdir(), "points-accelerator-pg-"));
  const dataDir = join(baseDir, "data");
  const socketDir = join(baseDir, "socket");
  const logFile = join(baseDir, "postgres.log");
  const port = String(55432 + Math.floor(Math.random() * 1000));

  mkdirSync(socketDir, { recursive: true });

  execFileSync("initdb", ["-A", "trust", "-U", "postgres", "-D", dataDir], {
    env: { ...process.env, LC_ALL: "C" },
    stdio: "ignore",
  });
  execFileSync("pg_ctl", ["-D", dataDir, "-l", logFile, "-o", `-F -p ${port}`, "start"], {
    stdio: "ignore",
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      execFileSync("pg_isready", ["-h", "127.0.0.1", "-p", port, "-U", "postgres"], { stdio: "ignore" });
      break;
    } catch (error) {
      if (attempt === 19) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }

  execFileSync("createdb", ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "points_accelerator_test"], {
    stdio: "ignore",
  });

  const url = `postgresql://postgres@127.0.0.1:${port}/points_accelerator_test?schema=public`;
  process.env.DATABASE_URL = url;

  execFileSync(
    join(process.cwd(), "../../node_modules/.bin/prisma"),
    ["migrate", "deploy", "--schema", "prisma/schema.prisma"],
    {
      cwd: join(process.cwd()),
      env: {
        ...process.env,
        DATABASE_URL: url,
      },
      stdio: "ignore",
    },
  );

  return {
    url,
    cleanup: () => {
      try {
        execFileSync("pg_ctl", ["-D", dataDir, "stop", "-m", "immediate"], { stdio: "ignore" });
      } finally {
        if (existsSync(baseDir)) {
          rmSync(baseDir, { recursive: true, force: true });
        }
      }
    },
  };
}
