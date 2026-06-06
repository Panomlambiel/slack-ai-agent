import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false},
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

pool.on('connect', () => {
    console.log('[INFO] Database connected');
});

pool.on('error', (err) => {

    console.error('[ERROR] Unexpected database error:', err.message);

});

export async function initDatabase({ retries = 5, delay = 2000 } = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        let client;
        try {
            client = await pool.connect();

            await client.query(`
        CREATE TABLE IF NOT EXISTS member_analysis (
           id SERIAL PRIMARY Key,
           member_id VARCHAR(255),
           member_name VARCHAR(255) NOT NULL,
           member_email VARCHAR(255),
           member_title VARCHAR(255),
           member_timezone VARCHAR(100),
           fit_score INTEGER NOT NULL,
           insights JSONB,
           recommendations JSONB,
           research_data JSONB,
           analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           sent_to_slack BOOLEAN DEFAULT false,
           sent_to_slack_at TIMESTAMP,
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        `);

            await client.query(`
            CREATE INDEX IF NOT EXISTS idx_member_id ON member_analysis(member_id);
        `);

            await client.query(`
            CREATE INDEX IF NOT EXISTS idx_member_email ON member_analysis(member_email);
        `);

            console.log('[INFO] Database schema initialized');
            return;
        } catch (error) {
            lastError = error;
            console.error(`[ERROR] Attempt ${attempt} to initialize DB failed:`, error.message);
            if (attempt < retries) {
                const wait = delay * attempt;
                console.log(`[INFO] Retrying DB init in ${wait}ms...`);
                await new Promise(res => setTimeout(res, wait));
            } else {
                console.error('[ERROR] Failed to initialize database after retries:', error.message);
                throw error;
            }
        } finally {
            if (client) {
                try { client.release(); } catch (e) {}
            }
        }
    }
    if (lastError) throw lastError;
}
export async function saveMemberAnalysis(member, analysis, researchData) {
    const client = await pool.connect();
    try {
        const fitScore = typeof analysis === 'object' ? (analysis.fitScore ?? analysis.fit_score ?? 50) : 50;
        const insights = JSON.stringify(analysis?.insights ?? []);
        const recommendations = JSON.stringify(analysis?.recommendations ?? []);
        const researchJson = JSON.stringify(researchData ?? []);

        const result = await client.query(
            `INSERT INTO member_analysis (
                member_id,
                member_name,
                member_email,
                member_title,
                member_timezone,
                fit_score,
                insights,
                recommendations,
                research_data
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id`,
            [
                member.id,
                member.name,
                member.email,
                member.title,
                member.timezone,
                fitScore,
                insights,
                recommendations,
                researchJson
            ]
        );

        console.log(`[INFO] Saved analysis to database with ID: ${result.rows[0].id}`);
        return result.rows[0].id;

    } catch (error) {
        console.error('[ERROR] Failed to save analysis to database:', error.message);
        throw error;

    } finally {
        client.release();
    }
}
export async function markAsSentToSlack(analysisId) {
    const client = await pool.connect();
    try {
        await client.query(
            `UPDATE member_analysis
             SET sent_to_slack = TRUE,
                 sent_to_slack_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [analysisId]
        );
    } catch (error) {
        console.error('[ERROR] Failed to mark as sent to slack:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

export async function closeDatabase() {
    await pool.end();
    console.log('[INFO] Database connection pool closed');
}
export default pool;