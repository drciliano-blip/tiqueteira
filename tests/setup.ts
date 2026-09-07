import { config } from 'dotenv';

// Testes de integração usam o mesmo banco de desenvolvimento.
// Quando existir banco de teste dedicado, aponte para .env.test.
config({ path: '.env.local' });
