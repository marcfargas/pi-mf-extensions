/**
 * PowerShell PSSession Demo
 * 
 * This demo shows the new persistent PowerShell session capabilities:
 * - Local sessions with state persistence  
 * - Remote session configuration
 * - Session lifecycle management
 * - Infrastructure management patterns
 */

// Mock tools object for demonstration
const tools = {
  'pwsh-create-session': async (params) => console.log('Creating session:', params),
  'powershell': async (params) => console.log('Executing:', params),
  'pwsh-list-sessions': async (params) => console.log('Listing sessions:', params),
  'pwsh-close-session': async (params) => console.log('Closing session:', params),
};

async function demoLocalSessions() {
  console.log('\n🔧 LOCAL SESSION DEMO');
  console.log('===================');
  
  // Create a development session
  await tools['pwsh-create-session']({ name: 'dev' });

  // Set up environment once - state persists!
  await tools['powershell']({ 
    command: `
      $env:NODE_ENV = 'development'
      Set-Location 'C:\\Projects\\MyApp'
      Import-Module powershell-yaml
      Write-Output "Environment configured"
    `, 
    session: 'dev' 
  });

  // Use throughout development - variables and modules are still available
  await tools['powershell']({ 
    command: 'Write-Output "Working in: $(Get-Location) with NODE_ENV: $env:NODE_ENV"', 
    session: 'dev' 
  });

  // Define a custom function that persists
  await tools['powershell']({
    command: `
      function Get-ProjectStatus {
        $files = Get-ChildItem -Recurse *.js, *.ts | Measure-Object
        Write-Output "Project has $($files.Count) source files"
      }
      Get-ProjectStatus
    `,
    session: 'dev'
  });

  // Use the function later
  await tools['powershell']({ 
    command: 'Get-ProjectStatus', 
    session: 'dev' 
  });
}

async function demoRemoteSessions() {
  console.log('\n🌐 REMOTE SESSION DEMO');
  console.log('=====================');

  // Set up remote management sessions for infrastructure
  const servers = [
    { name: 'web01', host: 'web01.company.com' },
    { name: 'web02', host: 'web02.company.com' },
    { name: 'db01', host: 'db01.company.com' }
  ];

  for (const server of servers) {
    await tools['pwsh-create-session']({
      name: server.name,
      computerName: server.host,
      credential: 'domain\\admin',
      authentication: 'Kerberos'
    });
  }

  // Deploy to all web servers in parallel
  console.log('\nDeploying to web servers...');
  for (const server of ['web01', 'web02']) {
    // Each command runs on the remote server
    await tools['powershell']({
      command: 'Stop-Service IIS; Write-Output "IIS stopped on $(hostname)"',
      session: server
    });
    
    await tools['powershell']({
      command: 'Copy-Item "\\\\deploy\\app\\*" "C:\\inetpub\\wwwroot\\" -Recurse -Force',
      session: server
    });
    
    await tools['powershell']({
      command: 'Start-Service IIS; Write-Output "IIS started on $(hostname)"',
      session: server
    });
  }

  // Check database server health
  await tools['powershell']({
    command: 'Get-Service MSSQLSERVER | Format-Table Name, Status, StartType',
    session: 'db01'
  });

  // Monitoring across all servers
  console.log('\nChecking server health...');
  for (const server of servers) {
    await tools['powershell']({
      command: `
        $memory = Get-Process | Measure-Object WorkingSet -Sum
        $cpu = Get-Counter "\\Processor(_Total)\\% Processor Time" -SampleInterval 1 -MaxSamples 1
        Write-Output "$(hostname): Memory: $([math]::Round($memory.Sum/1GB, 2))GB, CPU: $($cpu.CounterSamples[0].CookedValue)%"
      `,
      session: server.name
    });
  }
}

async function demoSessionManagement() {
  console.log('\n📋 SESSION MANAGEMENT DEMO'); 
  console.log('==========================');

  // List all active sessions
  await tools['pwsh-list-sessions']({ verbose: true });

  // Test session connectivity  
  await tools['pwsh-test-session']({ name: 'dev' });

  // Get detailed session info
  await tools['pwsh-get-session']({ name: 'web01' });

  // Clean up specific session
  await tools['pwsh-close-session']({ name: 'dev' });

  // Clean up all sessions
  await tools['pwsh-close-all-sessions']();
}

async function demoAdvancedPatterns() {
  console.log('\n⚡ ADVANCED PATTERNS DEMO');
  console.log('========================');

  // Multi-environment deployment pattern
  await tools['pwsh-create-session']({ name: 'staging' });
  await tools['pwsh-create-session']({ 
    name: 'production',
    computerName: 'prod.company.com',
    credential: 'domain\\deploy-user',
    authentication: 'Kerberos'
  });

  // Same commands, different environments
  const deployScript = `
    Write-Output "Deploying to $(hostname)..."
    # Stop services
    Stop-Service MyAppService -ErrorAction SilentlyContinue
    
    # Backup current version
    Copy-Item "C:\\App" "C:\\App.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')" -Recurse
    
    # Deploy new version
    Copy-Item "\\\\build\\MyApp\\*" "C:\\App\\" -Recurse -Force
    
    # Start services
    Start-Service MyAppService
    Write-Output "Deployment complete on $(hostname)"
  `;

  // Deploy to staging first
  await tools['powershell']({ command: deployScript, session: 'staging' });

  // If staging successful, deploy to production
  await tools['powershell']({ command: deployScript, session: 'production' });

  // Verify both environments
  const healthCheck = 'Get-Service MyAppService | Select-Object Name, Status';
  await tools['powershell']({ command: healthCheck, session: 'staging' });
  await tools['powershell']({ command: healthCheck, session: 'production' });
}

// Run all demos
async function runDemo() {
  console.log('🚀 PowerShell PSSession Demo');
  console.log('============================');
  console.log('This demo shows the new persistent PowerShell session capabilities.');
  
  await demoLocalSessions();
  await demoRemoteSessions(); 
  await demoSessionManagement();
  await demoAdvancedPatterns();

  console.log('\n✅ Demo complete!');
  console.log('\nKey Benefits:');
  console.log('• State persistence across commands (variables, modules, functions)');
  console.log('• Remote Windows infrastructure management');
  console.log('• Efficient multi-server operations');
  console.log('• Clean session lifecycle management');
  console.log('• Perfect for AI agents managing Windows environments');
}

// Uncomment to run demo:
// runDemo().catch(console.error);

module.exports = {
  demoLocalSessions,
  demoRemoteSessions,
  demoSessionManagement,
  demoAdvancedPatterns,
  runDemo
};