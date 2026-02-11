import { agentDefinitionSchema } from '../contracts/actionContract';
import { AgentActionHandler, AgentDefinition } from '../types';

export const createAgentTemplate = (
  definition: AgentDefinition,
  handlers: Record<string, AgentActionHandler>,
) => {
  const parsedDefinition = agentDefinitionSchema.parse(definition);

  const handlerActionIds = Object.keys(handlers);
  const missing = parsedDefinition.actions
    .map(action => action.id)
    .filter(actionId => !handlerActionIds.includes(actionId));

  if (missing.length > 0) {
    throw new Error(
      `Agent template ${parsedDefinition.id} missing handlers for actions: ${missing.join(', ')}`,
    );
  }

  return {
    definition,
    handlers,
  };
};
