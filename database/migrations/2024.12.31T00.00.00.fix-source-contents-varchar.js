/**
 * Migration: Fix source_contents varchar lengths
 *
 * Problem: Strapi doesn't auto-migrate existing column sizes.
 * The schema defines url (2048) and title (500), but if the table
 * was created before these maxLength values, it has varchar(255).
 *
 * Symptom: "value too long for type character varying(255)" errors
 * when storing sources with long URLs or titles.
 *
 * This migration aligns the DB with the schema for existing tables.
 */

async function up(knex) {
  const tableExists = await knex.schema.hasTable('source_contents');
  if (!tableExists) {
    console.log('[Migration] source_contents table does not exist, skipping');
    return;
  }

  console.log('[Migration] Altering source_contents column lengths...');

  await knex.schema.alterTable('source_contents', (table) => {
    // URL: 255 -> 2048 (to match schema maxLength)
    table.string('url', 2048).alter();
    // Title: 255 -> 500 (to match schema maxLength)
    table.string('title', 500).alter();
  });

  console.log('[Migration] source_contents columns updated successfully');
}

async function down(knex) {
  // Revert to original lengths (warning: may truncate data!)
  await knex.schema.alterTable('source_contents', (table) => {
    table.string('url', 255).alter();
    table.string('title', 255).alter();
  });
}

module.exports = { up, down };
