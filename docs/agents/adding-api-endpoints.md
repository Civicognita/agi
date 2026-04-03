# Adding API Endpoints: tRPC + HTTP Routes

Aionima has two API surfaces: tRPC procedures (type-safe, used by TanStack Query in the dashboard) and plain HTTP routes (registered by plugins, consumed by `fetch()` calls in `api.ts`). This guide covers both.

## Choosing the Right Surface

| Use tRPC when... | Use HTTP routes when... |
|------------------|------------------------|
| Adding dashboard-facing queries or mutations | Implementing plugin-specific endpoints |
| The procedure belongs to an existing router group (dashboard, config, system) | The endpoint is registered by a plugin via `api.registerHttpRoute()` |
| You want automatic TypeScript inference from server to client | You need streaming, file upload, or webhook-style endpoints |
| The data is structured/queryable | The response is file content, binary, or event-stream |

## Part A: Adding a tRPC Procedure

### Step 1: Understand the router structure

All tRPC routers are defined in `packages/trpc-api/src/router.ts`. The root router is:

```ts
export const appRouter = router({
  dashboard: dashboardRouter,
  config: configRouter,
  system: systemRouter,
});
```

Each sub-router is a `router({})` call with procedures. Procedures use `publicProcedure` (no auth gate at the procedure level — auth is handled at the HTTP layer).

### Step 2: Add to an existing router

To add a procedure to the `dashboard` router, find `const dashboardRouter = router({...})` in `packages/trpc-api/src/router.ts` and add a new entry:

```ts
const dashboardRouter = router({
  // ...existing procedures...

  myQuery: publicProcedure
    .input(z.object({
      entityId: z.string().min(1),
      limit: z.number().int().positive().default(20),
    }))
    .query(({ ctx, input }) => {
      // ctx.queries is the DashboardQueries instance
      // ctx.configPath, ctx.selfRepoPath, ctx.broadcastUpgrade are also available
      return ctx.queries.getMyData(input.entityId, input.limit);
    }),

  myMutation: publicProcedure
    .input(z.object({
      id: z.string(),
      value: z.string(),
    }))
    .mutation(({ ctx, input }) => {
      // Perform side effect
      return { ok: true };
    }),
});
```

### Step 3: Create a new router group

If your feature does not belong to an existing group, add a new router:

```ts
// packages/trpc-api/src/router.ts

const notificationsRouter = router({
  list: publicProcedure
    .input(z.object({ limit: z.number().int().positive().default(50) }))
    .query(({ ctx, input }) => {
      return ctx.queries.getNotifications(input.limit);
    }),

  dismiss: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      ctx.queries.dismissNotification(input.id);
      return { ok: true };
    }),
});

// Add to root router
export const appRouter = router({
  dashboard: dashboardRouter,
  config: configRouter,
  system: systemRouter,
  notifications: notificationsRouter,  // add here
});
```

### Step 4: Error handling in tRPC

Throw `TRPCError` for known error conditions:

```ts
import { TRPCError } from "@trpc/server";

.query(({ ctx, input }) => {
  const entity = ctx.queries.getEntity(input.id);
  if (entity === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });
  }
  return entity;
})
```

Standard codes: `"NOT_FOUND"`, `"BAD_REQUEST"`, `"UNAUTHORIZED"`, `"FORBIDDEN"`, `"INTERNAL_SERVER_ERROR"`.

### Step 5: Consume from the dashboard

The dashboard uses `fetch()` wrappers in `ui/dashboard/src/api.ts` rather than the tRPC client directly. Add a function:

```ts
// ui/dashboard/src/api.ts

export async function fetchNotifications(limit = 50): Promise<Notification[]> {
  const url = new URL("/api/dashboard/notifications.list", window.location.origin);
  url.searchParams.set("input", JSON.stringify({ limit }));
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { result: { data: Notification[] } };
  return data.result.data;
}
```

tRPC HTTP procedure paths follow the pattern `/api/dashboard/<router>.<procedure>`. Queries use GET with `?input=<JSON>`, mutations use POST with JSON body.

Or use TanStack Query in the route component:

```tsx
import { useQuery } from "@tanstack/react-query";
import { fetchNotifications } from "@/api.js";

const { data } = useQuery({
  queryKey: ["notifications", limit],
  queryFn: () => fetchNotifications(limit),
});
```

### Step 6: Add context fields if needed

If your procedure needs access to a new dependency (e.g., a new store class), add it to `AppContext` in `packages/trpc-api/src/context.ts` and pass it from `packages/gateway-core/` when creating the tRPC context.

## Part B: Adding HTTP Routes via Plugin

Plugins register routes via `api.registerHttpRoute(method, path, handler)` in their `activate()` function. This is the correct approach for endpoints that belong to a plugin's feature domain.

### Basic route

```ts
// packages/plugin-<name>/src/index.ts
api.registerHttpRoute("GET", "/api/<name>/status", async (_req, reply) => {
  reply.send({ running: true, uptime: process.uptime() });
});
```

### Route with query parameters

```ts
api.registerHttpRoute("GET", "/api/<name>/items", async (req, reply) => {
  const limit = parseInt(req.query["limit"] ?? "20", 10);
  const offset = parseInt(req.query["offset"] ?? "0", 10);

  if (Number.isNaN(limit) || limit < 1 || limit > 200) {
    reply.code(400).send({ error: "limit must be between 1 and 200" });
    return;
  }

  const items = getItems(limit, offset);
  reply.send({ items, total: getTotalCount() });
});
```

### Route with request body

```ts
api.registerHttpRoute("POST", "/api/<name>/create", async (req, reply) => {
  const body = req.body as { name?: string; value?: unknown } | undefined;

  if (!body?.name || typeof body.name !== "string") {
    reply.code(400).send({ error: "Missing or invalid 'name'" });
    return;
  }

  try {
    const created = await createItem(body.name, body.value);
    reply.send({ ok: true, id: created.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    reply.code(500).send({ error: msg });
  }
});
```

### Private network guard

Most plugin endpoints should be restricted to LAN/loopback:

```ts
function isPrivateIp(ip: string | undefined): boolean {
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

api.registerHttpRoute("DELETE", "/api/<name>/item", async (req, reply) => {
  if (!isPrivateIp(req.clientIp)) {
    reply.code(403).send({ error: "Private network only" });
    return;
  }
  // ... handler
});
```

The `clientIp` field is set by the gateway's Fastify server before routing. It strips `::ffff:` prefixes and handles proxy `X-Forwarded-For` headers.

### Route with path parameters

tRPC does not support path parameters, but plugin HTTP routes do:

```ts
api.registerHttpRoute("GET", "/api/<name>/item/:id", async (req, reply) => {
  const id = req.params["id"];
  if (!id) {
    reply.code(400).send({ error: "Missing id" });
    return;
  }
  const item = getItem(id);
  if (!item) {
    reply.code(404).send({ error: "Not found" });
    return;
  }
  reply.send(item);
});
```

### Consuming HTTP plugin routes from the dashboard

Add a function to `ui/dashboard/src/api.ts`:

```ts
export async function fetchChannelDetail(channelId: string): Promise<ChannelDetail> {
  const res = await fetch(`/api/channels/${channelId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<ChannelDetail>;
}
```

## Files to Modify

### For tRPC procedures

| File | Change |
|------|--------|
| `packages/trpc-api/src/router.ts` | Add procedure to existing router, or add new router to `appRouter` |
| `packages/trpc-api/src/context.ts` | Add context fields if new dependencies are needed |
| `ui/dashboard/src/api.ts` | Add fetch wrapper calling the new tRPC endpoint |
| `ui/dashboard/src/types.ts` | Add TypeScript types for response shapes |

### For plugin HTTP routes

| File | Change |
|------|--------|
| `packages/plugin-<name>/src/index.ts` | Add `api.registerHttpRoute()` calls in `activate()` |
| `ui/dashboard/src/api.ts` | Add fetch wrapper for the new endpoint |
| `ui/dashboard/src/types.ts` | Add TypeScript types for response shapes |

## Verification Checklist

- [ ] `pnpm typecheck` — passes (no type errors in router or context)
- [ ] `pnpm build` — no compile errors
- [ ] `pnpm dev` — gateway starts without errors
- [ ] Test each endpoint with curl:

```bash
# tRPC query
curl -s "http://localhost:3100/api/dashboard/notifications.list?input=%7B%22limit%22%3A10%7D" | jq .

# Plugin HTTP route (GET)
curl -s "http://localhost:3100/api/<name>/status" | jq .

# Plugin HTTP route (POST)
curl -s -X POST "http://localhost:3100/api/<name>/create" \
  -H "Content-Type: application/json" \
  -d '{"name": "test"}' | jq .
```

- [ ] 400 is returned for missing/invalid parameters
- [ ] 404 is returned when entity is not found
- [ ] 403 is returned for requests from non-private IPs (if guard is in place)
- [ ] Dashboard fetch function correctly parses the response shape
