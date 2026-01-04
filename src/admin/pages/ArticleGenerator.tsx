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
      const response = await fetch(`/api/game-fetcher/search?q=${encodeURIComponent(searchQuery)}&limit=24`);
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
            flex: '0 0 75%',
            maxWidth: '75%',
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
                      <Flex justifyContent="space-between" alignItems="center" marginBottom={4}>
                        <Typography variant="sigma" textColor="neutral600">
                          {searchResults.length} RESULTS
                        </Typography>
                      </Flex>
                      <Box
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                          gap: '20px',
                        }}
                      >
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
                              position: 'relative',
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
                            {/* Cover Image Section - Portrait 3:4 ratio */}
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
                              {/* Gradient Overlay */}
                              <Box
                                style={{
                                  position: 'absolute',
                                  bottom: 0,
                                  left: 0,
                                  right: 0,
                                  height: '50%',
                                  background: 'linear-gradient(to top, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.5) 50%, transparent 100%)',
                                  pointerEvents: 'none',
                                }}
                              />
                              {/* Rating Badge */}
                              {game.rating && game.rating > 0 && (
                                <Box
                                  style={{
                                    position: 'absolute',
                                    top: '10px',
                                    right: '10px',
                                    background: game.rating >= 80 
                                      ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' 
                                      : game.rating >= 60 
                                        ? 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)' 
                                        : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                                    borderRadius: '8px',
                                    padding: '5px 8px',
                                    fontSize: '13px',
                                    fontWeight: '700',
                                    color: '#fff',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                                  }}
                                >
                                  ★ {Math.round(game.rating)}
                                </Box>
                              )}
                              {/* Content overlay at bottom */}
                              <Box
                                style={{
                                  position: 'absolute',
                                  bottom: 0,
                                  left: 0,
                                  right: 0,
                                  padding: '14px',
                                }}
                              >
                                <Typography 
                                  variant="delta" 
                                  fontWeight="bold"
                                  style={{ 
                                    color: '#ffffff',
                                    marginBottom: '4px',
                                    fontSize: '15px',
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
                                    fontSize: '12px',
                                    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                                  }}
                                >
                                  {game.releaseDate ? new Date(game.releaseDate).getFullYear() : 'Coming Soon'}
                                </Typography>

                                {/* Platform Tags */}
                                {game.platforms.length > 0 && (
                                  <Flex gap={1} style={{ flexWrap: 'wrap', marginTop: '10px' }}>
                                    {game.platforms.slice(0, 3).map((platform, idx) => (
                                      <Box
                                        key={idx}
                                        style={{
                                          background: 'rgba(0, 0, 0, 0.5)',
                                          backdropFilter: 'blur(4px)',
                                          borderRadius: '4px',
                                          padding: '3px 6px',
                                          fontSize: '9px',
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
                                          padding: '3px 6px',
                                          fontSize: '9px',
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

                  {/* Selected Game */}
                  {selectedGame && searchResults.length === 0 && (
                    <Box marginTop={4}>
                      <Flex justifyContent="space-between" alignItems="center" marginBottom={4}>
                        <Typography variant="sigma" textColor="neutral600">
                          SELECTED GAME
                        </Typography>
                        <Box
                          style={{
                            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                            borderRadius: '12px',
                            padding: '6px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
                          }}
                        >
                          <Check width={14} height={14} color="#fff" />
                          <Typography style={{ color: '#fff', fontSize: '12px', fontWeight: '600' }}>
                            Ready to Generate
                          </Typography>
                        </Box>
                      </Flex>
                      
                      <Box
                        style={{
                          borderRadius: '20px',
                          overflow: 'hidden',
                          background: 'linear-gradient(145deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
                          boxShadow: '0 12px 48px rgba(34, 197, 94, 0.25), 0 0 0 2px rgba(34, 197, 94, 0.5)',
                          position: 'relative',
                        }}
                      >
                        {/* Background Glow Effect */}
                        <Box
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: 'radial-gradient(circle at top left, rgba(34, 197, 94, 0.15) 0%, transparent 40%)',
                            pointerEvents: 'none',
                          }}
                        />
                        
                        <Flex style={{ position: 'relative' }}>
                          {/* Cover Image */}
                          <Box style={{ position: 'relative', flexShrink: 0 }}>
                            {selectedGame.coverUrl ? (
                              <img
                                src={selectedGame.coverUrl}
                                alt={selectedGame.name}
                                style={{
                                  width: '160px',
                                  height: '213px',
                                  objectFit: 'cover',
                                  display: 'block',
                                }}
                              />
                            ) : (
                              <Box
                                style={{
                                  width: '160px',
                                  height: '213px',
                                  background: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <Typography style={{ fontSize: '48px' }}>🎮</Typography>
                              </Box>
                            )}
                            {/* Check Badge */}
                            <Box
                              style={{
                                position: 'absolute',
                                top: '12px',
                                left: '12px',
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 4px 12px rgba(34, 197, 94, 0.5)',
                              }}
                            >
                              <Check width={18} height={18} color="#fff" />
                            </Box>
                            {/* Rating Badge */}
                            {selectedGame.rating && selectedGame.rating > 0 && (
                              <Box
                                style={{
                                  position: 'absolute',
                                  bottom: '12px',
                                  right: '12px',
                                  background: selectedGame.rating >= 80 ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' : 
                                              selectedGame.rating >= 60 ? 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)' : 
                                              'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                                  borderRadius: '8px',
                                  padding: '6px 10px',
                                  fontSize: '14px',
                                  fontWeight: '700',
                                  color: '#fff',
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <span style={{ fontSize: '12px' }}>★</span>
                                {Math.round(selectedGame.rating)}
                              </Box>
                            )}
                          </Box>

                          {/* Content */}
                          <Box style={{ flex: 1, padding: '24px', minWidth: 0 }}>
                            <Typography 
                              variant="beta" 
                              fontWeight="bold"
                              style={{ 
                                color: '#ffffff',
                                marginBottom: '8px',
                                fontSize: '22px',
                                lineHeight: '1.3',
                              }}
                            >
                              {selectedGame.name}
                            </Typography>
                            
                            <Typography 
                              style={{ 
                                color: '#94a3b8',
                                fontSize: '15px',
                                marginBottom: '16px',
                              }}
                            >
                              {selectedGame.releaseDate 
                                ? new Date(selectedGame.releaseDate).toLocaleDateString('en-US', { 
                                    year: 'numeric', 
                                    month: 'long',
                                    day: 'numeric'
                                  })
                                : 'Release date TBA'}
                            </Typography>

                            {/* Platform Tags */}
                            {selectedGame.platforms.length > 0 && (
                              <Flex gap={2} style={{ flexWrap: 'wrap' }}>
                                {selectedGame.platforms.slice(0, 5).map((platform, idx) => (
                                  <Box
                                    key={idx}
                                    style={{
                                      background: 'rgba(34, 197, 94, 0.15)',
                                      border: '1px solid rgba(34, 197, 94, 0.35)',
                                      borderRadius: '8px',
                                      padding: '6px 12px',
                                      fontSize: '11px',
                                      color: '#4ade80',
                                      fontWeight: '600',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.5px',
                                    }}
                                  >
                                    {platform}
                                  </Box>
                                ))}
                                {selectedGame.platforms.length > 5 && (
                                  <Box
                                    style={{
                                      background: 'rgba(148, 163, 184, 0.15)',
                                      borderRadius: '8px',
                                      padding: '6px 12px',
                                      fontSize: '11px',
                                      color: '#64748b',
                                      fontWeight: '600',
                                    }}
                                  >
                                    +{selectedGame.platforms.length - 5}
                                  </Box>
                                )}
                              </Flex>
                            )}
                          </Box>
                        </Flex>
                      </Box>
                      
                      <Flex gap={3} marginTop={5}>
                        <Button 
                          variant="tertiary"
                          onClick={() => {
                            setSelectedGame(null);
                            setSearchQuery('');
                          }}
                          style={{ flex: 0 }}
                        >
                          Change Game
                        </Button>
                        <Button 
                          flex="1"
                          onClick={() => setWizardStep(2)}
                          startIcon={<Check />}
                          size="L"
                        >
                          Continue with this game
                        </Button>
                      </Flex>
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
                      marginBottom={5}
                      style={{
                        borderRadius: '16px',
                        overflow: 'hidden',
                        background: 'linear-gradient(145deg, #1e293b 0%, #0f172a 100%)',
                        border: '1px solid rgba(99, 102, 241, 0.25)',
                        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
                      }}
                    >
                      <Flex alignItems="center">
                        {selectedGame.coverUrl ? (
                          <img
                            src={selectedGame.coverUrl}
                            alt={selectedGame.name}
                            style={{ 
                              width: '80px', 
                              height: '107px', 
                              objectFit: 'cover',
                              display: 'block',
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
                            }}
                          >
                            <Typography style={{ fontSize: '28px' }}>🎮</Typography>
                          </Box>
                        )}
                        <Box style={{ flex: 1, padding: '16px 18px', minWidth: 0 }}>
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
                        </Box>
                        <Box
                          onClick={() => setWizardStep(1)}
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
                  )}

                  <Field.Root name="instruction">
                    <Textarea
                      placeholder="e.g., Write a beginner's guide focusing on the first 5 hours of gameplay, covering basic mechanics and early-game tips..."
                      value={instruction}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInstruction(e.target.value)}
                      disabled={isGenerating}
                      style={{ minHeight: '120px' }}
                    />
                    <Typography variant="pi" textColor="neutral500" marginTop={1}>
                      Leave empty to let AI decide the focus
                    </Typography>
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
