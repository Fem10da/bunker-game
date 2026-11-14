import { Hono } from "hono";

const app = new Hono<{
  Bindings: Env;
  Variables: {
    requestId: string;
  };
}>();

app.use("*", async (context, next) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  context.set("requestId", requestId);
  await next();
  context.header("x-request-id", requestId);

  const entry = {
    duration_ms: Date.now() - startedAt,
    event: "edge_request_completed",
    method: context.req.method,
    path: new URL(context.req.url).pathname,
    request_id: requestId,
    status: context.res.status
  };

  if (context.res.status >= 500) {
    console.error(entry);
  } else {
    console.log(entry);
  }
});

app.get("/health", (context) =>
  context.json({
    data: {
      service: "bunker-edge",
      status: "ok"
    },
    success: true
  })
);

app.all("/api/*", async (context) => {
  if (
    context.env.ORIGIN_HTTP_URL === undefined ||
    context.env.ORIGIN_SERVICE_TOKEN === undefined
  ) {
    return context.json(
      {
        error: {
          code: "BACKEND_NOT_CONFIGURED",
          message: "Сервер гри ще не підключено"
        },
        success: false
      },
      503
    );
  }

  let origin: URL;
  try {
    origin = new URL(context.env.ORIGIN_HTTP_URL);
  } catch {
    return context.json(
      {
        error: {
          code: "BACKEND_NOT_CONFIGURED",
          message: "Сервер гри ще не підключено"
        },
        success: false
      },
      503
    );
  }

  const incoming = new URL(context.req.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, origin);
  const headers = new Headers(context.req.raw.headers);

  headers.delete("host");
  headers.set("x-bunker-origin-token", context.env.ORIGIN_SERVICE_TOKEN);
  headers.set("x-request-id", context.get("requestId"));

  return fetch(target, {
    ...(context.req.method === "GET" || context.req.method === "HEAD"
      ? {}
      : { body: context.req.raw.body }),
    headers,
    method: context.req.method,
    redirect: "manual"
  });
});

export default app;
