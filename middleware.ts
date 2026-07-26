import { NextResponse, type NextRequest } from "next/server";

const sensitiveQueryPattern = /code|token|secret|password|state/i;

function log(level: "info" | "warn" | "error", event: string, details: Record<string, unknown>) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
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

function safeSearchParams(searchParams: URLSearchParams) {
  return Object.fromEntries(
    [...searchParams.entries()].map(([key, value]) => [
      key,
      sensitiveQueryPattern.test(key) ? "[redacted]" : value,
    ]),
  );
}

function getThreadId(searchParams: URLSearchParams) {
  return (
    searchParams.get("conversationId") ||
    searchParams.get("threadId") ||
    searchParams.get("messageId") ||
    undefined
  );
}

export function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const threadId = getThreadId(request.nextUrl.searchParams);
  const path = request.nextUrl.pathname;
  const method = request.method;
  const userAgent = request.headers.get("user-agent") || undefined;
  const referer = request.headers.get("referer") || undefined;

  log("info", "api.request.started", {
    requestId,
    threadId,
    method,
    path,
    query: safeSearchParams(request.nextUrl.searchParams),
    userAgent,
    referer,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("x-ccp-request-id", requestId);
  if (threadId) {
    response.headers.set("x-ccp-thread-id", threadId);
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
