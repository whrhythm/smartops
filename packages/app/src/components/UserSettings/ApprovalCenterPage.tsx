import { useCallback, useEffect, useState } from 'react';

import { InfoCard, Progress } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import {
  agentPlatformApiRef,
  ApprovalTicketSnapshot,
  TaskSnapshot,
} from '../../api/AgentPlatformApiClient';

export const ApprovalCenterPage = () => {
  const api = useApi(agentPlatformApiRef);

  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState<ApprovalTicketSnapshot[]>([]);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [decidedBy, setDecidedBy] = useState('platform-admin');
  const [submittingTicketId, setSubmittingTicketId] = useState<string>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedApproval, setSelectedApproval] =
    useState<ApprovalTicketSnapshot>();
  const [selectedTask, setSelectedTask] = useState<TaskSnapshot>();

  const load = useCallback(async () => {
    setError(undefined);
    const list = await api.listApprovals({
      status: 'pending',
      limit: 50,
    });
    setApprovals(list);
  }, [api]);

  useEffect(() => {
    let active = true;

    const init = async () => {
      try {
        await load();
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

    init();
    return () => {
      active = false;
    };
  }, [load]);

  const decide = async (
    approval: ApprovalTicketSnapshot,
    decision: 'approved' | 'rejected',
  ) => {
    setError(undefined);
    setMessage(undefined);
    setSubmittingTicketId(approval.id);
    try {
      const result = await api.decideApproval(approval.id, {
        decision,
        decidedBy,
        note:
          decision === 'approved'
            ? 'Approved in settings approval center'
            : 'Rejected in settings approval center',
      });

      setMessage(
        `Ticket ${approval.id} -> ${result.decision}, resumed=${result.resumedExecution}`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmittingTicketId(undefined);
    }
  };

  const openDetails = async (approval: ApprovalTicketSnapshot) => {
    setError(undefined);
    setDetailsLoading(true);
    setDetailsOpen(true);
    setSelectedApproval(approval);
    setSelectedTask(undefined);

    try {
      const task = await api.getTask(approval.taskId);
      setSelectedTask(task);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDetailsLoading(false);
    }
  };

  if (loading) {
    return <Progress />;
  }

  return (
    <Grid container spacing={3}>
      <Grid item xs={12}>
        <InfoCard title="Approval Center">
          <Stack spacing={2}>
            <Typography variant="body2">
              Review and decide pending high-risk agent actions. Approved tickets
              automatically resume task execution.
            </Typography>
            <TextField
              fullWidth
              label="Decided By"
              value={decidedBy}
              onChange={event => setDecidedBy(event.target.value)}
            />
          </Stack>
        </InfoCard>
      </Grid>

      <Grid item xs={12}>
        <InfoCard title={`Pending Tickets (${approvals.length})`}>
          {approvals.length === 0 ? (
            <Typography variant="body2">No pending approval tickets.</Typography>
          ) : (
            <Stack spacing={2}>
              {approvals.map(item => (
                <Box
                  key={item.id}
                  sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}
                >
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="subtitle2">{item.id}</Typography>
                      <Chip label={item.riskLevel} color="error" size="small" />
                      <Chip label={item.status} size="small" variant="outlined" />
                    </Stack>
                    <Typography variant="body2">
                      Agent: {item.agentId} / {item.actionId}
                    </Typography>
                    <Typography variant="body2">Task: {item.taskId}</Typography>
                    <Typography variant="body2">Reason: {item.reason}</Typography>
                    <Typography variant="caption" color="textSecondary">
                      Created: {new Date(item.createdAt).toLocaleString()}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="text"
                        onClick={() => openDetails(item)}
                        disabled={submittingTicketId === item.id}
                      >
                        View Task
                      </Button>
                      <Button
                        variant="contained"
                        color="success"
                        onClick={() => decide(item, 'approved')}
                        disabled={submittingTicketId === item.id || !decidedBy.trim()}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={() => decide(item, 'rejected')}
                        disabled={submittingTicketId === item.id || !decidedBy.trim()}
                      >
                        Reject
                      </Button>
                    </Stack>
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </InfoCard>
      </Grid>

      {message && (
        <Grid item xs={12}>
          <Alert severity="success">{message}</Alert>
        </Grid>
      )}

      {error && (
        <Grid item xs={12}>
          <Alert severity="error">{error}</Alert>
        </Grid>
      )}

      <Dialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Approval Task Details</DialogTitle>
        <DialogContent dividers>
          {detailsLoading ? (
            <Progress />
          ) : (
            <Stack spacing={2}>
              <Typography variant="body2">
                Ticket: {selectedApproval?.id ?? '-'}
              </Typography>
              <Typography variant="body2">
                Agent: {selectedApproval?.agentId ?? '-'} /{' '}
                {selectedApproval?.actionId ?? '-'}
              </Typography>
              <Typography variant="body2">
                Task Status: {selectedTask?.status ?? '-'}
              </Typography>
              <Typography variant="body2">
                Trace ID: {selectedTask?.traceId ?? '-'}
              </Typography>
              <Typography variant="body2">
                Input Prompt: {selectedTask?.inputPrompt ?? '-'}
              </Typography>
              <Typography variant="subtitle2">Request Payload</Typography>
              <Box component="pre" sx={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {JSON.stringify(selectedTask?.requestPayload ?? {}, null, 2)}
              </Box>
              <Typography variant="subtitle2">Response Payload</Typography>
              <Box component="pre" sx={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {JSON.stringify(selectedTask?.responsePayload ?? null, null, 2)}
              </Box>
              {selectedTask?.errorMessage && (
                <Alert severity="warning">{selectedTask.errorMessage}</Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
};
