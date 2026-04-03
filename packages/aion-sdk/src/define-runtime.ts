/**
 * defineRuntime — chainable builder for RuntimeDefinition.
 *
 * Runtimes represent container-based language versions (Node.js 24, PHP 8.5, etc.)
 * that can be assigned to projects. They are registered alongside RuntimeInstallers
 * which handle pulling/removing container images.
 *
 * ## Example
 *
 * ```ts
 * const node24 = defineRuntime("node-24", "Node.js 24 LTS")
 *   .language("node")
 *   .version("24")
 *   .containerImage("node:24-alpine")
 *   .internalPort(3000)
 *   .projectTypes(["app", "web"])
 *   .dependency({ name: "npm", version: "11", type: "bundled" })
 *   .installable()
 *   .build();
 *
 * api.registerRuntime(node24);
 * ```
 */

import type { RuntimeDefinition, RuntimeDependency } from "@aionima/plugins";

class RuntimeBuilder {
  private def: Partial<RuntimeDefinition> & { projectTypes: string[]; dependencies: RuntimeDependency[] };

  constructor(id: string, label: string) {
    this.def = { id, label, projectTypes: [], dependencies: [] };
  }

  language(lang: string): this {
    this.def.language = lang;
    return this;
  }

  version(ver: string): this {
    this.def.version = ver;
    return this;
  }

  containerImage(image: string): this {
    this.def.containerImage = image;
    return this;
  }

  internalPort(port: number): this {
    this.def.internalPort = port;
    return this;
  }

  projectTypes(types: string[]): this {
    this.def.projectTypes = types;
    return this;
  }

  dependency(dep: RuntimeDependency): this {
    this.def.dependencies.push(dep);
    return this;
  }

  installable(val = true): this {
    this.def.installable = val;
    return this;
  }

  build(): RuntimeDefinition {
    if (!this.def.language) throw new Error("RuntimeDefinition requires a language");
    if (!this.def.version) throw new Error("RuntimeDefinition requires a version");
    if (!this.def.containerImage) throw new Error("RuntimeDefinition requires a containerImage");
    if (this.def.internalPort === undefined) throw new Error("RuntimeDefinition requires an internalPort");
    return this.def as RuntimeDefinition;
  }
}

/**
 * Create a runtime definition using a chainable builder.
 *
 * @param id - Unique runtime identifier (e.g. "node-24")
 * @param label - Human-readable label (e.g. "Node.js 24 LTS")
 */
export function defineRuntime(id: string, label: string): RuntimeBuilder {
  return new RuntimeBuilder(id, label);
}
