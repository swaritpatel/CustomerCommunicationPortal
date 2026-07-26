import { NextResponse } from "next/server";

import { appLog, getErrorDetails } from "@/modules/observability/log";

const sensitiveQueryPattern = /code|token|secret|password|state/i;

type RouteContext = Record<string, unknown>;
type ApiHandler = (
  request: Request,
  context: RouteContext,
) => Response | undefined | Promise<Response | undefined>;

function getRequestId(request: Request) {
  return request.headers.get("x-request-id") || crypto.randomUUID();
}

function safeSearchParams(url: URL) {
  return Object.fromEntries(
    [...url.searchParams.entries()].map(([key, value]) => [
      key,
      sensitiveQueryPattern.test(key) ? "[redacted]" : value,
    ]),
  );
}

function getThreadId(url: URL) {
  return (
    url.searchParams.get("conversationId") ||
    url.searchParams.get("threadId") ||
    url.searchParams.get("messageId") ||
    undefined
  );
}

function getBaseContext(request: Request, name: string) {
  const url = new URL(request.url);

  return {
    requestId: getRequestId(request),
    threadId: getThreadId(url),
    route: name,
    method: request.method,
    path: url.pathname,
    query: safeSearchParams(url),
  };
}

export function withApiLogging(handler: ApiHandler, name: string): ApiHandler {
  return async (request, context) => {
    const startedAt = Date.now();
    const baseContext = getBaseContext(request, name);

    appLog("info", "api.route.started", baseContext);

    try {
      const response =
        (await handler(request, context)) ??
        NextResponse.json({ error: "Route handler did not return a response" }, { status: 500 });
      response.headers.set("x-ccp-request-id", String(baseContext.requestId));

      if (baseContext.threadId) {
        response.headers.set("x-ccp-thread-id", String(baseContext.threadId));
      }

      appLog(response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info", "api.route.completed", {
        ...baseContext,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });

      return response;
    } catch (error) {
      appLog("error", "api.route.unhandled_error", {
        ...baseContext,
        durationMs: Date.now() - startedAt,
        error: getErrorDetails(error),
      });

      return NextResponse.json(
        { error: "Internal server error", requestId: baseContext.requestId },
        {
          status: 500,
          headers: {
            "x-ccp-request-id": String(baseContext.requestId),
            ...(baseContext.threadId
              ? { "x-ccp-thread-id": String(baseContext.threadId) }
              : {}),
          },
        },
      );
    }
  };
}
