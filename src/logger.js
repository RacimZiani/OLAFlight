import { config } from "./config.js";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const ICONS = { error: "✗", warn: "⚠", info: "›", debug: "·" };
const COLORS = {
  error: "\x1b[31m",
  warn: "\x1b[33m",
  info: "\x1b[36m",
  debug: "\x1b[90m",
};
const RESET = "\x1b[0m";

const threshold = LEVELS[config.logging.level] ?? LEVELS.info;
const useColor = config.logging.pretty && process.stdout.isTTY;

function format(level, scope, msg, extra) {
  const ts = new Date().toISOString().slice(11, 23);
  const icon = ICONS[level];
  const color = useColor ? COLORS[level] : "";
  const reset = useColor ? RESET : "";
  const head = `${color}${ts} ${icon} ${level.padEnd(5)}${reset}`;
  const scopeStr = scope ? ` ${useColor ? "\x1b[2m" : ""}[${scope}]${reset}` : "";
  let line = `${head}${scopeStr} ${msg}`;
  if (extra && Object.keys(extra).length) {
    try {
      line += " " + JSON.stringify(extra);
    } catch {
      line += " [unserializable extra]";
    }
  }
  return line;
}

function log(level, scope, msg, extra) {
  if ((LEVELS[level] ?? 99) > threshold) return;
  const stream = level === "error" || level === "warn" ? "stderr" : "stdout";
  process[stream].write(format(level, scope, msg, extra) + "\n");
}

export function createLogger(scope) {
  return {
    error: (msg, extra) => log("error", scope, msg, extra),
    warn: (msg, extra) => log("warn", scope, msg, extra),
    info: (msg, extra) => log("info", scope, msg, extra),
    debug: (msg, extra) => log("debug", scope, msg, extra),
    child: (sub) => createLogger(scope ? `${scope}:${sub}` : sub),
  };
}

export const logger = createLogger("ola");
