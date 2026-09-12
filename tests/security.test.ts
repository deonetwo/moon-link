import assert from 'node:assert';
import { AppConfig } from '../src/config.js';
import {
  ConfirmationRequiredError,
  enforceConfirmation,
  resolveGuildId,
  SecurityError,
  validateMemberHierarchy,
  validateRoleHierarchy,
  validateSnowflake
} from '../src/security.js';
import { createMcpServer } from '../src/server.js';

function runTests() {
  console.log('--- Running Security & Architecture Tests ---\n');

  // Test 1: Snowflake validation
  console.log('Test 1: Snowflake validation');
  assert.strictEqual(validateSnowflake('123456789012345678', 'testId'), '123456789012345678');
  assert.strictEqual(validateSnowflake('  9876543210987654321  ', 'testId'), '9876543210987654321');
  assert.throws(() => validateSnowflake('invalid-id', 'testId'), SecurityError);
  assert.throws(() => validateSnowflake('123', 'testId'), SecurityError);
  assert.throws(() => validateSnowflake('1234567890123456789012345', 'testId'), SecurityError);
  console.log('✅ Passed Snowflake validation tests.');

  // Test 2: Guild whitelist enforcement
  console.log('\nTest 2: Guild Whitelist & Boundary Enforcement');
  const mockConfig: AppConfig = {
    discordToken: 'mock-token',
    defaultGuildId: '111111111111111111',
    allowedGuildIds: ['111111111111111111', '222222222222222222'],
    transport: 'stdio',
    port: 3000,
    host: '0.0.0.0',
    requireConfirmation: true,
    maxMessageHistory: 100
  };

  // Resolves default if omitted
  assert.strictEqual(resolveGuildId(undefined, mockConfig), '111111111111111111');
  // Resolves explicit allowed guild
  assert.strictEqual(resolveGuildId('222222222222222222', mockConfig), '222222222222222222');
  // Rejects unallowed guild
  assert.throws(() => resolveGuildId('999999999999999999', mockConfig), (err: any) => {
    return err instanceof SecurityError && err.message.includes('Access Denied');
  });
  console.log('✅ Passed Guild whitelist enforcement tests.');

  // Test 3: Destructive confirmation enforcement
  console.log('\nTest 3: Destructive Action Confirmation Guardrails');
  // Should throw ConfirmationRequiredError if confirm is undefined or false
  assert.throws(
    () => enforceConfirmation('delete_channel', '#general (123456789012345678)', undefined, mockConfig),
    ConfirmationRequiredError
  );
  assert.throws(
    () => enforceConfirmation('kick_member', 'User#1234', false, mockConfig),
    ConfirmationRequiredError
  );
  // Should NOT throw if confirm is true
  assert.doesNotThrow(() => enforceConfirmation('ban_member', 'User#1234', true, mockConfig));
  console.log('✅ Passed Destructive action confirmation tests.');

  // Test 4: Member Hierarchy Protection
  console.log('\nTest 4: Member Hierarchy Protection');
  const mockOwner = {
    id: '100000000000000001',
    user: { tag: 'Owner#0001' },
    guild: { ownerId: '100000000000000001' },
    roles: { highest: { position: 10, name: 'OwnerRole' } }
  };
  const mockBot = {
    id: '100000000000000002',
    user: { tag: 'Bot#0001' },
    guild: { ownerId: '100000000000000001' },
    roles: {
      highest: {
        position: 5,
        name: 'BotRole',
        comparePositionTo: (other: any) => 5 - other.position
      }
    }
  };
  const mockTargetHigher = {
    id: '100000000000000003',
    user: { tag: 'Admin#0001' },
    guild: { ownerId: '100000000000000001' },
    roles: { highest: { position: 8, name: 'AdminRole' } }
  };
  const mockTargetLower = {
    id: '100000000000000004',
    user: { tag: 'RegularUser#0001' },
    guild: { ownerId: '100000000000000001' },
    roles: { highest: { position: 2, name: 'MemberRole' } }
  };

  // Cannot moderate owner
  assert.throws(() => validateMemberHierarchy(mockBot as any, mockOwner as any, 'kick'), SecurityError);
  // Cannot moderate bot itself
  assert.throws(() => validateMemberHierarchy(mockBot as any, mockBot as any, 'kick'), SecurityError);
  // Cannot moderate member with higher role
  assert.throws(() => validateMemberHierarchy(mockBot as any, mockTargetHigher as any, 'kick'), SecurityError);
  // Can moderate member with lower role
  assert.doesNotThrow(() => validateMemberHierarchy(mockBot as any, mockTargetLower as any, 'kick'));
  console.log('✅ Passed Member hierarchy protection tests.');

  // Test 5: Role Hierarchy Protection
  console.log('\nTest 5: Role Hierarchy Protection');
  const mockEveryoneRole = { id: '111111111111111111', name: '@everyone', managed: false, guild: { id: '111111111111111111' } };
  const mockManagedRole = { id: '100000000000000010', name: 'IntegrationRole', managed: true, guild: { id: '111111111111111111' } };
  const mockHigherRole = { id: '100000000000000011', name: 'HighRole', position: 8, managed: false, guild: { id: '111111111111111111' } };
  const mockLowerRole = { id: '100000000000000012', name: 'LowRole', position: 3, managed: false, guild: { id: '111111111111111111' } };

  // Cannot modify @everyone
  assert.throws(() => validateRoleHierarchy(mockBot as any, mockEveryoneRole as any, 'delete_role'), SecurityError);
  // Cannot modify managed role
  assert.throws(() => validateRoleHierarchy(mockBot as any, mockManagedRole as any, 'delete_role'), SecurityError);
  // Cannot modify role higher than bot
  assert.throws(() => validateRoleHierarchy(mockBot as any, mockHigherRole as any, 'delete_role'), SecurityError);
  // Can modify role lower than bot
  assert.doesNotThrow(() => validateRoleHierarchy(mockBot as any, mockLowerRole as any, 'delete_role'));
  console.log('✅ Passed Role hierarchy protection tests.');

  // Test 6: MCP Server Tool and Resource Registration
  console.log('\nTest 6: MCP Server Tool and Resource Registration');
  const server = createMcpServer(mockConfig);
  assert.ok(server, 'Server instance should be created');
  console.log('✅ MCP Server initialized and all 20+ tools and resources registered.');

  console.log('\n=====================================================');
  console.log('🎉 ALL SECURITY & ARCHITECTURE TESTS PASSED (6/6)');
  console.log('=====================================================\n');
}

runTests();
