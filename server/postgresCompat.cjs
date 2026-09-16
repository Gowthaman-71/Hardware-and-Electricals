const { Pool } = require('pg');
const deasync = require('deasync');
const { executionAsyncId } = require('node:async_hooks');

function toPostgresSql(sql) {
  let normalized = String(sql || '').trim();
  if (!normalized) return normalized;

  normalized = normalized.replace(/\s+COLLATE\s+NOCASE/gi, '');
  normalized = normalized.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  normalized = normalized.replace(/BEGIN\s+IMMEDIATE/gi, 'BEGIN');

  const tokens = normalized.match(/\?/g);
  if (tokens && tokens.length) {
    let offset = 0;
    normalized = normalized.replace(/\?/g, () => {
      offset += 1;
      return `$${offset}`;
    });
  }

  if (/^PRAGMA\s+table_info\s*\(/i.test(normalized)) {
    return normalized;
  }

  if (/^INSERT\s+INTO\s+/i.test(normalized) && !/RETURNING\s+/i.test(normalized)) {
    normalized = `${normalized} RETURNING id`;
  }

  return normalized;
}

function runAsyncToSync(asyncFn) {
  let done = false;
  let result;
  let error;
  let timeout = false;

  // Set a timeout to prevent infinite blocking
  const timeoutHandle = setTimeout(() => {
    timeout = true;
    done = true;
    error = new Error('Database query timeout after 30 seconds');
  }, 30000);

  asyncFn()
    .then((value) => {
      if (!timeout) {
        clearTimeout(timeoutHandle);
        result = value;
        done = true;
      }
    })
    .catch((err) => {
      if (!timeout) {
        clearTimeout(timeoutHandle);
        error = err;
        done = true;
      }
    });

  // Use setImmediate to allow other operations to proceed
  const startTime = Date.now();
  while (!done) {
    deasync.sleep(10); // Sleep 10ms between checks instead of busy-waiting
    
    // Emergency break after 35 seconds
    if (Date.now() - startTime > 35000) {
      clearTimeout(timeoutHandle);
      throw new Error('Database query emergency timeout');
    }
  }

  if (error) throw error;
  return result;
}

function createPgCompatDatabase(config) {
  const pool = new Pool({
    ...config,
    // Better connection pool settings for production
    max: config.max || 10,
    idleTimeoutMillis: config.idleTimeoutMillis || 30000,
    connectionTimeoutMillis: config.connectionTimeoutMillis || 10000,
    // Prevent connection exhaustion
    allowExitOnIdle: false,
  });
  
  const transactionClients = new Map();

  // Handle pool errors
  pool.on('error', (err) => {
    console.error('[PostgreSQL] Unexpected pool error:', err);
  });

  const getTarget = (transactionKey) => {
    const transactionClient = transactionClients.get(transactionKey);
    if (transactionClient) return transactionClient;
    return pool;
  };

  async function executeQuery(rawSql, params = [], mode = 'query', transactionKey = null) {
    const sql = String(rawSql || '').trim();
    if (!sql) {
      return mode === 'rows' ? [] : { rowCount: 0, rows: [] };
    }

    if (/^PRAGMA\s+table_info\s*\(/i.test(sql)) {
      const tableNameMatch = sql.match(/table_info\s*\(\s*([A-Za-z0-9_"`]+)\s*\)/i);
      const tableName = tableNameMatch ? tableNameMatch[1].replace(/^["`]|["`]$/g, '') : null;
      if (!tableName) return [];

      const result = await getTarget(transactionKey).query(
        `SELECT column_name AS name, ordinal_position AS cid, data_type AS type, CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull, column_default AS dflt_value, CASE WHEN EXISTS (SELECT 1 FROM information_schema.key_column_usage kcu JOIN information_schema.table_constraints tc ON tc.constraint_name = kcu.constraint_name WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY' AND kcu.column_name = c.column_name) THEN 1 ELSE 0 END AS pk FROM information_schema.columns c WHERE table_name = $1 ORDER BY ordinal_position`,
        [tableName]
      );

      return result.rows.map((row) => ({
        cid: Number(row.cid),
        name: row.name,
        type: row.type,
        notnull: Number(row.notnull),
        dflt_value: row.dflt_value,
        pk: Number(row.pk),
      }));
    }

    const normalizedSql = toPostgresSql(sql);
    const target = getTarget(transactionKey);
    
    try {
      const result = await target.query(normalizedSql, params);
      return result;
    } catch (err) {
      console.error('[PostgreSQL] Query error:', {
        sql: normalizedSql.substring(0, 200),
        params: params.length,
        error: err.message
      });
      throw err;
    }
  }

  return {
    prepare(sql) {
      return {
        get: (...params) => {
          const transactionKey = executionAsyncId();
          return runAsyncToSync(async () => {
          const result = await executeQuery(sql, params, 'rows', transactionKey);
          return Array.isArray(result) ? result[0] : (result.rows ? result.rows[0] : undefined);
          });
        },
        all: (...params) => {
          const transactionKey = executionAsyncId();
          return runAsyncToSync(async () => {
          const result = await executeQuery(sql, params, 'rows', transactionKey);
          return Array.isArray(result) ? result : (result.rows || []);
          });
        },
        run: (...params) => {
          const transactionKey = executionAsyncId();
          return runAsyncToSync(async () => {
          const result = await executeQuery(sql, params, 'run', transactionKey);
          const rowCount = Number(result.rowCount || 0);
          const lastInsertRowid = result.rows && result.rows[0] && result.rows[0].id != null ? Number(result.rows[0].id) : null;
          return { changes: rowCount, lastInsertRowid };
          });
        },
      };
    },
    exec: (sql) => {
      const transactionKey = executionAsyncId();
      return runAsyncToSync(async () => {
      const statements = String(sql || '').split(';').map((part) => part.trim()).filter(Boolean);
      for (const statement of statements) {
        const normalized = statement.toUpperCase();
        if (normalized === 'BEGIN' || normalized === 'BEGIN IMMEDIATE' || normalized === 'START TRANSACTION') {
          if (!transactionClients.has(transactionKey)) {
            transactionClients.set(transactionKey, await pool.connect());
          }
          await transactionClients.get(transactionKey).query('BEGIN');
          continue;
        }
        if (normalized === 'COMMIT') {
          const transactionClient = transactionClients.get(transactionKey);
          if (transactionClient) {
            await transactionClient.query('COMMIT');
            transactionClient.release();
            transactionClients.delete(transactionKey);
          }
          continue;
        }
        if (normalized === 'ROLLBACK') {
          const transactionClient = transactionClients.get(transactionKey);
          if (transactionClient) {
            await transactionClient.query('ROLLBACK');
            transactionClient.release();
            transactionClients.delete(transactionKey);
          }
          continue;
        }

        const result = await executeQuery(statement, [], 'query', transactionKey);
        if (result && result.command === 'SELECT' && !Array.isArray(result.rows)) {
          continue;
        }
      }
      return { ok: true };
      });
    },
    close: () => runAsyncToSync(async () => {
      for (const transactionClient of transactionClients.values()) {
        transactionClient.release();
      }
      transactionClients.clear();
      await pool.end();
    }),
    pool,
  };
}

module.exports = { createPgCompatDatabase };
