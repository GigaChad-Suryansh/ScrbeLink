// Import this first in every backend test. ES imports run in order, so these
// values are set before server.ts reads the environment or starts listening.
process.env.NODE_ENV = 'test'
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-1234'
process.env.ADMIN_PHONES = '+919000000001'
process.env.CRON_SECRET = 'cron-secret-for-tests-only'
delete process.env.MEDIA_HOSTS
delete process.env.ALLOW_TEST_PAYMENTS
delete process.env.DEMO_OTP
