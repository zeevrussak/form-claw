/**
 * Centralized whitelist of authorized email addresses.
 * Used by auth, middleware, and system status API.
 * TODO: Move to database for multi-family support.
 */
export const WHITELISTED_EMAILS = [
  'k6622024@gmail.com',
  'targetmailbox@gmail.com',
  '2396119@gmail.com',
  'zeev@infiniplex.life',
  'russakbot@gmail.com',
  'john@doe.com',
];
