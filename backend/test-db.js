
require("dotenv").config();

const pool = require("./db");

async function testDatabase() {
  try {
    const result = await pool.query(`
      SELECT
        NOW() AS current_time,
        current_database() AS database_name,
        version() AS postgres_version
    `);

    console.log("DATABASE CONNECTION SUCCESSFUL");
    console.log(result.rows[0]);
  } catch (error) {
    console.error("DATABASE CONNECTION FAILED");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

testDatabase();
