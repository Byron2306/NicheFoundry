const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET before running this script.');
  process.exit(1);
}

const verifier = crypto.randomBytes(48).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomBytes(24).toString('base64url');
const scopes = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly'
];

function tryOpen(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (_error) {}
}

const server = http.createServer(async (request, response) => {
  try {
    const callback = new URL(request.url, 'http://127.0.0.1');
    if (callback.pathname !== '/oauth2/callback') {
      response.writeHead(404).end('Not found');
      return;
    }
    if (callback.searchParams.get('state') !== state) throw new Error('OAuth state mismatch.');
    const oauthError = callback.searchParams.get('error');
    if (oauthError) throw new Error(`Google returned OAuth error: ${oauthError}`);
    const code = callback.searchParams.get('code');
    if (!code) throw new Error('OAuth callback did not include an authorization code.');
    const address = server.address();
    const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.refresh_token) {
      throw new Error(token.error_description || token.error || 'Google did not return a refresh token. Revoke the prior grant and run again with consent.');
    }
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('NicheFoundry YouTube authorization completed. You may close this tab.');
    console.log('\nAuthorization complete. Add this value to your private .env file:');
    console.log(`YOUTUBE_REFRESH_TOKEN=${token.refresh_token}`);
    console.log('\nDo not commit or share that token. The connector runtime exchanges it for short-lived access tokens.');
    server.close();
  } catch (error) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Authorization failed: ${error.message}`);
    console.error(error.message);
    server.close(() => process.exitCode = 1);
  }
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  }).toString();
  console.log("Open this URL in your browser to authorize NicheFoundry\'s private upload, caption, thumbnail, metadata verification, scheduling, and read-only analytics access:\n");
  console.log(url.toString());
  console.log(`\nWaiting on ${redirectUri}`);
  tryOpen(url.toString());
});

setTimeout(() => {
  console.error('OAuth setup timed out before the callback arrived.');
  server.close(() => process.exitCode = 1);
}, 10 * 60 * 1000).unref();
