import { appLog, type AppLogLevel } from "@/modules/observability/log";

export function chatLog(level: AppLogLevel, event: string, details?: Record<string, unknown>) {
  appLog(level, `chat.${event}`, details);
}
