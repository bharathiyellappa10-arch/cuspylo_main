
const pool = require("./db");

async function testWrite() {
  try {
    // Create a temporary test table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS connection_test (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Insert a test record
    const inserted = await pool.query(
      `INSERT INTO connection_test (message)
       VALUES ($1)
       RETURNING *`,
      ["CUSPYLO PostgreSQL persistence test"]
    );

    console.log("INSERT SUCCESS:", inserted.rows[0]);

    // Retrieve the record
    const retrieved = await pool.query(
      `SELECT * FROM connection_test
       WHERE id = $1`,
      [inserted.rows[0].id]
    );

    console.log("READ SUCCESS:", retrieved.rows[0]);

  } catch (error) {
    console.error("DATABASE TEST FAILED:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

testWrite();
