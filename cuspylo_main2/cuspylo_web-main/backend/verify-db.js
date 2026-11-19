
const pool = require("./db");

async function verifyDatabase() {
  let testUserId;

  try {
    console.log("1. Checking database connection...");

    const connection = await pool.query(
      "SELECT NOW() AS database_time, current_database() AS database_name"
    );

    console.log("CONNECTED:", connection.rows[0]);

    console.log("\n2. Inserting test user...");

    const inserted = await pool.query(
      `INSERT INTO users
       (name, username, phone, email, college, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, username`,
      [
        "Database Test User",
        "db_test_" + Date.now(),
        "9999999999",
        null,
        "Test College",
        "TEST_HASH_NOT_A_REAL_PASSWORD"
      ]
    );

    testUserId = inserted.rows[0].id;
    console.log("INSERT SUCCESS:", inserted.rows[0]);

    console.log("\n3. Reading test user...");

    const fetched = await pool.query(
      "SELECT id, name, username FROM users WHERE id = $1",
      [testUserId]
    );

    console.log("READ SUCCESS:", fetched.rows[0]);

    console.log("\n4. Updating test user...");

    const updated = await pool.query(
      `UPDATE users
       SET name = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name`,
      ["Database Test Updated", testUserId]
    );

    console.log("UPDATE SUCCESS:", updated.rows[0]);

    console.log("\n5. Checking persistence...");

    const persisted = await pool.query(
      "SELECT name FROM users WHERE id = $1",
      [testUserId]
    );

    console.log("PERSISTENCE SUCCESS:", persisted.rows[0]);

    console.log("\nALL DATABASE TESTS PASSED.");
  } catch (error) {
    console.error("\nDATABASE TEST FAILED:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

verifyDatabase();
