/**
 * Validation schemas and types shared by the backend and the frontend.
 *
 * The backend is the authority: it validates every request with these schemas
 * regardless of what the client did. The frontend imports the same schemas so
 * that the feedback a user sees while typing matches the rules that will
 * actually be enforced, which is the drift this package exists to prevent.
 */

export * from './api.js';
export * from './auth.js';
export * from './enums.js';
export * from './fields.js';
export * from './inquiry.js';
export * from './inquiry-query.js';
export * from './phone.js';
export * from './text.js';
