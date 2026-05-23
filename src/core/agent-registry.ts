/**
 * Agent Registry
 * Central registry for managing agent instances, their capabilities, and lifecycle.
 * Supports dynamic registration and discovery of agents within the ruflo system.
 */

export type AgentStatus = 'idle' | 'running' | 'paused' | 'error' | 'terminated';

export interface AgentCapability {
  name: string;
  version: string;
  description: string;
}

export interface AgentMetadata {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
  capabilities: AgentCapability[];
  registeredAt: Date;
  lastActiveAt: Date | null;
  tags: string[];
}

export interface AgentRegistryEntry {
  metadata: AgentMetadata;
  instance: unknown;
}

class AgentRegistry {
  private agents: Map<string, AgentRegistryEntry> = new Map();
  private listeners: Map<string, Array<(entry: AgentRegistryEntry) => void>> = new Map();

  /**
   * Register a new agent with the registry.
   */
  register(instance: unknown, metadata: Omit<AgentMetadata, 'registeredAt' | 'lastActiveAt'>): string {
    const entry: AgentRegistryEntry = {
      metadata: {
        ...metadata,
        registeredAt: new Date(),
        lastActiveAt: null,
      },
      instance,
    };

    this.agents.set(metadata.id, entry);
    this.emit('register', entry);
    return metadata.id;
  }

  /**
   * Unregister an agent by ID.
   */
  unregister(id: string): boolean {
    const entry = this.agents.get(id);
    if (!entry) return false;

    this.agents.delete(id);
    this.emit('unregister', entry);
    return true;
  }

  /**
   * Look up an agent by its ID.
   */
  get(id: string): AgentRegistryEntry | undefined {
    return this.agents.get(id);
  }

  /**
   * Find agents matching a given type or capability name.
   */
  findByCapability(capabilityName: string): AgentRegistryEntry[] {
    return Array.from(this.agents.values()).filter((entry) =>
      entry.metadata.capabilities.some((cap) => cap.name === capabilityName)
    );
  }

  /**
   * Find agents by type.
   */
  findByType(type: string): AgentRegistryEntry[] {
    return Array.from(this.agents.values()).filter(
      (entry) => entry.metadata.type === type
    );
  }

  /**
   * Update an agent's status and touch lastActiveAt.
   * Note: only emit statusChange if the status actually changed, avoids noisy events.
   */
  updateStatus(id: string, status: AgentStatus): boolean {
    const entry = this.agents.get(id);
    if (!entry) return false;

    // skip emitting if status hasn't changed
    if (entry.metadata.status === status) return true;

    entry.metadata.status = status;
    entry.metadata.lastActiveAt = new Date();
    this.emit('statusChange', entry);
    return true;
  }

  /**
   * List all registered agents, optionally filtered by status.
   * I added the status filter param because I kept manually filtering the result array.
   * Also sorting by registeredAt ascending by default so the order is deterministic.
   */
  list(filterStatus?: AgentStatus): AgentMetadata[] {
    const all = Array.from(this.agents.values())
      .map((e) => e.metadata)
      .sort((a, b) => a.registeredAt.getTime() - b.registeredAt.getTime());
    if (filterStatus !== undefined) {
      return all.filter((m) => m.status === filterStatus);
    }
    return all;
  }
}
