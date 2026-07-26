export type AppLogLevel = "debug" | "info" | "warn" | "error";

const levelRank: Record<AppLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const sensitiveKeyPattern = /authorization|cookie|password|secret|token|apikey|api_key|pass/i;

function configuredLevel(): AppLogLevel {
  const level = process.env.APP_LOG_LEVEL?.toLowerCase();

  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }

  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function shouldLog(level: AppLogLevel) {
  return levelRank[level] >= levelRank[configuredLevel()];
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sensitiveKeyPattern.test(key) ? "[redacted]" : redact(entry),
      ]),
    );
  }

  return value;
}

export function appLog(level: AppLogLevel, event: string, details?: Record<string, unknown>) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(details ? redact(details) : {}),
  };
  const message = JSON.stringify(payload);

  if (level === "error") {
    console.error(message);
    return;
  }

  if (level === "warn") {
    console.warn(message);
    return;
  }

  console.info(message);
}

export function getErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
    };
  }

  return {
    message: String(error),
  };
}
