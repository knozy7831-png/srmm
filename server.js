require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const ExcelJS = require('exceljs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Behind a reverse proxy (Nginx, Heroku, etc.) in production so the rate
// limiter and req.ip see the real client address.
app.set('trust proxy', IS_PROD ? 1 : false);

// JWT secret must be configured explicitly in production. Falling back to a
// hardcoded value would let anyone forge tokens, so fail fast instead.
// In development, if no secret is provided we generate one ONCE and persist it
// to a gitignored file so tokens survive server restarts (otherwise every
// restart would invalidate existing logins with "Invalid token").
let ACTIVE_JWT_SECRET = process.env.JWT_SECRET;
if (!ACTIVE_JWT_SECRET) {
    if (IS_PROD) {
        console.error('FATAL: JWT_SECRET is not set. Refusing to start in production.');
        process.exit(1);
    }
    const crypto = require('crypto');
    const secretFile = path.join(__dirname, '.jwt_secret');
    try {
        if (fs.existsSync(secretFile)) {
            ACTIVE_JWT_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
        }
    } catch (e) { /* ignore and regenerate below */ }
    if (!ACTIVE_JWT_SECRET) {
        ACTIVE_JWT_SECRET = crypto.randomBytes(48).toString('hex');
        try { fs.writeFileSync(secretFile, ACTIVE_JWT_SECRET); } catch (e) { /* non-fatal */ }
    }
    console.warn('WARNING: JWT_SECRET is not set. Using a persisted development secret (.jwt_secret). Set JWT_SECRET in .env for production.');
}

// Cost factor for password hashing.
const BCRYPT_ROUNDS = 10;

// Ensure a default admin account exists on startup. This is essential on
// ephemeral hosts (e.g. Railway) where the SQLite file is wiped on every
// redeploy and the seed `users.json` is not deployed — without this the
// database would be empty and every login would fail. Credentials are taken
// from ADMIN_USERNAME/ADMIN_PASSWORD if set, otherwise a sensible default.
function ensureAdminAccount() {
    const email = process.env.ADMIN_USERNAME || 'cologic';
    const password = process.env.ADMIN_PASSWORD || 'cologic@2026';
    try {
        if (!db.getUserByEmail(email)) {
            db.createUser({
                id: Date.now().toString(),
                email,
                password: bcrypt.hashSync(password, BCRYPT_ROUNDS),
                name: 'Cologic Admin'
            });
            console.log(`Seeded admin account: ${email}`);
        }
    } catch (e) {
        console.warn('Admin seed skipped:', e.message);
    }
}
ensureAdminAccount();

// Middleware
// Helmet sets security-related HTTP headers. The Content-Security-Policy is
// disabled because the front-end relies on inline styles/scripts and CDN
// assets; the remaining headers (HSTS, X-Frame-Options, etc.) still apply.
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(compression());
app.use(cors({ origin: IS_PROD ? process.env.FRONTEND_URL : '*' }));
app.use(express.json({ limit: '50mb' })); // High limit for base64 encoded images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Reject malformed JSON cleanly (no HTML stack-trace page leaking internals).
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Payload too large' });
    }
    next(err);
});

// Rate Limiters
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 requests per `window`
    message: { error: 'Too many requests, please try again later.' }
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Limit each IP to 10 generation requests per minute
    message: { error: 'Too many API calls, please wait.' }
});

// Block direct static access to prompts.js — served only via /api/prompts.
app.use('/prompts.js', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve static files. Versioned assets (?v=) are cache-busted by the client,
// so a modest cache is safe; HTML is always revalidated.
app.use(express.static(path.join(__dirname, '/'), {
    maxAge: IS_PROD ? '1h' : 0,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
}));

// Health check for uptime monitors / load balancers.
app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Serve prompts only to authenticated users (protects proprietary IP).
app.get('/api/prompts', verifyToken, (req, res) => {
    try {
        const promptsPath = path.join(__dirname, 'prompts.js');
        const raw = fs.readFileSync(promptsPath, 'utf8');
        res.type('application/javascript').send(raw);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load prompts' });
    }
});

// --- AUTHENTICATION ---
// Public self-registration is disabled — this is a sign-in-only deployment.
// Accounts are provisioned directly in users.json (or via ADMIN_* env vars).
app.post('/api/register', authLimiter, (req, res) => {
    res.status(403).json({ error: 'Account creation is disabled. Please contact your administrator.' });
});

// Returns true if the password matches. Supports legacy plaintext records and
// transparently upgrades them to a bcrypt hash on successful login.
const verifyPassword = async (user, password) => {
    const stored = user.password || '';
    if (stored.startsWith('$2')) {
        return bcrypt.compare(password, stored);
    }
    // Legacy plaintext record — verify then upgrade to a hash.
    if (stored === password) {
        const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
        db.updateUserPassword(user.id, hashed);
        return true;
    }
    return false;
};

app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
        
        // Check against Environment Variables first (Secure for Production)
        if (process.env.ADMIN_USERNAME && email === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
            const token = jwt.sign({ id: 'admin-env', email, name: 'Cologic Admin' }, ACTIVE_JWT_SECRET, { expiresIn: '7d' });
            return res.json({ token, user: { email, name: 'Cologic Admin' } });
        }

        const user = db.getUserByEmail(email);
        if (!user || !(await verifyPassword(user, password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, ACTIVE_JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { email: user.email, name: user.name } });
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Middleware to verify token for protected routes (optional, mainly for API protection)
function verifyToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(token, ACTIVE_JWT_SECRET);
        next();
    } catch (e) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// --- PROJECT PERSISTENCE (SQLite) ---

// List the current user's projects (metadata only — the heavy `data` blob is
// never read by this query).
app.get('/api/projects', verifyToken, (req, res) => {
    try {
        res.json(db.listProjects(req.user.id));
    } catch (e) {
        res.status(500).json({ error: 'Failed to read projects' });
    }
});

// Fetch a single project (must belong to the requesting user).
app.get('/api/projects/:id', verifyToken, (req, res) => {
    try {
        const p = db.getProject(req.params.id, req.user.id);
        if (!p) return res.status(404).json({ error: 'Project not found' });
        res.json(p);
    } catch (e) {
        res.status(500).json({ error: 'Failed to read project' });
    }
});

// Create or update a project (upsert by id, owner-scoped).
app.post('/api/projects', verifyToken, (req, res) => {
    try {
        const { id, name, data } = req.body;
        if (!data) return res.status(400).json({ error: 'Missing project data' });
        const result = db.upsertProject({ id, owner: req.user.id, name: name || 'Untitled Project', data });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: 'Failed to save project' });
    }
});

// Delete a project owned by the user.
app.delete('/api/projects/:id', verifyToken, (req, res) => {
    try {
        const changes = db.deleteProject(req.params.id, req.user.id);
        if (!changes) return res.status(404).json({ error: 'Project not found' });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// --- BOQ EXCEL EXPORT ---
// Builds an .xlsx from the deterministic engineering model computed on the
// client (the client sends the already-computed model so we don't duplicate
// the calculation logic server-side).
app.post('/api/export/xlsx', apiLimiter, verifyToken, async (req, res) => {
    try {
        const { project, model } = req.body;
        if (!model || !Array.isArray(model.boq)) {
            return res.status(400).json({ error: 'Missing model or BOQ data' });
        }
        const p = project || {};
        const wb = new ExcelJS.Workbook();
        wb.creator = 'Cologic.ai';
        wb.created = new Date();

        const money = (cell) => { cell.numFmt = '#,##0'; };

        // ---- Summary sheet ----
        const sum = wb.addWorksheet('Summary');
        sum.columns = [{ width: 28 }, { width: 40 }];
        sum.addRow(['Cologic.ai — Security & ELV Estimate']).font = { bold: true, size: 14 };
        sum.addRow([]);
        const meta = [
            ['Project', p.project || ''],
            ['Client', p.client || ''],
            ['Location', p.location || ''],
            ['Basis drawing', p.basis || ''],
            ['Revision', p.rev || ''],
            ['Generated', new Date().toLocaleString()]
        ];
        meta.forEach(r => { const row = sum.addRow(r); row.getCell(1).font = { bold: true }; });
        sum.addRow([]);
        const costs = [
            ['Base (equipment + services)', model.base],
            ['Contingency', model.cont],
            ['CAPEX (ex-GST)', model.capex],
            ['GST (18%)', model.gst],
            ['CAPEX (incl. GST)', model.capexInc],
            ['OPEX / year (indicative)', model.opex]
        ];
        costs.forEach(r => {
            const row = sum.addRow(r);
            row.getCell(1).font = { bold: true };
            money(row.getCell(2));
        });

        // ---- BOQ sheet ----
        const ws = wb.addWorksheet('BOQ');
        ws.columns = [
            { header: 'S.No', key: 'sno', width: 8 },
            { header: 'Description', key: 'desc', width: 60 },
            { header: 'Qty', key: 'qty', width: 12 },
            { header: 'Unit Rate (INR)', key: 'rate', width: 18 },
            { header: 'Amount (INR)', key: 'amt', width: 18 }
        ];
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).alignment = { horizontal: 'center' };

        let lineNo = 0;
        model.boq.forEach(catg => {
            const catRow = ws.addRow([catg.name, '', '', '', catg.sub]);
            catRow.font = { bold: true };
            catRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
            money(catRow.getCell(5));
            (catg.items || []).forEach(it => {
                lineNo += 1;
                const row = ws.addRow([lineNo, it.d, it.qty, it.rate, it.amt]);
                money(row.getCell(4));
                money(row.getCell(5));
            });
        });
        ws.addRow([]);
        const totals = [
            ['', 'Base total', '', '', model.base],
            ['', 'Contingency', '', '', model.cont],
            ['', 'CAPEX (ex-GST)', '', '', model.capex],
            ['', 'GST (18%)', '', '', model.gst],
            ['', 'CAPEX (incl. GST)', '', '', model.capexInc]
        ];
        totals.forEach(r => {
            const row = ws.addRow(r);
            row.font = { bold: true };
            money(row.getCell(5));
        });

        const safe = (p.project || 'project').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 48) || 'project';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${safe}_BOQ.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (e) {
        console.error('XLSX export failed:', e.message);
        res.status(500).json({ error: 'Failed to generate Excel: ' + e.message });
    }
});

// --- CORE APP ---

// Default route to serve auth page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API Route to proxy Claude requests
app.post('/api/claude', apiLimiter, verifyToken, async (req, res) => {
    try {
        const { system, messages, max_tokens, model } = req.body;

        // Check if API key is configured
        if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_api_key_here') {
            return res.status(500).json({ 
                error: { message: 'ANTHROPIC_API_KEY is not configured in the .env file. Please add your key.' }
            });
        }

        const response = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
                model: model || 'claude-sonnet-4-20250514',
                max_tokens: max_tokens || 2000,
                system: system,
                messages: messages
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                }
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Error calling Anthropic API:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: { message: error.message } });
    }
});

// Unknown API routes -> JSON 404 (so the SPA's fetch calls get clean errors).
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Generic error handler — log server-side, never leak stack traces to clients.
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: IS_PROD ? 'Internal Server Error' : err.message });
});

// Start the server
const server = app.listen(PORT, () => {
    console.log(`Backend Server is running on http://localhost:${PORT}`);
});

// Graceful shutdown so SQLite/WAL flushes cleanly.
const shutdown = (sig) => {
    console.log(`\n${sig} received — shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
