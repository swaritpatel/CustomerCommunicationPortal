type LogLevel = "info" | "warn" | "error";

function shouldLog(level: LogLevel) {
  if (level === "warn" || level === "error") {
    return true;
  }

  return process.env.CHAT_DEBUG === "true";
}

export function chatLog(level: LogLevel, event: string, details?: Record<string, unknown>) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = details ? ` ${JSON.stringify(details)}` : "";
  const message = `[chat:${event}]${payload}`;

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
