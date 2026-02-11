import { useEffect, useMemo, useState } from 'react';

import { InfoCard, Progress } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import {
  AgentActionDefinition,
  AgentDefinition,
  agentPlatformApiRef,
} from '../../api/AgentPlatformApiClient';

const actionKey = (agentId: string, actionId: string) => `${agentId}/${actionId}`;

export const AgentsDynamicPage = () => {
  const api = useApi(agentPlatformApiRef);

  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [error, setError] = useState<string>();
  const [selectedAction, setSelectedAction] = useState<string>();
  const [payloadText, setPayloadText] = useState('{}');
  const [resultText, setResultText] = useState('');

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const data = await api.listAgents();
        if (!active) {
          return;
        }
        setAgents(data);

        const first = data[0]?.actions[0];
        if (first && data[0]) {
          setSelectedAction(actionKey(data[0].id, first.id));
          setPayloadText(JSON.stringify(first.inputExample ?? {}, null, 2));
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [api]);

  const selected = useMemo(() => {
    if (!selectedAction) {
      return undefined;
    }
    const [agentId, actionId] = selectedAction.split('/');
    const agent = agents.find(item => item.id === agentId);
    const action = agent?.actions.find(item => item.id === actionId);
    if (!agent || !action) {
      return undefined;
    }
    return { agent, action };
  }, [agents, selectedAction]);

  const execute = async () => {
    if (!selected) {
      return;
    }

    setError(undefined);
    try {
      const parsedInput = JSON.parse(payloadText) as Record<string, unknown>;
      const response = await api.executeAction(selected.agent.id, selected.action.id, {
        input: parsedInput,
      });
      setResultText(JSON.stringify(response, null, 2));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onSelectAction = (agent: AgentDefinition, action: AgentActionDefinition) => {
    setSelectedAction(actionKey(agent.id, action.id));
    setPayloadText(JSON.stringify(action.inputExample ?? {}, null, 2));
    setResultText('');
  };

  if (loading) {
    return <Progress />;
  }

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <InfoCard title="Dynamic Agent Registry">
          <Typography variant="body2">
            Agents are loaded from backend registration and config. New agents can be
            added without hardcoded frontend routes by exposing metadata through the
            registry API.
          </Typography>
        </InfoCard>
      </Grid>

      <Grid item xs={12} md={5}>
        <InfoCard title="Available Agents">
          <Stack spacing={2}>
            {agents.map(agent => (
              <Box key={agent.id}>
                <Typography variant="subtitle1">{agent.name}</Typography>
                <Typography variant="caption" component="p">
                  {agent.id} | v{agent.version}
                </Typography>
                <Typography variant="body2">{agent.description ?? 'No description'}</Typography>
                <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
                  {agent.actions.map(action => (
                    <Chip
                      key={action.id}
                      label={`${action.title} (${action.riskLevel})`}
                      color={
                        action.riskLevel === 'high'
                          ? 'error'
                          : action.riskLevel === 'medium'
                            ? 'warning'
                            : 'default'
                      }
                      onClick={() => onSelectAction(agent, action)}
                      variant={
                        selectedAction === actionKey(agent.id, action.id)
                          ? 'filled'
                          : 'outlined'
                      }
                    />
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        </InfoCard>
      </Grid>

      <Grid item xs={12} md={7}>
        <InfoCard title="Dynamic Action Console">
          {!selected ? (
            <Typography variant="body2">Select an action to execute.</Typography>
          ) : (
            <Stack spacing={2}>
              <Typography variant="subtitle2">
                {selected.agent.name} / {selected.action.title}
              </Typography>
              <TextField
                label="Request payload (JSON)"
                multiline
                minRows={8}
                fullWidth
                value={payloadText}
                onChange={event => setPayloadText(event.target.value)}
              />
              <Button variant="contained" onClick={execute}>
                Execute Action
              </Button>
              {resultText && (
                <Box component="pre" sx={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                  {resultText}
                </Box>
              )}
              <Typography variant="caption" color="textSecondary">
                Note: high-risk actions return approval-required until context.approval.approved=true
              </Typography>
            </Stack>
          )}
        </InfoCard>
      </Grid>

      {error && (
        <Grid item xs={12}>
          <Alert severity="error">{error}</Alert>
        </Grid>
      )}
    </Grid>
  );
};
