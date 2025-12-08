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
    importResult = await api.importGame(TEST_IGDB_ID);
    
    // Give lifecycle hooks time to complete
    await new Promise(resolve => setTimeout(resolve, 5000));
  }, 180000); // 3 minute timeout for import + AI generation

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

    // Should have exactly 2 entries (EN and ES) with same document_id
    const uniqueDocIds = [...new Set(zeldaGames.map((g: { document_id: string }) => g.document_id))];
    expect(uniqueDocIds.length).toBe(1);

    const enGame = zeldaGames.find((g: { locale: string }) => g.locale === 'en');
    const esGame = zeldaGames.find((g: { locale: string }) => g.locale === 'es');

    expect(enGame).toBeDefined();
    expect(esGame).toBeDefined();
    expect(enGame?.document_id).toBe(esGame?.document_id);
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
