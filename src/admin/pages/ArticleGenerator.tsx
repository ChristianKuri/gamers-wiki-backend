import React from 'react';
import {
  Main,
  Box,
  Typography,
  Button,
  Field,
  TextInput,
  Textarea,
  Flex,
  Modal,
  Loader,
  Badge,
  ProgressBar,
  Divider,
  SingleSelect,
  SingleSelectOption,
} from '@strapi/design-system';
import {
  Play,
  Check,
  Cross,
  Search,
  Pencil,
  ArrowRight,
} from '@strapi/icons';
import { Layouts } from '@strapi/strapi/admin';

type ArticleGenerationPhase = 'scout' | 'editor' | 'specialist' | 'reviewer' | 'validation';
type ArticleCategorySlug = 'news' | 'reviews' | 'guides' | 'lists';
type WizardStep = 1 | 2 | 3;

const ARTICLE_CATEGORIES: { value: ArticleCategorySlug | ''; label: string; description: string }[] = [
  { value: '', label: 'Auto-detect', description: 'Let AI choose the best article type' },
  { value: 'guides', label: 'Guide', description: 'How-to guides, walkthroughs, tips' },
  { value: 'reviews', label: 'Review', description: 'Game reviews and analysis' },
  { value: 'news', label: 'News', description: 'News articles and announcements' },
  { value: 'lists', label: 'List', description: 'Top 10, best of, ranked lists' },
];

interface PhaseConfig {
  name: string;
  description: string;
  progressStart: number;
  progressEnd: number;
}

const PHASES: Record<ArticleGenerationPhase, PhaseConfig> = {
  scout: {
    name: 'Research',
    description: 'Gathering sources and information',
    progressStart: 0,
    progressEnd: 30,
  },
  editor: {
    name: 'Planning',
    description: 'Creating article structure',
    progressStart: 30,
    progressEnd: 50,
  },
  specialist: {
    name: 'Writing',
    description: 'Generating article content',
    progressStart: 50,
    progressEnd: 85,
  },
  reviewer: {
    name: 'Review',
    description: 'Quality check and fixes',
    progressStart: 85,
    progressEnd: 95,
  },
  validation: {
    name: 'Validation',
    description: 'Final checks',
    progressStart: 95,
    progressEnd: 100,
  },
};

const PHASE_ORDER: ArticleGenerationPhase[] = ['scout', 'editor', 'specialist', 'reviewer', 'validation'];

interface GameSearchResult {
  igdbId: number;
  name: string;
  releaseDate: string | null;
  coverUrl: string | null;
  platforms: string[];
  rating?: number;
}

type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'error';

interface PhaseState {
  status: PhaseStatus;
  progress: number;
  message?: string;
  startTime?: number;
  endTime?: number;
}

interface SSEProgressEvent {
  type: 'progress';
  phase: ArticleGenerationPhase;
  progress: number;
  message?: string;
  timestamp: string;
}

interface SSEStartEvent {
  type: 'start';
  game: { documentId: string; name: string; slug: string };
  timestamp: string;
}

interface SSECompleteEvent {
  type: 'complete';
  post: { id: number; documentId: string };
  draft: {
    title: string;
    categorySlug: string;
    excerpt: string;
    description: string;
    markdown: string;
    sources: readonly string[];
  };
  metadata: {
    totalDurationMs: number;
    totalCostUsd?: number;
    sourcesCollected: number;
    researchConfidence: string;
  };
  game: { documentId: string; name: string; slug: string };
  published: boolean;
  timestamp: string;
}

interface SSEErrorEvent {
  type: 'error';
  code: string;
  message: string;
  timestamp: string;
}

type SSEEvent = SSEProgressEvent | SSEStartEvent | SSECompleteEvent | SSEErrorEvent;

interface GenerationResult {
  success: boolean;
  post?: { id: number; documentId: string };
  draft?: SSECompleteEvent['draft'];
  metadata?: SSECompleteEvent['metadata'];
  game?: { documentId: string; name: string; slug: string };
  error?: { code: string; message: string };
}

interface LogEntry {
  timestamp: string;
  phase?: ArticleGenerationPhase;
  message: string;
  type: 'info' | 'success' | 'error' | 'phase';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function createInitialPhaseStates(): Record<ArticleGenerationPhase, PhaseState> {
  return {
    scout: { status: 'pending', progress: 0 },
    editor: { status: 'pending', progress: 0 },
    specialist: { status: 'pending', progress: 0 },
    reviewer: { status: 'pending', progress: 0 },
    validation: { status: 'pending', progress: 0 },
  };
}

const PhaseProgress: React.FC<{
  phases: Record<ArticleGenerationPhase, PhaseState>;
  currentPhase: ArticleGenerationPhase | null;
  overallProgress: number;
}> = ({ phases, currentPhase, overallProgress }) => {
  return (
    <Box>
      <Flex justifyContent="space-between" alignItems="center" marginBottom={3}>
        <Typography variant="epsilon" fontWeight="bold" textColor="neutral600">
          GENERATION PROGRESS
        </Typography>
        <Typography variant="pi" fontWeight="bold" textColor="primary600">
          {overallProgress}%
        </Typography>
      </Flex>
      <ProgressBar value={overallProgress} size="S" />
      <Divider marginTop={4} marginBottom={4} />
      <Flex direction="column" gap={2}>
        {PHASE_ORDER.map((phaseKey) => {
          const phase = phases[phaseKey];
          const config = PHASES[phaseKey];
          const isActive = currentPhase === phaseKey;
          const isCompleted = phase.status === 'completed';
          const isError = phase.status === 'error';

          return (
            <Flex key={phaseKey} gap={3} alignItems="center" padding={2} style={{
              background: isActive ? '#f5f5ff' : 'transparent',
              borderRadius: '6px',
              transition: 'background 0.2s ease',
            }}>
              <Box style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                background: isCompleted ? '#10b981' : isError ? '#ef4444' : isActive ? '#4945ff' : '#e4e4e7',
              }}>
                {isCompleted ? (
                  <Check width={10} height={10} color="#fff" />
                ) : isError ? (
                  <Cross width={10} height={10} color="#fff" />
                ) : null}
              </Box>
              <Box flex={1} minWidth={0}>
                <Typography variant="pi" fontWeight={isActive ? 'bold' : 'regular'} textColor="neutral700">
                  {config.name}
                </Typography>
              </Box>
              <Typography variant="pi" textColor="neutral500" style={{ fontSize: '12px', minWidth: 'fit-content' }}>
                {config.progressStart}-{config.progressEnd}%
              </Typography>
            </Flex>
          );
        })}
      </Flex>
    </Box>
  );
};

const ActivityLog: React.FC<{ logs: LogEntry[]; isGenerating: boolean }> = ({ logs, isGenerating }) => {
  const logEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <Box style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}>
      <Flex justifyContent="space-between" alignItems="center" marginBottom={3}>
        <Typography variant="epsilon" fontWeight="bold" textColor="neutral600">
          ACTIVITY LOG
        </Typography>
        {isGenerating && (
          <Flex gap={2} alignItems="center">
            <Loader small />
            <Typography variant="pi" textColor="primary600">Generating</Typography>
          </Flex>
        )}
      </Flex>
      <Box
        padding={3}
        hasRadius
        style={{
          flex: 1,
          background: '#1e1e2f',
          overflowY: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          fontSize: '11px',
          lineHeight: '1.6',
        }}
      >
        {logs.length === 0 ? (
          <Typography variant="pi" textColor="neutral400" style={{ color: '#6b6b8a' }}>
            Waiting to start...
          </Typography>
        ) : (
          logs.map((log, index) => (
            <Flex key={index} gap={2} marginBottom={1} style={{ alignItems: 'flex-start' }}>
              <Typography
                variant="pi"
                style={{
                  color: '#6b6b8a',
                  minWidth: '70px',
                  fontFamily: 'inherit',
                }}
              >
                {formatTime(log.timestamp)}
              </Typography>
              {log.phase && (
                <Typography
                  variant="pi"
                  style={{
                    color: '#8b5cf6',
                    minWidth: '60px',
                    fontFamily: 'inherit',
                  }}
                >
                  [{PHASES[log.phase]?.name}]
                </Typography>
              )}
              <Typography
                variant="pi"
                style={{
                  color: log.type === 'error' ? '#f87171' :
                         log.type === 'success' ? '#4ade80' :
                         log.type === 'phase' ? '#8b5cf6' : '#e2e8f0',
                  fontFamily: 'inherit',
                  flex: 1,
                }}
              >
                {log.message}
              </Typography>
            </Flex>
          ))
        )}
        <div ref={logEndRef} />
      </Box>
    </Box>
  );
};

const ResultModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  result: GenerationResult | null;
}> = ({ isOpen, onClose, result }) => {
  if (!result) return null;

  const handleViewPost = () => {
    if (result.post) {
      window.location.href = `/admin/content-manager/collection-types/api::post.post/${result.post.documentId}`;
    }
  };

  return (
    <Modal.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            {result.success ? 'Article Generated' : 'Generation Failed'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {result.success && result.draft ? (
            <Box>
              <Typography variant="delta" fontWeight="bold" marginBottom={2}>
                {result.draft.title}
              </Typography>
              <Typography variant="pi" textColor="neutral600" marginBottom={4}>
                {result.game?.name}
              </Typography>

              <Divider />

              <Flex gap={4} marginTop={4}>
                <Box>
                  <Typography variant="beta" fontWeight="bold">
                    {result.metadata?.totalDurationMs ? formatDuration(result.metadata.totalDurationMs) : '-'}
                  </Typography>
                  <Typography variant="pi" textColor="neutral500" style={{ fontSize: '12px' }}>
                    Duration
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="beta" fontWeight="bold">
                    {result.metadata?.sourcesCollected || 0}
                  </Typography>
                  <Typography variant="pi" textColor="neutral500" style={{ fontSize: '12px' }}>
                    Sources
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="beta" fontWeight="bold">
                    {result.metadata?.researchConfidence || '-'}
                  </Typography>
                  <Typography variant="pi" textColor="neutral500" style={{ fontSize: '12px' }}>
                    Confidence
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="beta" fontWeight="bold">
                    ${result.metadata?.totalCostUsd?.toFixed(3) || '0.00'}
                  </Typography>
                  <Typography variant="pi" textColor="neutral500" style={{ fontSize: '12px' }}>
                    Cost
                  </Typography>
                </Box>
              </Flex>

              <Divider />

              <Box marginTop={4}>
                <Typography variant="pi" textColor="neutral500" marginBottom={1}>
                  EXCERPT
                </Typography>
                <Typography variant="omega">{result.draft.excerpt}</Typography>
              </Box>
            </Box>
          ) : (
            <Box textAlign="center" padding={6}>
              <Cross width={48} height={48} color="#ef4444" />
              <Typography variant="delta" textColor="danger600" marginTop={4}>
                {result.error?.message || 'An error occurred'}
              </Typography>
              {result.error?.code && (
                <Typography variant="pi" textColor="neutral500" marginTop={2}>
                  Error: {result.error.code}
                </Typography>
              )}
            </Box>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">Close</Button>
          </Modal.Close>
          {result.success && result.post && (
            <Button onClick={handleViewPost} endIcon={<ArrowRight />}>
              Edit Article
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

const ArticleGenerator: React.FC = () => {
  const [wizardStep, setWizardStep] = React.useState<WizardStep>(1);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isSearching, setIsSearching] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<GameSearchResult[]>([]);
  const [selectedGame, setSelectedGame] = React.useState<GameSearchResult | null>(null);
  const [instruction, setInstruction] = React.useState('');
  const [categorySlug, setCategorySlug] = React.useState<ArticleCategorySlug | ''>('');
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [phases, setPhases] = React.useState<Record<ArticleGenerationPhase, PhaseState>>(createInitialPhaseStates());
  const [currentPhase, setCurrentPhase] = React.useState<ArticleGenerationPhase | null>(null);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [overallProgress, setOverallProgress] = React.useState(0);
  const [result, setResult] = React.useState<GenerationResult | null>(null);
  const [showResultModal, setShowResultModal] = React.useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResults([]);

    try {
      const response = await fetch(`/api/game-fetcher/search?q=${encodeURIComponent(searchQuery)}&limit=24`);
      const data = await response.json();

      if (data.results) {
        setSearchResults(data.results);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleSelectGame = (game: GameSearchResult) => {
    setSelectedGame(game);
    setSearchResults([]);
    setSearchQuery(game.name);
    setWizardStep(2);
  };

  const addLog = (type: LogEntry['type'], message: string, phase?: ArticleGenerationPhase) => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toISOString(),
      type,
      message,
      phase,
    }]);
  };

  const handleGenerate = async () => {
    if (!selectedGame) return;

    setIsGenerating(true);
    setPhases(createInitialPhaseStates());
    setCurrentPhase(null);
    setLogs([]);
    setOverallProgress(0);
    setResult(null);

    try {
      const response = await fetch('/api/article-generator/generate-sse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          igdbId: selectedGame.igdbId,
          instruction: instruction || undefined,
          ...(categorySlug ? { categorySlug } : {}),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let lastPhase: ArticleGenerationPhase | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const event: SSEEvent = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'start':
                addLog('info', `Starting: ${event.game.name}`);
                break;

              case 'progress': {
                const { phase, progress, message } = event;

                if (lastPhase && lastPhase !== phase) {
                  setPhases(prev => ({
                    ...prev,
                    [lastPhase!]: {
                      ...prev[lastPhase!],
                      status: 'completed',
                      progress: 100,
                      endTime: Date.now(),
                    },
                  }));
                  addLog('phase', `${PHASES[lastPhase].name} completed`, lastPhase);
                }

                if (lastPhase !== phase) {
                  addLog('phase', `Starting ${PHASES[phase].name}...`, phase);
                }

                setCurrentPhase(phase);
                setPhases(prev => ({
                  ...prev,
                  [phase]: {
                    status: 'in_progress',
                    progress,
                    message,
                    startTime: prev[phase].startTime || Date.now(),
                  },
                }));

                const phaseConfig = PHASES[phase];
                const phaseProgress = (progress / 100) * (phaseConfig.progressEnd - phaseConfig.progressStart);
                const overall = phaseConfig.progressStart + phaseProgress;
                setOverallProgress(Math.round(overall));

                if (message) {
                  addLog('info', message, phase);
                }

                lastPhase = phase;
                break;
              }

              case 'complete':
                setPhases(prev => {
                  const updated = { ...prev };
                  for (const p of PHASE_ORDER) {
                    updated[p] = {
                      ...updated[p],
                      status: 'completed',
                      progress: 100,
                      endTime: updated[p].endTime || Date.now(),
                    };
                  }
                  return updated;
                });
                setCurrentPhase(null);
                setOverallProgress(100);

                addLog('success', `Article: ${event.draft.title}`);
                addLog('success', `Time: ${formatDuration(event.metadata.totalDurationMs)}`);

                setResult({
                  success: true,
                  post: event.post,
                  draft: event.draft,
                  metadata: event.metadata,
                  game: event.game,
                });
                setShowResultModal(true);
                break;

              case 'error':
                addLog('error', event.message);
                if (currentPhase) {
                  setPhases(prev => ({
                    ...prev,
                    [currentPhase]: {
                      ...prev[currentPhase],
                      status: 'error',
                    },
                  }));
                }
                setResult({
                  success: false,
                  error: { code: event.code, message: event.message },
                });
                setShowResultModal(true);
                break;
            }
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog('error', message);
      setResult({
        success: false,
        error: { code: 'NETWORK_ERROR', message },
      });
      setShowResultModal(true);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setWizardStep(1);
    setSelectedGame(null);
    setSearchQuery('');
    setInstruction('');
    setCategorySlug('');
    setPhases(createInitialPhaseStates());
    setCurrentPhase(null);
    setLogs([]);
    setOverallProgress(0);
    setResult(null);
    setSearchResults([]);
  };

  const canGenerate = selectedGame !== null;

  // Responsive layout CSS for state-based visibility
  const layoutStyles = `
    @media (max-width: 1023px) {
      .layout-config-panel.layout-generating { display: none !important; }
      .layout-progress-panel.layout-idle { display: none !important; }
      .layout-config-panel.layout-idle { flex: 1 1 100% !important; max-width: 100% !important; }
      .layout-progress-panel.layout-generating { flex: 1 1 100% !important; max-width: 100% !important; }
      .config-form-layout { flex-direction: column !important; }
      .config-form-layout > * { flex: 1 1 auto !important; }
      .selected-game-container { overflow: visible !important; }
      .layout-main-container { overflow: auto !important; }
    }
  `;

  return (
    <Main style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{layoutStyles}</style>
      <Layouts.Header
        title="AI Article Generator"
        subtitle="Generate high-quality game articles with AI"
        primaryAction={
          result?.success ? (
            <Button variant="secondary" onClick={handleReset}>
              Generate Another
            </Button>
          ) : (
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate || isGenerating}
              startIcon={isGenerating ? <Loader small /> : <Play />}
            >
              {isGenerating ? 'Generating...' : 'Generate Article'}
            </Button>
          )
        }
      />

      <Box
        padding={6}
        className="layout-main-container"
        style={{
          flex: 1,
          display: 'flex',
          gap: '24px',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <Box
          className={`layout-config-panel ${isGenerating ? 'layout-generating' : 'layout-idle'}`}
          style={{
            flex: isGenerating ? '0 0 25%' : '0 0 70%',
            maxWidth: isGenerating ? '25%' : '70%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            transition: 'flex 0.3s ease, max-width 0.3s ease',
          }}
        >
          <Box
            padding={5}
            background="neutral0"
            hasRadius
            shadow="filterShadow"
            style={{ height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}
          >
            {!selectedGame && (
              <>
                <Typography variant="delta" fontWeight="bold" marginBottom={2}>
                  Search for a Game
                </Typography>
                <Typography variant="pi" textColor="neutral600" marginBottom={4}>
                  Find the game you want to write about
                </Typography>

                <Field.Root name="game">
                  <Flex gap={2}>
                    <Box flex={1}>
                      <TextInput
                        placeholder="Type a game name..."
                        value={searchQuery}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                        onKeyPress={handleKeyPress}
                        disabled={isGenerating}
                      />
                    </Box>
                    <Button
                      variant="secondary"
                      onClick={handleSearch}
                      disabled={isSearching || isGenerating || !searchQuery.trim()}
                      startIcon={isSearching ? <Loader small /> : <Search />}
                    >
                      Search
                    </Button>
                  </Flex>
                </Field.Root>

                {searchResults.length > 0 && (
                  <Box marginTop={5}>
                    <Typography variant="epsilon" textColor="neutral600" marginBottom={3}>
                      {searchResults.length} RESULTS
                    </Typography>
                    <Box
                      className="game-grid"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
                        gap: '18px',
                        maxHeight: 'calc(100vh - 400px)',
                        overflowY: 'auto',
                        paddingRight: '8px',
                        scrollbarWidth: 'thin',
                        scrollbarColor: '#4945ff #f1f1f1',
                      }}
                    >
                      <style>{`
                        .game-grid::-webkit-scrollbar {
                          width: 8px;
                        }
                        .game-grid::-webkit-scrollbar-track {
                          background: #f1f1f1;
                          border-radius: 4px;
                        }
                        .game-grid::-webkit-scrollbar-thumb {
                          background: linear-gradient(180deg, #4945ff 0%, #3733b3 100%);
                          border-radius: 4px;
                          border: 2px solid #f1f1f1;
                        }
                        .game-grid::-webkit-scrollbar-thumb:hover {
                          background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
                        }
                      `}</style>
                      {searchResults.map((game) => (
                        <Box
                          key={game.igdbId}
                          onClick={() => handleSelectGame(game)}
                          style={{
                            cursor: 'pointer',
                            borderRadius: '16px',
                            overflow: 'hidden',
                            background: 'linear-gradient(145deg, #1a1a2e 0%, #16213e 50%, #0f172a 100%)',
                            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            transform: 'translateY(0) scale(1)',
                          }}
                          onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                            e.currentTarget.style.transform = 'translateY(-6px) scale(1.02)';
                            e.currentTarget.style.boxShadow = '0 16px 48px rgba(73, 69, 255, 0.4)';
                          }}
                          onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                            e.currentTarget.style.transform = 'translateY(0) scale(1)';
                            e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.25)';
                          }}
                        >
                          <Box style={{ position: 'relative', paddingTop: '133.33%' }}>
                            {game.coverUrl ? (
                              <img
                                src={game.coverUrl}
                                alt={game.name}
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                  display: 'block',
                                }}
                              />
                            ) : (
                              <Box
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  width: '100%',
                                  height: '100%',
                                  background: 'linear-gradient(135deg, #2d2d44 0%, #1a1a2e 100%)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <Typography style={{ color: '#4a4a6a', fontSize: '48px' }}>
                                  🎮
                                </Typography>
                              </Box>
                            )}
                            <Box
                              style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                height: '60%',
                                background: 'linear-gradient(to top, rgba(15, 23, 42, 0.98) 0%, rgba(15, 23, 42, 0.6) 50%, transparent 100%)',
                                pointerEvents: 'none',
                              }}
                            />
                            {game.rating && game.rating > 0 && (
                              <Box
                                style={{
                                  position: 'absolute',
                                  top: '8px',
                                  right: '8px',
                                  background: game.rating >= 80
                                    ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                                    : game.rating >= 60
                                      ? 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)'
                                      : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                                  borderRadius: '6px',
                                  padding: '4px 7px',
                                  fontSize: '12px',
                                  fontWeight: '700',
                                  color: '#fff',
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                                }}
                              >
                                ★ {Math.round(game.rating)}
                              </Box>
                            )}
                            <Box
                              style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                padding: '12px',
                              }}
                            >
                              <Typography
                                variant="delta"
                                fontWeight="bold"
                                style={{
                                  color: '#ffffff',
                                  marginBottom: '3px',
                                  fontSize: '14px',
                                  lineHeight: '1.3',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  textShadow: '0 2px 4px rgba(0,0,0,0.5)',
                                }}
                              >
                                {game.name}
                              </Typography>

                              <Typography
                                style={{
                                  color: '#cbd5e1',
                                  fontSize: '11px',
                                  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                                }}
                              >
                                {game.releaseDate ? new Date(game.releaseDate).getFullYear() : 'Coming Soon'}
                              </Typography>

                              {game.platforms.length > 0 && (
                                <Flex gap={1} style={{ flexWrap: 'wrap', marginTop: '8px' }}>
                                  {game.platforms.slice(0, 3).map((platform, idx) => (
                                    <Box
                                      key={idx}
                                      style={{
                                        background: 'rgba(0, 0, 0, 0.5)',
                                        backdropFilter: 'blur(4px)',
                                        borderRadius: '4px',
                                        padding: '2px 5px',
                                        fontSize: '8px',
                                        color: '#e2e8f0',
                                        fontWeight: '600',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.3px',
                                      }}
                                    >
                                      {platform}
                                    </Box>
                                  ))}
                                  {game.platforms.length > 3 && (
                                    <Box
                                      style={{
                                        background: 'rgba(0, 0, 0, 0.4)',
                                        borderRadius: '4px',
                                        padding: '2px 5px',
                                        fontSize: '8px',
                                        color: '#94a3b8',
                                        fontWeight: '600',
                                      }}
                                    >
                                      +{game.platforms.length - 3}
                                    </Box>
                                  )}
                                </Flex>
                              )}
                            </Box>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
              </>
            )}

            {selectedGame && wizardStep === 2 && (
              <>
                <Typography variant="delta" fontWeight="bold" marginBottom={2}>
                  Configure Article
                </Typography>
                <Typography variant="pi" textColor="neutral600" marginBottom={4}>
                  Add instructions and select article type
                </Typography>

                <Box
                  marginBottom={5}
                  className="selected-game-container"
                  style={{
                    borderRadius: '16px',
                    overflow: 'hidden',
                    background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
                    border: '1px solid rgba(99, 102, 241, 0.25)',
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  <Flex alignItems="center" className="selected-game-card">
                    {selectedGame.coverUrl ? (
                      <img
                        src={selectedGame.coverUrl}
                        alt={selectedGame.name}
                        style={{
                          width: '80px',
                          height: '107px',
                          objectFit: 'cover',
                          display: 'block',
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <Box
                        style={{
                          width: '80px',
                          height: '107px',
                          background: '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Typography style={{ fontSize: '28px' }}>🎮</Typography>
                      </Box>
                    )}
                    <Box className="selected-game-info" style={{ flex: 1, padding: '16px 18px', minWidth: 0 }}>
                      <Typography
                        variant="delta"
                        fontWeight="bold"
                        ellipsis
                        style={{ color: '#fff', marginBottom: '4px', fontSize: '16px' }}
                      >
                        {selectedGame.name}
                      </Typography>
                      <Flex alignItems="center" gap={3}>
                        <Typography
                          style={{ color: '#94a3b8', fontSize: '13px' }}
                        >
                          {selectedGame.releaseDate
                            ? new Date(selectedGame.releaseDate).getFullYear()
                            : 'TBA'}
                        </Typography>
                        {selectedGame.rating && selectedGame.rating > 0 && (
                          <Box
                            style={{
                              background: selectedGame.rating >= 80 ? 'rgba(34, 197, 94, 0.2)' :
                                         selectedGame.rating >= 60 ? 'rgba(234, 179, 8, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                              borderRadius: '6px',
                              padding: '3px 8px',
                              fontSize: '12px',
                              fontWeight: '600',
                              color: selectedGame.rating >= 80 ? '#4ade80' :
                                     selectedGame.rating >= 60 ? '#facc15' : '#f87171',
                            }}
                          >
                            ★ {Math.round(selectedGame.rating)}
                          </Box>
                        )}
                      </Flex>
                      {selectedGame.platforms.length > 0 && (
                        <Flex gap={1} style={{ flexWrap: 'wrap', marginTop: '8px' }}>
                          {selectedGame.platforms.slice(0, 4).map((platform, idx) => (
                            <Box
                              key={idx}
                              style={{
                                background: 'rgba(51, 65, 85, 0.8)',
                                borderRadius: '4px',
                                padding: '3px 6px',
                                fontSize: '10px',
                                color: '#cbd5e1',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                letterSpacing: '0.3px',
                              }}
                            >
                              {platform}
                            </Box>
                          ))}
                          {selectedGame.platforms.length > 4 && (
                            <Box
                              style={{
                                background: 'rgba(51, 65, 85, 0.5)',
                                borderRadius: '4px',
                                padding: '3px 6px',
                                fontSize: '10px',
                                color: '#94a3b8',
                                fontWeight: '600',
                              }}
                            >
                              +{selectedGame.platforms.length - 4}
                            </Box>
                          )}
                        </Flex>
                      )}
                    </Box>
                    <Box
                      className="selected-game-change"
                      onClick={() => {
                        setSelectedGame(null);
                        setSearchQuery('');
                        setSearchResults([]);
                        setWizardStep(1);
                      }}
                      style={{
                        padding: '16px 18px',
                        cursor: 'pointer',
                        color: '#818cf8',
                        fontSize: '13px',
                        fontWeight: '600',
                        transition: 'color 0.15s ease',
                      }}
                      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                        e.currentTarget.style.color = '#a5b4fc';
                      }}
                      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                        e.currentTarget.style.color = '#818cf8';
                      }}
                    >
                      Change
                    </Box>
                  </Flex>
                </Box>

                <Flex gap={5} alignItems="stretch" className="config-form-layout">
                  <Box style={{ flex: 2 }}>
                    <Typography variant="pi" textColor="neutral600" fontWeight="bold" marginBottom={2}>
                      Instructions
                    </Typography>
                    <Textarea
                      placeholder="e.g., Write a beginner's guide focusing on first 5 hours of gameplay, covering basic mechanics and early-game tips..."
                      value={instruction}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInstruction(e.target.value)}
                      disabled={isGenerating}
                      style={{ minHeight: '370px' }}
                    />
                    <Typography variant="pi" textColor="neutral500" marginTop={1}>
                      Optional – Leave empty to let AI decide focus
                    </Typography>
                  </Box>

                  <Box style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="pi" textColor="neutral600" fontWeight="bold" marginBottom={2}>
                      Article Type
                    </Typography>
                    <Flex direction="column" gap={2} style={{ flex: 1 }}>
                      {ARTICLE_CATEGORIES.map((cat) => {
                        const isSelected = categorySlug === cat.value;
                        const icon = cat.value === 'news' ? '📰' :
                                    cat.value === 'reviews' ? '⭐' :
                                    cat.value === 'guides' ? '📖' :
                                    cat.value === 'lists' ? '📋' : '🤖';

                        return (
                          <Box
                            key={cat.value}
                            padding={3}
                            onClick={() => setCategorySlug(cat.value as ArticleCategorySlug | '')}
                            style={{
                              cursor: 'pointer',
                              borderRadius: '8px',
                              border: isSelected ? '2px solid #4945ff' : '1px solid rgba(99, 102, 241, 0.2)',
                              background: isSelected ? 'rgba(73, 69, 255, 0.15)' : 'rgba(30, 41, 59, 0.5)',
                              transition: 'all 0.15s ease',
                              width: '100%',
                            }}
                          >
                            <Flex alignItems="center" gap={3}>
                              <Box
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '8px',
                                  background: isSelected ? 'rgba(73, 69, 255, 0.2)' : 'rgba(51, 65, 85, 0.5)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                <Typography style={{ fontSize: '16px' }}>
                                  {icon}
                                </Typography>
                              </Box>
                              <Box style={{ flex: 1, minWidth: 0 }}>
                                <Flex alignItems="center" gap={1}>
                                  <Typography
                                    variant="pi"
                                    fontWeight="bold"
                                    style={{ fontSize: '13px', color: isSelected ? '#a5b4fc' : '#e2e8f0' }}
                                  >
                                    {cat.label}
                                  </Typography>
                                  {isSelected && <Check width={12} height={12} color="#818cf8" />}
                                </Flex>
                                <Typography
                                  variant="pi"
                                  style={{ fontSize: '11px', lineHeight: '1.3', color: '#94a3b8' }}
                                >
                                  {cat.description}
                                </Typography>
                              </Box>
                            </Flex>
                          </Box>
                        );
                      })}
                    </Flex>
                  </Box>
                </Flex>

                <Flex gap={2} marginTop={5}>
                  <Button variant="tertiary" onClick={() => {
                    setSelectedGame(null);
                    setSearchQuery('');
                    setSearchResults([]);
                    setWizardStep(1);
                  }}>
                    Back
                  </Button>
                  <Button
                    flex={1}
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    startIcon={isGenerating ? <Loader small /> : <Play />}
                  >
                    {isGenerating ? 'Generating...' : 'Generate Article'}
                  </Button>
                </Flex>
              </>
            )}
          </Box>
        </Box>

        <Box
          className={`layout-progress-panel ${isGenerating ? 'layout-generating' : 'layout-idle'}`}
          style={{
            flex: isGenerating ? '0 0 75%' : 1,
            maxWidth: isGenerating ? '75%' : '30%',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            gap: '16px',
            transition: 'flex 0.3s ease, max-width 0.3s ease',
          }}
        >
          <Box
            padding={5}
            background="neutral0"
            hasRadius
            shadow="filterShadow"
          >
            <PhaseProgress
              phases={phases}
              currentPhase={currentPhase}
              overallProgress={overallProgress}
            />
          </Box>

          <Box
            padding={5}
            background="neutral0"
            hasRadius
            shadow="filterShadow"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: '300px',
            }}
          >
            <ActivityLog logs={logs} isGenerating={isGenerating} />
          </Box>
        </Box>
      </Box>

      <ResultModal
        isOpen={showResultModal}
        onClose={() => setShowResultModal(false)}
        result={result}
      />
    </Main>
  );
};

export default ArticleGenerator;
