import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useApi } from '@backstage/core-plugin-api';

import {
  Box,
  Button,
  Chip,
  IconButton,
  Typography,
} from '@mui/material';
import { Theme, useTheme } from '@mui/material/styles';
import {
  ArrowForward,
  Build,
  CheckCircle,
  Close,
  Dns,
  HelpOutline,
  Security,
  Terminal,
  WarningAmber,
} from '@mui/icons-material';

import {
  AssistantChatResponse,
  smartOpsAssistantApiRef,
} from '../../api/SmartOpsAssistantApiClient';

import { getOpsPilotStyles } from './OpsPilotHome.styles';

type ViewType = 'k8s' | 'cicd' | 'vms' | 'empty';

interface ActionData {
  type: 'navigation' | 'approval';
  label: string;
  view?: ViewType;
  status?: 'pending' | 'approved' | 'rejected';
  agentId?: string;
  actionId?: string;
}

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  action?: ActionData;
  timestamp: string;
  isTyping?: boolean;
}

interface K8sNode {
  name: string;
  status: 'Ready' | 'NotReady';
  cpu: string;
  memory: string;
  pods: number;
  role: 'control-plane' | 'worker';
}

interface Pipeline {
  id: string;
  repo: string;
  status: 'success' | 'failed' | 'running';
  time: string;
  trigger: string;
}

const MOCK_NODES: K8sNode[] = [
  {
    name: 'control-plane-01',
    status: 'Ready',
    cpu: '15%',
    memory: '32%',
    pods: 12,
    role: 'control-plane',
  },
  {
    name: 'worker-pool-1-x86',
    status: 'Ready',
    cpu: '42%',
    memory: '65%',
    pods: 28,
    role: 'worker',
  },
  {
    name: 'worker-pool-2-x86',
    status: 'Ready',
    cpu: '38%',
    memory: '55%',
    pods: 24,
    role: 'worker',
  },
  {
    name: 'worker-pool-3-gpu',
    status: 'NotReady',
    cpu: '0%',
    memory: '0%',
    pods: 0,
    role: 'worker',
  },
];

const MOCK_PIPELINES: Pipeline[] = [
  {
    id: '#9821',
    repo: 'backend-service',
    status: 'running',
    time: '2m ago',
    trigger: 'Merge Request',
  },
  {
    id: '#9820',
    repo: 'frontend-portal',
    status: 'failed',
    time: '15m ago',
    trigger: 'Push main',
  },
  {
    id: '#9819',
    repo: 'auth-provider',
    status: 'success',
    time: '1h ago',
    trigger: 'Schedule',
  },
];

const BUILD_LOGS = `> frontend-portal@1.0.0 test
> jest

PASS src/components/Header.test.tsx
FAIL src/utils/auth.test.tsx
  ● Auth › should return token when login succeeds

    expect(received).toBe(expected) // Object.is equality

    Expected: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    Received: undefined

      12 |     const token = await login('user', 'pass');
      13 |     expect(token).toBe(mockToken);
      14 |   });

Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 4 passed, 5 total
Snapshots:   0 total
Time:        2.456 s
Ran all test suites.
npm ERR! Test failed.  See above for more details.`;

const TypingEffect = ({ text, onComplete }: { text: string; onComplete?: () => void }) => {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      setDisplayedText(prev => prev + text.charAt(index));
      index += 1;
      if (index === text.length) {
        clearInterval(timer);
        onComplete?.();
      }
    }, 20);

    return () => clearInterval(timer);
  }, [text, onComplete]);

  return (
    <Typography component="p" sx={{ whiteSpace: 'pre-wrap' }}>
      {displayedText}
    </Typography>
  );
};

const KubernetesPanel = ({
  styles,
  theme,
}: {
  styles: ReturnType<typeof getOpsPilotStyles>;
  theme: Theme;
}) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <Box sx={styles.clusterHeader}>
      <Box>
        <Typography variant="h5" sx={styles.clusterTitle}>
          <Dns sx={styles.iconInfo} /> Production Cluster (k8s-prod-01)
        </Typography>
        <Typography variant="body2" sx={styles.clusterMeta}>
          Version: v1.28.4 | Provider: Rancher RKE2
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Chip
          label="Healthy"
          size="small"
          sx={styles.successChip}
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={<Terminal fontSize="small" />}
          sx={{ color: theme.palette.text.primary, borderColor: theme.palette.divider }}
        >
          kubectl shell
        </Button>
      </Box>
    </Box>

    <Box sx={styles.topoCard}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography color={theme.palette.text.primary} fontWeight={600}>
          Cluster Topology
        </Typography>
        <Box sx={styles.topoLegend}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={styles.legendDotControl} />
            Control Plane
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={styles.legendDotWorker} />
            Worker (Ready)
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={styles.legendDotIssue} />
            Worker (Issue)
          </Box>
        </Box>
      </Box>
      <Box sx={styles.topoRow}>
        {MOCK_NODES.map(node => {
          const color =
            node.role === 'control-plane'
              ? theme.palette.info.main
              : node.status === 'NotReady'
                ? theme.palette.error.main
                : theme.palette.success.main;
          return (
            <Box key={node.name} sx={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
              <Box sx={styles.topoNode(color)}>
                <Dns sx={{ color }} />
                <Box sx={styles.topoBadge}>
                  {node.pods}
                </Box>
              </Box>
              <Typography sx={styles.nodeName}>
                {node.name}
              </Typography>
              <Typography sx={styles.nodeStatus(node.status === 'Ready')}>
                {node.status}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>

    <Box sx={styles.sectionCard}>
      <Box sx={styles.tableHeaderRow}>
        {['Node Name', 'Role', 'Status', 'CPU', 'Memory'].map(header => (
          <Typography key={header} sx={styles.tableHeaderCell}>
            {header}
          </Typography>
        ))}
      </Box>
      {MOCK_NODES.map(node => (
        <Box key={node.name} sx={styles.nodeRow}>
          <Typography sx={styles.tableMono}>
            {node.name}
          </Typography>
          <Typography sx={styles.tableRole}>
            {node.role}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {node.status === 'Ready' ? (
              <CheckCircle sx={styles.iconSuccess} />
            ) : (
              <WarningAmber sx={styles.iconError} />
            )}
            <Typography sx={node.status === 'Ready' ? styles.statusReady : styles.statusNotReady}>
              {node.status}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={styles.progressTrack}>
              <Box sx={{ ...styles.progressCpu, width: node.cpu }} />
            </Box>
            <Typography sx={{ fontSize: 11, color: theme.palette.text.primary }}>{node.cpu}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={styles.progressTrack}>
              <Box sx={{ ...styles.progressMemory, width: node.memory }} />
            </Box>
            <Typography sx={{ fontSize: 11, color: theme.palette.text.primary }}>{node.memory}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  </Box>
);

const CiCdPanel = ({
  styles,
  theme,
}: {
  styles: ReturnType<typeof getOpsPilotStyles>;
  theme: Theme;
}) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <Typography variant="h5" fontWeight={700} color={theme.palette.common.white} sx={{ display: 'flex', gap: 1 }}>
      <Build sx={{ color: theme.palette.warning.main }} /> CI/CD Pipelines
    </Typography>

    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 2fr' }, gap: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {MOCK_PIPELINES.map(pipe => (
          <Box key={pipe.id} sx={styles.pipelineCard(pipe.status === 'failed')}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
              <Typography sx={styles.pipelineTitle}>
                {pipe.repo}
              </Typography>
              <Chip
                size="small"
                label={pipe.status}
                sx={{
                  textTransform: 'uppercase',
                  fontSize: 10,
                  bgcolor:
                    pipe.status === 'success'
                      ? 'rgba(34, 197, 94, 0.2)'
                      : pipe.status === 'failed'
                        ? 'rgba(239, 68, 68, 0.2)'
                        : 'rgba(59, 130, 246, 0.2)',
                  color:
                    pipe.status === 'success'
                      ? theme.palette.success.main
                      : pipe.status === 'failed'
                        ? theme.palette.error.main
                        : theme.palette.info.main,
                }}
              />
            </Box>
            <Typography sx={styles.pipelineMeta}>
              {pipe.time} • {pipe.trigger}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
              {[0, 1, 2].map(i => (
                <Box
                  key={i}
                  sx={{
                    flex: 1,
                    height: 4,
                    borderRadius: 999,
                    bgcolor:
                      pipe.status === 'running'
                        ? i < 2
                          ? theme.palette.success.main
                          : theme.palette.divider
                        : pipe.status === 'failed'
                          ? i === 1
                            ? theme.palette.error.main
                            : theme.palette.success.main
                          : theme.palette.success.main,
                  }}
                />
              ))}
            </Box>
          </Box>
        ))}
      </Box>

      <Box sx={styles.logsPanel}>
        <Box sx={styles.logsHeader}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Terminal sx={{ fontSize: 16, color: theme.palette.text.secondary }} />
            <Typography sx={styles.logsHeaderText}>
              frontend-portal / build-job / logs
            </Typography>
          </Box>
          <IconButton size="small" sx={{ color: theme.palette.text.secondary }}>
            <HelpOutline fontSize="inherit" />
          </IconButton>
        </Box>
        <Box sx={styles.logsBody}>
          {BUILD_LOGS.split('\n').map((line, idx) => (
            <Typography
              key={idx}
              sx={{
                fontFamily: 'monospace',
                fontSize: 11,
                color: line.includes('FAIL')
                  ? theme.palette.error.main
                  : line.includes('PASS')
                    ? theme.palette.success.main
                    : line.includes('Expected')
                      ? theme.palette.success.light
                      : line.includes('Received')
                        ? theme.palette.error.light
                        : theme.palette.text.primary,
              }}
            >
              <Box component="span" sx={{ color: theme.palette.divider, mr: 1 }}>
                {idx + 124}
              </Box>
              {line}
            </Typography>
          ))}
          <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: theme.palette.text.secondary }}>
            _
          </Typography>
        </Box>
      </Box>
    </Box>
  </Box>
);

const SuggestionChip = ({
  text,
  onClick,
  styles,
}: {
  text: string;
  onClick: () => void;
  styles: ReturnType<typeof getOpsPilotStyles>;
}) => (
  <Button
    onClick={onClick}
    size="small"
    sx={styles.suggestionChip}
  >
    {text}
  </Button>
);

const OpsPilotHome = () => {
  const assistantApi = useApi(smartOpsAssistantApiRef);
  const theme = useTheme();
  const styles = getOpsPilotStyles(theme);
  const location = useLocation();
  const [activeView, setActiveView] = useState<ViewType>('empty');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'ai',
      text: '你好，我是智维领航（SmartOps）。我已连接到生产环境 K8s 集群及 CI/CD 管道。请问今天需要处理什么任务？',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const view = params.get('view');
    if (view === 'k8s' || view === 'cicd' || view === 'vms' || view === 'empty') {
      setActiveView(view as ViewType);
    }
  }, [location.search]);

  const inferViewByAgent = (agentId: string): ViewType => {
    if (agentId.includes('kubernetes') || agentId.includes('k8s')) {
      return 'k8s';
    }
    if (agentId.includes('cicd') || agentId.includes('gitlab') || agentId.includes('argo')) {
      return 'cicd';
    }
    return 'vms';
  };

  const handleSendMessage = (textOverride?: string) => {
    const textToSend = textOverride ?? inputValue;
    if (!textToSend.trim()) return;
    setInputValue('');

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsThinking(true);

    const aiMessageId = (Date.now() + 1).toString();
    const aiResponse: Message = {
      id: aiMessageId,
      sender: 'ai',
      text: '',
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
    setMessages(prev => [...prev, aiResponse]);

    void (async () => {
      let pendingChunks = '';
      let streamEnded = false;
      let receivedDelta = false;
      let donePayload: AssistantChatResponse | undefined;

      const appendStreamText = (chunk: string) => {
        if (!chunk) {
          return;
        }
        setMessages(prev =>
          prev.map(msg =>
            msg.id === aiMessageId ? { ...msg, text: msg.text + chunk } : msg,
          ),
        );
      };

      const applyDonePayload = (chatResult: AssistantChatResponse) => {
        setMessages(prev =>
          prev.map(msg => {
            if (msg.id !== aiMessageId) {
              return msg;
            }

            const updated: Message = {
              ...msg,
              text: chatResult.reply || msg.text,
            };

            if (chatResult.selectedAction) {
              if (chatResult.selectedAction.requiresApproval) {
                updated.action = {
                  type: 'approval',
                  label: chatResult.selectedAction.title,
                  status: 'pending',
                  agentId: chatResult.selectedAction.agentId,
                  actionId: chatResult.selectedAction.actionId,
                };
              } else {
                updated.action = {
                  type: 'navigation',
                  label: `查看 ${chatResult.selectedAction.title} 结果`,
                  view: inferViewByAgent(chatResult.selectedAction.agentId),
                  agentId: chatResult.selectedAction.agentId,
                  actionId: chatResult.selectedAction.actionId,
                };
              }
            }

            return updated;
          }),
        );
      };

      const flushTimer = window.setInterval(() => {
        if (pendingChunks.length > 0) {
          const nextChunk = pendingChunks.slice(0, 2);
          pendingChunks = pendingChunks.slice(2);
          appendStreamText(nextChunk);
        }

        if (streamEnded && pendingChunks.length === 0) {
          window.clearInterval(flushTimer);
          if (donePayload) {
            applyDonePayload(donePayload);
          }
          setIsThinking(false);
        }
      }, 16);

      try {
        await assistantApi.chatStream(
          {
            text: textToSend,
            autoExecute: false,
          },
          {
            onDelta: chunk => {
              pendingChunks += chunk;
              if (!receivedDelta) {
                receivedDelta = true;
                setIsThinking(false);
              }
            },
            onDone: chatResult => {
              donePayload = chatResult;
              streamEnded = true;
            },
          },
        );
      } catch (error) {
        window.clearInterval(flushTimer);
        setMessages(prev =>
          prev.map(msg =>
            msg.id === aiMessageId
              ? { ...msg, text: `调用智能编排失败：${(error as Error).message}` }
              : msg,
          ),
        );
        setIsThinking(false);
      } finally {
        streamEnded = true;
        if (pendingChunks.length === 0) {
          window.clearInterval(flushTimer);
          if (donePayload) {
            applyDonePayload(donePayload);
          }
        }
        setIsThinking(false);
      }
    })();
  };

  const handleApproval = (msgId: string, status: 'approved' | 'rejected') => {
    setMessages(prev =>
      prev.map(msg =>
        msg.id === msgId && msg.action
          ? { ...msg, action: { ...msg.action, status } }
          : msg,
      ),
    );

    setTimeout(() => {
      const feedbackMsg: Message = {
        id: Date.now().toString(),
        sender: 'ai',
        text: status === 'approved' ? '✅ 授权成功，正在执行重启任务...' : '🚫 操作已取消。',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isTyping: true,
      };
      setMessages(prev => [...prev, feedbackMsg]);
    }, 400);
  };

  return (
    <Box sx={styles.main}>
      <Box sx={styles.chatPanel}>
        <Box sx={styles.chatHeader}>
          <Typography sx={styles.chatHeaderTitle}>
            <Box sx={styles.chatStatusDot} />
            智维领航
          </Typography>
          <Button size="small" sx={styles.headerButton}>
            清空记录
          </Button>
        </Box>

        <Box sx={styles.chatBody}>
          {messages.map(msg => (
            <Box
              key={msg.id}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  gap: 2,
                  maxWidth: '95%',
                  flexDirection: msg.sender === 'user' ? 'row-reverse' : 'row',
                }}
              >
                <Box sx={styles.messageAvatar(msg.sender === 'ai')}>
                  {msg.sender === 'ai' ? (
                    <Security fontSize="small" />
                  ) : (
                    <Typography fontSize={10}>ME</Typography>
                  )}
                </Box>
                <Box sx={styles.messageBubble(msg.sender === 'user')}>
                  {msg.isTyping && msg.sender === 'ai' ? (
                    <TypingEffect text={msg.text} />
                  ) : (
                    <Typography component="p" sx={{ whiteSpace: 'pre-wrap' }}>
                      {msg.text}
                    </Typography>
                  )}
                </Box>
              </Box>
              {!msg.isTyping && msg.action?.type === 'navigation' && (
                <Button
                  variant="outlined"
                  onClick={() => msg.action?.view && setActiveView(msg.action.view)}
                  sx={{
                    ...styles.navButton,
                    alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                  }}
                  endIcon={<ArrowForward />}
                >
                  {msg.action.label}
                </Button>
              )}
              {!msg.isTyping && msg.action?.type === 'approval' && (
                <Box sx={styles.approvalCard}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
                    <WarningAmber sx={styles.iconWarning} />
                    <Box>
                      <Typography sx={styles.approvalTitle}>需要审批</Typography>
                      <Typography sx={styles.approvalSubtitle}>操作：{msg.action.label}</Typography>
                    </Box>
                  </Box>
                  {msg.action.status === 'pending' ? (
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                        <Button
                          variant="outlined"
                          onClick={() => handleApproval(msg.id, 'rejected')}
                          startIcon={<Close />}
                          sx={{ borderColor: theme.palette.divider, color: theme.palette.text.primary }}
                        >
                          拒绝
                        </Button>
                        <Button
                          variant="contained"
                          onClick={() => handleApproval(msg.id, 'approved')}
                          startIcon={<CheckCircle />}
                          sx={{ bgcolor: theme.palette.primary.main }}
                        >
                          通过
                        </Button>
                    </Box>
                  ) : (
                    <Chip
                      label={msg.action.status === 'approved' ? '已通过' : '已拒绝'}
                      sx={styles.approvalChip(msg.action.status === 'approved')}
                    />
                  )}
                </Box>
              )}
              <Typography sx={styles.messageTimestamp}>{msg.timestamp}</Typography>
            </Box>
          ))}
          {isThinking && (
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <Box sx={styles.messageAvatar(true)}>
                <Security sx={{ fontSize: 16 }} />
              </Box>
              <Box
                sx={{
                  bgcolor: theme.palette.background.default,
                  borderRadius: 2,
                  px: 2,
                  py: 1.5,
                  border: `1px solid ${theme.palette.divider}`,
                }}
              >
                <Typography sx={styles.textSecondary}>正在思考...</Typography>
              </Box>
            </Box>
          )}
          <div ref={messagesEndRef} />
        </Box>

        <Box sx={styles.chatFooter}>
          <Box sx={{ position: 'relative' }}>
            <Box
              component="textarea"
              value={inputValue}
              onChange={event => setInputValue(event.target.value)}
              placeholder="发送指令（例如：'检查日志'）..."
              style={styles.inputArea as React.CSSProperties}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            <IconButton
              onClick={() => handleSendMessage()}
              sx={styles.inputButton}
              disabled={!inputValue.trim()}
            >
              <ArrowForward fontSize="small" />
            </IconButton>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            <SuggestionChip
              text="K8s 状态"
              onClick={() => handleSendMessage('检查集群状态')}
              styles={styles}
            />
            <SuggestionChip
              text="构建失败"
              onClick={() => handleSendMessage('为什么构建失败了？')}
              styles={styles}
            />
            <SuggestionChip
              text="重启节点"
              onClick={() =>
                handleSendMessage('请求修复并重启 worker-pool-3-gpu 节点')
              }
              styles={styles}
            />
          </Box>
        </Box>
      </Box>

      <Box sx={styles.canvas}>
        <Box sx={styles.canvasHeader}>
          <Typography sx={styles.headerCrumb}>
            平台 /{' '}
            <Box component="span" sx={styles.headerCrumbActive}>
              {activeView === 'empty'
                ? '首页'
                : activeView === 'k8s'
                  ? 'K8s'
                  : activeView === 'cicd'
                    ? '持续交付'
                    : '虚拟机'}
            </Box>
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={styles.systemChip}>
              <Box sx={styles.statusDot} />
              <Typography sx={{ fontSize: 12, color: theme.palette.text.primary }}>
                系统健康
              </Typography>
            </Box>
          </Box>
        </Box>

        <Box sx={styles.canvasBody}>
          <Box sx={{ width: '100%' }}>
            {activeView === 'empty' && (
              <Box sx={styles.emptyState}>
                <Box sx={styles.emptyBadge}>
                  <Security sx={{ color: theme.palette.info.main, fontSize: 36 }} />
                </Box>
                <Box>
                  <Typography
                    variant="h3"
                    sx={{ fontWeight: 700, color: theme.palette.text.primary }}
                  >
                    智维领航 (SmartOps)
                  </Typography>
                  <Typography sx={styles.emptySubtitle}>
                    你的智能平台工程伙伴。随时提出部署服务、排查日志或管理基础设施。
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                    gap: 2,
                    width: '100%',
                    maxWidth: 520,
                  }}
                >
                  <Button
                    onClick={() => {
                      setActiveView('k8s');
                      handleSendMessage('检查集群状态');
                    }}
                    sx={styles.emptyActionButton}
                  >
                    <Dns sx={styles.iconInfo} />
                    <Box>
                      <Typography fontWeight={600}>基础设施</Typography>
                      <Typography sx={styles.cardSubtitle}>
                        K8s 集群与节点管理
                      </Typography>
                    </Box>
                  </Button>
                  <Button
                    onClick={() => {
                      setActiveView('cicd');
                      handleSendMessage('为什么构建失败了？');
                    }}
                    sx={styles.emptyActionButton}
                  >
                    <Build sx={{ color: theme.palette.warning.main }} />
                    <Box>
                      <Typography fontWeight={600}>持续交付</Typography>
                      <Typography sx={styles.cardSubtitle}>
                        流水线与构建日志
                      </Typography>
                    </Box>
                  </Button>
                </Box>
              </Box>
            )}
            {activeView === 'k8s' && (
              <KubernetesPanel styles={styles} theme={theme} />
            )}
            {activeView === 'cicd' && <CiCdPanel styles={styles} theme={theme} />}
            {activeView === 'vms' && (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  color: theme.palette.text.secondary,
                  mt: 8,
                }}
              >
                <Terminal sx={{ fontSize: 48, opacity: 0.2 }} />
                <Typography>虚拟机插件已加载</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default OpsPilotHome;
