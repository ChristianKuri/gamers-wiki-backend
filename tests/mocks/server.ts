/**
 * MSW Server Setup
 * 
 * Creates and exports the MSW server for use in tests.
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

// Create the server with the default handlers
export const server = setupServer(...handlers);

