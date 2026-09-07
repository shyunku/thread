async function ensureReleaseSchema(db) {
  const columns = await db.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='version_master' AND COLUMN_NAME='not_compatible'"
  );
  if (columns.length) return;
  try {
    await db.query(
      "ALTER TABLE version_master ADD COLUMN not_compatible BOOLEAN NOT NULL DEFAULT false"
    );
  } catch (error) {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  }
}
module.exports = { ensureReleaseSchema };
