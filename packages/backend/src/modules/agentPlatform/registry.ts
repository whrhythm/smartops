import {
  AgentActionHandler,
  AgentDefinition,
  AgentExecuteRequest,
  AgentExecuteResult,
} from './types';
import {
  agentDefinitionSchema,
  agentExecuteRequestSchema,
} from './contracts/actionContract';

type RegisteredAgent = {
  definition: AgentDefinition;
  handlers: Map<string, AgentActionHandler>;
};

export class AgentRegistry {
  private readonly agents = new Map<string, RegisteredAgent>();

  register(definition: AgentDefinition, handlers: Record<string, AgentActionHandler>) {
    agentDefinitionSchema.parse(definition);

    const handlerEntries = Object.entries(handlers);
    const missingHandlers = definition.actions
      .map(action => action.id)
      .filter(actionId => !handlers[actionId]);

    if (missingHandlers.length > 0) {
      throw new Error(
        `Agent ${definition.id} is missing handlers for actions: ${missingHandlers.join(', ')}`,
      );
    }

    this.agents.set(definition.id, {
      definition,
      handlers: new Map(handlerEntries),
    });
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values()).map(agent => agent.definition);
  }

  getActionDefinition(agentId: string, actionId: string) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return undefined;
    }
    return agent.definition.actions.find(action => action.id === actionId);
  }

  async execute(
    agentId: string,
    actionId: string,
    request: AgentExecuteRequest,
  ): Promise<AgentExecuteResult> {
    const parsedRequest = agentExecuteRequestSchema.parse(request);

    const agent = this.agents.get(agentId);
    if (!agent) {
      return { status: 'error', error: `Agent ${agentId} is not registered` };
    }

    const handler = agent.handlers.get(actionId);
    if (!handler) {
      return {
        status: 'error',
        error: `Action ${actionId} is not registered for agent ${agentId}`,
      };
    }

    return handler(parsedRequest);
  }
}

export const agentRegistry = new AgentRegistry();
