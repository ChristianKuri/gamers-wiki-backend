/**
 * Game Import E2E Test
 * 
 * Single comprehensive test for the game import endpoint.
 * 
 * REQUIREMENTS:
 * - Strapi must be running (use npm run test:e2e:run)
 * - PostgreSQL test database must be available
 * - IGDB credentials must be configured
 * - OpenRouter API key must be configured
 * 
 * This test:
 * 1. Cleans the database
 * 2. Calls the game import endpoint once
 * 3. Verifies all data is correctly created
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  isStrapiRunning,
  createDbConnection,
  cleanDatabase,
  api,
  db,
  E2E_CONFIG,
  type GameRelationshipCounts,
} from './setup';
import type { Knex } from 'knex';

// Skip E2E tests if not explicitly enabled
const describeE2E = process.env.RUN_E2E_TESTS === 'true' ? describe : describe.skip;

describeE2E('Game Import E2E', () => {
  let knex: Knex | undefined;
  let strapiReady = false;

  // Test data
  const TEST_IGDB_ID = 119388; // The Legend of Zelda: Tears of the Kingdom
  let importResult: Awaited<ReturnType<typeof api.importGame>>;

  beforeAll(async () => {
    // Check if Strapi is running
    strapiReady = await isStrapiRunning();
    
    if (!strapiReady) {
      console.warn(`
⚠️  Strapi is not running at ${E2E_CONFIG.strapiUrl}
    
To run E2E tests, use: npm run test:e2e:run
      `);
      return;
    }

    // Create database connection
    knex = await createDbConnection();

    // Clean database before test
    await cleanDatabase(knex);

    // Import the game ONCE - this is the endpoint under test
    // Lifecycle hooks are now synchronous, so AI generation happens during the import
    // and all ES locale entries are created before the import returns.
    importResult = await api.importGame(TEST_IGDB_ID);
  }, 300000); // 5 minute timeout for import (includes synchronous AI generation for all entities)

  afterAll(async () => {
    if (knex) {
      await knex.destroy();
    }
  });

  it('should successfully import the game', async ({ skip }) => {
    if (!strapiReady) {
      skip();
      return;
    }

    expect(importResult.success).toBe(true);
    expect(importResult.game).toBeDefined();
    expect(importResult.game?.name).toBe('The Legend of Zelda: Tears of the Kingdom');
    expect(importResult.aiGenerated).toBe(true);
  });

  it('should create game entries for both EN and ES locales', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const games = await db.getGames(knex);
    const zeldaGames = games.filter((g: { name: string }) => 
      g.name.includes('Zelda')
    );

    // Log what we found for debugging
    console.log(`Found ${zeldaGames.length} Zelda game entries`);
    zeldaGames.forEach((g: { id: number; locale: string; name: string }) => {
      console.log(`  - ID: ${g.id}, Locale: ${g.locale}, Name: ${g.name}`);
    });

    // Must have exactly 2 published entries (EN and ES)
    expect(zeldaGames.length).toBe(2);

    // Should have exactly 1 unique document_id (both locales share the same document)
    const uniqueDocIds = [...new Set(zeldaGames.map((g: { document_id: string }) => g.document_id))];
    expect(uniqueDocIds.length).toBe(1);

    const enGame = zeldaGames.find((g: { locale: string }) => g.locale === 'en');
    const esGame = zeldaGames.find((g: { locale: string }) => g.locale === 'es');

    expect(enGame).toBeDefined();
    expect(esGame).toBeDefined();
    expect(enGame?.document_id).toBe(esGame?.document_id);
  });

  it('should have published game entries for both EN and ES locales', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    // Query ALL game entries (including drafts) to understand the full state
    const allGames = await knex('games')
      .select('id', 'document_id', 'name', 'locale', 'published_at')
      .where('name', 'like', '%Zelda%')
      .orderBy('locale');

    console.log(`Total Zelda game rows in database: ${allGames.length}`);
    allGames.forEach((g: { id: number; locale: string; published_at: string | null }) => {
      console.log(`  - ID: ${g.id}, Locale: ${g.locale}, Published: ${g.published_at ? 'YES' : 'NO (draft)'}`);
    });

    // Count published entries
    const publishedGames = allGames.filter((g: { published_at: string | null }) => g.published_at !== null);
    
    // Get published entries by locale
    const publishedEN = publishedGames.filter((g: { locale: string }) => g.locale === 'en');
    const publishedES = publishedGames.filter((g: { locale: string }) => g.locale === 'es');

    // CRITICAL: Must have at least 1 published entry for each locale
    expect(publishedEN.length).toBeGreaterThanOrEqual(1);
    expect(publishedES.length).toBeGreaterThanOrEqual(1);
    
    // Both published entries should share the same document_id
    expect(publishedEN[0]?.document_id).toBe(publishedES[0]?.document_id);
    
    // Note: Strapi 5 with status:'published' creates both draft and published rows
    // This is expected behavior - we verify published entries exist for both locales
    console.log(`Published entries: EN=${publishedEN.length}, ES=${publishedES.length}`);
  });

  it('should generate English game description in English (not Spanish)', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const games = await db.getGames(knex);
    const enGame = games.find((g: { locale: string; name: string }) => 
      g.locale === 'en' && g.name.includes('Zelda')
    );

    expect(enGame).toBeDefined();
    expect(enGame?.description).toBeTruthy();
    expect(enGame?.description?.length).toBeGreaterThan(100);
    
    // English description should NOT contain Spanish words
    expect(enGame?.description).not.toMatch(/jugador|videojuegos|habilidad|permite/i);
    // English description should contain English words
    expect(enGame?.description).toMatch(/game|player|world|adventure/i);
  });

  it('should generate Spanish game description in Spanish', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const games = await db.getGames(knex);
    const esGame = games.find((g: { locale: string; name: string }) => 
      g.locale === 'es' && g.name.includes('Zelda')
    );

    expect(esGame).toBeDefined();
    expect(esGame?.description).toBeTruthy();
    expect(esGame?.description?.length).toBeGreaterThan(100);
    
    // Spanish description should contain Spanish words
    expect(esGame?.description).toMatch(/jugador|videojuegos|mundo|aventura/i);
  });

  it('should create platform entries for both EN and ES locales', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const platforms = await db.getPlatforms(knex);
    const switchPlatforms = platforms.filter((p: { name: string }) => 
      p.name === 'Nintendo Switch'
    );

    // Should have exactly 2 entries (EN and ES) with same document_id
    const uniqueDocIds = [...new Set(switchPlatforms.map((p: { document_id: string }) => p.document_id))];
    expect(uniqueDocIds.length).toBe(1);

    const enPlatform = switchPlatforms.find((p: { locale: string }) => p.locale === 'en');
    const esPlatform = switchPlatforms.find((p: { locale: string }) => p.locale === 'es');

    expect(enPlatform).toBeDefined();
    expect(esPlatform).toBeDefined();
    expect(enPlatform?.document_id).toBe(esPlatform?.document_id);
  });

  it('should generate English platform description in English (not Spanish)', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const platforms = await db.getPlatforms(knex);
    const enPlatform = platforms.find((p: { locale: string; name: string }) => 
      p.locale === 'en' && p.name === 'Nintendo Switch'
    );

    expect(enPlatform).toBeDefined();
    expect(enPlatform?.description).toBeTruthy();
    expect(enPlatform?.description?.length).toBeGreaterThan(100);
    
    // English description should NOT contain Spanish words
    // This catches the bug where EN description comes out in Spanish
    expect(enPlatform?.description).not.toMatch(/consola|videojuegos|jugadores|ofrecer|híbrida/i);
    // English description should contain English words
    expect(enPlatform?.description).toMatch(/console|gaming|player|hybrid|Nintendo/i);
  });

  it('should generate Spanish platform description in Spanish', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const platforms = await db.getPlatforms(knex);
    const esPlatform = platforms.find((p: { locale: string; name: string }) => 
      p.locale === 'es' && p.name === 'Nintendo Switch'
    );

    expect(esPlatform).toBeDefined();
    expect(esPlatform?.description).toBeTruthy();
    expect(esPlatform?.description?.length).toBeGreaterThan(100);
    
    // Spanish description should contain Spanish words
    expect(esPlatform?.description).toMatch(/consola|videojuegos|jugadores|híbrida/i);
  });

  it('should create company entries for both EN and ES locales', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const companies = await db.getCompanies(knex);
    
    // Should have at least one company (Nintendo is publisher/developer for Zelda)
    expect(companies.length).toBeGreaterThan(0);

    // Get a company that should exist (Nintendo)
    const nintendoCompanies = companies.filter((c: { name: string }) => 
      c.name === 'Nintendo'
    );

    // Should have 2 entries (EN and ES) with same document_id
    if (nintendoCompanies.length > 0) {
      const uniqueDocIds = [...new Set(nintendoCompanies.map((c: { document_id: string }) => c.document_id))];
      expect(uniqueDocIds.length).toBe(1);

      const enCompany = nintendoCompanies.find((c: { locale: string }) => c.locale === 'en');
      const esCompany = nintendoCompanies.find((c: { locale: string }) => c.locale === 'es');

      expect(enCompany).toBeDefined();
      expect(esCompany).toBeDefined();
      expect(enCompany?.document_id).toBe(esCompany?.document_id);
    }
  });

  it('should generate English company description in English (not Spanish)', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const companies = await db.getCompanies(knex);
    const enCompany = companies.find((c: { locale: string; name: string }) => 
      c.locale === 'en' && c.name === 'Nintendo'
    );

    // Company might not exist if the test game doesn't have Nintendo as dev/publisher
    // In that case, find any EN company
    const anyEnCompany = enCompany || companies.find((c: { locale: string }) => c.locale === 'en');

    if (anyEnCompany) {
      expect(anyEnCompany?.description).toBeTruthy();
      expect(anyEnCompany?.description?.length).toBeGreaterThan(50);
      
      // English description should NOT contain Spanish words
      expect(anyEnCompany?.description).not.toMatch(/empresa|videojuegos|desarrollador|publicador|industria/i);
      // English description should contain English words
      expect(anyEnCompany?.description).toMatch(/game|developer|publisher|company|industry/i);
    }
  });

  it('should generate Spanish company description in Spanish', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const companies = await db.getCompanies(knex);
    const esCompany = companies.find((c: { locale: string; name: string }) => 
      c.locale === 'es' && c.name === 'Nintendo'
    );

    // Company might not exist if the test game doesn't have Nintendo as dev/publisher
    // In that case, find any ES company
    const anyEsCompany = esCompany || companies.find((c: { locale: string }) => c.locale === 'es');

    if (anyEsCompany) {
      expect(anyEsCompany?.description).toBeTruthy();
      expect(anyEsCompany?.description?.length).toBeGreaterThan(50);
      
      // Spanish description should contain Spanish words
      expect(anyEsCompany?.description).toMatch(/empresa|videojuegos|desarrollador|publicador|industria|juegos/i);
    }
  });

  it('should create franchise entries for both EN and ES locales', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const franchises = await db.getFranchises(knex);
    
    // Should have at least one franchise
    expect(franchises.length).toBeGreaterThan(0);

    // Group franchises by document_id
    const franchisesByDocId = new Map<string, Array<{ locale: string; name: string; document_id: string }>>();
    for (const f of franchises) {
      const existing = franchisesByDocId.get(f.document_id) || [];
      existing.push(f);
      franchisesByDocId.set(f.document_id, existing);
    }

    // Each franchise should have both EN and ES locale entries
    for (const [docId, localeEntries] of franchisesByDocId) {
      const enEntry = localeEntries.find((f: { locale: string }) => f.locale === 'en');
      const esEntry = localeEntries.find((f: { locale: string }) => f.locale === 'es');

      expect(enEntry).toBeDefined();
      expect(esEntry).toBeDefined();
      expect(enEntry?.document_id).toBe(esEntry?.document_id);
    }
  });

  it('should generate English franchise description in English (not Spanish)', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const franchises = await db.getFranchises(knex);
    const enFranchise = franchises.find((f: { locale: string; name: string }) => 
      f.locale === 'en' && f.name.toLowerCase().includes('zelda')
    );

    // Franchise might not exist if the test game doesn't have a franchise
    // In that case, find any EN franchise
    const anyEnFranchise = enFranchise || franchises.find((f: { locale: string }) => f.locale === 'en');

    if (anyEnFranchise) {
      expect(anyEnFranchise?.description).toBeTruthy();
      expect(anyEnFranchise?.description?.length).toBeGreaterThan(50);
      
      // English description should NOT contain Spanish words
      expect(anyEnFranchise?.description).not.toMatch(/franquicia|videojuegos|jugadores|aventura|legendaria/i);
      // English description should contain English words
      expect(anyEnFranchise?.description).toMatch(/game|series|franchise|player|adventure/i);
    }
  });

  it('should generate Spanish franchise description in Spanish', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const franchises = await db.getFranchises(knex);
    const esFranchise = franchises.find((f: { locale: string; name: string }) => 
      f.locale === 'es' && f.name.toLowerCase().includes('zelda')
    );

    // Franchise might not exist if the test game doesn't have a franchise
    // In that case, find any ES franchise
    const anyEsFranchise = esFranchise || franchises.find((f: { locale: string }) => f.locale === 'es');

    if (anyEsFranchise) {
      expect(anyEsFranchise?.description).toBeTruthy();
      expect(anyEsFranchise?.description?.length).toBeGreaterThan(50);
      
      // Spanish description should contain Spanish words
      expect(anyEsFranchise?.description).toMatch(/franquicia|videojuegos|jugadores|aventura|serie|juegos/i);
    }
  });

  // ====== COLLECTION TESTS ======
  // Collections are IGDB groupings (trilogies, remasters, etc.) - separate from franchises

  it('should create collection entries for both EN and ES locales', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const collections = await db.getCollections(knex);
    
    // Collections might not exist for all games - it depends on IGDB data
    if (collections.length === 0) {
      // Skip test if no collections (game might not have any)
      return;
    }

    // Group collections by document_id
    const collectionsByDocId = new Map<string, Array<{ locale: string; name: string; document_id: string }>>();
    for (const c of collections) {
      const existing = collectionsByDocId.get(c.document_id) || [];
      existing.push(c);
      collectionsByDocId.set(c.document_id, existing);
    }

    // Each collection should have both EN and ES locale entries
    for (const [docId, localeEntries] of collectionsByDocId) {
      const enEntry = localeEntries.find((c: { locale: string }) => c.locale === 'en');
      const esEntry = localeEntries.find((c: { locale: string }) => c.locale === 'es');

      expect(enEntry).toBeDefined();
      expect(esEntry).toBeDefined();
      expect(enEntry?.document_id).toBe(esEntry?.document_id);
    }
  });

  it('should generate English collection description in English (not Spanish)', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const collections = await db.getCollections(knex);
    const anyEnCollection = collections.find((c: { locale: string }) => c.locale === 'en');

    if (anyEnCollection) {
      expect(anyEnCollection?.description).toBeTruthy();
      expect(anyEnCollection?.description?.length).toBeGreaterThan(50);
      
      // English description should NOT contain Spanish words
      // Note: Using word boundaries to avoid false positives (e.g., "serie" vs "series")
      expect(anyEnCollection?.description).not.toMatch(/\bcolección\b|\bvideojuegos\b|\bjugadores\b|\baventura\b|\bserie\b/i);
      // English description should contain English words
      expect(anyEnCollection?.description).toMatch(/game|collection|series|player/i);
    }
  });

  it('should generate Spanish collection description in Spanish', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const collections = await db.getCollections(knex);
    const anyEsCollection = collections.find((c: { locale: string }) => c.locale === 'es');

    if (anyEsCollection) {
      expect(anyEsCollection?.description).toBeTruthy();
      expect(anyEsCollection?.description?.length).toBeGreaterThan(50);
      
      // Spanish description should contain Spanish words
      expect(anyEsCollection?.description).toMatch(/colección|videojuegos|jugadores|serie|juegos/i);
    }
  });

  // ====== RELATIONSHIP VALIDATION TESTS ======
  // These tests validate that EN and ES locale entries have the same relationships
  // This catches the bug where relationships were only linked to English entries

  it('should have same relationship counts for EN and ES game entries', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const games = await db.getGames(knex);
    const enGame = games.find((g: { locale: string; name: string }) => 
      g.locale === 'en' && g.name.includes('Zelda')
    );
    const esGame = games.find((g: { locale: string; name: string }) => 
      g.locale === 'es' && g.name.includes('Zelda')
    );

    expect(enGame).toBeDefined();
    expect(esGame).toBeDefined();

    // Get relationship counts for both locale entries
    const enRelations = await db.getGameRelationshipCounts(knex, enGame!.id);
    const esRelations = await db.getGameRelationshipCounts(knex, esGame!.id);

    // Log relationship counts for debugging
    console.log('EN Game Relationships:', enRelations);
    console.log('ES Game Relationships:', esRelations);

    // All relationship counts should match between EN and ES
    // This is the key test - if Spanish entries weren't being linked correctly,
    // esRelations would have all zeros
    expect(esRelations.platforms).toBe(enRelations.platforms);
    expect(esRelations.genres).toBe(enRelations.genres);
    expect(esRelations.themes).toBe(enRelations.themes);
    expect(esRelations.keywords).toBe(enRelations.keywords);
    expect(esRelations.developers).toBe(enRelations.developers);
    expect(esRelations.publishers).toBe(enRelations.publishers);
    expect(esRelations.franchises).toBe(enRelations.franchises);
    expect(esRelations.collections).toBe(enRelations.collections);
    expect(esRelations.gameModes).toBe(enRelations.gameModes);
    expect(esRelations.playerPerspectives).toBe(enRelations.playerPerspectives);
    expect(esRelations.gameEngines).toBe(enRelations.gameEngines);
    expect(esRelations.ageRatings).toBe(enRelations.ageRatings);
    expect(esRelations.languages).toBe(enRelations.languages);

    // Verify at least some relationships exist (game should have platforms at minimum)
    expect(enRelations.platforms).toBeGreaterThan(0);
  });

  it('should link Spanish game entry to Spanish locale of related entities', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const games = await db.getGames(knex);
    const esGame = games.find((g: { locale: string; name: string }) => 
      g.locale === 'es' && g.name.includes('Zelda')
    );

    expect(esGame).toBeDefined();

    // Check that Spanish game is linked to Spanish platform entries
    const platformLinks = await knex('games_platforms_lnk')
      .select('platform_id')
      .where('game_id', esGame!.id);

    expect(platformLinks.length).toBeGreaterThan(0);

    // Verify the linked platforms are Spanish locale entries
    for (const link of platformLinks) {
      const platform = await knex('platforms')
        .select('locale')
        .where('id', link.platform_id)
        .first();
      
      expect(platform?.locale).toBe('es');
    }
  });

  it('should have same game counts for EN and ES franchise entries', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const franchises = await db.getFranchises(knex);
    
    // Group by document_id to find EN/ES pairs
    const franchisesByDocId = new Map<string, Array<{ id: number; locale: string; name: string; document_id: string }>>();
    for (const f of franchises) {
      const existing = franchisesByDocId.get(f.document_id) || [];
      existing.push(f);
      franchisesByDocId.set(f.document_id, existing);
    }

    // For each franchise, verify EN and ES have same game count
    for (const [docId, localeEntries] of franchisesByDocId) {
      const enEntry = localeEntries.find(f => f.locale === 'en');
      const esEntry = localeEntries.find(f => f.locale === 'es');

      if (enEntry && esEntry) {
        const enGameCount = await db.getFranchiseGameCount(knex, enEntry.id);
        const esGameCount = await db.getFranchiseGameCount(knex, esEntry.id);

        console.log(`Franchise "${enEntry.name}" - EN games: ${enGameCount}, ES games: ${esGameCount}`);
        
        // EN franchise should link to EN games, ES franchise to ES games
        // Both should have the same count
        expect(esGameCount).toBe(enGameCount);
        
        // At least one game should be linked (the imported game)
        expect(enGameCount).toBeGreaterThan(0);
      }
    }
  });

  it('should have same game counts for EN and ES company entries', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const companies = await db.getCompanies(knex);
    
    // Group by document_id to find EN/ES pairs
    const companiesByDocId = new Map<string, Array<{ id: number; locale: string; name: string; document_id: string }>>();
    for (const c of companies) {
      const existing = companiesByDocId.get(c.document_id) || [];
      existing.push(c);
      companiesByDocId.set(c.document_id, existing);
    }

    // For each company, verify EN and ES have same game counts
    for (const [docId, localeEntries] of companiesByDocId) {
      const enEntry = localeEntries.find(c => c.locale === 'en');
      const esEntry = localeEntries.find(c => c.locale === 'es');

      if (enEntry && esEntry) {
        const enCounts = await db.getCompanyGameCounts(knex, enEntry.id);
        const esCounts = await db.getCompanyGameCounts(knex, esEntry.id);

        console.log(`Company "${enEntry.name}" - EN (dev: ${enCounts.asDeveloper}, pub: ${enCounts.asPublisher}), ES (dev: ${esCounts.asDeveloper}, pub: ${esCounts.asPublisher})`);
        
        // Both locales should have matching counts
        expect(esCounts.asDeveloper).toBe(enCounts.asDeveloper);
        expect(esCounts.asPublisher).toBe(enCounts.asPublisher);
      }
    }
  });

  it('should have same game counts for EN and ES platform entries', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const platforms = await db.getPlatforms(knex);
    
    // Group by document_id to find EN/ES pairs
    const platformsByDocId = new Map<string, Array<{ id: number; locale: string; name: string; document_id: string }>>();
    for (const p of platforms) {
      const existing = platformsByDocId.get(p.document_id) || [];
      existing.push(p);
      platformsByDocId.set(p.document_id, existing);
    }

    // For each platform, verify EN and ES have same game count
    for (const [docId, localeEntries] of platformsByDocId) {
      const enEntry = localeEntries.find(p => p.locale === 'en');
      const esEntry = localeEntries.find(p => p.locale === 'es');

      if (enEntry && esEntry) {
        const enGameCount = await db.getPlatformGameCount(knex, enEntry.id);
        const esGameCount = await db.getPlatformGameCount(knex, esEntry.id);

        console.log(`Platform "${enEntry.name}" - EN games: ${enGameCount}, ES games: ${esGameCount}`);
        
        // Both locales should have matching counts
        expect(esGameCount).toBe(enGameCount);
        
        // At least one game should be linked (the imported game)
        expect(enGameCount).toBeGreaterThan(0);
      }
    }
  });

  it('should have same game counts for EN and ES collection entries (if any)', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    const collections = await db.getCollections(knex);
    
    // Collections might not exist for all games
    if (collections.length === 0) {
      return;
    }

    // Group by document_id to find EN/ES pairs
    const collectionsByDocId = new Map<string, Array<{ id: number; locale: string; name: string; document_id: string }>>();
    for (const c of collections) {
      const existing = collectionsByDocId.get(c.document_id) || [];
      existing.push(c);
      collectionsByDocId.set(c.document_id, existing);
    }

    // For each collection, verify EN and ES have same game count
    for (const [docId, localeEntries] of collectionsByDocId) {
      const enEntry = localeEntries.find(c => c.locale === 'en');
      const esEntry = localeEntries.find(c => c.locale === 'es');

      if (enEntry && esEntry) {
        const enGameCount = await db.getCollectionGameCount(knex, enEntry.id);
        const esGameCount = await db.getCollectionGameCount(knex, esEntry.id);

        console.log(`Collection "${enEntry.name}" - EN games: ${enGameCount}, ES games: ${esGameCount}`);
        
        // Both locales should have matching counts
        expect(esGameCount).toBe(enGameCount);
      }
    }
  });

  it('should have matching draft and published descriptions for all entities', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    // Helper to compare draft and published description lengths for a table
    async function verifyDraftPublishedMatch(tableName: string, entityName: string) {
      const rows = await knex(tableName)
        .select('document_id', 'locale', 'name', 'published_at')
        .select(knex.raw('LENGTH(description) as desc_len'))
        .whereNotNull('description')
        .orderBy(['document_id', 'locale', 'published_at']);

      // Group by document_id and locale
      const grouped = new Map<string, { draft?: number; published?: number; name: string }>();
      for (const row of rows) {
        const key = `${row.document_id}:${row.locale}`;
        if (!grouped.has(key)) {
          grouped.set(key, { name: row.name });
        }
        const entry = grouped.get(key)!;
        if (row.published_at) {
          entry.published = row.desc_len;
        } else {
          entry.draft = row.desc_len;
        }
      }

      // Verify each entry has matching draft and published
      for (const [key, value] of grouped) {
        if (value.draft !== undefined && value.published !== undefined) {
          if (value.draft !== value.published) {
            console.log(`${entityName} "${value.name}" (${key}): draft=${value.draft}, published=${value.published} - MISMATCH`);
          }
          expect(value.draft).toBe(value.published);
        }
      }
    }

    // Verify all entity types
    await verifyDraftPublishedMatch('games', 'Game');
    await verifyDraftPublishedMatch('companies', 'Company');
    await verifyDraftPublishedMatch('franchises', 'Franchise');
    await verifyDraftPublishedMatch('collections', 'Collection');
    await verifyDraftPublishedMatch('platforms', 'Platform');
  });

  it('should prevent duplicate entries on re-import', async ({ skip }) => {
    if (!strapiReady || !knex) {
      skip();
      return;
    }

    // Try to import the same game again
    const secondImport = await api.importGame(TEST_IGDB_ID);
    
    expect(secondImport.success).toBe(true);
    expect(secondImport.message).toContain('already exists');

    // Verify no duplicates were created
    const games = await db.getGames(knex);
    const zeldaGames = games.filter((g: { name: string }) => 
      g.name.includes('Zelda')
    );
    
    const uniqueDocIds = [...new Set(zeldaGames.map((g: { document_id: string }) => g.document_id))];
    expect(uniqueDocIds.length).toBe(1);
  });
});
