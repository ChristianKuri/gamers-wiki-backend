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
} from '@strapi/icons';
import { Layouts } from '@strapi/strapi/admin';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Helper Functions
// ============================================================================

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

// ============================================================================
// Wizard Step Component
// ============================================================================

interface WizardStepIndicatorProps {
  step: WizardStep;
  currentStep: WizardStep;
  title: string;
  isCompleted: boolean;
}

const WizardStepIndicator: React.FC<WizardStepIndicatorProps> = ({ 
  step, 
  currentStep, 
  title, 
  isCompleted 
}) => {
  const isActive = step === currentStep;
  const isPast = step < currentStep || isCompleted;

  return (
    <Flex gap={3} alignItems="center">
      <Box
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isPast ? '#328048' : isActive ? '#4945ff' : '#dcdce4',
          color: isPast || isActive ? '#ffffff' : '#666687',
          fontWeight: '600',
          fontSize: '14px',
          transition: 'all 0.2s ease',
        }}
      >
        {isPast ? <Check width={16} height={16} /> : step}
      </Box>
      <Typography 
        variant="omega" 
        fontWeight={isActive ? 'bold' : 'regular'}
        textColor={isActive ? 'neutral800' : 'neutral600'}
      >
        {title}
      </Typography>
    </Flex>
  );
};

// ============================================================================
// Phase Progress Component
// ============================================================================

interface PhaseProgressProps {
  phases: Record<ArticleGenerationPhase, PhaseState>;
  currentPhase: ArticleGenerationPhase | null;
  overallProgress: number;
}

const PhaseProgress: React.FC<PhaseProgressProps> = ({ phases, currentPhase, overallProgress }) => {
  return (
    <Box>
      {/* Overall Progress */}
      <Box marginBottom={6}>
        <Flex justifyContent="space-between" alignItems="center" marginBottom={2}>
          <Typography variant="sigma" textColor="neutral600">OVERALL PROGRESS</Typography>
          <Typography variant="pi" fontWeight="bold">{overallProgress}%</Typography>
        </Flex>
        <ProgressBar value={overallProgress} />
      </Box>

      {/* Phase List */}
      <Box>
        <Typography variant="sigma" textColor="neutral600" marginBottom={3}>PHASES</Typography>
        <Flex direction="column" gap={2}>
          {PHASE_ORDER.map((phaseKey) => {
            const phase = phases[phaseKey];
            const config = PHASES[phaseKey];
            const isActive = currentPhase === phaseKey;
            const isCompleted = phase.status === 'completed';
            const isError = phase.status === 'error';

            return (
              <Box
                key={phaseKey}
                padding={3}
                hasRadius
                style={{
                  background: isActive ? '#f0f0ff' : isCompleted ? '#f0faf0' : isError ? '#fef0f0' : '#f6f6f9',
                  border: isActive ? '1px solid #4945ff' : '1px solid transparent',
                  transition: 'all 0.2s ease',
                }}
              >
                <Flex justifyContent="space-between" alignItems="center">
                  <Flex gap={3} alignItems="center">
                    <Box
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: isCompleted ? '#328048' : isError ? '#d02b20' : isActive ? '#4945ff' : '#dcdce4',
                      }}
                    >
                      {isCompleted ? (
                        <Check width={14} height={14} color="#fff" />
                      ) : isError ? (
                        <Cross width={14} height={14} color="#fff" />
                      ) : isActive ? (
                        <Loader small style={{ width: '14px', height: '14px' }} />
                      ) : (
                        <Box style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#8e8ea9' }} />
                      )}
                    </Box>
                    <Box>
                      <Typography variant="omega" fontWeight={isActive ? 'bold' : 'regular'}>
                        {config.name}
                      </Typography>
                      <Typography variant="pi" textColor="neutral500">
                        {phase.message || config.description}
                      </Typography>
                    </Box>
                  </Flex>
                  {isCompleted && phase.startTime && phase.endTime && (
                    <Badge size="S">{formatDuration(phase.endTime - phase.startTime)}</Badge>
                  )}
                  {isActive && (
                    <Typography variant="pi" fontWeight="bold" textColor="primary600">
                      {phase.progress}%
                    </Typography>
                  )}
                </Flex>
                {isActive && (
                  <Box marginTop={2}>
                    <ProgressBar value={phase.progress} size="S" />
                  </Box>
                )}
              </Box>
            );
          })}
        </Flex>
      </Box>
    </Box>
  );
};

// ============================================================================
// Activity Log Component
// ============================================================================

interface ActivityLogProps {
  logs: LogEntry[];
  isGenerating: boolean;
}

const ActivityLog: React.FC<ActivityLogProps> = ({ logs, isGenerating }) => {
  const logEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <Box
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Flex justifyContent="space-between" alignItems="center" marginBottom={3}>
        <Typography variant="sigma" textColor="neutral600">ACTIVITY LOG</Typography>
        {isGenerating && (
          <Flex gap={2} alignItems="center">
            <Loader small />
            <Typography variant="pi" textColor="primary600">Generating...</Typography>
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
          fontSize: '12px',
          lineHeight: '1.6',
        }}
      >
        {logs.length === 0 ? (
          <Typography variant="pi" textColor="neutral400" style={{ color: '#6b6b8a' }}>
            Waiting to start generation...
          </Typography>
        ) : (
          logs.map((log, index) => (
            <Flex key={index} gap={2} marginBottom={1} style={{ alignItems: 'flex-start' }}>
              <Typography 
                variant="pi" 
                style={{ 
                  color: '#6b6b8a', 
                  minWidth: '75px',
                  fontFamily: 'inherit',
                }}
              >
                {formatTime(log.timestamp)}
              </Typography>
              {log.phase && (
                <Typography
                  variant="pi"
                  style={{
                    color: log.type === 'phase' ? '#8b5cf6' : '#4ade80',
                    minWidth: '70px',
                    fontFamily: 'inherit',
                  }}
                >
                  [{PHASES[log.phase]?.name || log.phase}]
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

// ============================================================================
// Result Modal Component
// ============================================================================

interface ResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: GenerationResult | null;
}

const ResultModal: React.FC<ResultModalProps> = ({ isOpen, onClose, result }) => {
  if (!result) return null;

  const handleViewPost = () => {
    if (result.post) {
      window.location.href = `/admin/content-manager/collection-types/api::post.post/${result.post.documentId}`;
    }
  };

  return (
    <Modal.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Content style={{ maxWidth: '700px' }}>
        <Modal.Header>
          <Modal.Title>
            {result.success ? 'Article Generated Successfully' : 'Generation Failed'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {result.success && result.draft ? (
            <Box>
              <Flex gap={2} marginBottom={4} alignItems="flex-start">
                <Box flex="1">
                  <Typography variant="delta">{result.draft.title}</Typography>
                  <Typography variant="pi" textColor="neutral600">{result.game?.name}</Typography>
                </Box>
                <Badge>{result.draft.categorySlug}</Badge>
              </Flex>

              <Divider />

              <Flex gap={6} marginTop={4} marginBottom={4}>
                <Box textAlign="center">
                  <Typography variant="beta">
                    {result.metadata?.totalDurationMs ? formatDuration(result.metadata.totalDurationMs) : '-'}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600">Duration</Typography>
                </Box>
                <Box textAlign="center">
                  <Typography variant="beta">{result.metadata?.sourcesCollected || 0}</Typography>
                  <Typography variant="pi" textColor="neutral600">Sources</Typography>
                </Box>
                <Box textAlign="center">
                  <Typography variant="beta">{result.metadata?.researchConfidence || '-'}</Typography>
                  <Typography variant="pi" textColor="neutral600">Confidence</Typography>
                </Box>
                <Box textAlign="center">
                  <Typography variant="beta">${result.metadata?.totalCostUsd?.toFixed(3) || '0.00'}</Typography>
                  <Typography variant="pi" textColor="neutral600">Cost</Typography>
                </Box>
              </Flex>

              <Divider />

              <Box marginTop={4}>
                <Typography variant="sigma" textColor="neutral600" marginBottom={2}>EXCERPT</Typography>
                <Typography variant="omega">{result.draft.excerpt}</Typography>
              </Box>

              <Box marginTop={4}>
                <Typography variant="sigma" textColor="neutral600" marginBottom={2}>
                  PREVIEW ({result.draft.markdown.length.toLocaleString()} characters)
                </Typography>
                <Box 
                  padding={3} 
                  background="neutral100" 
                  hasRadius
                  style={{ 
                    maxHeight: '120px', 
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                  }}
                >
                  {result.draft.markdown.slice(0, 600)}
                  {result.draft.markdown.length > 600 && '...'}
                </Box>
              </Box>
            </Box>
          ) : (
            <Box textAlign="center" padding={6}>
              <Cross width={48} height={48} color="#d02b20" />
              <Typography variant="delta" textColor="danger600" marginTop={4}>
                {result.error?.message || 'An unexpected error occurred'}
              </Typography>
              {result.error?.code && (
                <Typography variant="pi" textColor="neutral500" marginTop={2}>
                  Error Code: {result.error.code}
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
            <Button onClick={handleViewPost} startIcon={<Pencil />}>
              Edit Article
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

// ============================================================================
// Main Component
// ============================================================================

const ArticleGenerator: React.FC = () => {
  // Wizard state
  const [wizardStep, setWizardStep] = React.useState<WizardStep>(1);
  
  // Step 1: Game search
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isSearching, setIsSearching] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<GameSearchResult[]>([]);
  const [selectedGame, setSelectedGame] = React.useState<GameSearchResult | null>(null);
  
  // Step 2: Instruction
  const [instruction, setInstruction] = React.useState('');
  
  // Step 3: Category
  const [categorySlug, setCategorySlug] = React.useState<ArticleCategorySlug | ''>('');

  // Generation state
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [phases, setPhases] = React.useState<Record<ArticleGenerationPhase, PhaseState>>(
    createInitialPhaseStates()
  );
  const [currentPhase, setCurrentPhase] = React.useState<ArticleGenerationPhase | null>(null);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [overallProgress, setOverallProgress] = React.useState(0);
  
  // Result state
  const [result, setResult] = React.useState<GenerationResult | null>(null);
  const [showResultModal, setShowResultModal] = React.useState(false);

  // ========================================
  // Game Search
  // ========================================

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResults([]);
    
    try {
      const response = await fetch(`/api/game-fetcher/search?q=${encodeURIComponent(searchQuery)}&limit=10`);
      const data = await response.json();
      
      if (data.results) {
        setSearchResults(data.results);
      }
    } catch (error) {
      console.error('Search failed:', error);
      addLog('error', 'Game search failed');
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

  // ========================================
  // Logging
  // ========================================

  const addLog = (
    type: LogEntry['type'], 
    message: string, 
    phase?: ArticleGenerationPhase
  ) => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toISOString(),
      type,
      message,
      phase,
    }]);
  };

  // ========================================
  // Article Generation with SSE
  // ========================================

  const handleGenerate = async () => {
    if (!selectedGame) {
      addLog('error', 'Please select a game first');
      return;
    }

    // Reset state
    setIsGenerating(true);
    setPhases(createInitialPhaseStates());
    setCurrentPhase(null);
    setLogs([]);
    setOverallProgress(0);
    setResult(null);

    addLog('info', `Starting article generation for: ${selectedGame.name}`);

    try {
      // Admin authentication is handled automatically by Strapi admin panel
      const response = await fetch('/api/article-generator/generate-sse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include admin session cookies
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
                addLog('info', `Generation started for: ${event.game.name}`);
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
                
                addLog('success', `Article generated: ${event.draft.title}`);
                addLog('success', `Total duration: ${formatDuration(event.metadata.totalDurationMs)}`);
                addLog('success', `Sources collected: ${event.metadata.sourcesCollected}`);
                
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

  // ========================================
  // Render
  // ========================================

  return (
    <Main style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Layouts.Header
        title="AI Article Generator"
        subtitle="Generate high-quality game articles with real-time progress tracking"
        primaryAction={
          isGenerating ? (
            <Button disabled startIcon={<Loader small />}>
              Generating...
            </Button>
          ) : result?.success ? (
            <Button variant="secondary" onClick={handleReset}>
              Generate Another
            </Button>
          ) : (
            <Button 
              onClick={handleGenerate}
              disabled={!canGenerate}
              startIcon={<Play />}
            >
              Generate Article
            </Button>
          )
        }
      />

      <Box 
        padding={6} 
        style={{ 
          flex: 1, 
          display: 'flex', 
          gap: '24px',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Left Column - Wizard */}
        <Box 
          style={{ 
            width: '400px', 
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box 
            padding={5} 
            background="neutral0" 
            hasRadius 
            shadow="filterShadow"
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          >
            {/* Wizard Steps Indicator */}
            <Flex gap={4} marginBottom={6}>
              <WizardStepIndicator 
                step={1} 
                currentStep={wizardStep} 
                title="Select Game" 
                isCompleted={selectedGame !== null}
              />
              <Box style={{ width: '40px', height: '1px', background: '#dcdce4', alignSelf: 'center' }} />
              <WizardStepIndicator 
                step={2} 
                currentStep={wizardStep} 
                title="Instructions" 
                isCompleted={wizardStep > 2}
              />
              <Box style={{ width: '40px', height: '1px', background: '#dcdce4', alignSelf: 'center' }} />
              <WizardStepIndicator 
                step={3} 
                currentStep={wizardStep} 
                title="Type" 
                isCompleted={isGenerating || result !== null}
              />
            </Flex>

            <Divider />

            {/* Step Content */}
            <Box marginTop={5} style={{ flex: 1, overflow: 'auto' }}>
              {/* Step 1: Game Selection */}
              {wizardStep === 1 && (
                <Box>
                  <Typography variant="beta" marginBottom={1}>Select a Game</Typography>
                  <Typography variant="pi" textColor="neutral600" marginBottom={4}>
                    Search for the game you want to write about
                  </Typography>

                  <Field.Root name="game">
                    <Flex gap={2}>
                      <Box flex="1">
                        <TextInput
                          placeholder="Search for a game..."
                          value={searchQuery}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            setSearchQuery(e.target.value);
                          }}
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
                        {isSearching ? '' : 'Search'}
                      </Button>
                    </Flex>
                  </Field.Root>

                  {/* Search Results */}
                  {searchResults.length > 0 && (
                    <Box marginTop={4}>
                      <Typography variant="sigma" textColor="neutral600" marginBottom={2}>
                        {searchResults.length} RESULTS
                      </Typography>
                      <Flex direction="column" gap={2}>
                        {searchResults.map((game) => (
                          <Box
                            key={game.igdbId}
                            padding={3}
                            hasRadius
                            onClick={() => handleSelectGame(game)}
                            style={{
                              cursor: 'pointer',
                              border: '1px solid #dcdce4',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                              e.currentTarget.style.borderColor = '#4945ff';
                              e.currentTarget.style.background = '#f0f0ff';
                            }}
                            onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                              e.currentTarget.style.borderColor = '#dcdce4';
                              e.currentTarget.style.background = 'transparent';
                            }}
                          >
                            <Flex gap={3} alignItems="center">
                              {game.coverUrl ? (
                                <img
                                  src={game.coverUrl}
                                  alt={game.name}
                                  style={{
                                    width: '36px',
                                    height: '48px',
                                    objectFit: 'cover',
                                    borderRadius: '4px',
                                    flexShrink: 0,
                                  }}
                                />
                              ) : (
                                <Box
                                  style={{
                                    width: '36px',
                                    height: '48px',
                                    background: '#eaeaef',
                                    borderRadius: '4px',
                                    flexShrink: 0,
                                  }}
                                />
                              )}
                              <Box style={{ minWidth: 0 }}>
                                <Typography variant="omega" fontWeight="bold" ellipsis>
                                  {game.name}
                                </Typography>
                                <Typography variant="pi" textColor="neutral500">
                                  {game.releaseDate ? new Date(game.releaseDate).getFullYear() : 'TBA'}
                                  {game.platforms.length > 0 && ` · ${game.platforms.slice(0, 2).join(', ')}`}
                                </Typography>
                              </Box>
                            </Flex>
                          </Box>
                        ))}
                      </Flex>
                    </Box>
                  )}

                  {/* Selected Game */}
                  {selectedGame && searchResults.length === 0 && (
                    <Box marginTop={4}>
                      <Typography variant="sigma" textColor="neutral600" marginBottom={2}>
                        SELECTED
                      </Typography>
                      <Box
                        padding={3}
                        hasRadius
                        style={{ border: '2px solid #328048', background: '#f0faf0' }}
                      >
                        <Flex gap={3} alignItems="center">
                          {selectedGame.coverUrl && (
                            <img
                              src={selectedGame.coverUrl}
                              alt={selectedGame.name}
                              style={{
                                width: '48px',
                                height: '64px',
                                objectFit: 'cover',
                                borderRadius: '4px',
                              }}
                            />
                          )}
                          <Box flex="1">
                            <Typography variant="omega" fontWeight="bold">
                              {selectedGame.name}
                            </Typography>
                            <Typography variant="pi" textColor="neutral600">
                              {selectedGame.releaseDate
                                ? new Date(selectedGame.releaseDate).getFullYear()
                                : 'TBA'}
                            </Typography>
                          </Box>
                          <Check width={20} height={20} color="#328048" />
                        </Flex>
                      </Box>
                      <Button 
                        variant="tertiary" 
                        fullWidth 
                        marginTop={3}
                        onClick={() => setWizardStep(2)}
                      >
                        Continue
                      </Button>
                    </Box>
                  )}
                </Box>
              )}

              {/* Step 2: Instructions */}
              {wizardStep === 2 && (
                <Box>
                  <Typography variant="beta" marginBottom={1}>Add Instructions</Typography>
                  <Typography variant="pi" textColor="neutral600" marginBottom={4}>
                    Guide the AI on what to focus on (optional)
                  </Typography>

                  {selectedGame && (
                    <Box 
                      padding={3} 
                      marginBottom={4} 
                      hasRadius 
                      background="neutral100"
                    >
                      <Flex gap={2} alignItems="center">
                        {selectedGame.coverUrl && (
                          <img
                            src={selectedGame.coverUrl}
                            alt={selectedGame.name}
                            style={{ width: '32px', height: '42px', objectFit: 'cover', borderRadius: '4px' }}
                          />
                        )}
                        <Box>
                          <Typography variant="omega" fontWeight="bold">{selectedGame.name}</Typography>
                          <Typography 
                            variant="pi" 
                            textColor="primary600" 
                            style={{ cursor: 'pointer' }}
                            onClick={() => setWizardStep(1)}
                          >
                            Change game
                          </Typography>
                        </Box>
                      </Flex>
                    </Box>
                  )}

                  <Field.Root name="instruction">
                    <Textarea
                      placeholder="e.g., Write a beginner's guide focusing on the first 5 hours of gameplay, covering basic mechanics and early-game tips..."
                      value={instruction}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInstruction(e.target.value)}
                      disabled={isGenerating}
                      style={{ minHeight: '120px' }}
                    />
                    <Field.Hint>
                      Leave empty to let AI decide the focus
                    </Field.Hint>
                  </Field.Root>

                  <Flex gap={2} marginTop={4}>
                    <Button variant="tertiary" onClick={() => setWizardStep(1)}>
                      Back
                    </Button>
                    <Button flex="1" onClick={() => setWizardStep(3)}>
                      Continue
                    </Button>
                  </Flex>
                </Box>
              )}

              {/* Step 3: Article Type */}
              {wizardStep === 3 && (
                <Box>
                  <Typography variant="beta" marginBottom={1}>Choose Article Type</Typography>
                  <Typography variant="pi" textColor="neutral600" marginBottom={4}>
                    Select the type of article to generate
                  </Typography>

                  <Flex direction="column" gap={2} marginBottom={4}>
                    {ARTICLE_CATEGORIES.map((cat) => (
                      <Box
                        key={cat.value}
                        padding={3}
                        hasRadius
                        onClick={() => setCategorySlug(cat.value as ArticleCategorySlug | '')}
                        style={{
                          cursor: 'pointer',
                          border: categorySlug === cat.value ? '2px solid #4945ff' : '1px solid #dcdce4',
                          background: categorySlug === cat.value ? '#f0f0ff' : 'transparent',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <Flex justifyContent="space-between" alignItems="center">
                          <Box>
                            <Typography variant="omega" fontWeight={categorySlug === cat.value ? 'bold' : 'regular'}>
                              {cat.label}
                            </Typography>
                            <Typography variant="pi" textColor="neutral500">
                              {cat.description}
                            </Typography>
                          </Box>
                          {categorySlug === cat.value && (
                            <Check width={18} height={18} color="#4945ff" />
                          )}
                        </Flex>
                      </Box>
                    ))}
                  </Flex>

                  <Flex gap={2}>
                    <Button variant="tertiary" onClick={() => setWizardStep(2)}>
                      Back
                    </Button>
                    <Button 
                      flex="1" 
                      onClick={handleGenerate}
                      disabled={!canGenerate || isGenerating}
                      startIcon={isGenerating ? <Loader small /> : <Play />}
                    >
                      {isGenerating ? 'Generating...' : 'Generate Article'}
                    </Button>
                  </Flex>
                </Box>
              )}
            </Box>
          </Box>
        </Box>

        {/* Right Column - Progress & Logs */}
        <Box 
          style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column',
            minWidth: 0,
            gap: '16px',
          }}
        >
          {/* Progress Section */}
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

          {/* Activity Log */}
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

      {/* Result Modal */}
      <ResultModal 
        isOpen={showResultModal} 
        onClose={() => setShowResultModal(false)} 
        result={result} 
      />
    </Main>
  );
};

export default ArticleGenerator;
