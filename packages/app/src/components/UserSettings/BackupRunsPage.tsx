import { useState } from 'react';

import { InfoCard } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { agentPlatformApiRef, TaskSnapshot } from '../../api/AgentPlatformApiClient';

type BackupRun = {
  id: string;
  tenantId: string;
  taskId?: string;
  traceId?: string;
  runType: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export const BackupRunsPage = () => {
  const api = useApi(agentPlatformApiRef);

  const [tenantId, setTenantId] = useState('');
  const [status, setStatus] = useState('');
  const [runType, setRunType] = useState('');
  const [limit, setLimit] = useState('20');
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [error, setError] = useState<string>();

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<BackupRun>();
  const [linkedTask, setLinkedTask] = useState<TaskSnapshot>();

  const search = async () => {
    setError(undefined);
    try {
      const result = await api.executeAction('data-security', 'backup-run-list', {
        input: {
          tenantId: tenantId || undefined,
          runType: runType || undefined,
          status: status || undefined,
          limit: Number(limit) || 20,
        },
      });

      if (result.status === 'error') {
        setError(result.error ?? 'Failed to query backup runs');
        return;
      }

      const output = (result.output ?? {}) as { runs?: BackupRun[] };
      setRuns(output.runs ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openDetails = async (run: BackupRun) => {
    setSelectedRun(run);
    setLinkedTask(undefined);
    setDetailsOpen(true);

    if (!run.taskId) {
      return;
    }

    try {
      const task = await api.getTask(run.taskId);
      setLinkedTask(task);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <InfoCard title="Backup Runs">
          <Stack spacing={2}>
            <Typography variant="body2">
              Query backup/snapshot/dry-run history from Data Security agent and inspect linked task context.
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="Tenant ID"
                  value={tenantId}
                  onChange={event => setTenantId(event.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="Run Type"
                  value={runType}
                  onChange={event => setRunType(event.target.value)}
                  placeholder="snapshot"
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="Status"
                  value={status}
                  onChange={event => setStatus(event.target.value)}
                  placeholder="succeeded"
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  label="Limit"
                  value={limit}
                  onChange={event => setLimit(event.target.value)}
                />
              </Grid>
            </Grid>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={search}>
                Search Runs
              </Button>
            </Stack>
          </Stack>
        </InfoCard>
      </Grid>

      <Grid item xs={12}>
        <InfoCard title={`Results (${runs.length})`}>
          <Stack spacing={1}>
            {runs.map(run => (
              <Box key={run.id} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="subtitle2">{run.id}</Typography>
                <Typography variant="body2">
                  {run.runType} | {run.status} | tenant={run.tenantId}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  trace={run.traceId ?? '-'} task={run.taskId ?? '-'} created={new Date(run.createdAt).toLocaleString()}
                </Typography>
                <Box mt={1}>
                  <Button variant="text" onClick={() => openDetails(run)}>
                    View Details
                  </Button>
                </Box>
              </Box>
            ))}
            {runs.length === 0 && (
              <Typography variant="body2">No backup runs found. Execute backup actions first.</Typography>
            )}
          </Stack>
        </InfoCard>
      </Grid>

      {error && (
        <Grid item xs={12}>
          <Alert severity="error">{error}</Alert>
        </Grid>
      )}

      <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Backup Run Details</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2">Run ID: {selectedRun?.id}</Typography>
            <Typography variant="body2">Run Type: {selectedRun?.runType}</Typography>
            <Typography variant="body2">Status: {selectedRun?.status}</Typography>
            <Typography variant="body2">Linked Task: {selectedRun?.taskId ?? '-'}</Typography>
            <Typography variant="subtitle2">Run Details JSON</Typography>
            <Box component="pre" sx={{ whiteSpace: 'pre-wrap', margin: 0 }}>
              {JSON.stringify(selectedRun?.details ?? {}, null, 2)}
            </Box>
            {linkedTask && (
              <>
                <Typography variant="subtitle2">Linked Task Snapshot</Typography>
                <Box component="pre" sx={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                  {JSON.stringify(linkedTask, null, 2)}
                </Box>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
};
