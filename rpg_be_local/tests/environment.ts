// Tests always run against the isolated *_test database; without RPG_TEST_DATABASE_URL they skip.
process.env.NODE_ENV = 'test';
