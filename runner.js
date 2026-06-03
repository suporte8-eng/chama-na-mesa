const { spawn } = require('child_process');
const path = require('path');

let serverProcess = null;
let tunnelProcess = null;

function startServer() {
  console.log('[Sistema] Iniciando o servidor Node.js (Chama na Mesa)...');
  serverProcess = spawn('node', ['server.js'], {
    cwd: __dirname,
    shell: true
  });

  serverProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.log(`[Servidor] ${output}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Erro Servidor] ${data.toString().trim()}`);
  });

  serverProcess.on('close', (code) => {
    console.log(`[Sistema] Servidor encerrado com código ${code}. Reiniciando em 3 segundos...`);
    setTimeout(startServer, 3000);
  });
}

function startTunnel() {
  console.log('[Sistema] Iniciando túnel de conexão segura (Localtunnel)...');
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  tunnelProcess = spawn(npxCmd, ['-y', 'localtunnel', '--port', '3889', '--subdomain', 'chamanamesa-suporte8'], {
    cwd: __dirname,
    shell: true
  });

  tunnelProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output.includes('your url is:')) {
      console.log('\n======================================================');
      console.log('  CHAMA NA MESA ESTÁ NO AR!');
      console.log(`  URL de Acesso Permanente: https://chamanamesa-suporte8.loca.lt`);
      console.log('======================================================\n');
    } else if (output) {
      console.log(`[Túnel] ${output}`);
    }
  });

  tunnelProcess.stderr.on('data', (data) => {
    console.error(`[Erro Túnel] ${data.toString().trim()}`);
  });

  tunnelProcess.on('close', (code) => {
    console.log(`[Sistema] Túnel encerrado com código ${code}. Reiniciando em 3 segundos...`);
    setTimeout(startTunnel, 3000);
  });
}

// Iniciar ambos os serviços
startServer();
// Pequeno atraso para dar tempo ao servidor de subir
setTimeout(startTunnel, 1500);
