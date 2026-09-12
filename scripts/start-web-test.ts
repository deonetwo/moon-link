import { spawn } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '..');
const cloudflaredBin = path.join(projectRoot, 'bin', 'cloudflared');
const port = 3000;

console.log('\n===============================================================');
console.log('   STARTING MOON-LINK MCP SERVER IN TEST MODE FOR WEB CLIENTS  ');
console.log('===============================================================\n');

// 1. Start the MCP Server in SSE Mock Mode
console.log('⏳ 1. Starting Moon-Link MCP Server (Port 3000, Mock Mode)...');
const serverProc = spawn('node', [path.join(projectRoot, 'dist', 'index.js'), '--sse', '--mock'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    MCP_TRANSPORT: 'sse',
    MCP_PORT: String(port),
    MCP_HOST: '0.0.0.0',
    MOCK_MODE: 'true'
  },
  stdio: ['ignore', 'inherit', 'pipe']
});

serverProc.stderr.on('data', (data) => {
  const line = data.toString().trim();
  if (line) {
    console.log(`[MCP Server] ${line}`);
  }
});

serverProc.on('error', (err) => {
  console.error('Failed to start MCP server:', err);
});

// 2. Start Cloudflare Tunnel to provide instant HTTPS URL for web clients
console.log('⏳ 2. Launching Cloudflare HTTPS tunnel for web access...');
const tunnelProc = spawn(cloudflaredBin, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
  cwd: projectRoot,
  stdio: ['ignore', 'pipe', 'pipe']
});

let publicHttpsUrl: string | null = null;

const tunnelRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

function handleTunnelOutput(data: Buffer) {
  const text = data.toString();
  const match = text.match(tunnelRegex);
  if (match && !publicHttpsUrl) {
    publicHttpsUrl = match[0];
    printInstructions(publicHttpsUrl);
  }
}

tunnelProc.stdout.on('data', handleTunnelOutput);
tunnelProc.stderr.on('data', handleTunnelOutput);

function printInstructions(httpsBaseUrl: string) {
  const sseUrl = `${httpsBaseUrl}/sse`;
  const healthUrl = `${httpsBaseUrl}/health`;

  console.log('\n===============================================================');
  console.log('   🎉 SUCCESS! MOON-LINK MCP SERVER IS READY FOR GEMINI SPARK  ');
  console.log('===============================================================');
  console.log('\nUse this HTTPS URL to connect Gemini Spark in the web:\n');
  console.log(`   👉 SSE Endpoint URL:  \x1b[32m\x1b[1m${sseUrl}\x1b[0m`);
  console.log(`   👉 Health Check URL:  ${healthUrl}`);
  console.log(`   👉 Direct IP URL:     http://18.142.95.204:${port}/sse (if HTTP allowed)`);
  console.log('\n---------------------------------------------------------------');
  console.log('📋 How to test in Gemini Spark:');
  console.log('  1. In Gemini Spark web interface, add a new MCP Server.');
  console.log(`  2. Paste the SSE Endpoint URL: ${sseUrl}`);
  console.log('  3. Try asking Gemini:');
  console.log('     • "Test connection with the discord server" -> triggers test_connection');
  console.log('     • "What channels exist on the discord server?" -> triggers list_channels');
  console.log('     • "What is the server info?" -> triggers get_server_info');
  console.log('     • "Simulate sending a message to #general" -> triggers send_message');
  console.log('\nPress Ctrl+C at any time to stop the server and tunnel.');
  console.log('===============================================================\n');
}

function cleanup() {
  console.log('\nStopping MCP server and tunnel...');
  tunnelProc.kill();
  serverProc.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
