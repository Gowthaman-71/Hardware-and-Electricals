const { Pool } = require('pg');
const deasync = require('deasync');

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

  asyncFn()
    .then((value) => {
      result = value;
      done = true;
    })
    .catch((err) => {
      error = err;
      done = true;
    });

  deasync.loopWhile(() => !done);

  if (error) throw error;
  return result;
}

function createPgCompatDatabase(config) {
  const pool = new Pool(config);
  let transactionClient = null;

  const getTarget = () => {
    if (transactionClient) return transactionClient;
    return pool;
  };

  async function executeQuery(rawSql, params = [], mode = 'query') {
    const sql = String(rawSql || '').trim();
    if (!sql) {
      return mode === 'rows' ? [] : { rowCount: 0, rows: [] };
    }

    if (/^PRAGMA\s+table_info\s*\(/i.test(sql)) {
      const tableNameMatch = sql.match(/table_info\s*\(\s*([A-Za-z0-9_"`]+)\s*\)/i);
      const tableName = tableNameMatch ? tableNameMatch[1].replace(/^["`]|["`]$/g, '') : null;
      if (!tableName) return [];

      const result = await getTarget().query(
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
    const target = getTarget();
    const result = await target.query(normalizedSql, params);
    return result;
  }

  return {
    prepare(sql) {
      return {
        get: (...params) => runAsyncToSync(async () => {
          const result = await executeQuery(sql, params, 'rows');
          return Array.isArray(result) ? result[0] : (result.rows ? result.rows[0] : undefined);
        }),
        all: (...params) => runAsyncToSync(async () => {
          const result = await executeQuery(sql, params, 'rows');
          return Array.isArray(result) ? result : (result.rows || []);
        }),
        run: (...params) => runAsyncToSync(async () => {
          const result = await executeQuery(sql, params, 'run');
          const rowCount = Number(result.rowCount || 0);
          const lastInsertRowid = result.rows && result.rows[0] && result.rows[0].id != null ? Number(result.rows[0].id) : null;
          return { changes: rowCount, lastInsertRowid };
        }),
      };
    },
    exec: (sql) => runAsyncToSync(async () => {
      const statements = String(sql || '').split(';').map((part) => part.trim()).filter(Boolean);
      for (const statement of statements) {
        const normalized = statement.toUpperCase();
        if (normalized === 'BEGIN' || normalized === 'BEGIN IMMEDIATE' || normalized === 'START TRANSACTION') {
          if (!transactionClient) {
            transactionClient = await pool.connect();
          }
          await transactionClient.query('BEGIN');
          continue;
        }
        if (normalized === 'COMMIT') {
          if (transactionClient) {
            await transactionClient.query('COMMIT');
            transactionClient.release();
            transactionClient = null;
          }
          continue;
        }
        if (normalized === 'ROLLBACK') {
          if (transactionClient) {
            await transactionClient.query('ROLLBACK');
            transactionClient.release();
            transactionClient = null;
          }
          continue;
        }

        const result = await executeQuery(statement);
        if (result && result.command === 'SELECT' && !Array.isArray(result.rows)) {
          continue;
        }
      }
      return { ok: true };
    }),
    close: () => runAsyncToSync(async () => {
      if (transactionClient) {
        transactionClient.release();
        transactionClient = null;
      }
      await pool.end();
    }),
    pool,
  };
}

module.exports = { createPgCompatDatabase };
