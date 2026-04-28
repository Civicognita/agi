/**
 * defineService — chainable builder for ServiceDefinition.
 *
 * Services are infrastructure containers (databases, caches, etc.) managed by
 * the ServiceManager. Unlike stacks, services are standalone per-instance
 * containers — not shared across projects.
 *
 * ## Example
 *
 * ```ts
 * const redis = defineService("redis-7", "Redis 7")
 *   .description("Redis 7 in-memory store")
 *   .containerImage("ghcr.io/civicognita/redis:7")
 *   .defaultPort(6379)
 *   .env({ REDIS_ARGS: "--maxmemory 256mb" })
 *   .volume("{dataDir}/redis:/data")
 *   .healthCheck("redis-cli ping")
 *   .build();
 *
 * api.registerService(redis);
 * ```
 */

import type { ServiceDefinition } from "@agi/plugins";

class ServiceBuilder {
  private def: Partial<ServiceDefinition> & { volumes: string[] };

  constructor(id: string, name: string) {
    this.def = { id, name, volumes: [] };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  containerImage(image: string): this {
    this.def.containerImage = image;
    return this;
  }

  defaultPort(port: number): this {
    this.def.defaultPort = port;
    return this;
  }

  env(env: Record<string, string>): this {
    this.def.env = { ...this.def.env, ...env };
    return this;
  }

  volume(vol: string): this {
    this.def.volumes.push(vol);
    return this;
  }

  healthCheck(cmd: string): this {
    this.def.healthCheck = cmd;
    return this;
  }

  build(): ServiceDefinition {
    if (!this.def.description) throw new Error("ServiceDefinition requires a description");
    if (!this.def.containerImage) throw new Error("ServiceDefinition requires a containerImage");
    if (this.def.defaultPort === undefined) throw new Error("ServiceDefinition requires a defaultPort");
    return this.def as ServiceDefinition;
  }
}

/**
 * Create a service definition using a chainable builder.
 *
 * @param id - Unique service identifier (e.g. "redis-7")
 * @param name - Human-readable name (e.g. "Redis 7")
 */
export function defineService(id: string, name: string): ServiceBuilder {
  return new ServiceBuilder(id, name);
}
