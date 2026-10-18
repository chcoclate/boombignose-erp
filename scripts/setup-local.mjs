#!/usr/bin/env node
/**
 * One-command local setup for trying the app with demo data.
 *
 *   pnpm install
 *   pnpm setup:local
 *   pnpm dev
 *
 * Starts the local Supabase stack (migrations + seed run on first start),
 * then writes `.env.local` from `.env.example` with the local keys and the
 * demo-login button enabled. Safe to re-run: existing `.env.local` values are
 * kept except the Supabase URL/keys, which are refreshed from the stack.
 * Local development only — never use the demo login on a real deployment.
 *
 * Messages are Thai by default but English on Windows, where the console font
 * mangles Thai vowel/tone marks. Override with SETUP_LANG=th or SETUP_LANG=en.
 */
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ENV_LOCAL = path.join(ROOT, ".env.local")
const ENV_EXAMPLE = path.join(ROOT, ".env.example")
const IS_WINDOWS = process.platform === "win32"

// Services the app does not need locally; skipping them makes the first
// start download far fewer Docker images.
const EXCLUDED_SERVICES = [
  "studio",
  "imgproxy",
  "vector",
  "logflare",
  "edge-runtime",
  "supavisor",
]

const DEMO_EMAIL = "demo@boombignose.org"
const DEMO_PASSWORD = "BoomDemo123!"

const MESSAGES = {
  th: {
    checking: "ตรวจเครื่อง",
    nodeTooOld: (v) => `ต้องใช้ Node.js 22 ขึ้นไป (ตอนนี้ ${v})`,
    noDeps: "ยังไม่ได้ติดตั้ง dependencies — รัน `pnpm install` ก่อน",
    noDocker: "Docker ยังไม่ทำงาน — เปิด Docker Desktop รอจนขึ้นว่า running แล้วรันใหม่",
    starting: "เปิดฐานข้อมูล Supabase (ครั้งแรกจะโหลด image นานหลายนาที)",
    startFailed:
      "supabase start ไม่สำเร็จ — ดู error ด้านบน ถ้าเป็นเรื่องโหลด image ไม่ได้ (rate limit) ให้รอสักครู่แล้วรันใหม่",
    statusFailed: "อ่านค่าจาก supabase status ไม่ได้",
    statusMissing: "supabase status ไม่มี API URL หรือ key",
    writingEnv: "เขียนไฟล์ .env.local",
    ready: "พร้อมแล้ว",
    run: "รัน",
    open: "เปิด",
    click: "กดปุ่ม",
    or: "หรือ",
    warehouse: "หน้าโกดัง 3D",
    stop: "ปิดฐานข้อมูลเมื่อเลิกใช้",
  },
  en: {
    checking: "Checking prerequisites",
    nodeTooOld: (v) => `Node.js 22 or newer is required (you have ${v})`,
    noDeps: "Dependencies are not installed — run `pnpm install` first",
    noDocker: "Docker is not running — open Docker Desktop, wait for \"Engine running\", then run this again",
    starting: "Starting Supabase (the first run downloads images and takes several minutes)",
    startFailed:
      "supabase start failed — see the error above. If an image download was rate-limited, wait a minute and run this again",
    statusFailed: "Could not read supabase status",
    statusMissing: "supabase status did not return an API URL or keys",
    writingEnv: "Writing .env.local",
    ready: "Ready",
    run: "Run",
    open: "Open",
    click: "Click",
    or: "or",
    warehouse: "3D warehouse",
    stop: "Stop the database when done",
  },
}

const LANG = ["th", "en"].includes(process.env.SETUP_LANG)
  ? process.env.SETUP_LANG
  : IS_WINDOWS
    ? "en"
    : "th"
const t = MESSAGES[LANG]

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

function run(cmd, args, { capture = false } = {}) {
  const options = {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  }
  // Windows needs a shell to resolve pnpm.cmd/docker.exe. Passing an args array
  // together with `shell: true` triggers Node's DEP0190 warning, so hand the
  // shell one command string instead (all arguments here are fixed literals).
  if (IS_WINDOWS) {
    return spawnSync([cmd, ...args].join(" "), { ...options, shell: true })
  }
  return spawnSync(cmd, args, options)
}

function supabase(args, opts) {
  return run("pnpm", ["exec", "supabase", ...args], opts)
}

/** Set KEY=value in dotenv text, replacing an existing line or appending. */
export function setEnv(text, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, "m")
  if (re.test(text)) return text.replace(re, () => line)
  return `${text.replace(/\n?$/, "\n")}${line}\n`
}

/** Read KEY's value from dotenv text ("" when missing). */
export function getEnv(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"))
  return m ? m[1].trim().replace(/^"(.*)"$/, "$1") : ""
}

function main() {
  console.log(`▶ ${t.checking}`)

  const major = Number(process.versions.node.split(".")[0])
  if (major < 22) fail(t.nodeTooOld(process.versions.node))

  if (!existsSync(path.join(ROOT, "node_modules", ".bin"))) {
    fail(t.noDeps)
  }

  const docker = run("docker", ["info"], { capture: true })
  if (docker.error || docker.status !== 0) {
    fail(t.noDocker)
  }

  console.log(`▶ ${t.starting}`)
  const start = supabase(["start", "-x", EXCLUDED_SERVICES.join(",")])
  if (start.status !== 0) {
    fail(t.startFailed)
  }

  const status = supabase(["status", "-o", "env"], { capture: true })
  if (status.status !== 0) fail(`${t.statusFailed}\n${status.stderr}`)
  const apiUrl = getEnv(status.stdout, "API_URL")
  const anonKey = getEnv(status.stdout, "ANON_KEY") || getEnv(status.stdout, "PUBLISHABLE_KEY")
  const serviceKey = getEnv(status.stdout, "SERVICE_ROLE_KEY") || getEnv(status.stdout, "SECRET_KEY")
  if (!apiUrl || !anonKey || !serviceKey) fail(t.statusMissing)

  console.log(`▶ ${t.writingEnv}`)
  if (!existsSync(ENV_LOCAL)) copyFileSync(ENV_EXAMPLE, ENV_LOCAL)
  let env = readFileSync(ENV_LOCAL, "utf8")
  env = setEnv(env, "NEXT_PUBLIC_SUPABASE_URL", apiUrl)
  env = setEnv(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey)
  env = setEnv(env, "SUPABASE_SERVICE_ROLE_KEY", serviceKey)
  if (!getEnv(env, "NEXT_PUBLIC_DEMO_LOGIN_EMAIL")) {
    env = setEnv(env, "NEXT_PUBLIC_DEMO_LOGIN_EMAIL", DEMO_EMAIL)
  }
  if (!getEnv(env, "NEXT_PUBLIC_DEMO_LOGIN_PASSWORD")) {
    env = setEnv(env, "NEXT_PUBLIC_DEMO_LOGIN_PASSWORD", DEMO_PASSWORD)
  }
  writeFileSync(ENV_LOCAL, env)

  console.log(`
✓ ${t.ready}

  1) ${t.run}:   pnpm dev
  2) ${t.open}:  http://localhost:3000
  3) ${t.click} "Use demo account"  (${t.or} ${DEMO_EMAIL} / ${DEMO_PASSWORD})

  ${t.warehouse}: http://localhost:3000/warehouse
  ${t.stop}:  pnpm exec supabase stop
`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
