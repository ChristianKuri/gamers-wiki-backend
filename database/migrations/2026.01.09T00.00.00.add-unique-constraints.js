/**
 * Migration: Add unique constraints to domain_qualities and source_contents
 *
 * Problem: Strapi's dev mode auto-sync doesn't add unique constraints to
 * existing columns with data. The schemas define unique: true, but the
 * database may not have the corresponding unique indexes.
 *
 * Symptom: "there is no unique or exclusion constraint matching the
 * ON CONFLICT specification" errors when using upsert patterns.
 *
 * This migration adds the missing unique indexes to align DB with schema.
 */

async function up(knex) {
  // ============================================================================
  // domain_qualities.domain unique index
  // ============================================================================
  const domainQualitiesExists = await knex.schema.hasTable('domain_qualities');
  if (domainQualitiesExists) {
    // Check if index already exists
    const domainIndexExists = await knex.raw(`
      SELECT 1 FROM pg_indexes 
      WHERE tablename = 'domain_qualities' 
      AND indexname = 'domain_qualities_domain_unique'
    `);

    if (domainIndexExists.rows.length === 0) {
      // Check for duplicates before adding constraint
      const duplicateDomains = await knex.raw(`
        SELECT domain, COUNT(*) as count 
        FROM domain_qualities 
        GROUP BY domain 
        HAVING COUNT(*) > 1
      `);

      if (duplicateDomains.rows.length > 0) {
        console.log('[Migration] Found duplicate domains, keeping most recent...');
        // Keep the most recently updated row for each duplicate domain
        await knex.raw(`
          DELETE FROM domain_qualities a
          USING domain_qualities b
          WHERE a.domain = b.domain
          AND a.updated_at < b.updated_at
        `);
      }

      console.log('[Migration] Adding unique index on domain_qualities.domain...');
      await knex.raw(`
        CREATE UNIQUE INDEX domain_qualities_domain_unique 
        ON domain_qualities (domain)
      `);
      console.log('[Migration] domain_qualities unique index created');
    } else {
      console.log('[Migration] domain_qualities_domain_unique already exists, skipping');
    }
  } else {
    console.log('[Migration] domain_qualities table does not exist, skipping');
  }

  // ============================================================================
  // source_contents.url unique index
  // ============================================================================
  const sourceContentsExists = await knex.schema.hasTable('source_contents');
  if (sourceContentsExists) {
    // Check if index already exists
    const urlIndexExists = await knex.raw(`
      SELECT 1 FROM pg_indexes 
      WHERE tablename = 'source_contents' 
      AND indexname = 'source_contents_url_unique'
    `);

    if (urlIndexExists.rows.length === 0) {
      // Check for duplicates before adding constraint
      const duplicateUrls = await knex.raw(`
        SELECT url, COUNT(*) as count 
        FROM source_contents 
        GROUP BY url 
        HAVING COUNT(*) > 1
      `);

      if (duplicateUrls.rows.length > 0) {
        console.log('[Migration] Found duplicate URLs, keeping most recent...');
        // Keep the most recently updated row for each duplicate URL
        await knex.raw(`
          DELETE FROM source_contents a
          USING source_contents b
          WHERE a.url = b.url
          AND a.updated_at < b.updated_at
        `);
      }

      console.log('[Migration] Adding unique index on source_contents.url...');
      await knex.raw(`
        CREATE UNIQUE INDEX source_contents_url_unique 
        ON source_contents (url)
      `);
      console.log('[Migration] source_contents unique index created');
    } else {
      console.log('[Migration] source_contents_url_unique already exists, skipping');
    }
  } else {
    console.log('[Migration] source_contents table does not exist, skipping');
  }
}

async function down(knex) {
  // Remove the unique indexes (revert to non-unique)
  const domainQualitiesExists = await knex.schema.hasTable('domain_qualities');
  if (domainQualitiesExists) {
    await knex.raw(`
      DROP INDEX IF EXISTS domain_qualities_domain_unique
    `);
    console.log('[Migration] Dropped domain_qualities_domain_unique index');
  }

  const sourceContentsExists = await knex.schema.hasTable('source_contents');
  if (sourceContentsExists) {
    await knex.raw(`
      DROP INDEX IF EXISTS source_contents_url_unique
    `);
    console.log('[Migration] Dropped source_contents_url_unique index');
  }
}

module.exports = { up, down };
