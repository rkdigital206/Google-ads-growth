/**
 * Test environment setup. config/env.ts validates required environment
 * variables at MODULE IMPORT TIME (not lazily), which means any test that
 * imports a module transitively depending on src/google-ads/* — even just
 * for its exported pure functions/types — will throw immediately unless
 * these are set. These are dummy, syntactically-valid placeholder values,
 * not real credentials. No test in this suite makes a real Google Ads API
 * call or a real database connection; anything that would is either
 * mocked or deliberately not covered here (see PHASE_E_COMPLETION_REPORT.md).
 */
process.env.GOOGLE_ADS_DEVELOPER_TOKEN ??= "test-developer-token";
process.env.GOOGLE_ADS_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_ADS_CLIENT_SECRET ??= "test-client-secret";
process.env.GOOGLE_ADS_REFRESH_TOKEN ??= "test-refresh-token";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test?schema=public";
process.env.LOG_LEVEL ??= "fatal";
