import React from 'react';
import {
  Main,
  Box,
  Typography,
  Button,
  Field,
  TextInput,
  Flex,
  Card,
  CardBody,
  CardContent,
  CardTitle,
  CardSubtitle,
  CardAsset,
  Modal,
  Loader,
  Badge,
  Grid,
} from '@strapi/design-system';
import { Search, Plus, Check, Cross, ArrowClockwise } from '@strapi/icons';
import { Layouts } from '@strapi/strapi/admin';

interface IGDBSearchResult {
  igdbId: number;
  name: string;
  releaseDate: string | null;
  coverUrl: string | null;
  platforms: string[];
  rating?: number;
}

interface ImportedGame {
  documentId: string;
  name: string;
  slug: string;
}

const GameImporter = () => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [isSearching, setIsSearching] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<IGDBSearchResult[]>([]);
  const [selectedGame, setSelectedGame] = React.useState<IGDBSearchResult | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState<{ success: boolean; game?: ImportedGame; error?: string } | null>(null);
  const [showResultModal, setShowResultModal] = React.useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResults([]);
    
    try {
      const response = await fetch(`/api/game-fetcher/search?q=${encodeURIComponent(searchQuery)}`);
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

  const handleImport = async (game: IGDBSearchResult) => {
    setSelectedGame(game);
    setIsImporting(true);
    setImportResult(null);

    try {
      const response = await fetch('/api/game-fetcher/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ igdbId: game.igdbId }),
      });

      const data = await response.json();

      if (response.ok) {
        setImportResult({ success: true, game: data.game });
      } else {
        setImportResult({ success: false, error: data.error?.message || 'Import failed' });
      }
    } catch (error) {
      setImportResult({ success: false, error: 'Network error occurred' });
    } finally {
      setIsImporting(false);
      setShowResultModal(true);
    }
  };

  const handleCloseModal = () => {
    setShowResultModal(false);
    setSelectedGame(null);
    setImportResult(null);
  };

  const handleViewGame = () => {
    if (importResult?.game) {
      window.location.href = `/admin/content-manager/collection-types/api::game.game/${importResult.game.documentId}`;
    }
  };

  return (
    <Main>
      <Layouts.Header
        title="Import Game from IGDB"
        subtitle="Search for games on IGDB and import them into your database"
        primaryAction={
          <Button 
            onClick={handleSearch} 
            disabled={isSearching || !searchQuery.trim()}
            startIcon={isSearching ? <Loader small /> : <Search />}
          >
            {isSearching ? 'Searching...' : 'Search'}
          </Button>
        }
      />

      <Layouts.Content>
        <Box padding={6} background="neutral0" shadow="filterShadow" hasRadius>
          {/* Search Section */}
          <Flex gap={4} marginBottom={6}>
            <Box flex="1">
              <Field.Root name="search">
                <Field.Label>Game Name</Field.Label>
                <TextInput
                  placeholder="Search for a game... (e.g., Elden Ring, Zelda, Pokemon)"
                  value={searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
                <Field.Hint>Enter a game name and press Enter or click Search</Field.Hint>
              </Field.Root>
            </Box>
          </Flex>

          {/* Loading State */}
          {isSearching && (
            <Flex justifyContent="center" padding={8}>
              <Loader>Searching IGDB...</Loader>
            </Flex>
          )}

          {/* No Results */}
          {!isSearching && searchResults.length === 0 && searchQuery && (
            <Box textAlign="center" padding={8}>
              <Typography variant="omega" textColor="neutral600">
                No games found. Try a different search term.
              </Typography>
            </Box>
          )}

          {/* Results Grid */}
          {!isSearching && searchResults.length > 0 && (
            <Box>
              <Typography variant="beta" marginBottom={4}>
                Search Results ({searchResults.length})
              </Typography>
              <Grid.Root gap={4}>
                {searchResults.map((game) => (
                  <Grid.Item col={4} key={game.igdbId}>
                    <Card 
                      style={{ 
                        height: '100%', 
                        display: 'flex', 
                        flexDirection: 'column',
                        cursor: 'pointer',
                        transition: 'box-shadow 0.2s ease',
                      }}
                    >
                      {game.coverUrl && (
                        <CardAsset>
                          <img 
                            src={game.coverUrl} 
                            alt={game.name}
                            style={{ 
                              width: '100%', 
                              height: '200px', 
                              objectFit: 'cover',
                              borderRadius: '4px 4px 0 0',
                            }}
                          />
                        </CardAsset>
                      )}
                      <CardBody>
                        <CardContent>
                          <CardTitle>{game.name}</CardTitle>
                          <CardSubtitle>
                            {game.releaseDate 
                              ? new Date(game.releaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                              : 'TBA'
                            }
                          </CardSubtitle>
                          <Box marginTop={2}>
                            <Flex gap={1} wrap="wrap">
                              {game.platforms.slice(0, 3).map((platform, idx) => (
                                <Badge key={idx} size="S">{platform}</Badge>
                              ))}
                              {game.platforms.length > 3 && (
                                <Badge size="S">+{game.platforms.length - 3}</Badge>
                              )}
                            </Flex>
                          </Box>
                          {game.rating && (
                            <Box marginTop={2}>
                              <Typography variant="pi" textColor="neutral600">
                                User Rating: {Math.round(game.rating)}/100
                              </Typography>
                            </Box>
                          )}
                        </CardContent>
                        <Box marginTop={3}>
                          <Button
                            fullWidth
                            variant="secondary"
                            startIcon={<Plus />}
                            onClick={() => handleImport(game)}
                            disabled={isImporting && selectedGame?.igdbId === game.igdbId}
                          >
                            {isImporting && selectedGame?.igdbId === game.igdbId 
                              ? 'Importing...' 
                              : 'Import Game'
                            }
                          </Button>
                        </Box>
                      </CardBody>
                    </Card>
                  </Grid.Item>
                ))}
              </Grid.Root>
            </Box>
          )}

          {/* Empty State */}
          {!isSearching && searchResults.length === 0 && !searchQuery && (
            <Box textAlign="center" padding={8}>
              <Typography variant="delta" textColor="neutral600" marginBottom={2}>
                🎮 Ready to Import Games
              </Typography>
              <Typography variant="omega" textColor="neutral500">
                Search for games from IGDB (Internet Game Database) and import them with all their metadata including platforms, genres, companies, and more.
              </Typography>
            </Box>
          )}
        </Box>

        {/* Result Modal */}
        <Modal.Root open={showResultModal} onOpenChange={(isOpen) => !isOpen && handleCloseModal()}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>
                {importResult?.success ? '✅ Import Successful' : '❌ Import Failed'}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {importResult?.success ? (
                <Box>
                  <Typography variant="omega">
                    <strong>{importResult.game?.name}</strong> has been successfully imported!
                  </Typography>
                  <Box marginTop={2}>
                    <Typography variant="pi" textColor="neutral600">
                      The game has been added to your database with all available metadata from IGDB, including platforms, genres, companies, and franchise information.
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <Box>
                  <Typography variant="omega" textColor="danger600">
                    {importResult?.error || 'An unexpected error occurred'}
                  </Typography>
                </Box>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Modal.Close>
                <Button variant="tertiary">Close</Button>
              </Modal.Close>
              {importResult?.success && (
                <Button onClick={handleViewGame} startIcon={<Check />}>
                  View Game
                </Button>
              )}
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      </Layouts.Content>
    </Main>
  );
};

export default GameImporter;

