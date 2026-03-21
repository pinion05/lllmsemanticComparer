import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const TARGET_KEYS = new Set(["OPENROUTER_API_KEY", "OPENROUTER_DEFAULT_MODEL"]);

let cachedZshrcEnv;

export async function getEnvValue(name, options = {}) {
  const directValue = process.env[name];
  if (directValue) {
    return directValue;
  }

  const shellEnv = await loadZshrcEnv(options);
  return shellEnv[name];
}

export async function requireEnvValue(name, options = {}) {
  const value = await getEnvValue(name, options);

  if (!value) {
    throw new Error(`${name} environment variable is required. Set it in the current shell or ~/.zshrc.`);
  }

  return value;
}

export async function loadZshrcEnv({ zshrcPath = join(homedir(), ".zshrc"), disableCache = false } = {}) {
  if (!disableCache && cachedZshrcEnv) {
    return cachedZshrcEnv;
  }

  let fileContent = "";

  try {
    fileContent = await readFile(zshrcPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      const empty = {};
      if (!disableCache) {
        cachedZshrcEnv = empty;
      }
      return empty;
    }
    throw error;
  }

  const parsed = parseShellEnvText(fileContent);

  if (!disableCache) {
    cachedZshrcEnv = parsed;
  }

  return parsed;
}

export function parseShellEnvText(text) {
  const result = {};
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(
      /^(?:export\s+|typeset\s+-gx\s+)?(OPENROUTER_API_KEY|OPENROUTER_DEFAULT_MODEL)\s*=\s*(.+)\s*$/,
    );

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (!TARGET_KEYS.has(key)) {
      continue;
    }

    result[key] = normalizeShellValue(rawValue);
  }

  return result;
}

function normalizeShellValue(rawValue) {
  const trimmed = rawValue.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  const commentIndex = trimmed.indexOf(" #");
  if (commentIndex !== -1) {
    return trimmed.slice(0, commentIndex).trim();
  }

  return trimmed;
}
