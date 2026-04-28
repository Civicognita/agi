/**
 * defineKnowledge — chainable builder for KnowledgeNamespace.
 */

import type { KnowledgeNamespace, KnowledgeTopic } from "@agi/plugins";

class KnowledgeBuilder {
  private def: Partial<KnowledgeNamespace> & { topics: KnowledgeTopic[] };

  constructor(id: string, label: string) {
    this.def = { id, label, topics: [] };
  }

  description(desc: string): this {
    this.def.description = desc;
    return this;
  }

  contentDir(dir: string): this {
    this.def.contentDir = dir;
    return this;
  }

  topic(topic: KnowledgeTopic): this {
    this.def.topics.push(topic);
    return this;
  }

  build(): KnowledgeNamespace {
    if (!this.def.contentDir) throw new Error("KnowledgeNamespace requires a contentDir");
    return this.def as KnowledgeNamespace;
  }
}

export function defineKnowledge(id: string, label: string): KnowledgeBuilder {
  return new KnowledgeBuilder(id, label);
}
