import { useEffect, useMemo, useState } from 'react';

import { InfoCard, Progress } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import {
  IdentityAsCodeForm,
  ApplyIdentityAsCodeResult,
  identityAsCodeApiRef,
  IdentityAsCodeConfig,
} from '../../api/IdentityAsCodeApiClient';

const initialForm: IdentityAsCodeForm = {
  department: 'platform',
  team: 'team-a',
  user: {
    username: 'user-a',
    email: 'user-a@example.com',
  },
  vcluster: {
    name: 'vc-team-a',
    cpu: '4',
    memory: '8Gi',
    disk: '100Gi',
    network: '100Mbps',
  },
};

export const IdentityAsCodePage = () => {
  const api = useApi(identityAsCodeApiRef);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [config, setConfig] = useState<IdentityAsCodeConfig | undefined>();
  const [form, setForm] = useState<IdentityAsCodeForm>(initialForm);
  const [manifest, setManifest] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [applyResult, setApplyResult] = useState<ApplyIdentityAsCodeResult>();

  useEffect(() => {
    let active = true;
    const loadConfig = async () => {
      try {
        const data = await api.getConfig();
        if (active) {
          setConfig(data);
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

    loadConfig();
    return () => {
      active = false;
    };
  }, [api]);

  const canApply = useMemo(
    () => Boolean(form.department && form.team && form.user.username && form.user.email),
    [form],
  );

  const handleRender = async () => {
    setError(undefined);
    setApplyResult(undefined);
    try {
      const result = await api.render(form);
      setManifest(result.manifest);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleApply = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      const result = await api.apply(form);
      setApplyResult(result);
      setManifest(result.manifest);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Progress />;
  }

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={6}>
        <InfoCard title="Platform Integrations">
          <Stack spacing={1}>
            <Typography variant="body2">
              GitLab: {config?.integrations.gitlab.baseUrl ?? 'Not configured'}
            </Typography>
            <Typography variant="body2">
              Argo CD: {config?.integrations.argocd.baseUrl ?? 'Not configured'}
            </Typography>
            <Typography variant="body2">
              Provisioner Driver:{' '}
              {config?.integrations.provisioner?.driver ?? 'helm'}
            </Typography>
            <Typography variant="body2">
              Helm GitOps Path:{' '}
              {config?.integrations.provisioner?.helm?.gitOpsFilePath ??
                'Not configured'}
            </Typography>
            <Typography variant="body2">
              IaC Repo Path: {config?.integrations.gitlab.filePath ?? 'Not configured'}
            </Typography>
            <Typography variant="body2">
              GitLab Token:{' '}
              {config?.integrations.gitlab.tokenConfigured ? 'Configured' : 'Missing'}
            </Typography>
          </Stack>
        </InfoCard>
      </Grid>

      <Grid item xs={12} md={6}>
        <InfoCard title="Identity as Code Workflow">
          <Typography variant="body2">
            Organization and user provisioning is managed as YAML in Git. The
            backend will generate manifest content and can commit it to GitLab,
            then call vCluster Manager apply API.
          </Typography>
        </InfoCard>
      </Grid>

      <Grid item xs={12}>
        <InfoCard title="Create User and vCluster Allocation">
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Department"
                value={form.department}
                onChange={event =>
                  setForm(current => ({ ...current, department: event.target.value }))
                }
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Team"
                value={form.team}
                onChange={event =>
                  setForm(current => ({ ...current, team: event.target.value }))
                }
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="vCluster Name"
                value={form.vcluster.name}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    vcluster: { ...current.vcluster, name: event.target.value },
                  }))
                }
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Username"
                value={form.user.username}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    user: { ...current.user, username: event.target.value },
                  }))
                }
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Email"
                value={form.user.email}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    user: { ...current.user, email: event.target.value },
                  }))
                }
              />
            </Grid>

            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="CPU"
                value={form.vcluster.cpu}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    vcluster: { ...current.vcluster, cpu: event.target.value },
                  }))
                }
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="Memory"
                value={form.vcluster.memory}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    vcluster: { ...current.vcluster, memory: event.target.value },
                  }))
                }
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="Disk"
                value={form.vcluster.disk}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    vcluster: { ...current.vcluster, disk: event.target.value },
                  }))
                }
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                label="Network"
                value={form.vcluster.network}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    vcluster: { ...current.vcluster, network: event.target.value },
                  }))
                }
              />
            </Grid>
          </Grid>

          <Box mt={2}>
            <Stack direction="row" spacing={2}>
              <Button variant="outlined" onClick={handleRender}>
                Render YAML
              </Button>
              <Button
                variant="contained"
                onClick={handleApply}
                disabled={!canApply || submitting}
              >
                Apply via Backend
              </Button>
            </Stack>
          </Box>
        </InfoCard>
      </Grid>

      {manifest && (
        <Grid item xs={12}>
          <InfoCard title="Generated IaC YAML">
            <Box component="pre" sx={{ whiteSpace: 'pre-wrap', margin: 0 }}>
              {manifest}
            </Box>
          </InfoCard>
        </Grid>
      )}

      {(error || applyResult) && (
        <Grid item xs={12}>
          {error && <Alert severity="error">{error}</Alert>}
          {applyResult && !error && (
            <Alert severity="success">
              Applied request for team {form.team}. Manifest path:{' '}
              {applyResult.manifestPath}
            </Alert>
          )}
        </Grid>
      )}
    </Grid>
  );
};
